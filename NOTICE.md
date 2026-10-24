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
- Additive-слой RU-баз (поле `merged: 2026-10-24`): RU base-item names adapted
  from Sidekick-Poe/Sidekick (MIT) — https://github.com/Sidekick-Poe/Sidekick
  (`data/poe2/ru/items.json`: RU-имена, baseItemIds → `metadataId`,
  tradeItems.cat → `tradeCat`; EN-канон новых строк — из repoe base_items.json).
  Слияние — `poe2-kit/scripts/_merge_sidekick_ru.mjs`, копия донора —
  `poe2-kit/scripts/data-raw/sidekick_ru_items.json` (в portable-архив не входит).

## packages/core/data/game/i18n/mods_ru.json

- **Exiled Exchange 2** — https://github.com/Kvan7/Exiled-Exchange-2 — лицензия **MIT**
  (`dataParser/output/ru/stats.ndjson`): RU-строки модов ↔ EN ref. Сжатая
  регенерация: `poe2-kit/scripts/gen-ru-locale-data.mjs` (2026-10-11).

## packages/core/data/game/i18n/item_classes_ru.json

- **xiletrade** — https://github.com/maxensas/xiletrade — лицензия **MIT**
  (`licenses/LICENSE_XiletradeJson`, данные `src/Xiletrade.Library/Data/Lang/ru-RU/ItemClassTwo.json`):
  RU→EN значения «Класс предмета:» PoE2-клиента. Регенерация тем же скриптом.


## packages/core/data/game/livefilter/ + packages/core/src/livefilter/

- **mrw-overlay-poe2** — https://github.com/kadircelebi/mrw-overlay-poe2 — лицензия **MIT**;
  подход (инжект динамического блока, SelfCheck, guardrails, FilterKey) портирован
  Go→TS с адаптацией, атрибуция в шапках перенесённых файлов
  («Adapted from kadircelebi/mrw-overlay-poe2 (MIT)»).
- **Filtration-Fork** — GPL-2.0 (`Filtration.ObjectModel/BlockItemTypes/*.cs`,
  `Enums/BlockItemOrdering.cs`): из донора взяты ТОЛЬКО факты — имена условий
  лут-фильтра PoE2 и SortOrder-числа (модель BlockItemOrdering); код НЕ копируется,
  датасет и реализация — собственные (`data/game/livefilter/conditions.json`,
  `src/livefilter/conditions.ts`).
- **divine-view** — LICENSE-файла НЕТ: ТОЛЬКО факты (`src/utils/filterValidator.ts:12-56`
  — списки NUMERIC/ALL_CONDITIONS и операторы; `:109-111` — shorthand «GemLevel 19» = «>= 19»).
  Код НЕ копируется.
- Канон истины — гайд GGG Item Filters
  (https://www.pathofexile.com/item-filter/about), live-сверка 2026-10-24:
  HasImplicitMod→boolean, HasInfluence→list, MemoryStrands→numeric,
  +BaseDefencePercentile/Exceptional/TransfiguredGem (PoE2-only),
  GemQualityType помечен Deleted.

## packages/core/data/game/ritual/ (датасет Ritual №584)


- **github.com/saxe78/poe2pricer** — лицензия **MIT** © 2026 saxe78
  (релиз 1.1.2, SHA256 zip `67A1AEE17CBFF80AAC9BC52EEE5C0086ADB8C6B5039C75B25C009335554F4110`):
  каталог `catalog.json`, learned-модель `recognition-model.json`,
  эталоны `official-references.json`, иконки `catalog/images/`, `catalog/official-images/`,
  якоря `ui/*.png`. Константы `Tuning.cs` портированы дословно в `src/ritual.ts`.
- **github.com/Dev-Jahn/poe2-ritual-checker** — лицензия **MIT** © 2026 (commit 7c16291):
  исходная модель распознавания Favours (gray 0.70 / edge 0.30 / penalty), прототипы 24×48.
- **Арт GGG** (через poe2db.tw, web.poecdn.com): изображения предметов, якоря UI и artwork —
  материал Grinding Gear Games, НЕ покрывается MIT; использование — CC BY-NC-SA практики
  poe2db, только для некоммерческого SSF-инструмента. Тексты/JSON — факт данных игры.

## Прочие портированные модули (MIT, указано в шапках файлов)

- `livefilter/injector.ts` и др. — порт Go-донора (см. комментария в файлах).
- Паттерны гвардов вердикт-слоя — ExileLens (MIT); реализация своя
  (`packages/core/src/itemVerdict.ts`).
