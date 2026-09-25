/**
 * Ленивый доступ к node:*-модулям.
 *
 * Ядро работает и под Node (MCP, CLI, скрипты), и в браузере (apps/web через
 * vite). Статические named-imports `import { tmpdir } from 'node:os'` ломают
 * браузерную сборку: rollup подменяет node-builtins заглушкой
 * `__vite-browser-external` без этих экспортов. Поэтому node:* импортируем
 * динамически и только под Node (top-level await допустим: es2022).
 *
 * В браузере все `*Mod` равны null, а HAS_DISK=false — дисковый кэш и чтение
 * локальных датасетов отключаются, остаётся сетевой путь.
 */

export const IS_NODE =
  typeof process !== 'undefined' &&
  !!process.versions?.node &&
  typeof window === 'undefined';

import type * as FsType from 'node:fs';
import type * as OsType from 'node:os';
import type * as PathType from 'node:path';
import type * as UrlType from 'node:url';
import type * as CryptoType from 'node:crypto';

export const fsMod: typeof FsType | null = IS_NODE ? await import('node:fs') : null;
export const osMod: typeof OsType | null = IS_NODE ? await import('node:os') : null;
export const pathMod: typeof PathType | null = IS_NODE ? await import('node:path') : null;
export const urlMod: typeof UrlType | null = IS_NODE ? await import('node:url') : null;
export const cryptoMod: typeof CryptoType | null = IS_NODE ? await import('node:crypto') : null;

/** Файловая система доступна (Node); в браузере — false. */
export const HAS_DISK = !!(fsMod && osMod && pathMod && urlMod && cryptoMod);
