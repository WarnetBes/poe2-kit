import { defineConfig } from 'vite';

/**
 * CORS — враг браузерного чистого fetch к poe.ninja/poe2scout/trade.
 * Решение: реверс-прокси на том же хосте Vite (dev и preview).
 * Ядро (core.http) с map {host→prefix} переписывает абсолютные URL на эти пути.
 */
const proxy = {
  // Ядро добавляет к префиксу полный исходный путь (содержит /poe2/api/... ранее).
  // Поэтому rewrite просто снимает префикс и оставляет остаток пути как есть.
  '/proxy/poeninja': { target: 'https://poe.ninja', changeOrigin: true, rewrite: (p: string) => p.replace(/^\/proxy\/poeninja/, '') },
  '/proxy/scout': { target: 'https://api.poe2scout.com', changeOrigin: true, rewrite: (p: string) => p.replace(/^\/proxy\/scout/, '') },
  '/proxy/trade': { target: 'https://www.pathofexile.com', changeOrigin: true, rewrite: (p: string) => p.replace(/^\/proxy\/trade/, '') },
  '/proxy/repower': { target: 'https://repoe-fork.github.io', changeOrigin: true, rewrite: (p: string) => p.replace(/^\/proxy\/repower/, '') },
};

export default defineConfig({
  server: { host: true, port: 5173, proxy },
  preview: { host: true, port: 5173, proxy },
  build: { outDir: 'dist', target: 'es2022' },
});