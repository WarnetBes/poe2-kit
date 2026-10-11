# Эпика: Headless-PoB-оракул (решение владельца от 11.10.2026)

> Спека: `_research/poe2kit_master_plan_2026-10.md` §7 + `plan_sections/sec2_decoders.md`.
> База: batch-оракул CI (oracle/oracle.lua, golden 5/5 PASS, №190+).
> Цель эпики: полноценный интерактивный headless-хост движка PoB2 под MCP/web,
> без патчей апстрима, с воспроизводимым рантаймом и дисциплиной пинов.

## Архитектура (установлена)

- Движок: **апстрим PathOfBuilding-PoE2**, штатный `HeadlessWrapper.lua`, без патчей.
- Загрузка билда: готовый XML; PoB-код → XML декодирует наш `core/pobcode` (патч-бюджет экономим).
- Транспорт: line-JSON-RPC по stdio (`oracle/headless/pob_host.lua`):
  startup-фрейм `{ready, runtimeContract:1,...}`, запрос = строка, EOF = корректный выход.
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
| **2. CAS-транзакции + долгоживущий режим** | set_config batch с откатом (снапшот input → restore), персист-сессия для web | ⬜ |
| **3. Интеграция с estimate/evaluate** | связка с poe2_build_estimate/compare: ручной FullDPS what-if на живом движке, дерево целей | ⬜ |
| **4. Патч-конвейер и 1.0-готовность** | PINNED.md (ревизия апстрима, SHA бинарей), драйф TreeData/0_5→1.0, CI-job oracle-headless | ⬜ |

## Гейты каждой фазы

tsc 0 → vitest всё зелёное → build mcp+overlay 0 → smoke «Registered tools: <N>» → деплой на шару
после коммита → запись в квантовое ядро (журнал + cube2).

## Что НЕ проверено (Фаза 1)

- Поведение на машине друга (нет клона PoB2 на F:\ — тул честно ответит available:false;
  нужен `git clone https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2` +
  `set POE2K_POB2_SRC`).
- CI Linux-путь хоста (run-oracle.sh — существующий CI работает на старом batch-скрипте;
  хост в CI подключается в Фазе 4).
- Долгоживущий процесс (Фаза 2), утечки/стабильность под серией запросов.
