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

## Прочие портированные модули (MIT, указано в шапках файлов)

- `livefilter/injector.ts` и др. — порт Go-донора (см. комментария в файлах).
- Паттерны гвардов вердикт-слоя — ExileLens (MIT); реализация своя
  (`packages/core/src/itemVerdict.ts`).
