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
    // Предупреждение порога чанков — по факту gzip-размера (то, что реально
    // летит по сети). 500 kB raw — косметика Vite: наши датасет-чанки
    // (data/layout/numeric_ids *.json) жмутся в 6-10 раз и в CDN-кэш идут
    // уже сжатыми. Ниже реальный budget, а не сырой размер.
    chunkSizeWarningLimit: 1200,
    // Оптимизация (№202): монолитный index-*.js 639КБ резать на два чанка —
    // 'core' (@poe2-kit + deps) и 'app'. Выигрыш: раздельное кэширование при
    // релизах (движок меняется чаще UI и наоборот) + параллельный парсинг.
    rollupOptions: {
      output: {
        manualChunks(id) {
          // #24b «Игровой вид»: React + PixiJS + @poe2-toolkit — отдельный чанк
          // 'treegame'; грузится ТОЛЬКО по тумблеру (dynamic import из fullMap).
          if (id.includes('/apps/web/src/treeGame/') ||
              id.match(/[\\/]node_modules[\\/](react|react-dom|react-jsx-runtime|scheduler)[\\/]/)) {
            return 'treegame';
          }
          // PixiJS — ТОЛЬКО в treegame: он нужен исключительно WebGL-дереву.
          // Если попадёт в 'core' — разорвётся динамический import treeGame
          // (цик treegame -> core -> treegame), это ловит гейт web-сборки.
          if (id.match(/[\\/]node_modules[\\/](@pixi[\\/]|pixi[.]js[\\/])/)) {
            return 'treegame';
          }
          // @poe2-toolkit — по имени модуля (не каталога): type-only импорт
          // (import type) не несёт рантайма, а value-импорты живут только
          // в treeGame/. Держим всё в treegame-чанке (грузится по тумблеру).
          if (id.includes('@poe2-toolkit')) {
            return 'treegame';
          }
          // Парсеры HTML (cheerio/parse5/htmlparser2/entities ~300 kB) и
          // fflate/earcut вызываются ПРЯМЫМИ импортами из core-модулей
          // (poe2db/pobcode/png) — отдельный чанк даёт цикл core-parsers ->
          // core -> core-parsers, поэтому они остаются в 'core'. Реальный
          // выигрыш здесь — PixiJS/react/@poe2-toolkit выше, в 'treegame'.
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