/**
 * W4-3: устойчивое JSON-хранилище оверлея.
 *
 * Idea reference: poe2-upgrade-checker store.js (GPL-3) — НИ СТРОКИ кода
 * не скопировано (№686): перенята только эвристика (не охраняема):
 *   - чтение JSON с ретраями (файл может быть дописывается другим процессом);
 *   - запись через временный файл + атомарный rename (нет состояния
 *     «половина файла»);
 *   - предыдущая хорошая версия сохраняется как `.bak` и восстанавливается,
 *     если основной файл битый («битый файл не блокирует старт»).
 *
 * Сознательные границы:
 *   - `.bak` хранит ровно одну предыдущую версию (не история);
 *   - при успешном восстановлении из `.bak` логируем — потеря молча
 *     считается грехом;
 *   - ENOENT не ретраится и не считается ошибкой (нет файла = норма).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const DEFAULT_RETRIES = 5;
const RETRY_DELAY_MS = 25;

export interface ReadJsonOptions {
  /** Попыток чтения при transient-ошибках/битом JSON (default 5). */
  retries?: number;
  /** Пауза между попытками, мс (default 25). */
  delayMs?: number;
  /** Пробовать `.bak`, если основной файл битый (default true). */
  tryBackup?: boolean;
}

const sleepSync = (ms: number): void => {
  // Синхронный sleep в Electron-main допустим: пауза 25–50 мс в read-пути
  // стейта при старте/редких операциях; Atomics.wait без event-loop блокировки main —
  // но у нас main и так синхронный на этих вызовах, ок.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

function parseWithBom(text: string): unknown {
  // №105-паттерн: PowerShell Set-Content кладёт UTF-8 BOM — JSON.parse падает.
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return JSON.parse(t);
}

function tryReadOnce(file: string): { ok: true; value: unknown } | { ok: false; reason: 'missing' | 'busy' | 'corrupt' } {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { ok: false, reason: 'missing' };
    return { ok: false, reason: 'busy' }; // EBUSY/EMFILE/… — точно transient
  }
  try {
    return { ok: true, value: parseWithBom(text) };
  } catch {
    return { ok: false, reason: 'corrupt' }; // обрезан/мусор — content стабилен
  }
};

/**
 * Прочитать JSON: до `retries` попыток, при неудаче — `.bak`.
 * Возвращает распарсенное значение либо null (нет файла; всё битое).
 * НЕ бросает — «битый файл не блокирует старт».
 * №696 P2-1: corrupt ≠ busy — парсинг-мусор не гоняет 5×25мс ретраев
 * впустую, а идёт в .bak сразу; ретраи — для busy (EBUSY) и для
 * corrupt-без-.bak (внешний писатель может дописывать файл).
 */
export function readJsonSync<T = unknown>(file: string, opts: ReadJsonOptions = {}): T | null {
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const delayMs = opts.delayMs ?? RETRY_DELAY_MS;
  let retriesLeft = Math.max(1, retries);
  let lastReason: 'missing' | 'busy' | 'corrupt' | null = null;
  while (retriesLeft-- > 0) {
    const r = tryReadOnce(file);
    if (r.ok) return r.value as T;
    lastReason = r.reason;
    if (r.reason === 'missing') break; // файла нет — ретраить бессмысленно
    if (r.reason === 'corrupt' && (opts.tryBackup ?? true)) {
      const bak = tryReadOnce(`${file}.bak`);
      if (bak.ok) {
        console.log(`[overlay] store: ${path.basename(file)} битый — восстановлен из .bak`);
        return bak.value as T;
      }
      // .bak нет: единственная надежда — внешний писатель допишет файл.
    }
    if (retriesLeft > 0) sleepSync(delayMs);
  }
  if ((opts.tryBackup ?? true) && lastReason === 'busy') {
    const bak = tryReadOnce(`${file}.bak`);
    if (bak.ok) {
      console.log(`[overlay] store: ${path.basename(file)} не читается (busy) — прочитан .bak`);
      return bak.value as T;
    }
  }
  return null;
}

/**
 * Атомарная запись JSON: tmp → rename поверх; прежняя версия → `.bak`.
 * Возвращает true/false (НЕ бросает — все вызовы в catch-обёртках call-site'ов
 * продолжают логировать своими словами).
 */
export function writeJsonSync(file: string, data: unknown, pretty = false): boolean {
  const tmp = `${file}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data, null, pretty ? 2 : undefined), 'utf8');
    // №695-ревью P1-2: прежняя версия → .bak КОПИРОВАНИЕМ ДО подмены main —
    // раньше порядок rename(main→bak) → rename(tmp→main) оставлял окно
    // «основного файла нет» (краш между rename = потеря стейта: ENOENT-ветка
    // readJsonSync в .bak не заглядывает). Теперь main уничтожается только
    // последним rename'ом; стейты кита ≤ сотен КБ — копия дешёвая.
    try {
      const prev = fs.readFileSync(file, 'utf8');
      fs.rmSync(`${file}.bak`, { force: true });
      fs.writeFileSync(`${file}.bak`, prev, 'utf8');
    } catch {
      /* нет основного файла (первая запись) — .bak не нужен */
    }
    fs.renameSync(tmp, file);
    return true;
  } catch (err) {
    console.log(`[overlay] store: ${path.basename(file)} не записан: ${err instanceof Error ? err.message : err}`);
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
    return false;
  }
}
