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
  build: {
    outDir: 'dist',
    target: 'es2022',
    // Оптимизация (№202): монолитный index-*.js 639КБ резать на два чанка —
    // 'core' (@poe2-kit + deps) и 'app'. Выигрыш: раздельное кэширование при
    // релизах (движок меняется чаще UI и наоборот) + параллельный парсинг.
    rollupOptions: {
      output: {
        manualChunks(id) {
          // vite-хелперы (modulepreload-polyfill, preload-helper) держим в 'core',
          // иначе Circular chunk: core -> app -> core (хелпер нужен обоим).
          // index.html (entry-фасад) обязан лежать в 'app' вместе с main.ts,
          // иначе Circular chunk: app -> core -> app (вход -> main.ts -> core -> вход).
          const isApp = id.endsWith('.html') || (id.includes('/apps/web/src/') && !id.includes('vite/'));
          return isApp ? 'app' : 'core';
        },
      },
    },
  },
});