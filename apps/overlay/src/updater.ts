/**
 * PoE2 Kit overlay — W1-2: свой апдейтер поверх существующих GitHub-релизов
 * (electron-updater отвергнут — см. журнал №687: он требует electron-builder
 * и перепахивает весь конвейер make-portable/шара/bat).
 *
 * Идея reference: poe2-upgrade-checker (GPL-3) — «updates itself»; реализация
 * своя, ни строки чужого кода (№686/№687, MIT-дисциплина).
 *
 * Живые факты (30.10.2026, проверено curl.exe по API):
 *  - /releases/latest отдаёт NOT главный релиз, а последний созданный — у нас
 *    это ritual-data-vX — для апдейтера НЕГОДЕН. Правильный путь:
 *    /releases?per_page=100 + фильтр /^v\d+\.\d+\.\d+$/ + max-семвер.
 *  - Главный релиз несёт ассет poe2-kit-portable-<ver>-win64.zip (~97 МБ).
 *  - Сеть владельца = DPI: node:https через раз (№202) — ВСЯ сеть только
 *    spawn(curl.exe --ssl-no-revoke), как в serve-dist.mjs.
 *
 * Применение: overlay не может заменить свои же файлы на ходу (Windows-локи) —
 * пишем apply-update.cmd (robocopy /E staging → корень, рестарт start-overlay.bat),
 * spawn detached → app.quit(). /E (не /MIR) сознательно: старые файлы не
 * удаляем, откат = скопировать обратно из staging-версии.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

const GH_REPO_API = process.env.POE2K_UPDATE_API ?? 'https://api.github.com/repos/WarnetBes/poe2-kit/releases';
const ZIP_ASSET_RE = /^poe2-kit-portable-[\d.]+-win64\.zip$/;
const MAIN_TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/;

export interface MainRelease {
  version: string;
  tag: string;
  zipUrl: string;
  zipBytes: number;
  pageUrl: string;
}

export interface UpdateCheckResult {
  currentVersion: string;
  latest: MainRelease | null;
  available: boolean;
  checkedAt: number;
  error?: string;
}

/** curl.exe -sSLf --ssl-no-revoke → stdout (DPI-паттерн №202). null = сеть молчит. */
function curlStdout(url: string, args: string[] = []): string | null {
  try {
    const res = spawnSync('curl.exe', ['-sSLf', '--ssl-no-revoke', '--max-time', '60', ...args, url], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 70_000,
    });
    if (res.status === 0 && res.stdout) return res.stdout;
    if (res.stderr) console.warn('[updater] curl stderr:', String(res.stderr).slice(0, 200));
    return null;
  } catch (err) {
    console.warn('[updater] curl spawn не удался', (err as Error).message);
    return null;
  }
}

/** Скачивание файла curl-ом в dest (stream через curl -o). true = есть файл нужного размера. */
export function curlDownload(url: string, dest: string, expectBytes: number): boolean {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    const res = spawnSync(
      'curl.exe',
      ['-sSLf', '--ssl-no-revoke', '--max-time', '900', '-o', dest, url],
      { windowsHide: true, timeout: 910_000 },
    );
    return res.status === 0 && fs.existsSync(dest) && (!expectBytes || fs.statSync(dest).size === expectBytes);
  } catch (err) {
    console.warn('[updater] download не удался', (err as Error).message);
    return false;
  }
}

/** Сравнение семверов: >0 если a новее b. */
export function compareVersions(a: string, b: string): number {
  const pa = (a.replace(/^v/, '').split('.').map(Number) as number[]);
  const pb = (b.replace(/^v/, '').split('.').map(Number) as number[]);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

/** Живой GH-API: список релизов → главный (max-семвер) релиз с portable-zip. */
export function fetchLatestMainRelease(): MainRelease | null {
  const raw = curlStdout(`${GH_REPO_API}?per_page=100`, ['-H', 'User-Agent: poe2-kit-overlay-updater']);
  if (!raw) return null;
  try {
    const list = JSON.parse(raw) as Array<{
      tag_name?: string;
      html_url?: string;
      assets?: Array<{ name?: string; size?: number; browser_download_url?: string }>;
    }>;
    let best: MainRelease | null = null;
    for (const rel of list) {
      const m = MAIN_TAG_RE.exec(rel.tag_name ?? '');
      if (!m) continue; // ritual-data-vX, прочие — мимо
      const asset = (rel.assets ?? []).find((a) => ZIP_ASSET_RE.test(a.name ?? ''));
      if (!asset?.browser_download_url) continue;
      const version = rel.tag_name!.slice(1);
      if (!best || compareVersions(version, best.version) > 0) {
        best = {
          version,
          tag: rel.tag_name!,
          zipUrl: asset.browser_download_url!,
          zipBytes: asset.size ?? 0,
          pageUrl: rel.html_url ?? '',
        };
      }
    }
    return best;
  } catch (err) {
    console.warn('[updater] GH-JSON не распарсился', (err as Error).message);
    return null;
  }
}

/** Файл кэша проверки (авточек 1/день — не дёргаем API на каждое открытие панели). */
function checkCacheFile(): string {
  return path.join(app.getPath('userData'), 'update-check.json');
}

export function readCachedCheck(): UpdateCheckResult | null {
  try {
    const raw = JSON.parse(fs.readFileSync(checkCacheFile(), 'utf8'));
    if (typeof raw?.checkedAt === 'number' && raw.latest && typeof raw.currentVersion === 'string') {
      return raw as UpdateCheckResult;
    }
  } catch {
    /* нет/битый — не страшно */
  }
  return null;
}

/** Проверить обновление (сеть + кэш-перезапись). */
export function checkForUpdate(): UpdateCheckResult {
  const currentVersion = app.getVersion();
  const latest = fetchLatestMainRelease();
  if (!latest) {
    return { currentVersion, latest: null, available: false, checkedAt: Date.now(), error: 'сеть/GitHub недоступны' };
  }
  const result: UpdateCheckResult = {
    currentVersion,
    latest,
    available: compareVersions(latest.version, currentVersion) > 0,
    checkedAt: Date.now(),
  };
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(checkCacheFile(), JSON.stringify(result), 'utf8');
  } catch {
    /* кэш некритичен */
  }
  console.log(`[updater] check: current=${currentVersion} latest=${latest.version} available=${result.available}`);
  return result;
}

/** Портабл-корень установки: <root>/apps/overlay/dist → вверх 3. Гварды:
 *  package.json(name=poe2-kit) + start-overlay.bat — иначе авто-установка
 *  выключена (dev-копия, шара-запуск из репо и т.п. — обновлять руками). */
export function portableInstallRoot(): string | null {
  let dir = __dirname;
  for (let i = 0; i < 3; i++) dir = path.dirname(dir);
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as { name?: string };
    if (pkg.name !== 'poe2-kit') return null;
    if (!fs.existsSync(path.join(dir, 'start-overlay.bat'))) return null;
    return dir;
  } catch {
    return null;
  }
}

export interface InstallResult {
  ok: boolean;
  step?: 'download' | 'extract' | 'apply-cmd';
  applyScript?: string;
  version?: string;
  error?: string;
}

/**
 * Скачать + распаковать релиз в staging и подготовить apply-скрипт.
 * Скачивание::~97 МБ (curl, до 15 мин), распаковка tar (bsdtar читает zip —
 * тот же инструмент, что в start-overlay.bat).
 */
export function stageUpdate(rel: MainRelease): InstallResult {
  const root = portableInstallRoot();
  if (!root) return { ok: false, error: 'не портабл-установка — применить автоматически нельзя (обновите распаковкой zip вручную)' };
  const stagingDir = path.join(root, 'update-staging', rel.version);
  const zipPath = path.join(root, 'update-staging', `poe2-kit-portable-${rel.version}-win64.zip`);
  // Скачивание (перезакачиваем целиком: битый partial-zip дороже лишних 97 МБ).
  if (!curlDownload(rel.zipUrl, zipPath, rel.zipBytes)) {
    return { ok: false, step: 'download', error: 'скачивание не удалось (сеть/прокси) — zip не докачан или размер не совпал' };
  }
  // Распаковка: tar -xf <zip> -C <staging> (bsdtar).
  fs.mkdirSync(stagingDir, { recursive: true });
  try {
    const res = spawnSync('tar.exe', ['-xf', zipPath, '-C', stagingDir], { windowsHide: true, timeout: 600_000 });
    if (res.status !== 0) {
      return { ok: false, step: 'extract', error: `tar не раскрыл zip (status ${res.status})` };
    }
  } catch (err) {
    return { ok: false, step: 'extract', error: (err as Error).message };
  }
  // ZIP паковался из stage-каталога: внутри корневая папка poe2-kit-portable-<ver>-win64
  const inner = path.join(stagingDir, `poe2-kit-portable-${rel.version}-win64`);
  const src = fs.existsSync(inner) ? inner : stagingDir;
  if (!fs.existsSync(path.join(src, 'start-overlay.bat'))) {
    return { ok: false, step: 'extract', error: 'в распаковке нет start-overlay.bat — структура релиза неожиданна, применять отказываюсь' };
  }
  // apply-скрипт: ждёт выхода оверлея → robocopy /E (БЕЗ /MIR: старое не удаляем,
  // откат = скопировать из update-staging назад) → перезапуск.
  const applyScript = path.join(root, 'apply-update.cmd');
  const CRLF = '\r\n';
  fs.writeFileSync(
    applyScript,
    [
      '@echo off',
      'chcp 65001 >nul',
      `rem PoE2 Kit auto-update: ${rel.version} (сгенерировано оверлеем)`,
      'timeout /t 3 /nobreak >nul',
      `robocopy "${src}" "${root}" /E /NFL /NDL /NJH /NJS /NP >nul`,
      `if exist "${root}\\start-overlay.bat" start "" cmd /c "${root}\\start-overlay.bat"`,
      'exit /b 0',
    ].join(CRLF) + CRLF,
    'utf8',
  );
  console.log(`[updater] staged ${rel.version} → ${applyScript}`);
  return { ok: true, step: 'apply-cmd', applyScript, version: rel.version };
}

/** Запустить apply-скрипт detached и выйти. */
export function runApplyScriptAndQuit(applyScript: string): boolean {
  try {
    const child = spawn('cmd.exe', ['/c', applyScript], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    return true;
  } catch (err) {
    console.warn('[updater] apply-spawn не удался', (err as Error).message);
    return false;
  }
}
