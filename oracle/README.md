# Headless-PoB2 оракул (CI)

Эталонный источник чисел для `poe2_build_estimate` и формул из `docs/POB2_CALC_FORMULAS.md`.
Запускает **настоящий движок PoB2** без GUI штатным способом (так же делает и сам
PoB2 в CI: `cd src; luajit HeadlessWrapper.lua`, см. `.github/workflows/test.yml`
репозитория PathOfBuilding-PoE2).

## Файлы

| Файл | Назначение |
|---|---|
| `oracle.lua` | Сценарии (customMods) → `build.calcsTab.calcsOutput` → JSON-строки. Ключи сортированы, числа — 4 знака (детерминизм) |
| `run-oracle.ps1` | Раннер: задаёт `LUA_PATH/LUA_CPATH`, `CI=true` (не трогать ModCache), снимок, сравнение/golden-update |
| `compare-golden.mjs` | Точное сравнение (tolerance 1e-4), диф в stdout, exit 1 при любом расхождении |
| `golden-oracle.json` | Эталонный снимок (обновляется ТОЛЬКО осознанно, см. ниже) |
| `bin/luajit.exe`, `bin/lua51.dll`, `bin/luajit.exe.manifest` | LuaJIT 2.1 (luapower mingw64-сборка, лицензия MIT — Copyright Mike Pall) |

## Использование

```powershell
# проверка против golden (CI-режим)
powershell -ExecutionPolicy Bypass -File oracle\run-oracle.ps1
# осознанное обновление golden (смена данных/версии PoB2)
powershell -ExecutionPolicy Bypass -File oracle\run-oracle.ps1 -UpdateGolden
```

Требования: PathOfBuilding-PoE2 в `C:\TestPE\_research` (переопределяется `-PobSrc`).

## Сценарии (5)
`novelist_default` (база PoE2: Life 65, Mana 50, res -50...), `resists_200`
(сверка с TestDefence_spec: PhysicalMaxHit 650/260/38...), `pool_conversions`,
`reduced_pools`, `big_life`. Числа `resists_200` и `reduced_pools` подобраны по
assert'ам PoB2-спеков — оракул взаимно проверяем с апстримом.

## Политика golden
1. CI-джоба падает при расхождении — не «обновить и забыть»: сначала diff,
   понять причину (данные PoB2 обновились? формула кита уехала?).
2. `-UpdateGolden` — только с коммитом, объясняющим причину, в паре с обновлением
   формул/датасетов кита.
3. Новые сценарии добавляются в `oracle.lua` + `-UpdateGolden` в том же PR.

## GitHub Actions (вставить в репозиторий poe2-kit)

```yaml
name: PoB2 oracle
on:
  push: { branches: [ main, dev ] }
  pull_request: { branches: [ main, dev ] }
  schedule: [{ cron: '0 6 * * 1' }]  # еженедельно ловим дрейф данных PoB2
jobs:
  oracle:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - name: Checkout PathOfBuilding-PoE2 (pinned)
        uses: actions/checkout@v4
        with:
          repository: PathOfBuildingCommunity/PathOfBuilding-PoE2
          ref: '<пинн tag для воспроизводимости>'
          path: _research/PathOfBuilding-PoE2
      - run: powershell -ExecutionPolicy Bypass -File oracle/run-oracle.ps1
        shell: pwsh
```

Linux-вариант: вместо luapower-бинаря — `ghcr.io/pathofbuildingcommunity/pathofbuilding-tests`
(тот же образ, что и CI PoB2; внутри есть `luajit`). Задачаائق: `cd src && LUA_PATH='?.lua;../runtime/lua/?.lua' luajit ../../oracle/oracle.lua`.

## Почему не GUI-экзешник
`runtime\Path{space}of{space}Building-PoE2.exe` аргументы скриптов не принимает
(проверено: запускает GUI) — headless-режим в PoB2 достигается только отдельным
интерпретатором LuaJIT. Строковая таблица `newBuild()`/`loadBuildFromXML()`
глобальна после `dofile("HeadlessWrapper.lua")`.
