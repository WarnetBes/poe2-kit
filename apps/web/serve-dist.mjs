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

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
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
