/**
 * Мини static-сервер для apps/web/dist — для portable-сборки (без vite).
 * Запуск: node apps/web/serve-dist.mjs [порт]   (default 5173, host 0.0.0.0)
 * Ноль зависимостей: чистый node:http, поэтому переживает npm prune --omit=dev.
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, 'dist');
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 5173);
const HOST = process.env.HOST ?? '0.0.0.0';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

// Реверс-прокси для обхода CORS — как в vite.config.ts (dev/preview).
// Без этого в portable-режиме все живые запросы падают в SPA-фолбэк.
const PROXY = {
  '/proxy/poeninja': 'https://poe.ninja',
  '/proxy/scout': 'https://api.poe2scout.com',
  '/proxy/trade': 'https://www.pathofexile.com',
  '/proxy/repower': 'https://repoe-fork.github.io',
};

// Один upstream-запрос через системный curl (--ssl-no-revoke).
// Почему curl, а не fetch/node:https (№202, измерено на DPI-сети владельца):
//   node:https сырым ClientHello — DPI режет (0/7, сплошные таймауты);
//   fetch (undici) — проходит ~60% (недетерминированные ECONNRESET);
//   curl --ssl-no-revoke — 3/3, 0.7с. Windows 10+ поставляет curl.exe всегда,
//   ноль npm-зависимостей сохраняется; при отсутствии curl — fallback на fetch.
const CURL = process.platform === 'win32' ? 'curl.exe' : 'curl';

function curlOnce(target, method, headersIn, body) {
  return new Promise((resolve, reject) => {
    const MARK = '\n<<<POE2K:%{http_code}:%{content_type}>>>';
    const args = ['--ssl-no-revoke', '-s', '-m', '20', '-X', method, '-w', MARK];
    for (const [k, v] of Object.entries(headersIn)) if (v != null) args.push('-H', `${k}: ${v}`);
    if (body) args.push('--data-binary', '@-');
    args.push(target);
    const p = spawn(CURL, args, { windowsHide: true });
    const out = [];
    p.stdout.on('data', (c) => out.push(c));
    let errTxt = '';
    p.stderr.on('data', (c) => { errTxt += c; });
    p.on('error', reject); // ENOENT curl — вызывающий откатится на fetch
    p.on('close', (code) => {
      const buf = Buffer.concat(out);
      const m = /<<<POE2K:(\d+):([^>]*)>>>$/.exec(buf.toString('latin1'));
      if (!m) return reject(new Error(`curl parse fail rc=${code} ${errTxt.slice(0, 120)}`));
      const bodyBuf = buf.subarray(0, buf.length - m[0].length - 1); // минус маркер и \n
      resolve({ status: Number(m[1]), contentType: m[2], body: bodyBuf });
    });
    if (body) p.stdin.end(body); else p.stdin.end();
  });
}

function fetchOnce(target, method, headersIn, body) {
  return fetch(target, { method, headers: headersIn, body: body || undefined })
    .then(async (r) => ({ status: r.status, contentType: r.headers.get('content-type') ?? '', body: Buffer.from(await r.arrayBuffer()) }));
}

async function upstreamOnce(target, method, headersIn, body) {
  try {
    return await curlOnce(target, method, headersIn, body);
  } catch (err) {
    if (String(err?.code ?? err?.message).includes('ENOENT')) return fetchOnce(target, method, headersIn, body); // нет curl в PATH
    throw err;
  }
}

async function handleProxy(req, res, urlPath) {
  const prefix = Object.keys(PROXY).find((p) => urlPath === p || urlPath.startsWith(p + '/'));
  if (!prefix) return false;
  const query = (req.url ?? '').split('?')[1] ?? '';
  const target = PROXY[prefix] + urlPath.slice(prefix.length) + (query ? '?' + query : '');
  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') body = Buffer.concat(await toArray(req));
  const headersIn = {
    accept: req.headers['accept'],
    'user-agent': req.headers['user-agent'],
    ...(body ? { 'content-type': req.headers['content-type'] ?? 'application/json', 'content-length': String(body.length) } : {}),
  };

  // Ретраи: 3 попытки, бэкофф — от оставшихся недетерминированных срывов.
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 250 * attempt));
    try {
      const r = await upstreamOnce(target, req.method === 'HEAD' ? 'GET' : req.method, headersIn, body);
      res.writeHead(r.status, { 'Content-Type': r.contentType || 'application/json; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : r.body);
      return true;
    } catch (err) {
      lastErr = err;
    }
  }
  console.error(`[serve-dist] upstream failed after retries: ${req.method} ${target}:`, lastErr?.message ?? lastErr);
  res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Upstream unavailable (retries exhausted)');
  return true;
}

function toArray(iter) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    iter.on('data', (c) => chunks.push(c));
    iter.on('end', () => resolve(chunks));
    iter.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (await handleProxy(req, res, urlPath)) return;
    let file = path.normalize(path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath));
    // защита от выхода за пределы dist (path traversal)
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    let data;
    try {
      data = await fs.readFile(file);
    } catch {
      // SPA-фолбэк: любые «не найденные» роуты отдаём index.html
      file = path.join(ROOT, 'index.html');
      data = await fs.readFile(file);
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
    res.end(data);
  } catch (err) {
    // Молчаливый 500 — плохая диагностика (№202): логируем причину и URL.
    console.error(`[serve-dist] 500 on ${req.method} ${req.url}:`, err?.message ?? err);
    res.writeHead(500).end('Internal error');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`PoE2 Kit web (static): http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT} (root: ${ROOT})`);
});
