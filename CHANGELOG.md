# Changelog

Формат loosely по [Keep a Changelog](https://keepachangelog.com/).
Версии совпадают с тегами релизов на SourceCraft.

## [Unreleased]

### Added
- **OAuth 2.1 (PKCE) вход в GGG** (`core.oauth`): доступ к официальному
  аккаунтному API `api.pathofexile.com` realm poe2 — список персонажей
  и полный снапшот выбранного (экипировка, инвентарь, пассивки) без
  копипасты из игры. Токены локально (`~/.poe2-kit/ggg-oauth.json`, 0600),
  автопродление по refresh, вход через локальный callback
  `http://127.0.0.1:8080/callback`. Требует `POE2K_GGG_CLIENT_ID`
  (регистрация приложения GGG; без него — честный отказ, остальной Kit
  не затронут). Стэш-API PoE2 у GGG не существует (PoE1 only) — стэш-тулов
  нет и не делаем.
- MCP-инструменты: `poe2_oauth_login`, `poe2_oauth_status`,
  `poe2_oauth_logout`, `poe2_characters`, `poe2_character_get`
  (42 → 47 тулов).
- Офлайн-смоук OAuth: PKCE/state/URL, хранилище токенов, 401 → refresh →
  повтор (мок fetch), валидация имени персонажа на границе (path-injection).

## [1.0.3] — 2026-09-28

### Added
- **statdesc-рендерер** (`@poe2-kit/core` `core.statdesc`): текст игрового
  стата по stat_id + значению — диапазоны `#`/`N`/`a|b`/`!N`, 31+ handler-
  конверсий (negate, per_minute_to_per_second и др.), теги `[A|B]`,
  fail-safe null на неизвестном stat_id. `normalizeStatPattern` /
  `findStatIdByPattern` — поиск по нормализованному тексту.
- **Оффлайн-снапшот каталога trade2** (`core.tradeSnapshot` +
  `data/game/trade/stats_snapshot.json`, 8299 статов): матчинг модов
  предмета → stat-id работает и без сети / при смене схемы после патча.
  Цепочка фолбэков: живой каталог → снапшот → learned.
- **Динамический rate-limit-клиент GGG** (http.ts): уважение заголовкам
  `X-Rate-Limit-Ip/Account` + `-State` (все правила), ожидание до
  освобождения квоты, при 429 — пауза по `Retry-After`/бан-счётчикам и
  повтор ≤2 раз. Действует на все запросы trade2/прайс-чек пачек.
- **Валидация community-вкладов** (`merge-contributions.mjs`): каждый
  предложенный stat_id↔шаблон сверяется с датамайном и снапшотом trade2;
  жёсткий конфликт «id есть с другим текстом» ловится в отчёте.
- **Headless-PoB2 оракул в CI SourceCraft** (`.sourcecraft/ci.yaml` +
  `oracle/`): настоящий движок PoB2 без GUI, 5 сценариев против golden
  (tolerance 1e-4), еженедельный cron + при изменениях `oracle/**`.
  Ловит дрейф формул/данных PoB2 до релиза.

## [1.0.2] — 2026-09-27

### Added
- **Оверлей: «осторожный режим»** — галка «Привязка к окну игры» в панели
  Ctrl+F6 (`bindWindow`, default on). Выключена = ни одного вызова user32.dll:
  оверлей стоит в углу рабочей области экрана (двигается Ctrl+F5), всегда
  видим, не следует за окном игры и не прячется при alt-tab.
- `loadSettings` теперь BOM-толерантен: файл, записанный PowerShell
  (`Set-Content -Encoding UTF8` = UTF-8 с BOM), больше не роняет чтение
  настроек в тихие дефолты.
- Дисклеймер ToS GGG: разделы «Правила использования» в README (RU/EN),
  строка в панели настроек оверлея, фиксация «no automation / read-only FFI»
  в SECURITY.md.
- CHANGELOG.md.

### Data
- base_items: baseline бандла перегенерирован до патча 0.5.5 (5382 → 5496 записей,
  +114 новых баз; game build 4.5.5.2, снапшот repoe-fork 11.09). Остальные датасеты
  (skill_gems, stat_descriptions, passive_tree, ascendancies) — патч 0.5 до
  лицензионной re-extraction. `data_revision` 12 → 13.
- `POE2K_LEARN_SOURCE`: записи журнала обучения теперь несут метку источника
  (`overlay` / `mcp`), внешний env не перетирается.

## [1.0.1] — 2026-09-26

### Added
- **Portable-сборка** `poe2-kit-portable-1.0.1-win64.zip` (17 МБ): путь без
  Node.js/npm — `start-overlay.bat` сам скачивает Electron при первом старте
  (github → фолбэк npmmirror). Режим `--full` (~190 МБ) — для своих ПК.
  `start-web.bat` раздаёт production-сборку через `serve-dist.mjs`.
- Оверлей: панель Ctrl+F6 — галка «Журнал обучения» и кнопка
  «📤 Поделиться предметами» (вклад без консоли).
- `README.en.md` (English Quick Start).

### Fixed
- Монорепо: `@poe2-kit/core` в apps/* пинился `"0.1.0"` → падение 404 при
  установке (теперь `*`); electron перенесён в prod-зависимости оверлея
  (иначе вырезался из portable `--omit=dev`); typescript — в devDeps core.

## [1.0.0] — 2026-09-26

Первый публичный релиз. MIT, публичное распространение через SourceCraft.

### Added
- **Community learning (opt-in):** журнал обучения (`POE2K_LEARN=1`,
  `~/.poe2-kit/learn/items.jsonl` — только структура предмета, без
  персонажа/аккаунта); `npm run contribute-items` — JSON-дайджест для issue;
  `merge-contributions` — строгий валидатор мейнтейнера.
- **Библиотека выученных статов** `stat_text_map.json` (3711 stat-id ↔ шаблон,
  засеяно живым trade2 `/data/stats`): фолбэк-матчинг модов — прайс-чек раров
  не падает при смене схемы после патча.
- `poe2_build_guide` — скелет 9-секционного гайда из проверяемых данных
  (MCP-тулы: 41 → 42).
- Документация: README — раздел «MCP-инструменты (42)» с примерами всех
  тулов и «Как что считается»; `ASSISTANT_GUIDE.md` — шпаргалка для
  ИИ-ассистентов.
- Оверлей: полная карта дерева пассивок в вебе; чек-лист прокачки
  (localStorage по лиге); сравнение с топ-лестницей класса; вставка предмета
  из буфера в вебе; диагностика (Кнопка «📋 Отправить диагностику» — хвост
  лога + конфиг в буфер/файл); watchlist-алерты; пакетный прайс-чек;
  HiDPI-лог.
- Live-смоки против живых API (poe.ninja / trade2 / poe2scout) —
  ежесуточно, Windows Task Scheduler (хост SourceCraft не исполняет
  GitHub Actions).
- Релиз-файлы: LICENSE (MIT), SECURITY.md (вклады — только данные),
  CONTRIBUTING.md.

## До 1.0.0 (dev-история)

P0/P1/P2-этапы разработки (декод PoB, прайс-чек, дерево пассивок,
MCP-сервер, оверлей, веб) — детально в `WORK_LOG.md` и `docs/WORK_SUMMARY.md`.
