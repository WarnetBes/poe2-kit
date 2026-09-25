/**
 * Живое состояние игры из лога Client.txt (Path of Exile 2).
 *
 * PoE2-клиент дописывает структурированный поток событий с таймстампами в
 * `logs/Client.txt` (append-only, сотни МБ). Это ЛОКАЛЬНЫЙ источник данных —
 * без сети, API и POESESSID: текущая зона, уровень персонажа, смерти, сессии.
 *
 * Идеи и форматы строк перенесены из исследованных репозиториев (алгоритмы,
 * без копирования кода):
 *  - _research/poe2-mcp-server/src/services/logfile.ts (коды зон G{act}_{area},
 *    таблица ZONE_NAMES, разбор строк — перевод в TS: факты об игре считаем
 *    данными, авторство форматов отмечено здесь)
 *  - _research/path-of-levelling-2/src/main/services/LogWatcherService.ts
 *    (инкрементальное чтение новых строк, трекеры зоны/уровня)
 *  - _research/exiled-exchange-2 (пути установки клиента под win32/linux/darwin)
 *  - _research/hivemind-poe2-mcp/src/api/client_log_reader.py
 *    (bounded-tail чтение через seek, свёртка событий в текущее состояние)
 */

// Браузер: живое чтение Client.txt недоступно (node-only). В браузере
// функции поиска/чтения лога честно возвращают пустоту — см. IS_NODE-guard'ы.
import { IS_NODE, fsMod, osMod, pathMod } from './nodeenv.js';

// ─── Коды зон ────────────────────────────────────────────────────────────────

/** Разобранный код зоны PoE2. Формат: G{act}_{area}[_{suffix}]. */
export interface DecodedZoneCode {
  act: number;
  areaIndex: number | null;
  suffix: string | null;
  description: string;
  englishName: string | null;
}

/** Канонические английские имена зон по внутреннему коду. */
const ZONE_NAMES: Record<string, string> = {
  // Act 1
  G1_town: 'Clearfell Encampment',
  G1_1: 'The Riverways',
  G1_2: 'Clearfell',
  G1_3: 'The Mud Burrow',
  G1_4: 'Ogham Farmlands',
  G1_5: 'Ogham Village',
  G1_6: 'The Grim Tangle',
  G1_7: 'Cemetery of the Eternals',
  G1_8: 'Mausoleum of the Praetor',
  G1_9: 'Freythorn',
  G1_10: 'The Hunting Grounds',
  G1_11: 'Red Vale',
  G1_12: 'The Grelwood',
  G1_13: 'The Bloated Miller',
  G1_14: 'Shrine of the Grelwood Wanderer',
  // Act 2
  G2_town: 'Vastiri Outskirts',
  G2_1: 'Mawdun Quarry',
  G2_2: 'The Bone Pits',
  G2_3: 'Valley of Bones',
  G2_4: 'Deshar',
  G2_5: 'The Halani Gates',
  G2_6: 'The Path of Mourning',
  G2_7: 'Mastodon Cemetary',
  G2_8: 'Sandswept Marsh',
  G2_9: 'Keth',
  G2_10: "Traitor's Passage",
  G2_11: 'The Lost City',
  G2_12: 'The Dreadnought',
  G2_13: 'Dreadnought Vanguard',
  G2_14: 'The Titan Grotto',
  G2_15: 'The Drowned City',
  // Act 3
  G3_town: 'Ziggurat Encampment',
  G3_1: 'Jungle Ruins',
  G3_2: 'Infested Barrens',
  G3_3: 'Jungle Depths',
  G3_4: "Jiquani's Machinarium",
  G3_5: 'Chimeral Wetlands',
  G3_6: 'The Azak Bog',
  G3_7: 'Aggorat',
  G3_8: 'Utzaal',
  G3_9: 'Apex of Filth',
  G3_10: 'The Trial of Chaos',
  G3_11: 'The Temple of Chaos',
  G3_10_Airlock: 'Temple of Chaos (Entrance)',
  G3_Vault_Present: 'Treasure Vault (Present)',
  G3_Vault_Past: 'Treasure Vault (Past)',
  // Act 4
  G4_town: 'Ngakuramakoi',
  G4_1: 'Kingsmarch',
  G4_2: 'Rocky Outcrop',
  G4_3: 'Volcanic Island',
  G4_4: "Castaway's Isle",
  G4_5: 'Island of the Wai-Tangi',
  G4_6: 'Coastal Path',
  G4_7: 'Moata Shore',
  G4_8: "Journey's End",
  G4_9: 'Isle of Kin',
  G4_10: 'Hidden Vaults',
  G4_11: 'Slave Pens',
  G4_12: 'Moten Fortress',
};

/** Разобрать код зоны `G{act}_{area}[_{suffix}]` в структуру. */
export function decodeZoneCode(areaId: string): DecodedZoneCode | null {
  const match = /^G(\d+)_(\w+?)(?:_(.+))?$/.exec(areaId);
  if (!match) return null;
  const act = parseInt(match[1]!, 10);
  const areaRaw = match[2]!;
  const suffix = match[3] ?? null;
  const areaIndex = /^\d+$/.test(areaRaw) ? parseInt(areaRaw, 10) : null;
  const englishName = ZONE_NAMES[areaId] ?? null;
  let description = `Act ${act}`;
  if (areaRaw === 'town') description += ' Town';
  else if (areaIndex !== null) description += `, area ${areaIndex}`;
  else description += ` (${areaRaw})`;
  if (suffix) description += ` [${suffix}]`;
  return { act, areaIndex, suffix, description, englishName };
}

// ─── События лога ────────────────────────────────────────────────────────────

/** Тип события лога. */
export type LogEventKind =
  | 'level_up'
  | 'area_change'
  | 'death'
  | 'afk'
  | 'whisper'
  | 'items_identified'
  | 'instance_connect';

/** Типизированное событие из строки Client.txt. */
export interface ClientLogEvent {
  kind: LogEventKind;
  /** ГГГГ/ММ/ДД ЧЧ:ММ:СС (сырая строка лога, локальное время клиента). */
  timestamp: string;
  /** Имя персонажа (level_up / death), если применимо. */
  character?: string;
  /** Класс/асценданси из события level_up. */
  klass?: string;
  level?: number;
  areaCode?: string;
  areaLevel?: number;
  seed?: number;
  server?: string;
  afkState?: 'ON' | 'OFF';
  whisperDirection?: 'From' | 'To';
  count?: number;
  /** Сырое тело сообщения. */
  raw: string;
}

// Общий префикс строки: дата, uptime-счётчик, hex-хэш, [LEVEL Client PID].
const PREFIX_RE =
  /^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}) \d+ [0-9a-fA-F]+ \[\w+ Client \d+\] (.+)$/;
// Шаблоны тела сообщения → тип события. Порядок важен: специфичнее — раньше.
const EVENT_PATTERNS: Array<[LogEventKind, RegExp]> = [
  ['level_up', /^: ([^\s(]+) \(([^)]+)\) is now level (\d+)/],
  ['area_change', /Generating level (\d+) area "([^"]+)" with seed (\d+)/],
  ['instance_connect', /Connecting to instance server at ([\d.]+:\d+)/],
  ['death', /^: ([^\s(]+) has been slain\./],
  ['afk', /^: AFK mode is now (ON|OFF)/],
  ['whisper', /^@(From|To) ([^:]+): (.*)$/],
  ['items_identified', /^: (\d+) Items? identified/],
];

/** Разобрать одну строку лога в типизированное событие (или null). */
export function parseLogLine(line: string): ClientLogEvent | null {
  const m = PREFIX_RE.exec(line);
  if (!m) return null;
  const ts = m[1]!;
  const body = m[2]!;
  for (const [kind, re] of EVENT_PATTERNS) {
    const e = re.exec(body);
    if (!e) continue;
    const ev: ClientLogEvent = { kind, timestamp: ts, raw: body };
    switch (kind) {
      case 'level_up':
        ev.character = e[1];
        ev.klass = e[2];
        ev.level = parseInt(e[3]!, 10);
        break;
      case 'area_change':
        ev.areaLevel = parseInt(e[1]!, 10);
        ev.areaCode = e[2]!;
        ev.seed = parseInt(e[3]!, 10);
        break;
      case 'instance_connect':
        ev.server = e[1];
        break;
      case 'death':
        ev.character = e[1];
        break;
      case 'afk':
        ev.afkState = e[1] as 'ON' | 'OFF';
        break;
      case 'whisper':
        ev.whisperDirection = e[1] as 'From' | 'To';
        break;
      case 'items_identified':
        ev.count = parseInt(e[1]!, 10);
        break;
    }
    return ev;
  }
  return null;
}

// ─── Поиск файла лога ────────────────────────────────────────────────────────

/** Кандидаты путей установки PoE2 (Steam / standalone / доп. библиотеки Steam). */
function installCandidates(): string[] {
  if (!IS_NODE) return [];
  const p = (drive: string, root: string) =>
    pathMod!.join(drive, root, 'logs');
  const roots = [
    'Program Files (x86)\\Steam\\steamapps\\common\\Path of Exile 2',
    'Program Files\\Steam\\steamapps\\common\\Path of Exile 2',
    'Program Files (x86)\\Grinding Gear Games\\Path of Exile 2',
    'Program Files\\Grinding Gear Games\\Path of Exile 2',
    'SteamLibrary\\steamapps\\common\\Path of Exile 2',
  ];
  const out: string[] = [];
  if (process.platform === 'win32') {
    // Все смонтированные диски A..Z (F:, G:, ... — Steam-библиотеки часто на.addData)
    const drives: string[] = [];
    for (let code = 67; code <= 90; code++) {
      const d = `${String.fromCharCode(code)}:`;
      try {
        if (fsMod!.existsSync(`${d}\\`)) drives.push(d);
      } catch {
        /* диск недоступен — пропускаем */
      }
    }
    for (const d of drives) for (const r of roots) out.push(p(d, r));
  }
  if (process.platform === 'darwin') {
    out.push(pathMod!.join(osMod!.homedir(), 'Library/Application Support/Steam/steamapps/common/Path of Exile 2/logs'));
  }
  if (process.platform === 'linux') {
    out.push(
      pathMod!.join(osMod!.homedir(), '.steam/steam/steamapps/common/Path of Exile 2/logs'),
      pathMod!.join(
        osMod!.homedir(),
        '.local/share/Steam/steamapps/compatdata/2694490/pfx/drive_c/Program Files (x86)/Steam/steamapps/common/Path of Exile 2/logs',
      ),
    );
  }
  return out;
}

/** Параметры поиска файла лога. */
export interface LogPathOptions {
  /** Явный путь к Client.txt / LatestClient.txt — приоритетнее автодетекта. */
  overridePath?: string;
  /** Корень установки PoE2 (папка с logs/). */
  poe2InstallPath?: string;
  /** Логировать список проверенных кандидатов (для диагностики). */
  collectTried?: boolean;
}

/** Результат поиска пути лога. */
export interface ResolvedLogPath {
  logPath: string | null;
  /** Путь к полному логу Client.txt, если найден LatestClient.txt (fallback). */
  fallbackPath: string | null;
  tried: string[];
}

/**
 * Автоопределение пути к логу PoE2: LatestClient.txt (текущая сессия,
 * быстрее) с fallback на Client.txt (полная история).
 */
export function resolveClientLogPath(opts: LogPathOptions = {}): ResolvedLogPath {
  const tried: string[] = [];
  const check = (dir: string): string | null => {
    for (const name of ['LatestClient.txt', 'Client.txt']) {
      const p = pathMod!.join(dir, name);
      tried.push(p);
      if (fsMod!.existsSync(p)) return p;
    }
    return null;
  };

  if (opts.overridePath && opts.overridePath.trim() !== '') return { logPath: opts.overridePath, fallbackPath: null, tried };

  if (opts.poe2InstallPath && opts.poe2InstallPath.trim() !== '') {
    const found = check(pathMod!.join(opts.poe2InstallPath, 'logs'));
    if (found) {
      const fb = found.endsWith('LatestClient.txt')
        ? found.replace('LatestClient.txt', 'Client.txt')
        : null;
      return { logPath: found, fallbackPath: fb && fsMod!.existsSync(fb) ? fb : null, tried };
    }
  }

  for (const dir of installCandidates()) {
    const found = check(dir);
    if (found) {
      const fb = found.endsWith('LatestClient.txt')
        ? found.replace('LatestClient.txt', 'Client.txt')
        : null;
      return { logPath: found, fallbackPath: fb && fsMod!.existsSync(fb) ? fb : null, tried };
    }
  }
  return { logPath: null, fallbackPath: null, tried: opts.collectTried ? tried : [] };
}

// ─── Чтение хвоста лога ──────────────────────────────────────────────────────

/**
 * Прочитать последние `maxBytes` файла, НИКОГДА не загружая весь файл
 * (лог может быть в сотни МБ). Через seek, с отбрасыванием частной первой строки.
 */
export function readLogTailBytes(filePath: string, maxBytes = 1_048_576): string[] {
  if (!IS_NODE) return [];
  let size = 0;
  try {
    size = fsMod!.statSync(filePath).size;
  } catch {
    return [];
  }
  const start = Math.max(0, size - maxBytes);
  const fd = fsMod!.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(size - start);
    fsMod!.readSync(fd, buf, 0, buf.length, start);
    const text = buf.toString('utf8');
    const lines = text.split(/\r?\n/);
    if (start > 0 && lines.length) lines.shift(); // первая строка обрезана — drop
    return lines.filter((l) => l.trim() !== '');
  } finally {
    fsMod!.closeSync(fd);
  }
}

// ─── Состояние игрока ────────────────────────────────────────────────────────

/** Одно посещение зоны, извлечённое из лога. */
export interface ZoneVisit {
  timestamp: string;
  areaCode: string;
  areaLevel: number;
  zoneName: string | null;
  decoded: DecodedZoneCode | null;
}

/** Свёрнутое текущее состояние персонажа/сессии из хвоста лога. */
export interface ClientGameState {
  available: boolean;
  reason?: string;
  logPath: string | null;
  /** Текущий персонаж (из level_up; fallback — из death). */
  character: string | null;
  /** Класс или асценданси. */
  klass: string | null;
  level: number | null;
  /** Последняя зона. */
  zone: ZoneVisit | null;
  /** Числовое поле `act` разбора кода зоны. */
  act: number | null;
  /** Смерти в окне хвоста. */
  deathsInWindow: number;
  afk: boolean | null;
  instanceServer: string | null;
  /** Время последнего распознанного события (сырая строка лога). */
  lastEventTime: string | null;
  /** Все события из окна, распознанные парсером. */
  events: ClientLogEvent[];
  zoneVisits: ZoneVisit[];
}

/** Параметры чтения состояния. */
export interface GetStateOptions {
  /** Явный путь к логу (иначе автодетект). */
  logPath?: string;
  /** Корень установки PoE2. */
  poe2InstallPath?: string;
  /** Размер хвостового окна в байтах (по умолчанию 1 МиБ ≈ тысячи строк). */
  tailBytes?: number;
  /** Прочитать полный Client.txt вместо LatestClient.txt (если есть выбор). */
  fullHistory?: boolean;
}

/** Свернуть события лога в текущее состояние игрока (без сети, чисто локально). */
export function getClientState(opts: GetStateOptions = {}): ClientGameState {
  const resolved = resolveClientLogPath({
    overridePath: opts.logPath,
    poe2InstallPath: opts.poe2InstallPath,
  });
  let logPath = resolved.logPath;
  if (logPath && opts.fullHistory && resolved.fallbackPath) logPath = resolved.fallbackPath;

  const base: ClientGameState = {
    available: false,
    logPath,
    character: null,
    klass: null,
    level: null,
    zone: null,
    act: null,
    deathsInWindow: 0,
    afk: null,
    instanceServer: null,
    lastEventTime: null,
    events: [],
    zoneVisits: [],
  };
  if (!logPath || !IS_NODE || !fsMod!.existsSync(logPath)) {
    return {
      ...base,
      reason: logPath
        ? `Файл лога не найден или недоступен: ${logPath}`
        : 'Client.txt не найден. Укажите путь в opts.logPath или poe2InstallPath (нестандартная установка).',
    };
  }
  const lines = readLogTailBytes(logPath, opts.tailBytes);

  for (const line of lines) {
    const ev = parseLogLine(line);
    if (!ev) continue;
    base.events.push(ev);
    switch (ev.kind) {
      case 'level_up':
        base.character = ev.character ?? base.character;
        base.klass = ev.klass ?? base.klass;
        base.level = ev.level ?? base.level;
        break;
      case 'area_change': {
        const visit: ZoneVisit = {
          timestamp: ev.timestamp,
          areaCode: ev.areaCode!,
          areaLevel: ev.areaLevel!,
          zoneName: ZONE_NAMES[ev.areaCode!] ?? null,
          decoded: decodeZoneCode(ev.areaCode!),
        };
        base.zoneVisits.push(visit);
        base.zone = visit;
        base.act = visit.decoded?.act ?? null;
        break;
      }
      case 'instance_connect':
        base.instanceServer = ev.server ?? base.instanceServer;
        break;
      case 'afk':
        base.afk = ev.afkState === 'ON';
        break;
      case 'death':
        base.deathsInWindow += 1;
        if (!base.character) base.character = ev.character ?? null;
        break;
      default:
        break;
    }
    base.lastEventTime = ev.timestamp;
  }
  base.available = true;
  return base;
}

/**
 * Диагностика: достаточно ли данных в разобранном состоянии для анализа.
 * Слишком «пустое» окно (перезапуск игры) — стоит читать полный Client.txt.
 */
export function hasSubstantialLogData(s: ClientGameState): boolean {
  return s.zoneVisits.length >= 3 || s.events.length >= 5;
}
