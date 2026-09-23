/**
 * Чтение локального конфига PoE2-клиента: poe2_production_Config.ini
 * (COVERAGE приоритет 12; TS-порт hivemind src/api/game_config_reader.py,
 * автор HivemindOverlord/poe2-mcp — приём портирован, формат сверен).
 *
 * INI хранится в Documents/My Games/Path of Exile 2 и содержит то, что не
 * даёт ни один API: режим ввода (WASD vs click-to-move), текущий акт
 * (environment), gateway, разрешение/GPU. Влияет на советы по билду:
 * WASD-игроку и кликер-игроку подходят разные механики.
 *
 * ВАЖНО (сверено hivemind'ом на живом конфиге): [LOGIN] account_name ПУСТ
 * при Steam-аутентификации — Steam делает вход, игра имя аккаунта не пишет.
 * Для identity использовать Client.txt (log.ts), account_name надёжен только
 * для standalone-клиента.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const CONFIG_FILENAME = 'poe2_production_Config.ini';
const MY_GAMES_SUFFIX = path.join('My Games', 'Path of Exile 2', CONFIG_FILENAME);

/** current_act_environment → человеческая метка (данные игры каноничны, это подсказка). */
const ACT_ENV_HINTS: Record<string, string> = {
  '1': 'Act 1',
  '2': 'Act 2',
  '3': 'Act 3',
  '4': 'Act 1 (Cruel)',
  '5': 'Act 2 (Cruel)',
  '6': 'Act 3 (Cruel) / endgame',
};

/** Кандидаты пути конфига: OneDrive-редирект Documents в приоритете. */
function candidateConfigPaths(): string[] {
  const candidates: string[] = [];
  const userprofile = process.env['USERPROFILE'];
  if (userprofile) {
    candidates.push(path.join(userprofile, 'OneDrive', 'Documents', MY_GAMES_SUFFIX));
    candidates.push(path.join(userprofile, 'Documents', MY_GAMES_SUFFIX));
  }
  const onedrive = process.env['OneDrive'];
  if (onedrive) {
    candidates.push(path.join(onedrive, 'Documents', MY_GAMES_SUFFIX));
  }
  return candidates;
}

/** Найти конфиг по стандартным путям. null — не найден (игра не ставилась/пути другие). */
export function discoverGameConfigPath(explicit?: string): string | null {
  if (explicit) return existsSync(explicit) ? explicit : null;
  for (const c of candidateConfigPaths()) {
    if (existsSync(c)) return c;
  }
  return null;
}

/**
 * Толерантный INI-парсер: срезает BOM (utf-8-sig), сохраняет регистр ключей,
 * переживает valueless-ключи («account_name=») и дубликаты (последний победил).
 */
export function parseGameConfigIni(text: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  let section: Record<string, string> | null = null;
  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const secMatch = line.match(/^\[(.+)\]$/);
    if (secMatch) {
      const name = secMatch[1]!.trim();
      section = out[name] ?? (out[name] = {});
      continue;
    }
    if (!section) continue;
    const eq = line.indexOf('=');
    if (eq === -1) {
      section[line] = '';
      continue;
    }
    section[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

export interface GameConfigSummary {
  available: boolean;
  configPath: string | null;
  reason?: string;
  gateway: string | null;
  accountName: string | null;
  /** Пояснение, почему account_name пуст (Steam-аутентификация). */
  accountNameNote: string | null;
  /** Режим ввода клиента — WASD или click-to-move. */
  inputMode: string | null;
  /** Сырое значение current_act_environment. */
  actEnvironment: string | null;
  /** Подсказка акта по environment (Act 1..3, Cruel). */
  actHint: string | null;
  resolution: string | null;
  renderer: string | null;
  framerateCap: string | null;
  gpu: string | null;
  /** Все секции конфига (как есть). */
  raw: Record<string, Record<string, string>>;
}

/**
 * Билд-релевантная выжимка конфига: gateway, account, режим ввода, текущий
 * акт, разрешение, рендерер/GPU. Читается с диска при каждом вызове.
 */
export function getGameConfigSummary(explicitPath?: string): GameConfigSummary {
  const configPath = discoverGameConfigPath(explicitPath);
  if (!configPath) {
    return {
      available: false,
      configPath: null,
      reason: 'poe2_production_Config.ini не найден по стандартным путям (Documents/My Games/Path of Exile 2).',
      gateway: null,
      accountName: null,
      accountNameNote: null,
      inputMode: null,
      actEnvironment: null,
      actHint: null,
      resolution: null,
      renderer: null,
      framerateCap: null,
      gpu: null,
      raw: {},
    };
  }
  let ini: Record<string, Record<string, string>>;
  try {
    ini = parseGameConfigIni(readFileSync(configPath, 'utf8'));
  } catch (error) {
    return {
      available: false,
      configPath,
      reason: `INI не прочитан: ${error instanceof Error ? error.message : String(error)}`,
      gateway: null,
      accountName: null,
      accountNameNote: null,
      inputMode: null,
      actEnvironment: null,
      actHint: null,
      resolution: null,
      renderer: null,
      framerateCap: null,
      gpu: null,
      raw: {},
    };
  }

  const get = (section: string, key: string): string | null => ini[section]?.[key] || null;
  const accountName = get('LOGIN', 'account_name');
  const resW = get('DISPLAY', 'resolution_width');
  const resH = get('DISPLAY', 'resolution_height');
  const actEnv = get('CACHED_DATA', 'current_act_environment');

  return {
    available: true,
    configPath,
    gateway: get('LOGIN', 'gateway'),
    accountName,
    accountNameNote: accountName
      ? null
      : 'пусто — Steam-аутентификация не пишет account_name; персонаж — из Client.txt (log.ts)',
    inputMode: get('GENERAL', 'user_input_mode') ?? get('GENERAL', 'last_selected_KBM_input_mode'),
    actEnvironment: actEnv,
    actHint: actEnv ? (ACT_ENV_HINTS[actEnv] ?? null) : null,
    resolution: resW && resH ? `${resW}x${resH}` : null,
    // Имена ключей renderer/GPU варьируются между патчами — берём дежурные кандидаты.
    renderer: get('DISPLAY', 'renderer') ?? get('DISPLAY', 'adapter'),
    framerateCap: get('DISPLAY', 'framerate_cap') ?? get('DISPLAY', 'max_framerate'),
    gpu: get('CACHED_DATA', 'gpu_name') ?? get('DISPLAY', 'gpu'),
    raw: ini,
  };
}
