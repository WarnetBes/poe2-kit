# PINNED — воспроизводимость headless-оракула (Фаза 4)

Любое отклонение от этой таблицы = осознанный апдейт с записью в журнал
куба LOG. Селфтест: `node oracle/headless-selftest.mjs <pob2>/src` (Windows:
подхватит `oracle/bin/luajit.exe`; Linux/CI-Docker: `luajit` из PATH).

## Пины

| Компонент | Значение | Где проверяется |
|---|---|---|
| PathOfBuilding-PoE2 (движок) | тег **v0.23.1** (`codeload .../zip/refs/tags/v0.23.1`) | CI pob-oracle + pob-headless скачивают один и тот же URL |
| Zip SHA256 (замер 11.10.2026) | `aaa1ce761a87cfdbc3f54d145c14c6804275de5f3ef1a1d4b1524127c164c2af` (~390 МБ) | CI печатает `sha256sum`; codeload-архивы НЕ гарантируют побайтовую стабильность — сверка глазная, не гейт |
| luajit.exe (Windows-рантайм кита) | `5343326fb0b4f79c32276f08ffcc36bd88cde23aa19962bd1e8d8b80f5d33953` | `oracle/setup-headless.mjs` — жёсткий гейт (exit 1) |
| lua51.dll (Windows-рантайм кита) | `c7a657af5455812fb215a8888b7e3fd8fa1ba27672a3ed9021eb6004eff271ac` | там же — жёсткий гейт |
| LuaJIT исходник | github.com/luapower/luajit, ветка master (`bin/mingw64`) — пин только по SHA бинарей, тегов у ветки нет | setup-headless при перезамере |
| Контракт хоста | **4** (см. `oracle/headless/pob_host.lua`, `HEADLESS_RUNTIME_CONTRACT`) | selftest ассертит startup-фрейм |

## Контракт 4 — что в нём

1. `set_config` отдаёт `before` (снимок) + `remove` (список ключей к удалению).
   Причина: dkjson при decode ПРОПУСКАЕТ `"ключ":null` (проба №460-х: 0 entries),
   «удалить ключ» через JSON round-trip значением не выражается до контракта 4.
2. `restore_config` принимает `before` и/или `remove`.
3. `whatif` — матрица сценариев (≤12) в одном движке, CAS-изоляция.

## История

- 11.10.2026: замер пинов, контракт 4 (Фаза 4 эпики headless-оракула).
