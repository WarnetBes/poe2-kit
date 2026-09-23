# PoE2 Kit — Журнал всей выполненной работы

> Дата сохранения: **23.09.2026**
> Репозиторий: `git@git.sourcecraft.dev/volkovpartilaholin/poe2-kit.git`
> Ветка: `main` · HEAD: `e9c8660` (всё запушено в origin)

---

## 1. Что это за проект

**PoE2 Kit** — набор инструментов для **Path of Exile 2**:

- **Ядро** (`packages/core`) — вся логика: декодирование PoB-билдов, клир-текст предметов,
  прайс-чек (цены из живого рынка), оценка билда без движка PoB, гид по прокачке,
  AI-советы, чтение игрового лога, wiki.
- **MCP-сервер** (`apps/mcp`) — 15+ инструментов поверх ядра (через контекст-агент OpenAI).
- **Веб-приложение** (`apps/web`) — UI для сборки/оценки билдов, прайс-чека; доступно по локальной сети.
- **Оверлей** (`apps/overlay`) — поверх окна PoE2 (Win32 FFI через `koffi`), переносится на игровой ПК.

**Ограничения (решения):** только бесплатные публичные API (poe.ninja, poe2scout, trade2)
и локальная база RePoE. Модели Eliza: `eliza-glm/glm-5-3`, `eliza-qwen/qwen3-8-27b-fp8`,
`eliza-deepseek/deepseek-v4-flash`.

---

## 2. История коммитов (main → origin, последние 15)

| Коммит | Суть |
|--------|------|
| `e9c8660` | **feat(estimate)** — примерная оценка билда без движка PoB: слоёные EHP-формулы PoE2 (armor DR, evasion, block, res, chaos×2 ES), defense gaps, оружейный DPS. `estimateBuild(input)` принимает share-код/XML/gear. MCP тул `poe2_build_estimate` (итого 15 тулов). |
| `98bdea8` | **feat(wiki)** — poe2wiki.net service (search/getPage/lookup) в core + MCP `poe2_wiki_lookup`. |
| `9ab61eb` | **feat(log)** — чтение `Client.txt` в реальном времени: `packages/core/src/log.ts` (зоны `G{act}_{area}`, bounded tail через seek, событийный парсинг, свёрнутое состояние) + MCP `poe2_log_state`; smoke-тесты. |
| `ce9f247` | **diag** — `decodeShareCode` различает порчу mid-stream от усечённого хвоста; утилита `_recover_code.mjs` (salvage), `start-web.bat`, e2e-фикстура. |
| `3904cec` | **net** — web слушает `0.0.0.0:5173` для доступа по локальной сети (игровой ПК `192.168.0.200`). |
| `185bef7` | **feat: whole-build price check** — `buildCodeToGear`, `priceBuild`, типы `BuildGearItem`/`BuildPricedItem`/`BuildPriceReport`, MCP `poe2_build_price`, web-кнопка «Оценить снаряжение». Фикс `priceUnique`. |
| `5b1ed31` | **core(parse)** — распознавание Rarity в верхнем регистре (PoB) + игнор строки `Unique ID:` при определении базового типа. |
| `a305892` | **core/web/overlay** — единая актуальная лига по умолчанию из poe2scout (`currentDefaultLeague` в core) вместо хардкода `Runes of Aldur`; оверлей сохраняет выбор лиги. |
| `fe00daf` | — тесты `inferUniqueCategory`/`mapItemClassToScoutCategory` в smoke; экспорт `inferUniqueCategory`. |
| `01307fa` | **core** — ускорен `priceUnique`: категория уника из baseType (1 запрос вместо 27), таймаут 5с на категорийный поиск, общий таймаут 20с. |
| `255357a` | **mcp** — актуальная лига по умолчанию вместо хардкода; `price_check` без `Runes of Aldur`; docs: список инструментов и лиг. |
| `357e0f7` | **overlay** — привязка к окну игры PoE2 (Win32 FFI через `koffi`). |
| `114590e` | — дисклеймер: дата актуальности (23.09.2026); README-раздел о правах на файлы Beget. |
| `2b0c985` | — все лиги: динамический список + переключатель + конвертация цен; деплой вкладкой на сайт + дисклеймер. |
| `5ec993c` | — docs: README — обзор ядра и трёх приложений (web/overlay/mcp). |

---

## 3. Ядро — модули

Каталог: `packages/core/src`

| Файл | Назначение |
|------|-----------|
| `build.ts` | Декод share-кода PoB → XML (`decodeShareCode`, `toXml`), `buildCodeToGear` — извлечение снаряжения из активного ItemSet, `importBuild`, `parseBuildJson`, `estimateBuild`. |
| `trade.ts` | Живой прайс-чек: `priceCheck`, `priceUnique` (матч по имени + fallback), `priceBuild` (целиком), `inferUniqueCategory`, `aggregateGroups`, `currentDefaultLeague`. |
| `estimate.ts` | Примерная оценка билда без движка PoB: EHP-формулы PoE2, defense gaps, weapon DPS, `estimateBuild`. |
| `parse.ts` | Парсинг клир-текста предмета: `parseItemText` (верхний регистр редкости, Unique ID), `mapItemClassToScoutCategory`. |
| `leveling.ts` | Гид по прокачке: акты 1–4, `LEVELING_ZONES`, `ACT_REWARDS`. |
| `ai.ts` | AI-советы через OpenAI-совместимый endpoint: `systemPrompt`, fallback, Ollama. |
| `log.ts` | Чтение `Client.txt` в реальном времени: зоны, события, tail via seek. |
| `wiki.ts` | Поиск по poe2wiki.net: search/getPage/lookup. |
| `repoe.ts` | База RePoE (базовые типы, моды, тиры модов). |
| `http.ts` | HTTP-хелперы для публичных API. |
| `types.ts` | Общие типы, включая `BuildGearItem`, `BuildPricedItem`, `BuildPriceReport`. |
| `index.ts` | Экспорты ядра. |

---

## 4. MCP-инструменты

Каталог: `apps/mcp/src/tools` — `build.ts`, `currency.ts`, `db.ts`, `item.ts`, `leveling.ts`, `ai.ts`, `log.ts`, `wiki.ts`.

Всего инструментов (на HEAD `e9c8660`): **15**. Основные:
- `poe2_build_decode` — декод share-кода/ссылки/XML → XML или структура.
- `poe2_build_summary` — человекочитаемая сводка по XML.
- `poe2_build_price` — прайс-чек всего снаряжения билда (слот, имя, редкость, медиана, min/max, источники, объявления, сумма).
- `poe2_build_estimate` — примерная оценка билда (EHP, gaps, DPS) без движка PoB.
- `poe2_item_*` / `poe2_parse_item`, `poe2_mod_tier`, `poe2_items_db`, `poe2_currency_*`, `poe2_leagues`, `poe2_leveling_*`, `poe2_ai_*`, `poe2_log_state`, `poe2_wiki_lookup`.

---

## 5. Функциональные итоги (что реально сделано и проверено)

### 5.1 Актуальная лига
- Функция `currentDefaultLeague()` читает активную лигу из poe2scout (не хардкод).
- Актуальная лига на дату: **Forbidden Rites** (`shortCode: forbiddenrites`).
- Оверлей и веб сохраняют выбранную лигу.

### 5.2 Whole-build price check
- `buildCodeToGear(input)` принимает share-код (`eNr…`), ссылку, сырой XML или `.build` JSON.
  Внутри выбирает активный ItemSet и извлекает слоты (`inventory_id`) + клир-текст.
- `priceBuild(input, { league })` — конкурентный прайс всех слотов; в отчёте слот, имя, редкость,
  медиана, min/max, источники (poe.ninja/trade2), число объявлений, суммарная нижняя граница.
- MCP тул `poe2_build_price` и web-кнопка «Оценить снаряжение» (`apps/web/src/ui.ts` `showBuildPrice`).
- Проверено на реальном билде Ice Strike Monk (см. ниже).

### 5.3 Живой прайс-чек билда «Ice Strike Monk» (Invoker, lvl 95)
Полный share-код (`eNr…`) продекодирован и прогнан через `poe2_build_price`. 13 слотов:

| Слот | Предмет | Редкость | Цена |
|------|---------|----------|------|
| Belt | Darkness Enthroned | unique | ~0.02 (0.02–0.03) |
| Gloves | Pandemonium Paw | rare | — |
| Boots | Mind Dash | rare | — |
| Amulet | Doom Pendant | rare | — |
| Ring 2 | Dread Whorl | rare | — |
| Charm 3 | Vibrant Golden Charm of the Verdant | magic | — |
| Charm 2 | Silver Charm of the Brewer | magic | — |
| Charm 1 | Lustrous Stone Charm of the Medic | magic | — |
| Flask 1 | Bubbling Ultimate Life Flask of the Plentiful | magic | — |
| Helmet | Brimstone Cowl | rare | — |
| Ring 1 | Kraken Grasp | rare | — |
| Body Armour | Victory Cloak | rare | — |
| Flask 2 | Simmering Ultimate Mana Flask of the Brewer | magic | — |
| **Итог** | | | **1 из 13 оценён, сумма ~0.02** |

**Важно / ограничение:** PoB share-код хранит предметы **по именам**, без полного клир-текста модов/качеств.
Поэтому рары и магические предметы в «--» (0 объявлений) — точную рыночную оценку без модов
получить нельзя. Реально оценён только уникал **Darkness Enthroned** (~0.02).
Низкая сумма НЕ означает, что билд дешёвый — просто почти все слоты не имеют рыночного клир-текста.
Для точной оценки нужен **клир-текст каждого предмета** (Ctrl+C на предмете в игре).

> Альтернатива целиком в ядре: `estimateBuild(input)` даёт приблизительную EHP/DPS-оценку
> без PoB-движка по share-коду/XML/gear, даже когда точных цен нет.

### 5.4 Прочее проверенное
- **Net/веб:** `vite.config.ts` host:true → `http://192.168.0.196:5173` отвечает 200.
- **Автозагрузка веба:** `poe2k-web.vbs` в папке Startup (скрытый запуск `start-web.bat`).
- `start-web.bat` защищён от «порт 5173 занят» (netstat → exit 0), проверен.
- **Оверлей-пакет:** `deploy/poe2k-overlay-transfer.zip` (85 КБ) — исходники core+overlay, `start-overlay.bat`, README; `npm ci --dry-run` = up to date.
- **Фикс:** PowerShell-запись кода в файл добавляет UTF-8 BOM → ломает base64 декод; обрабатывается `.replace(/^\uFEFF/,'')`.

---

## 6. Порядок развёртывания

### 6.1 Веб (сервер, порт 5173)
- ПК `192.168.0.196` (этот): репо + модели. Веб доступен всем в сети: `http://192.168.0.196:5173`.
- Автозагрузка: `C:\Users\mezhavikiserj\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\poe2k-web.vbs`
  → скрытый запуск `start-web.bat`.
- Файрвол: inbound-Allow Node.js (RemoteAddress=Any) уже покрывает доступ.

### 6.2 Оверлей (игровой ПК 192.168.0.200)
- Привязан к окну PoE2 (Win32 через `koffi`), запускается локально.
- Перенос: распаковать `deploy/poe2k-overlay-transfer.zip` на игровой ПК:
  1. Установить Node.js LTS + C++ Build Tools (нужно для нативного `koffi`).
  2. Распаковать пакет.
  3. Запустить `start-overlay.bat`.
- Проверить веб `http://192.168.0.196:5173`.

### 6.3 Ограничения доступа
- Пароль сервера (OPENCODE_SERVER_PASSWORD) и удалённый доступ **не менять**.
- Firewall-правила от имени админа не создаются (UAC auto-denied); существующее правило достаточно.

---

## 7. Открытые вопросы / следующий шаг
1. **Полный прайс редких слотов** — нужен клир-текст предметов (Ctrl+C), share-код даёт только имена.
2. Гид по прокачке (`leveling.ts`) и AI-советы (`ai.ts`) для Ice Strike Monk — проверить/дополнить.
3. На игровом ПК: Node LTS + C++ Build Tools + `start-overlay.bat`.
4. Ранее не закоммичены временные файлы: `_price_build.mjs`, `e2e_code.txt`, `code_input.txt`, `decoded.xml` — сейчас убраны из рабочей копии (scratch), не коммитить.

---

## 8. Структура репозитория (ключевое)
```
poe2-kit/
  packages/core/src/   # ядро (build, trade, parse, estimate, leveling, ai, log, wiki, repoe, http, types)
  apps/mcp/src/tools/  # MCP-инструменты
  apps/web/            # веб-UI (vite, host 0.0.0.0:5173), кнопка прайс-чека
  apps/overlay/        # оверлей поверх PoE2 (koffi/Win32)
  deploy/              # переносимый пакет оверлея + start-overlay.bat
  start-web.bat        # автостарт веба с защитой порта
  _recover_code.mjs    # утилита восстановления повреждённого share-кода
  packages/package.json, package-lock.json
```