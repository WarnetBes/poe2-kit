# Эпика: Headless-PoB-оракул (решение владельца от 11.10.2026)

> Спека: `_research/poe2kit_master_plan_2026-10.md` §7 + `plan_sections/sec2_decoders.md`.
> База: batch-оракул CI (oracle/oracle.lua, golden 5/5 PASS, №190+).
> Цель эпики: полноценный интерактивный headless-хост движка PoB2 под MCP/web,
> без патчей апстрима, с воспроизводимым рантаймом и дисциплиной пинов.

## Архитектура (установлена)

- Движок: **апстрим PathOfBuilding-PoE2**, штатный `HeadlessWrapper.lua`, без патчей.
- Загрузка билда: готовый XML; PoB-код → XML декодирует наш `core/pobcode` (патч-бюджет экономим).
- Транспорт: line-JSON-RPC по stdio (`oracle/headless/pob_host.lua`):
  startup-фрейм `{ready, runtimeContract:2,...}`, запрос = строка, EOF = корректный выход.
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
| **3. Интеграция с estimate/evaluate** | связка с poe2_build_estimate/compare: ручной FullDPS what-if на живом движке, дерево целей | ⬜ |
| **4. Патч-конвейер и 1.0-готовность** | PINNED.md (ревизия апстрима, SHA бинарей), драйф TreeData/0_5→1.0, CI-job oracle-headless | ⬜ |

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

## Что НЕ проверено (Фазы 1–2)

- Поведение на машине друга (нет клона PoB2 на F:\ — тул честно ответит available:false;
  нужен `git clone https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2` +
  `set POE2K_POB2_SRC`).
- CI Linux-путь хоста (run-oracle.sh — существующий CI работает на старом batch-скрипте;
  хост в CI подключается в Фазе 4).
- Долгоживущий процесс (персист-сессия web — Фаза 3), утечки/стабильность под серией
  запросов; многоконфигсетные билды (configSets >1) на живом движке (юнит-путь тот же).
