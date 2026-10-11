import { describe, it, expect } from 'vitest';
import { parseLogLine } from '../src/log.js';
import {
  classifyZone,
  runsTick,
  reduceRuns,
  closeRuns,
  newRunsState,
  sessionMarkdown,
  appendRunsToJsonl,
  appendSessionToJsonl,
  RUNS_FORMAT_VERSION,
} from '../src/runsTracker.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * P4-б (№281-W2): runs/sessions FSM — паттерны dillapoe2stat (без LICENSE,
 * только модель): Map→Abyss→Map→Town; town НЕ открывает run (0 false
 * map-enters — главный гейт спеки); лог-мерцание гасится debounce;
 * персист append-only JSONL (философия квант-ядра №7).
 */

/** Событие из строки Client.txt. */
const E = (line: string) => parseLogLine(line)!;

const area = (ts: string, level: number, code: string) =>
  E(`2026/06/04 ${ts} 77440000 3ef23344 [INFO Client 29396] Generating level ${level} area "${code}" with seed 123`);
const death = (ts: string) =>
  E(`2026/06/04 ${ts} 77440000 3ef23344 [INFO Client 29396] : Pandaren has been slain.`);
const lvl = (ts: string, level: number) =>
  E(`2026/06/04 ${ts} 77440000 3ef23344 [INFO Client 29396] : Pandaren (Invoker) is now level ${level}`);

describe('runsTracker FSM (P4-б, №281-W2)', () => {
  it('classifyZone: town/map/abyss/boss/leveling', () => {
    expect(classifyZone('G4_town')).toBe('safe');
    expect(classifyZone('MapRustbowl')).toBe('map');
    expect(classifyZone('Abyss_Hub')).toBe('abyss');
    expect(classifyZone('P2_1')).toBe('boss');
    expect(classifyZone('G3_10_Airlock')).toBe('leveling');
    expect(classifyZone('SomethingUnknown123')).toBe('safe'); // неизвестное не открывает run
  });

  it('golden-кейс спеки: Map→Abyss_Hub→Map→Town: один run, abyss = фаза, town закрывает', () => {
    const events = [
      area('10:00:00', 78, 'MapRustbowl'),
      area('10:03:00', 78, 'Abyss_Hub'),
      area('10:07:00', 78, 'MapAugury'),
      area('10:12:00', 65, 'Endgame_town'),
    ];
    const fin = closeRuns(reduceRuns(events), '2026/06/04 10:12:00');
    expect(fin.state.runs.length).toBe(1);
    const run = fin.state.runs[0]!;
    expect(run.format_version).toBe(RUNS_FORMAT_VERSION);
    expect(run.mode).toBe('map');
    expect(run.zones).toEqual(['MapRustbowl', 'Abyss_Hub', 'MapAugury']);
    expect(run.exitTs).toBe('2026/06/04 10:12:00');
    expect(fin.state.currentRun).toBeNull(); // закрыт самим тиком town, не closeRuns
    expect(fin.closedRuns).toEqual([]);
  });

  it('town не открывает run: кампания+город = 0 runs (0 false map-enters)', () => {
    const events = [
      area('10:00:00', 10, 'G1_town'),
      area('10:01:00', 10, 'G1_2'),
      area('10:05:00', 11, 'G1_5'),
      area('10:09:00', 11, 'G1_town'),
    ];
    const fin = closeRuns(reduceRuns(events), '2026/06/04 10:09:00');
    expect(fin.state.runs.length).toBe(0);
    expect(fin.state.zonesVisited.length).toBe(3); // town дважды — одна запись
  });

  it('debounce: подряд дубликаты area_change той же зоны не создают и ничего не ломают', () => {
    let s = newRunsState('s1', '2026/06/04 09:00:00');
    s = runsTick(s, area('09:00:01', 78, 'MapRustbowl')).state;
    s = runsTick(s, area('09:00:02', 78, 'MapRustbowl')).state; // мерцание
    s = runsTick(s, area('09:00:03', 78, 'MapRustbowl')).state;
    expect(s.runs.length).toBe(0);
    expect(s.currentRun!.zones).toEqual(['MapRustbowl']); // один вход, без дублей
    expect(s.areaHistory.length).toBe(1);
  });

  it('смерть в run инкрементирует deathsInRun и сессию; после смерти в город run закрыт', () => {
    const events = [
      area('10:00:00', 78, 'MapBastille'),
      death('10:02:00'),
      area('10:02:30', 65, 'Endgame_town'),
      area('10:04:00', 79, 'MapArroyo'),
      area('10:05:00', 65, 'Endgame_town'),
    ];
    const fin = closeRuns(reduceRuns(events), '2026/06/04 10:05:00');
    expect(fin.state.deaths).toBe(1);
    expect(fin.state.runs.length).toBe(2);
    expect(fin.state.runs[0]!.deathsInRun).toBe(1);
    expect(fin.state.runs[1]!.deathsInRun).toBe(0);
    expect(fin.state.runs[0]!.exitTs).toBe('2026/06/04 10:02:30');
  });

  it('level_up: levelStart/levelEnd, тик смерти вне run не падает', () => {
    const events = [lvl('10:00:00', 86), death('10:01:00'), lvl('10:10:00', 87)];
    const fin = closeRuns(reduceRuns(events), '2026/06/04 10:10:00');
    expect(fin.finishedSession.levelStart).toBe(86);
    expect(fin.finishedSession.levelEnd).toBe(87);
    expect(fin.finishedSession.deaths).toBe(1);
  });

  it('log_opening: закрытие прошлой сессии + новая с finishedSession', () => {
    let s = newRunsState('s1', '2026/06/04 09:00:00');
    s = runsTick(s, area('09:00:01', 78, 'MapRustbowl')).state;
    const t = runsTick(s, E('2026/06/04 12:00:00 1 2 [INFO Client 29396] ***** LOG FILE OPENING *****'));
    expect(t.sessionOpened).toBe(true);
    expect(t.finishedSession!.runs.length).toBe(1);
    expect(t.finishedSession!.runs[0]!.exitTs).toBe('2026/06/04 12:00:00');
    expect(t.state.sessionId).not.toBe('s1');
    expect(t.state.character).toBeNull();
  });

  it('runsTick не мутирует входное состояние (чистый редьюсер)', () => {
    const s0 = newRunsState('s1', '2026/06/04 09:00:00');
    const t = runsTick(s0, area('09:00:01', 78, 'MapRustbowl'));
    expect(s0.currentRun).toBeNull();
    expect(t.state.currentRun).not.toBeNull();
  });

  it('jsonl-персист: append-only, две записи = две строки', () => {
    const dir = mkdtempSync(join(tmpdir(), 'poe2kit-runs-'));
    const f = join(dir, 'runs.jsonl');
    const s = reduceRuns([area('10:00:00', 78, 'MapRustbowl')]);
    const fin = closeRuns(s, '2026/06/04 10:05:00');
    appendRunsToJsonl(fin.closedRuns, f);
    appendSessionToJsonl(fin.finishedSession, join(dir, 'sessions.jsonl'));
    const lines = readFileSync(f, 'utf8').trim().split('\n');
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]!).run_id).toBe(fin.closedRuns[0]!.run_id);
    const sess = readFileSync(join(dir, 'sessions.jsonl'), 'utf8').trim().split('\n');
    expect(JSON.parse(sess[0]!).session_id).toBe(fin.finishedSession.session_id);
    rmSync(dir, { recursive: true, force: true });
  });

  it('sessionMarkdown: готовый блок с runs', () => {
    const fin = closeRuns(
      reduceRuns([area('10:00:00', 78, 'MapRustbowl'), death('10:02:00'), area('10:02:30', 65, 'Endgame_town'), lvl('10:03:00', 88)]),
      '2026/06/04 10:03:00',
    );
    const md = sessionMarkdown(fin.finishedSession);
    expect(md).toContain('**Сессия');
    expect(md).toContain('💀×1');
    expect(md).toContain('MapRustbowl');
  });
});

