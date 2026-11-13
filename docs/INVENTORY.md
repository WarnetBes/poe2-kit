# Инвентаризация PoE2 Kit

**Дата:** 2026-11-14 · **HEAD:** e1f640f = v1.0.39 · **Выпуск:** №1 (issue #1)

## Executive summary

**Живо и зелёное:**

- MCP: 85/85 тулов (= `EXPECTED_TOOL_COUNT=85`)
- Тесты: vitest 831/831 passed (живой прогон 2026-11-14, 19.6 с)
- CI: live-smoke success (13.11.2026)
- Релизы: GH/SC синхронны, v1.0.39 — latest в обоих
- Датасеты: 0.5.5-свежие (base_items от snapshot 2026-09-11, trade_stats от 2026-11-08)

**Отстаёт / расхождения:**

- 1 устаревший счётчик: README.md:477 — «MCP-сервер (84)» (факт 85). README.en.md и apps/mcp/ASSISTANT_GUIDE.md счётчик 85 несут верно.

**Незакрытые хвосты в рабочем дереве:**

- 3 изменённых датасета: `packages/core/data/game/repoe/base_items.json`, `packages/core/data/game/repoe/mods.json`, `packages/core/data/game/trade/trade_stats.json` — вероятно live-refresh, решение коммитить за владельцем
- Untracked: `ninja_ldr.mjs` (известный давнишний хвост владельца, в коммиты не попадал), `start-mcp-log.txt`

---

## 1. Репозиторий

| Параметр | Значение |
|---|---|
| Зеркала | origin = `git.sourcecraft.dev/volkovpartilaholin/poe2-kit` (канон); github = `WarnetBes/poe2-kit` |
| HEAD | e1f640f = тег v1.0.39, присутствует в обоих ремоутах |
| Версии (package.json) | корень = 1.0.39; apps/mcp = 1.0.39 |
| Структура | packages/core (ядро+датасеты); apps/mcp; apps/overlay; apps/web; docs/ (21 файл); tests/smoke (32 скрипта) |
| CI | `.github/workflows`: ci.yml + live-smoke.yml; live-smoke success от 13.11.2026 |

## 2. MCP-инструменты (apps/mcp)

**Итого: 85 тулов ✅ = `EXPECTED_TOOL_COUNT=85`** (`tests/smoke/expected-tools.mjs:8`) · 40 модулей-файлов в `src/tools`.

| Категория | Инструменты |
|---|---|
| AI | poe2_ai_ask |
| Айлменты / калькуляторы | poe2_ailments, poe2_base_pools, poe2_ehp, poe2_enemy_stats, poe2_resist_pairs, poe2_spirit, poe2_stun |
| Билд | poe2_build_advice, poe2_build_compare, poe2_build_decode, poe2_build_estimate, poe2_build_guide, poe2_build_price, poe2_build_summary, poe2_compose_build, poe2_evaluate_build, poe2_export_build_planner, poe2_pob_compare, poe2_rank_levers, poe2_recompute, poe2_starter_builds |
| Дерево / датасеты | poe2_ascendancy_nodes, poe2_data_freshness, poe2_dataset_info, poe2_gems_lookup, poe2_mod_tier, poe2_stat_explain, poe2_support_gems_lookup, poe2_tree_ids, poe2_tree_route, poe2_tree_search, poe2_tree_search_stats |
| Предметы / гир | poe2_gearscore, poe2_item_filter_upload, poe2_item_upgrade_verdict, poe2_item_verdict, poe2_items_compare, poe2_items_db, poe2_parse_item, poe2_price_analysis, poe2_price_check, poe2_trade_search, poe2_unique_market, poe2_rune_prices |
| Цены / валюта | poe2_currency_check, poe2_currency_history, poe2_currency_prices, poe2_leagues, poe2_price_history |
| Лестницы / мета | poe2_ladder_leagues, poe2_ladder_top, poe2_meta_ladder, poe2_skill_meta |
| Прокачка / гайды | poe2_leveling_class, poe2_leveling_context, poe2_leveling_guide, poe2_leveling_plan, poe2_simulacrum_guide |
| Карты / эндгейм | poe2_map_check, poe2_map_prep, poe2_pinnacle_check, poe2_delirium_recipes, poe2_tricks, poe2_known_issues |
| Фильтры | poe2_live_filter |
| Логи / клиент | poe2_game_config, poe2_log_state, poe2_log_summary, poe2_log_tail, poe2_character_get, poe2_characters |
| OAuth | poe2_oauth_login, poe2_oauth_logout, poe2_oauth_status |
| Оверлей | poe2_overlay_gaps, poe2_overlay_notify, poe2_overlay_state, poe2_overlay_watch_add, poe2_overlay_watch_remove |
| Прочее | poe2_poe2db_lookup, poe2_sources_fetch, poe2_sources_list, poe2_wiki_lookup, poe2_keybind_advisor |

## 3. Датасеты (packages/core/data/game)

**Итого: 2763 файла, 109.0 МБ.**

Топ по объёму:

| Датасет | Объём |
|---|---|
| ritual/catalog/images | 36.2 МБ |
| skill_gems | 9.9 МБ |
| stat_descriptions | 9.2 МБ |
| passive_tree | 6.7 МБ (+export 5.7 МБ, +assets 4.5 МБ) |
| uniques/icons | 5.7 МБ |

Ключевые счётчики (по `data/game/version.json`: data_revision 13, патч 0.5 «Return of the Ancients» 2026-05-29; base_items_REFRESH 0.5.5 snapshot 2026-09-11):

| Счётчик | Значение |
|---|---|
| base_items | 5496 записей (0.5.5) |
| mods | 16788 записей |
| passive_tree | 9605 узлов; mastery_effects 332 |
| stats | 27013 |
| skill_gems | 965 |
| skill_gems_v2 | 1373 |
| support_gems | 680 |
| stat_descriptions | 16533 (+89 без описания); per_skill 1240 |
| ascendancies | 37 (23 активных) |
| starter_builds | 18 |
| delirium_recipes | 946 рецептов, 10 эмоций (данные poe2-biblioteka.ru, fetched 2026-11-08) |
| uniques_catalog | 433 уника в 19 категориях |
| poeshop_market | 957 записей |
| build_planner/gem_gameids.json | 966 gameId |
| known_issues | 22 |
| tricks | 8 |
| trade/trade_stats.json | 855 295 Б (свежесть 2026-11-08) |
| trade/vendor_regex.json | — (справочник вендор-цен) |
| maps.json + waystone_mods.json | — |
| pob2_stat_templates.txt | 1.6 МБ (31 016 msgid) |
| zoneNotes.json | 36 КБ |

## 4. Web (apps/web)

**22 кнопки-вкладки в 4 группах** (по data-tab в `src/main.ts:76-97`):

| Группа | Вкладки |
|---|---|
| Прокачка (4) | leveling, checklist, hideout, slang |
| Билд (10) | build, keybinds, compare, poboracle, tree, map, craft, starterbuilds, poeguides, planner |
| Эндгейм (5) | atlas, mapprep, simulacrum, radar, pinnacle |
| Экономика (3) | currency, price, ai |

Sources: 27 ts-файлов в src (включая style.css 69 КБ, main.ts 53 КБ).

## 5. Overlay (apps/overlay)

Electron-приложение. src: 11 файлов; main.ts 259 КБ; rendererHtml.ts 211 КБ.

**IPC-каналы (`ipcMain.handle`): 46 шт.**

| № | Каналы |
|---|---|
| 1–12 | price:check, boss:timerdone, level:reset, level:claim, league:set, leagues:list, watch:list, watch:add, watch:remove, watch:toggle, watch:check, watch:addBuffer |
| 13–24 | settings:get, settings:apply, settings:pickPobFile, update:check, update:cached, update:rootWritable, update:openPage, update:install, move:reset, build:import, build:toggle, build:reset |
| 25–36 | build:get, mapprep:check, starter:list, starter:import, starter:pick_asc, starter:openpob, panel:open, tree:search, interact:set, craft:catalog, craft:plan, keybinds:advice |
| 37–46 | currency:rates, buildgen:meta, buildgen:compose, buildgen:gemdata, buildgen:combocode, keyboard:set, overlay:autosize, diag:collect, trade:reloadStats, learn:info, learn:contribute |

## 6. Тесты и гейты

| Гейт | Состояние |
|---|---|
| vitest core | 66 файлов, 831/831 passed (живой прогон 2026-11-14, 19.6 с) |
| smoke | 32 mjs-скрипта в tests/smoke; головной контракт EXPECTED_TOOL_COUNT=85 |
| CI | ci.yml + live-smoke.yml; последний success 13.11.2026 |
| Релизы | GH v1.0.39 Latest (2026-11-08); история: v1.0.38, v1.0.37, v1.0.36, ritual-data-v1.0.36 |

## 7. Расхождения и хвосты

| Позиция | Детали |
|---|---|
| README.md:477 | «MCP-сервер (84)» — устарел (факт 85). Единственное найденное расхождение счётчиков. README.en.md (3× «85») и apps/mcp/ASSISTANT_GUIDE.md (2× «85») верны |
| Рабочее дерево (M) | packages/core/data/game/repoe/base_items.json, packages/core/data/game/repoe/mods.json, packages/core/data/game/trade/trade_stats.json — live-refresh датасетов, коммит за владельцем |
| Рабочее дерево (untracked) | ninja_ldr.mjs (давнишний хвост, вне коммитов), start-mcp-log.txt |
| Портативная дистрибуция | portable в истории релизов присутствует (v1.0.39); деплой на шару `\\192.168.0.200\OpenCodeProjectsF\poe2-kit` сверен байт-в-байт 08.11 (№742); батник update_v1039_game_pc.bat на шаре ждёт запуска на игровом ПК |

---

*Источник: docs/INVENTORY.md — сгенерирован скриптами зондов по фактическим данным; функциональный код не менялся*
