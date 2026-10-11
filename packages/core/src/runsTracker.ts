/**
 * Runs/sessions-трекер поверх событий log.ts (P4-б, №281-W2).
 *
 * Паттерны (НЕ код) из `_research/dillapoe2stat` (нет LICENSE):
 *  - Run/Session-модель (poe_logging.py:101-141): визит в карту + сессия;
 *  - FSM классификации зон (auto_map_detector.py:41-211): Map→Abyss→Map→Town,
 *    safe/leveling-зоны НЕ открывают run; Abyss — фаза текущего run;
 *    debounce-история зон (кольцевой буфер, мерцания area_change).
 * Тик — event-driven (push события), не poll: их poll 1.0s + backoff
 * (auto_map_detector.py:233-237) — известные грабли, обходим.
 *
 * Персист: append-only JSONL (~/.poe2-kit/runs.jsonl, sessions.jsonl) —
 * та же философия, что квантовое ядро журнала кубов (append-only, №7).
 */

import type { ClientLogEvent } from './log.js';
import { decodeZoneCode } from './log.js';
import { IS_NODE, fsMod, pathMod, osMod } from './nodeenv.js';

/** Формат записи в runs.jsonl (self-describing, dillapoe2stat-паттерн). */
export const RUNS_FORMAT_VERSION = 1;

/** Тип run-визита. */
export type RunMode = 'map' | 'abyss' | 'boss';

/** Класс зоны для FSM. */
export type ZoneClass = 'safe' | 'leveling' | 'map' | 'abyss' | 'boss';

/** Run — один визит в эндгейм-контент (waystone-карта). */
export interface TrackedRun {
  format_version: number;
  run_id: string;
  session_id: string;
  character: string | null;
  zoneCode: string;
  zoneName: string | null;
  areaLevel: number | null;
  mode: RunMode;
  /** Все зоны run по порядку (map → abyss-фазы → …). */
  zones: string[];
  enterTs: string;
  exitTs: string | null;
  deathsInRun: number;
}

/** Session — LOG FILE OPENING → EOF/закрытие. */
export interface TrackedSession {
  format_version: number;
  session_id: string;
  character: string | null;
  startTs: string;
  endTs: string | null;
  deaths: number;
  levelStart: number | null;
  levelEnd: number | null;
  zonesVisited: string[];
  runs: TrackedRun[];
}

/** Внутреннее состояние FSM (чистый редьюсер — тестируемо без watcher). */
export interface RunsState {
  sessionId: string;
  sessionStartTs: string;
  character: string | null;
  levelStart: number | null;
  levelEnd: number | null;
  deaths: number;
  runs: TrackedRun[];
  currentRun: TrackedRun | null;
  zonesVisited: string[];
  /** Кольцевой буфер последних кодов зон (debounce мерцаний, maxlen 15). */
  areaHistory: string[];
  runCounter: number;
}

/** Что FSM-тик вернул наружу (для персиста/подписчиков). */
export interface RunsTickResult {
  state: RunsState;
  /** Run, закрытые этим тиком (готовы к append в jsonl). */
  closedRuns: TrackedRun[];
  /** true, если этот тик открыл новую сессию (log_opening). */
  sessionOpened: boolean;
  /** Оконченная сессия, если новая открылась (для append в sessions.jsonl). */
  finishedSession: TrackedSession | null;
}

const AREA_HISTORY_MAX = 15;

/**
 * Классификация кода зоны (dillapoe2stat auto_map_detector-паттерн):
 *  - `*_town` — safe (выход из run);
 *  - `Map*` — эндгейм-карта (maps.json: MapRustbowl и 135 др.);
 *  - `Abyss*` — фаза текущего run;
 *  - `P\d_*` — пиннакл/boss-контент (пример из Client.txt: P2_1);
 *  - прочее (G1..G4-кампания) — leveling, run НЕ открывает.
 */
export function classifyZone(areaCode: string): ZoneClass {
  if (/_town$/.test(areaCode) || /^Hideout/.test(areaCode)) return 'safe';
  if (/^Map/.test(areaCode)) return 'map';
  if (/^Abyss/.test(areaCode)) return 'abyss';
  if (/^P\d+_/.test(areaCode) || /^Boss/.test(areaCode)) return 'boss';
  const d = decodeZoneCode(areaCode);
  return d && d.act >= 1 ? 'leveling' : 'safe'; // неизвестное не открывает run
}

/** Новое состояние (новая сессия). */
export function newRunsState(sessionId: string, startTs: string, character: string | null = null): RunsState {
  return {
    sessionId,
    sessionStartTs: startTs,
    character,
    levelStart: null,
    levelEnd: null,
    deaths: 0,
    runs: [],
    currentRun: null,
    zonesVisited: [],
    areaHistory: [],
    runCounter: 0,
  };
}

function sessionSnapshot(s: RunsState): TrackedSession {
  const { sessionId, sessionStartTs, character, levelStart, levelEnd, deaths, runs, zonesVisited } = s;
  return {
    format_version: RUNS_FORMAT_VERSION,
    session_id: sessionId,
    character,
    startTs: sessionStartTs,
    endTs: null,
    deaths,
    levelStart,
    levelEnd,
    zonesVisited: [...zonesVisited],
    runs: [...runs],
  };
}

/** Детерминированный id: uuid если есть crypto, иначе session-N. */
function makeRunId(s: RunsState): string {
  const c = globalThis.crypto as Crypto | undefined;
  return c?.randomUUID ? c.randomUUID() : `${s.sessionId}-run${s.runCounter}`;
}

/**
 * Один тик FSM: одно событие лога → новое состояние (чистая функция,
 * state не мутируется — вызывающий хранит result.state).
 */
export function runsTick(state: RunsState, ev: ClientLogEvent): RunsTickResult {
  let s: RunsState = {
    ...state,
    runs: [...state.runs],
    zonesVisited: [...state.zonesVisited],
    areaHistory: [...state.areaHistory],
  };
  let closedRuns: TrackedRun[] = [];
  let sessionOpened = false;
  let finishedSession: TrackedSession | null = null;

  switch (ev.kind) {
    case 'log_opening': {
      // Новая сессия: текущий run и прежняя сессия закрываются.
      if (s.currentRun) {
        s.currentRun.exitTs = ev.timestamp;
        s.runs.push(s.currentRun);
        closedRuns = [s.currentRun];
        s.currentRun = null;
      }
      finishedSession = s.sessionStartTs === ev.timestamp ? null : sessionSnapshot(s);
      // Новая сессия с новым id (счётчик внутри id — детерминированно для тестов).
      const fresh = newRunsState(`${ev.timestamp.replace(/[/ :]/g, '-')}`, ev.timestamp);
      fresh.character = s.character;
      fresh.levelStart = s.levelEnd;
      s = fresh;
      sessionOpened = true;
      break;
    }
    case 'level_up': {
      s.character = ev.character ?? s.character;
      if (s.levelStart == null) s.levelStart = ev.level ?? null;
      s.levelEnd = ev.level ?? s.levelEnd;
      break;
    }
    case 'death': {
      s.deaths += 1;
      if (s.currentRun) s.currentRun.deathsInRun += 1;
      break;
    }
    case 'area_change': {
      const code = ev.areaCode ?? '';
      // Debounce мерцаний: повтор той же зоны подряд — не событие FSM.
      const last = s.areaHistory[s.areaHistory.length - 1];
      if (code === last) break;
      s.areaHistory.push(code);
      if (s.areaHistory.length > AREA_HISTORY_MAX) s.areaHistory.shift();

      // Смерть в зоне часто логируется как area_change назад → фактический
      // выход из run произойдёт классификацией ниже; deaths считаем по kind.
      if (!s.zonesVisited.includes(code)) s.zonesVisited.push(code);

      const klass = classifyZone(code);
      if (klass === 'safe' || klass === 'leveling') {
        if (s.currentRun) {
          s.currentRun.exitTs = ev.timestamp;
          s.runs.push(s.currentRun);
          closedRuns = [s.currentRun];
          s.currentRun = null;
        }
        break;
      }
      const mode: RunMode = klass === 'abyss' ? 'abyss' : klass === 'boss' ? 'boss' : 'map';
      if (!s.currentRun) {
        // on_map_enter (auto_map_detector-паттерн).
        s.runCounter += 1;
        s.currentRun = {
          format_version: RUNS_FORMAT_VERSION,
          run_id: makeRunId(s),
          session_id: s.sessionId,
          character: s.character,
          zoneCode: code,
          zoneName: decodeZoneCode(code)?.englishName ?? null,
          areaLevel: ev.areaLevel ?? null,
          mode,
          zones: [code],
          enterTs: ev.timestamp,
          exitTs: null,
          deathsInRun: 0,
        };
      } else {
        // Abyss-фаза/новая карта внутри run — остаёмся в run, зона дописывается.
        s.currentRun.zones.push(code);
        if (mode !== 'abyss' && s.currentRun.mode === 'map') s.currentRun.mode = mode;
      }
      break;
    }
    default:
      break;
  }

  return { state: s, closedRuns, sessionOpened, finishedSession };
}

/** Свернуть поток событий лога в состояние (удобно для replay/summary). */
export function reduceRuns(events: ClientLogEvent[], sessionId = 'session'): RunsState {
  let s = newRunsState(sessionId, events[0]?.timestamp ?? '');
  for (const ev of events) s = runsTick(s, ev).state;
  return s;
}

/** Закрыть всё, что открыто (конец чтения лога/EOF): возвращает закрытые runs. */
export function closeRuns(state: RunsState, endTs: string): { state: RunsState; closedRuns: TrackedRun[]; finishedSession: TrackedSession } {
  const s: RunsState = { ...state, runs: [...state.runs], zonesVisited: [...state.zonesVisited] };
  const closed: TrackedRun[] = [];
  if (s.currentRun) {
    s.currentRun.exitTs = endTs;
    s.runs.push(s.currentRun);
    closed.push(s.currentRun);
    s.currentRun = null;
  }
  return { state: s, closedRuns: closed, finishedSession: sessionSnapshot(s) };
}

// ─── Персист (append-only JSONL) ─────────────────────────────────────────────

/** Дефолтный каталог данных: ~/.poe2-kit (node-only). */
export function defaultRunsDir(): string | null {
  if (!IS_NODE || !osMod || !pathMod) return null;
  const home = osMod.homedir();
  return home ? pathMod.join(home, '.poe2-kit') : null;
}

function appendJsonl(filePath: string, records: unknown[]): void {
  if (!IS_NODE || !fsMod || !pathMod || !records.length) return;
  fsMod.mkdirSync(pathMod.dirname(filePath), { recursive: true });
  const chunk = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  fsMod.appendFileSync(filePath, chunk, 'utf8');
}

/** Дописать закрытые runs в runs.jsonl (append-only, №7-философия). */
export function appendRunsToJsonl(runs: TrackedRun[], filePath: string): void {
  appendJsonl(filePath, runs);
}

/** Дописать сессию в sessions.jsonl. */
export function appendSessionToJsonl(session: TrackedSession, filePath: string): void {
  appendJsonl(filePath, [session]);
}

// ─── Markdown-сводка (для poe2_log_summary / коллапса в журнал) ──────────────

/**
 * Markdown-сводка сессии: runs, смерти, дельта уровней, зоны.
 * Формат — готовый блок для вставки ИИ-сессией в журнал (НЕ автозапись).
 */
export function sessionMarkdown(s: TrackedSession): string {
  const lines: string[] = [];
  const lvl =
    s.levelStart != null && s.levelEnd != null && s.levelEnd !== s.levelStart
      ? `${s.levelStart} → ${s.levelEnd}`
      : (s.levelEnd ?? s.levelStart ?? '?');
  lines.push(`**Сессия ${s.startTs}${s.character ? ` · ${s.character}` : ''}:** уровень ${lvl}, смертей ${s.deaths}, зон посещено ${s.zonesVisited.length}, runs ${s.runs.length}.`);
  for (const r of s.runs) {
    const mins = r.exitTs && r.enterTs ? durationMinutes(r.enterTs, r.exitTs) : null;
    const death = r.deathsInRun > 0 ? ` · 💀×${r.deathsInRun}` : '';
    const spent = mins != null ? ` · ~${mins} мин` : '';
    lines.push(`- **${r.zoneName ?? r.zoneCode}** (T${r.areaLevel ?? '?'} · ${r.mode})${death}${spent}`);
  }
  return lines.join('\n');
}

function durationMinutes(enterTs: string, exitTs: string): number | null {
  const t = (s: string) => Date.parse(s.replace(/\//g, '-').replace(' ', 'T'));
  const a = t(enterTs);
  const b = t(exitTs);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.round((b - a) / 60000);
}
