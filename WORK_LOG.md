# PoE2 Kit overlay — рабочий лог (dev-машина)

Обновлено: 2026-09-24. Репо: https://git.sourcecraft.dev/volkovpartilaholin/poe2-kit.git, ветка main.

## Текущее состояние remote (main)

```
7f253f9 start-overlay: chcp 65001 — русский вывод в консоли
f42a388 deploy: автообновление через git pull при старте оверлея
18f90a9 deploy: обновить справку хоткеев (Ctrl+F1..F5) в transfer-пакете
24ed981 overlay: autosync с персонажем poe.ninja + авторазмер окна
```

## Что сделано ранее (кратко)

- Char-sync: `parseProfileCharacterUrl` / `profileCharacterCodeUrl` / `fetchProfileCharacterGear` в `packages/core/src/build.ts`; raw-эндпоинт poe.ninja `/poe2/pob/raw/profile/code/{account}/{league}/{char}`; троттлинг 5 мин; `char-sync.json` в `%APPDATA%\@poe2-kit\overlay`.
- Ссылка на персонажа + Ctrl+F3 = настройка синхронизации (не затирает целевой билд); PoB-код/ссылка + Ctrl+F3 = импорт.
- Авторазмер окна: renderer ResizeObserver → IPC `overlay:autosize` → main подгоняет высоту (ширина 420).
- Матчинг слотов: по имени слота → fallback `matchBuildSlot`; совпало → `status='bought'`, иначе запись `worn`.
- Автообновление: canonical `start-overlay.bat` в корне репо (git pull --ff-only при старте, WARN при сбое сети); `deploy/poe2k-overlay-transfer-src/convert-to-git.bat` — bootstrap zip-копии в git-клон (winget Git.Git + clone + перенос node_modules); make-transfer-zip.ps1 берёт bat из корня, фильтрует `_*.mjs/_*.log/_*.txt/*.tsbuildinfo`. Zip: `deploy/poe2k-overlay-transfer.zip` (2.45 МБ).
- chcp 65001 в start-overlay.bat — фикс кракозябр в консоли (коммит 7f253f9). НА ГЕЙМ-ПК ещё не применён: у пользователя папка без .git, обновлений нет.

## Живой тест на гейм-ПК (лог пользователя, новая версия)

OK: хоткеи Ctrl+F1..F5, автодетект лога `F:\SteamLibrary\...\LatestClient.txt`, импорт билда 28880 (13 slots, Monk @Invoker), estimate worstEhp=4477 (chaos), ru-en dict loaded.

Проблемы из лога (в работе —"]))
1. `build import skipped: ещё идёт прайсинг предыдущего билда` — прайсинг слотов (13 слотов × до 45 с) блокирует повторный Ctrl+F3. ФИКС: отменяемый прайсинг через токен (`pricingToken`): новый импорт отменяет старый цикл; гвард убран.
2. `build price failed: slot=Charm 3 ... timeout after 45000ms` —.charms/flasks не торгуются, жгут таймауты. ФИКС: скип слотов /^(charm|flask)/i в прайсинге.
3. `price done: item="Неизвестный предмет"` при Ctrl+F1 с PoB-кодом билда в буфере (9944 символов). ФИКС: детект «похоже на PoB-код» → подсказка «нажмите Ctrl+F3» вместо пустого результата.
4. `build meta failed: fetch failed` — транзиентная сеть к poe.ninja, best-effort, оставлено как есть.

## Инструкции для гейм-ПК

- Включить автообновление (один раз): `deploy\poe2k-overlay-transfer-src\convert-to-git.bat`, дальше запускать `poe2-kit-git\start-overlay.bat`.
- Признак старой версии: в логе `hotkey CommandOrControl+Alt+Space` вместо F1..F5.
- Конфиги: `%APPDATA%\@poe2-kit\overlay` (league.txt, build-state.json, char-sync.json, overlay.log, ...).
- Chat-вставки PoB-кодов всегда битые — только raw-ссылки.

## Ключевые файлы

- `apps/overlay/src/main.ts` — char-sync, runBuildImport/runPriceCheck, autosize, хоткеи
- `apps/overlay/src/rendererHtml.ts` — requestSize, worn-строки, 🧍, state.info
- `apps/overlay/src/preload.ts` — autosize(px)
- `packages/core/src/build.ts` — parseProfileCharacterUrl, fetchProfileCharacterGear, toRawUrl
- `packages/core/src/estimate.ts` — estimateBuild
- `start-overlay.bat` (корень) — автообновление git pull + сборка + старт
- `deploy/poe2k-overlay-transfer-src/` — make-transfer-zip.ps1, convert-to-git.bat, README.md
