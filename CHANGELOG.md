# Changelog

Формат loosely по [Keep a Changelog](https://keepachangelog.com/).
Версии совпадают с тегами релизов на SourceCraft.

## [Unreleased]

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
- Дисклеймер ToS GGG: разделы «Правила использования» в README (RU/EN),
  строка в панели настроек оверлея, фиксация «no automation / no game-client
  access / read-only FFI» в SECURITY.md.

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
