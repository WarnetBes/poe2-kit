// Мини-статик-сервер для poe2-kit web (без зависимостей, чистый Node).
// Запуск: node server.mjs [порт]  (порт по умолчанию 4173)
// Кладётся рядом с содержимым apps/web/dist, обслуживает текущую папку.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.argv[2] || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

http.createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (urlPath.endsWith('/')) urlPath += 'index.html';
    // защита от path traversal
    const rel = normalize(urlPath).replace(/^([/\\]|\.\.)+/g, '');
    let file = join(ROOT, rel);
    let data = await readFile(file).catch(() => null);
    if (!data) { // SPA-фолбэк
      file = join(ROOT, 'index.html');
      data = await readFile(file);
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(500);
    res.end('server error');
  }
}).listen(PORT, () => {
  console.log(`[poe2-kit web] http://localhost:${PORT} (root: ${ROOT})`);
});
