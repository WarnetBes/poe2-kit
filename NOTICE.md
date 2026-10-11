# NOTICE — атрибуция сторонних материалов

## packages/core/data/game/i18n/items_ru.json

- Цепочка источников:
  1. **Exiled Exchange 2** — https://github.com/Kvan7/Exiled-Exchange-2 — лицензия **MIT**.
     Оригинальные RU-строки локализации (renderer/public/data/ru).
  2. **mrw-overlay-poe2** (локальный клон `_research/mrw-overlay-poe2`) — лицензия **MIT**;
     файл `internal/overlay/data/locale/ru.json` собран `build/locale/build_locale.py`
     из данных Exiled Exchange 2 (поле `source` внутри JSON фиксирует это).
  3. **poe2-kit** — копия байт-в-байт, лицензия MIT (наследует право перераспространения).
- Поле `built` в JSON — дата сборки донором (2026-10-08). Содержимое: только данные
  (имена предметов/уникалей/гемов RU→EN + лейблы/паттерны клир-текста),
  исполняется только через JSON.parse, никогда не eval (см. packages/core/SECURITY.md).

## packages/core/data/game/i18n/mods_ru.json

- **Exiled Exchange 2** — https://github.com/Kvan7/Exiled-Exchange-2 — лицензия **MIT**
  (`dataParser/output/ru/stats.ndjson`): RU-строки модов ↔ EN ref. Сжатая
  регенерация: `poe2-kit/scripts/gen-ru-locale-data.mjs` (2026-10-11).

## packages/core/data/game/i18n/item_classes_ru.json

- **xiletrade** — https://github.com/maxensas/xiletrade — лицензия **MIT**
  (`licenses/LICENSE_XiletradeJson`, данные `src/Xiletrade.Library/Data/Lang/ru-RU/ItemClassTwo.json`):
  RU→EN значения «Класс предмета:» PoE2-клиента. Регенерация тем же скриптом.


## Прочие портированные модули (MIT, указано в шапках файлов)

- `livefilter/injector.ts` и др. — порт Go-донора (см. комментария в файлах).
- Паттерны гвардов вердикт-слоя — ExileLens (MIT); реализация своя
  (`packages/core/src/itemVerdict.ts`).
