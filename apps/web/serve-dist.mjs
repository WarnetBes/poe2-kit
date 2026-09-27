/**
 * Мини static-сервер для apps/web/dist — для portable-сборки (без vite).
 * Запуск: node apps/web/serve-dist.mjs [порт]   (default 5173, host 0.0.0.0)
 * Ноль зависимостей: чистый node:http, поэтому переживает npm prune --omit=dev.
 */
import http from 'node:http';
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

async function handleProxy(req, res, urlPath) {
  const prefix = Object.keys(PROXY).find((p) => urlPath === p || urlPath.startsWith(p + '/'));
  if (!prefix) return false;
  const query = (req.url ?? '').split('?')[1] ?? '';
  const target = PROXY[prefix] + urlPath.slice(prefix.length) + (query ? '?' + query : '');
  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') body = Buffer.concat(await toArray(req));
  const r = await fetch(target, {
    method: req.method,
    headers: {
      accept: req.headers['accept'],
      'content-type': req.headers['content-type'],
      'user-agent': req.headers['user-agent'],
      ...(body ? { 'content-length': String(body.length) } : {}),
    },
    body,
  });
  const buffer = Buffer.from(await r.arrayBuffer());
  const headers = { 'Content-Type': r.headers.get('content-type') ?? 'application/json; charset=utf-8' };
  res.writeHead(r.status, headers);
  res.end(buffer);
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
  } catch {
    res.writeHead(500).end('Internal error');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`PoE2 Kit web (static): http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT} (root: ${ROOT})`);
});
