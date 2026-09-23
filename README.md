# poe2-kit

Единый помощник для **Path of Exile 2**: гид по прокачке, AI-советы, универсальная торговля, анализ билдов и прайс-чек предметов.

Одно ядро **`@poe2-kit/core`** обслуживает три формы помощника:

| Форма | Пакет | Что это |
|---|---|---|
| 🌐 Веб-приложение | `apps/web` | Дашборд: курсы валют, прайс-чек, гид по прокачке, импорт билда |
| 🖥️ Windows-оверлей | `apps/overlay` | Прозрачное окно поверх игры: прайс-чек по хоткею |
| 🧠 MCP-сервер для ИИ | `apps/mcp` | 10 инструментов `poe2_*` для ИИ-ассистентов (OpenCode и др.) |

Цены и торговля — **только с бесплатных публичных API**: [poe.ninja](https://poe.ninja), [poe2scout](https://poe2scout.com), официальный `trade2` Path of Exile 2 и открытые данные RePoE. Ключей не требуется.

---

## Структура

```
poe2-kit/
├── packages/core/          # единое ядро (всё, что можно переиспользовать)
│   └── src/
│       ├── parse.ts        # парсер предмета из клир-текста (Ctrl+C в игре)
│       ├── trade.ts        # poe.ninja / poe2scout / trade2, прайс-чек валют и предметов
│       ├── leveling.ts     # гид по прокачке (акты 1–4, 65 зон)
│       ├── build.ts        # декод PoB share-кода (urlsafe base64 + zlib + XML)
│       ├── ai.ts           # AI-советы (поставщик подключается в рантайме)
│       ├── http.ts         # сетевой слой (+ опциональный CORS-прокси для браузера)
│       └── index.ts        # публичный API: export const core = { … }
├── apps/
│   ├── web/                # Vite + vanilla TS (Vite dev/preview reverse-proxy для обхода CORS)
│   ├── overlay/            # Electron: хоткей Ctrl+Alt+Space → прайс-чек из буфера
│   └── mcp/                # MCP-сервер (stdio), инструменты poe2_*
└── _research/              # скачанные сторонние репозитории (авторство сохранено)
```

---

## Быстрый старт

Требуется **Node.js ≥ 20**.

```bash
npm install          # установка зависимостей (workspaces)
npm run build        # сборка ядра
```

### Веб-приложение

```bash
npm run build -w @poe2-kit/web   # tsc + vite build
npm run dev    -w @poe2-kit/web  # dev-сервер с прокси (localhost:5173)
npm run preview -w @poe2-kit/web -- --port 5173  # production-preview
```

Веб-приложение: **Курсы валют**, **Прайс-чек**, **Прокачка**, **Импорт билда**.

> **Про CORS.** Браузеры блокируют прямое обращение к poe.ninja/poe2scout/trade. Поэтому в ядре есть `core.http.setProxyBaseMap({ host → prefix })`, а Vite (`server.proxy` / `preview.proxy`) реверсивно-проксирует `/proxy/* →` внешние хосты. В Node (MCP, оверлей) прокси не нужен — запросы идут напрямую.

### Windows-оверлей (Electron)

```bash
npm run dev -w @poe2-kit/overlay   # сборка + запуск Electron
npm run build -w @poe2-kit/overlay
npm run test -w @poe2-kit/overlay  # --smoke: окно, хоткей, парсер
```

- В игре скопируйте предмет (`Ctrl+C` — PoE2 кладёт клир-текст в буфер) и нажмите **`Ctrl+Alt+Space`**.
- Прозрачное, безрамочное, always-on-top окно: клики «проходят сквозь» него в игру.
- Оценка считается в main-процессе напрямую через ядро (без CORS).

### MCP-сервер

```bash
npm run start -w @poe2-kit/mcp           # stdio MCP-сервер
npm run test  -w @poe2-kit/mcp           # build + --smoke
npm run start -w @poe2-kit/mcp -- --smoke
```

Инструменты `poe2_*`: `get_item_price`, `price_check`, `currency_rates`, `search_trade`, `leveling_guide`, `decode_build`, `analyze_build`, `ai_advice`, `get_league`, `set_league`. См. `apps/mcp/ASSISTANT_GUIDE.md`.

---

## Ядро (`@poe2-kit/core`)

Один импорт покрывает все сценарии (клиент/N=Node/браузер):

```ts
import { core } from '@poe2-kit/core';

// прайс-чек предмета из клир-текста
const res = await core.trade.priceCheck(itemText);
// [optional] режим браузера: переписать абсолютные URL на прокси того же хоста
core.http.setProxyBaseMap({ 'poe.ninja': '/proxy/poeninja', /* … */ });

// гид по прокачке (акты 1–4)
const plan = core.leveling.getLevelingPlan();

// декод PoB share-кода
const build = core.build.decodeShareCode(code);
```

Возможности:
- **Parse** — полный разбор клир-текста предмета: редкость, базу, моды, требования, урон/защиту, инференсы категорий.
- **Trade** — курсы валют (poe.ninja), уникалы (poe2scout), листинги `trade2`, прайс-чек валют и предметов с оценкой и доверительной меткой.
- **Leveling** — пошаговый план актов 1–4 (65 зон, связки, награды).
- **Build** — декод share-кода (urlsafe base64 → zlib → XML) со сводкой: класс, ascendancy, навыки, пассивные умения, снаряжение.
- **AI** — советы через подключаемого поставщика (`core.ai.setProvider(...)`), доступны и в Node, и в браузере.

---

## Лиги

По умолчанию активная лига — **Runes of Aldur**. Управляется через `core.trade.setLeague(name)` (MCP: `poe2_set_league`).

---

## Лицензия и авторство

Проект развивает собственную реализацию, не копируя целиком сторонние файлы. В `_research/` находятся скачанные открытые репозитории, послужившие источниками идей/данных; их авторство сохранено и к ним даются ссылки при использовании приёмов.