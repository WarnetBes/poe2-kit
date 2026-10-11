# Эпика: Headless-PoB-оракул (решение владельца от 11.10.2026)

> Спека: `_research/poe2kit_master_plan_2026-10.md` §7 + `plan_sections/sec2_decoders.md`.
> База: batch-оракул CI (oracle/oracle.lua, golden 5/5 PASS, №190+).
> Цель эпики: полноценный интерактивный headless-хост движка PoB2 под MCP/web,
> без патчей апстрима, с воспроизводимым рантаймом и дисциплиной пинов.

## Архитектура (установлена)

- Движок: **апстрим PathOfBuilding-PoE2**, штатный `HeadlessWrapper.lua`, без патчей.
- Загрузка билда: готовый XML; PoB-код → XML декодирует наш `core/pobcode` (патч-бюджет экономим).
- Транспорт: line-JSON-RPC по stdio (`oracle/headless/pob_host.lua`):
  startup-фрейм `{ready, runtimeContract:3,...}`, запрос = строка, EOF = корректный выход.
  One-shot (MCP): несколько запросов в stdin → stdout → EOF. Протокол — паттерны
  MIT-донора poe2-exile-architect (© 2026 Max Wilk), наш код.
- Рантайм Windows: `oracle/bin/luajit.exe` + `lua51.dll` — LuaJIT 2.1 (luapower mingw64,
  MIT © Mike Pall), ставит `oracle/setup-headless.mjs` (SHA256-гейт, в git не коммитится).
- Каталог статов: DEFAULT_STATS (~60 ключей) в хосте; тул может сузить через `stats:[]`.
- Отказ без рантайма: `available:false` + setup-инструкция, не исключение.

## Фазы

| Фаза | Объём | Статус |
|---|---|---|
| **1. Хост v1 + MCP poe2_recompute** | setup-headless, pob_host.lua (ping/new_build/load_build_xml/set_level/set_config/stats), core/pobHost.ts, тул poe2_recompute, тесты | ✅ сделано (эталон Invoker 95 живьём: TotalDPS 5.99M, EHP 31 675) |
| **2. CAS-конфиг + валидация enum** | set_config CAS: снимок `before` затронутых ключей + `restore_config`; `get_config_schema` (списки движка из Modules/ConfigOptions); невалидные enum → отказ, не no-op; авто-резисты босс-тира (Boss 30 / Pinnacle 50 / Uber 50 — апстрим в headless применяет только как GUI-плейсхолдеры); полный `snapshot_build`/`restore_build` (XML через SaveDB). Долгоживущий персист-сессия web — остаётся Фазе 3 | ✅ сделано (живьём: Uber 1.80M vs baseline 5.99M, откат точный до копейки; contract 2) |
| **3. Интеграция с estimate/evaluate** | связка с poe2_build_estimate/compare: ручной FullDPS what-if на живом движке, дерево целей. Шаг 1: what-if МАТРИЦА `scenarios` в poe2_recompute — один boot движка на всю матрицу (до 12 сценариев {name, config, level}, `methods.whatif`): CAS-изоляция, точечный отказ сценария не рушит матрицу, Δ-таблица. Шаг 2 (№461, `1a64c11`): ПЕРСИСТ-СЕССИЯ — `core/pobSession.ts` (PobSession: boot один раз → RPC ~3 мс, FIFO, ленивый рестарт; stateful-RPC с умершим движком = отказ) + serve-dist.mjs `/api/pob/{load,rpc,status}` (whitelist, честный 503 без рантайма). Шаг 3 (№461, `9c6778c`): ДЕРЕВО ЦЕЛЕЙ — poe2_build_estimate `goals` (≤8 вех) → live-whatif таблица DPS/Life/EHP + Δ | ✅ сделано (живьём: 12-сценарная смешанная матрица level+config — 0 fails, after-matrix = baseline; персист boot 2.5 с → RPC ~3 мс ×10 одним спавном; дерево целей lvl92/95/100 точными дельтами) |
| **4. Патч-конвейер и 1.0-готовность** | PINNED.md (ревизия апстрима, SHA бинарей), драйф TreeData/0_5→1.0, CI-job oracle-headless | 🔶 частично (№461, `19495b6`): PINNED.md (v0.23.1, zip SHA256, luajit SHA-гейты, контракт 4) + кросс-платформенный selftest `oracle/headless-selftest.mjs` (Windows ОК) + CI-workflow pob-headless в .sourcecraft/ci.yaml. Дрейф-конвейер определён как ПРОЦЕДУРА (PINNED.md «Конвейер дрейфа»): деревьев 1.0 в v0.23.1 нет (latestTreeVersion=0_5), детектор = eженедельный golden-гейт pob-oracle; шаги перебазировки пина при красном ране описаны. НЕ проверен сам Linux-CI-ран (ждёт cloud worker) |

## Гейты каждой фазы

tsc 0 → vitest всё зелёное → build mcp+overlay 0 → smoke «Registered tools: <N>» → деплой на шару
после коммита → запись в квантовое ядро (журнал + cube2).

## Сквозной finding Фазы 2 (закрывает загадку №458)

`enemyIsBoss` в headless не двигал DPS по ДВУМ независимым причинам:

1. **Резисты босса — GUI-плейсхолдеры.** `apply` в ConfigOptions.lua ставит их
   через `SetPlaceholder` (только GUI), а в расчёт резист идёт лишь из
   `configTab.input`. Хост теперь применяет их сам (Boss 30 стр.2011 /
   Pinnacle 50 стр.2053 / Uber 50 стр.2094 / None 0; паттерн MIT-донора).
2. **Эталон Invoker игнорирует элементальные резисты** (флаги
   `Ignore*Cold/Fire/Lightning`/`IgnoreElementalResistances`, гейт
   `useThisResist` в CalcOffence.lua:4104). Зонд: Fire/Cold/Lightning 0→75%
   не меняют DPS; Chaos 75% → 4.42M (было 5.99M); Uber DamageTaken −70% →
   1.80M. Движок считает честно — особенность билда.

Опасная яма закрыта в TS: `set_config` отвечает `ok:false` ВНУТРИ result —
`recomputeBuild` обязан разворачивать это в honest unavailable, иначе мусорное
значение конфига тихо проглатывается (старое поведение = тот же класс бага).

## Что НЕ проверено (Фазы 1–4, №461)

- Поведение на машине друга (нет клона PoB2 на F:\ — тул честно ответит available:false;
  нужен `git clone https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2` +
  `set POE2K_POB2_SRC`).
- **Первый Linux-CI-ран pob-headless** — workflow в .sourcecraft/ci.yaml ждёт запуска
  cloud worker'ом (selftest локально на Windows против эталонного клона — ОК).
- **Персист-сессия HTTP под конкурентной нагрузкой** — сериализация очередью доказана
  юнит-тестами (FIFO, id-матчинг) и одним live-спавном на 10 RPC; реальная
  мультисессия/параллельные клиенты `/api/pob/*` не гонялись.
- **Дни-аптайм персист-сессии** — утечки luajit-хоста на длительном горизонте не мерились;
  ленивый рестарт после краша покрыт тестами (fake child).
- **Дрейф TreeData/0_5→1.0** — деревьев 1.0 в pinned v0.23.1 нет (latestTreeVersion=0_5);
  конвейер оформлен как процедура обновления пина в oracle/PINNED.md, детектор —
  еженедельный golden-гейт pob-oracle; процедура пока не отработана на живом дрейфе.
- Zip SHA256 v0.23.1 (aaa1ce76…c2af) — замерен 11.10.2026 один раз; codeload-архивы не
  гарантируют побайтовую стабильность, CI печатает sha256sum для глазной сверки с PINNED.md.
- Live-OAuth GGG-upload — блокер `POE2K_GGG_CLIENT_ID` (вне этой эпики).

