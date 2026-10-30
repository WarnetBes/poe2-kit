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

## packages/core/src/treeRoute.ts (пробел №3: маршрут по пассивке)

- Данные дерева — уже имевшийся в репо экстракт официального GGG skill tree
  export (`packages/core/data/game/passive_tree/layout.json`,
  `build_planner/map.json` slugs): формат-факт игры, в данных источниках не нуждается
  (см. metadata файлов).
- **poe2-toolkit/tree-core** (https://github.com/poe2-toolkit, copyright © 2026
  Vladislav Rajtmajer, **MIT**) — эталон сверки BFS-слоя `buildTreeGraph` /
  `pathToNode`; код не копировался (вход у них — GGG TreeData, у нас свой layout),
  использован как канон «BFS на невзвешенном графе узлов+рёбер».
- JayRichh/poe2.dev (`skill-tree/utils/pathFinding.ts`) — **LICENSE отсутствует**:
  заимствована только идея мульти-стартового фронта A*/BFS от любого
  аллоцированного узла (pattern-by, ни одной строки кода).

## packages/core/src/buildComposer.ts (№497: генератор скелета билда)

- **github.com/MaxWilk/poe2-build-mcp** — паттерн **MIT © 2026 MaxWilk**:
  заимствована архитектура «LLM-скелет + PoB-движок валидирует» — движок
  собирает только скелет (класс → оружие → main-skill → саппорты → бюджетная
  стадия → числовые цели), а все числа проверяются каноническими модулями
  ядра (estimate/optimize/enemy/resources). Python-код не переносился;
  реализация — собственный TypeScript поверх существующих экспортов core.


## packages/core/src/upgradeVerdict.ts, swapItem.ts; oracle/headless/pob_host.lua (swap_item)

- **Idea reference: poe2-upgrade-checker** (ets-public) — https://github.com/ets-public/poe2-upgrade-checker — лицензия **GPL-3.0-only** (НЕ совместима с MIT-китом: код НЕ копировался ни строкой). Заимствованы только идеи/подходы (не охраняемые копирайтом): вердикт-swap «предмет надевается, билд пересчитывается, до/после сравниваются», DPS-приоритет Full -> MinionCombined -> Combined -> Total одним ключом на обеих сторонах, гварды (резист-кап с буфером, Spirit over-reserve, атрибуты, hold movement speed), примерка колец/фляг в оба слота. Все формулы re-реализованы в TypeScript/Lua kit-а поверх собственного oracle-хоста (pob_host.lua, паттерны MIT © 2026 Max Wilk) и Recompute-статов; см. журнал волны W2 (№690).


## packages/core/src/autoWeights.ts, resistPairs.ts, gearscore.ts, mapCheck.ts, itemsCompare.ts; apps/overlay/src/jsonStore.ts (волны W3/W4/W5)

- **Idea reference: poe2-upgrade-checker** (ets-public) — лицензия **GPL-3.0-only** (НЕ совместима с MIT-китом: код НЕ копировался ни строкой). Заимствованные идеи/подходы (не охраняемые копирайтом):
  - W3 autoWeights: «статы, которые ваш гир стекает = приоритеты билда»; типичный ролл ≈ 30 целевых очков с мультипликатором числа слотов; капы спец-статов; уники и локальные double-count-моды исключаются.
  - W3 resistPairs: «пары предметов, закрывающие резисты ВМЕСТЕ», сплит больших дефицитов.
  - W4 gearscore: оценка 0–100 = Σ(важность × качество ролла)/«идеальный предмет слота» (top-K статов на полном ролле); per-slot важности и «отличные роллы»-капы; один старт не набирает больше одного топ-ролла; условные моды и заменяемые бонусы весят меньше; закрытые резисты почти не весят; фляги/чармы/уники/неопознанные не оцениваются.
  - W4 mapCheck: вердикт карты против билда DANGER/CAREFUL/FINE по модам -max Resistance (пересчёт элем-EHP страниц по механике капа) и жёстким немоделируемым дебаффам.
  - W4 jsonStore: JSON-хранение с ретраями чтения, атомарной записью через tmp+rename и восстановлением битого файла из последней хорошей копии.
  - W5 itemsCompare (head-to-head, №696): идея «сравнение текущего предмета с кандидатом: явный мод-дифф + числовая оценка → вердикт» без копирования кода; статистика rival-items — собственная (мод-дифф с нормализацией чисел + связка с gearscore-профилями кита).
  Все формулы re-реализованы в TypeScript kit-а поверх собственного core (parse/tradeQuery/estimate) и Electron-окружения; см. журнал волн W3 (№692), W4 (№693) и W5 (№696).
