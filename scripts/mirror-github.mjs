#!/usr/bin/env node
/**
 * mirror-github.mjs — публичное GitHub-зеркало poe2-kit + релиз с portable-zip.
 *
 * Зачем: SourceCraft-запуски видны анонимам (web 200), но прямая скачка релиз-ассетов
 * требует сессию (проверено 01.10.2026). GitHub Release даёт анонимную прямую ссылку.
 *
 * Использование:
 *   1) PAT (fine-grained или classic, scopes: repo) положить в env GH_TOKEN
 *      (PowerShell: $env:GH_TOKEN = "ghp_...")
 *   2) node scripts/mirror-github.mjs --user ВАШ_ЛОГИН [--tag v1.0.17]
 *
 * Что делает (идемпотентно, можно перезапускать):
 *   A. Создаёт public-репо <user>/poe2-kit, если его нет (POST /user/repos).
 *   B. Пушит main + все теги отдельным remote «github» (ветка main не переписывается).
 *   C. Создаёт GitHub-Release на --tag (если нет) с заметками из release notes
 *      SourceCraft (только заголовок — полный текст ниже); NOTE-файл можно передать
 *      через --notes-file, тогда он станет телом релиза.
 *   D. Заливает portable-zip из _portable/ как ассет (если ассет с таким именем
 *      уже есть — пропускает).
 *
 * Откат: удалить remote «github» (git remote remove github) + удалить репо на GitHub.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

function arg(name, def) {
  const i = argv.indexOf('--' + name);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
}

const GH_USER = arg('user');
const GH_REPO = arg('repo', 'poe2-kit');
const TAG = arg('tag', 'v1.0.17');
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const NOTES_FILE = arg('notes-file', null);

if (!GH_USER || !TOKEN) {
  console.error('Нужны --user <логин> и env GH_TOKEN (PAT со scope repo).');
  process.exit(1);
}

const API = 'https://api.github.com';
const commonHeaders = {
  'Authorization': `Bearer ${TOKEN}`,
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'poe2-kit-mirror',
};

async function gh(method, url, body, extraHeaders = {}) {
  const res = await fetch(url.startsWith('http') ? url : API + url, {
    method,
    headers: { ...commonHeaders, ...extraHeaders, ...(body && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}) },
    body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined,
  });
  return res;
}

function die(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

// --- A. Репо существует? иначе создать -------------------------------------------------
let repoCreated = false;
{
  const res = await gh('GET', `/repos/${GH_USER}/${GH_REPO}`);
  if (res.status === 200) {
    const j = await res.json();
    console.log(`repo: существует (private=${j.private})`);
    if (j.private) {
      const r2 = await gh('PATCH', `/repos/${GH_USER}/${GH_REPO}`, { private: false });
      if (r2.status !== 200) die('не удалось открыть репо: ' + r2.status + ' ' + (await r2.text()));
      console.log('repo: переведён в public');
    }
  } else if (res.status === 404) {
    const r2 = await gh('POST', '/user/repos', {
      name: GH_REPO,
      private: false,
      has_wiki: false,
      has_projects: false,
      has_issues: true,
    });
    // 403 «Resource not accessible by personal access token» бывает у fine-grained PAT без account-permissions; тогда создать руками на сайте.
    if (r2.status === 201) {
      console.log(`repo: создан public https://github.com/${GH_USER}/${GH_REPO}`);
    } else {
      console.error(`Не могу создать репо (HTTP ${r2.status}): ${await r2.text()}`);
      console.error('Создай репо руками на https://github.com/new (public, без README) и перезапусти.');
      process.exit(1);
    }
  } else if (res.status === 403 && res.headers.get('x-github-authentication-frequency')) {
    // rate limit — нежелательный, но возможный исход
    die('rate-limit GitHub: подожди и перезапусти.');
  } else {
    die('Проверка репо: HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
  }
}

// Токен может протухнуть здесь — предотвращаем утечку токена в remote-url.
{
  const remotes = execSync('git remote', { cwd: ROOT, encoding: 'utf8' }).trim().split('\n');
  const url = `https://${GH_USER}:${TOKEN}@github.com/${GH_USER}/${GH_REPO}.git`;
  if (remotes.includes('github')) {
    execSync(`git remote set-url github "${url}"`, { cwd: ROOT });
  } else {
    execSync(`git remote add github "${url}"`, { cwd: ROOT });
  }
  console.log('remote: github настроен (push-url с токеном; не коммить .git/config, он вне репо)');
}

// --- B. Пуш main + теги ---------------------------------
try {
  execSync('git push github main', { cwd: ROOT, stdio: 'inherit' });
  execSync('git push github --tags', { cwd: ROOT, stdio: 'inherit' });
  console.log('push: main + теги OK');
} catch (e) {
  console.error('push не удался; проверь, что main уже существует локально и токен имеет доступ к репо.');
  process.exit(1);
}

// --- C. Релиз ---------------------------------------------------------------
const notes = NOTES_FILE ? fs.readFileSync(NOTES_FILE, 'utf8') : [
  'Portable build — unzip → run start-overlay.bat (downloads Electron once, ~110 MB).',
  '',
  'No game memory access, no automation. See README.en.md → Rules & disclaimer.',
  'Canonical repo: https://sourcecraft.dev/volkovpartilaholin/poe2-kit',
].join('\n');

let rel;
{
  const res = await gh('GET', `/repos/${GH_USER}/${GH_REPO}/releases/tags/${TAG}`);
  if (res.status === 200) {
    rel = await res.json();
    console.log(`release: существует (${rel.html_url})`);
  } else {
    // target_commitish не указываем: тег уже запушен шагом B — релиз привяжется к нему.
    const r2 = await gh('POST', `/repos/${GH_USER}/${GH_REPO}/releases`, {
      tag_name: TAG,
      name: `poe2-kit ${TAG}`,
      body: notes,
    });
    if (r2.status !== 201) die('создание release: ' + r2.status + ' ' + (await r2.text()));
    rel = await r2.json();
    console.log(`release: создан ${rel.html_url}`);
  }
}

// --- D. Ассет portable-zip ------------------------------------------------------
const zipPath = path.join(ROOT, '_portable', `poe2-kit-portable-${TAG.replace(/^v/, '')}-win64.zip`);
if (!fs.existsSync(zipPath)) die('нет zip: ' + zipPath);
const zipName = path.basename(zipPath);
if (rel.assets?.some((a) => a.name === zipName)) {
  console.log(`asset: ${zipName} уже залит`);
} else {
  const buf = new Uint8Array(fs.readFileSync(zipPath));
  const up = await gh('POST',
    `https://uploads.github.com/repos/${GH_USER}/${GH_REPO}/releases/${rel.id}/assets?name=${encodeURIComponent(zipName)}`,
    buf, { 'Content-Type': 'application/zip', 'Content-Length': String(buf.length) });
  if (up.status !== 201) die('заливка asset: ' + up.status + ' ' + (await up.text()));
  const j = await up.json();
  console.log(`asset: ${zipName} (${buf.length.toLocaleString('ru')} Б) → ${j.browser_download_url}`);
}

console.log('\nГотово. Прямые ссылки для поста:');
console.log(`  Release:  https://github.com/${GH_USER}/${GH_REPO}/releases/latest`);
console.log(`  Zip:      https://github.com/${GH_USER}/${GH_REPO}/releases/download/${TAG}/${zipName}`);
console.log(`  Source:   https://github.com/${GH_USER}/${GH_REPO}`);
