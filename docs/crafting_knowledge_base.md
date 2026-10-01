# PoE2 — база знаний целевого крафта (КУБ-2 KIT)

> Куритировано из трёх web-research-агентов 01.10.2026. Актуальность: **патч 0.5.5, лига Forbidden Rites** (старт 05.09.2026); релиз 1.0 — 11–12.12.2026.
> Хронология лиг: 0.2 Dawn of the Hunt (04.2025) → 0.3 (Abyss/Desecration → core) → 0.4 The Last of the Druids / Fate of the Vaal (13.12.2025) → 0.5 Return of the Ancients / Runes of Aldur (30.05.2026) → **0.5.5 Forbidden Rites (текущая)**.
> Источник хронологии: https://poe2db.tw/us/League
> Пометки: ✅ подтверждено источником (URL), ❓ не подтверждено = не выдумано, требует проверки.

## 0. Ключевые отличия от PoE1 (мифы — прочь)

- ❌ **Нет** Orb of Scouring, Orb of Alteration, Orb of Regret, Chromatic Orb — удалены. ✅ https://poe2db.tw/us/Currency
- ❌ **Нет крафт-бенча PoE1-типа** (мастера/золото/1 bench-мод). «The Count» — босс Act 1, не верстак. Замещающие системы: эссенции/Alloys (1 crafted-мод), Desecration (1 desecrated-мод), руны/соколы-сокеты, Reforging Bench. ✅ https://poe2db.tw/us/Crafting
- ❌ **Нет «Item Power»** — есть ilvl базы и mod level тира. ✅ mobalytics, poe2db
- ✖ **Рекомбинаторы удалены** патчем 0.5.0 («Omen of Recombination has been removed»). Официальный патчноут: https://www.pathofexile.com/forum/view-thread/3932540
- ✅ Chaos Orb в PoE2 = **удалить 1 случайный мод + добавить 1 случайный**, НЕ полный реролл. ✅ https://poe2db.tw/us/Currency
- ✅ Rare = **6 модов: 3 префикса + 3 суффикса**; Magic = 2 (1+1). ✅ https://poe2wiki.net/wiki/Item_rarity

## 1. Крафтовая валюта (0.5.5)

Линейки **Greater** (floor уровня мода: Transmute/Augment — 44, Exalt/Regal/Chaos — 35) и **Perfect** (70 / 50) — вырезают мусорные низкие тиры из пула. ✅ https://maxroll.gg/poe2/resources/how-to-craft-in-path-of-exile-2

| Сфера | Эффект | Применяется к | SSF-ценность |
|---|---|---|---|
| Orb of Transmutation (G/P) | White → Magic, +1 мод | Normal | расходник основы |
| Orb of Augmentation (G/P) | Magic, +1 мод | Magic | расходник №1 |
| Regal Orb (G/P) | Magic → Rare, +1 мод | Magic | ключевой шаг |
| Orb of Alchemy | White/Magic → Rare, 4 мода | Normal/Magic | дороже PoE1-аналога |
| Exalted Orb (G/P) | Rare, +1 мод | Rare | «валюта» PoE2 (аналог chaos PoE1) |
| Chaos Orb (G/P) | удалить 1 случ. мод + добавить 1 | Rare | чистка |
| Orb of Annulment | удалить случайный мод | любой | ценная; с Omen of Light — таргет desecrated |
| Divine Orb | реролл чисел модов (внутри тиров) | любой | топ-капитал, только на готовом |
| Vaal Orb | коррупт: +1 сокет / реролл части модов / энчант / ничего | любой | финализатор |
| Orb of Chance | White → Unique ИЛИ уничтожает | Normal | гэмблинг |
| Fracturing Orb | фракчерит случайный мод на Rare ≥4 модов | Rare | high-end, атласный дроп |
| Hinekora's Lock | предвидит результат след. валюты | любой | планирование Perfect-крафта |
| Jeweller's Orb (L/G/P) | 3/4/5 сокета саппортов камню | гем | — |
| Artificer's Orb | добавить augment-сокет (из 10 шардов с Salvage) | предмет | руны/соколы |
| Orb of Extraction | уничтожает предмет, возвращает сокетабл | предмет | спасение руны |

## 2. Эссенции — ядро целевого крафта

Механика (✅ https://poe2db.tw/us/Essence, https://maxroll.gg/poe2/resources/how-to-craft-in-path-of-exile-2):
- **Lesser/Normal/Greater: Magic → Rare + гарантированный мод** (аналог Regal без случайности). Тир ограничен ilvl базы.
- **Perfect: Rare → Rare: удалить случайный мод + добавить гарантированный** (аналог управляемого Chaos).
- ⚠️ **0.5: на предмете максимум ОДИН crafted-мод** (эссенции/Alloys делят один слот) — спам эссенций мёртв.

Ключевые гарантированные моды (базовый тир; Greater — выше):

| Эссенция | Мод | Наше применение (Ice Strike Invoker CI) |
|---|---|---|
| Grounding | +% Lightning Res | суффикс-резист |
| Thawing | +% Cold Res | суффикс-резист |
| Insulation | +% Fire Res | суффикс-резист |
| Ruin | +% Chaos Res | самый ценный резист эндгейма |
| the Body | +Life | пул |
| the Mind | +Mana | — |
| Enhancement | +% Armour/Evasion/ES | ES-броня под CI |
| Sorcery | +% Spell Damage | Focus/Wand/Staff |
| Abrasion | +физ. урон оружию / Gain % as Extra Phys (Perfect) | урон |
| Electricity / Ice / Flames | +элем. урон / Gain % as Extra (Perfect) | урон посоха |
| Battle | +Accuracy (Perfect: +2/1H, +3/2H к уровню атак) | точность |
| Haste | +% Attack Speed | DPS-суффикс |
| Seeking | +% Crit | DPS |
| the Infinite | +STR/DEX/INT | попадание в требования |
| Opulence | % Rarity | MF |

Perfect-флагманы: Enhancement → Amulet (20–30)% increased Global defences; Battle → +уровни атакующих скиллов на оружии; Insulation/Thawing/Grounding → слот-специфичные Recoup-моды.
Эссенции-фарм: Essence-монстры на минимапке; Abyss/Breach/Corrupted — спецэссенции (Hysteria: 30% MS на ботинки и т.п.).

## 3. Омены — детерминизм (дроп: Ritual, Tribute)

Полный список ✅ https://poe2db.tw/us/Omen. Крафтовые:

| Назначение | Omen | Эффект |
|---|---|---|
| Exalted: сторона | Sinistral/Dextral Exaltation | slam только префикс/суффикс |
| Exalted: количество | Greater Exaltation | slam добавляет 2 мода |
| Exalted:_family | Catalysing Exaltation | жрёт Quality бижутерии (Breach-катализаторы) → шанс мода нужного тега |
| Chaos: что удалить | Sinistral/Dextral Erasure | Chaos удалит только префикс/суффикс (дорогие!) |
| Chaos: худший мод | Whittling | Chaos удалит мод минимального mod level |
| Regal: сторона | Sinistral/Dextral Coronation | Regal добавит только префикс/суффикс |
| Regal: тот же тип | Homogenising Coronation | Regal добавит мод того же типа |
| Alchemy | Sinistral/Dextral Alchemy | максимум префиксов/суффиксов |
| Perfect-эссенция | Sinistral/Dextral Crystallisation | удалит только нужную сторону |
| Desecration | Sinistral/Dextral Necromancy / Abyssal Echoes / Sovereign/Liege/Blackblooded / Putrefaction | сторона / переролл тройки / конкретный лорд Бездны / 6 Unrevealed |
| Annulment | Greater (−2 мода), Sinistral/Dextral (сторона), Omen of Light (только desecrated-мод) | чистка |
| Vaal | Corruption (гарантия изменения), Sanctification | финализаторы |
| Waystone | Chaotic Rarity/Quantity/Monsters/Effectiveness | реролл модов карт без потери нужного |

## 4. Руны, сокеты, Soul Cores, качество

- **Сокеты (augment)**: 2 — body/2H; 1 — 1H/шлем/перчатки/боты/щит/фокус. Руны тирируются Lesser→Normal→Greater→Perfect, **комбинирование 3:1** на Reforging Bench; **две одинаковые руны = «Bonded»-бонус** (например две Storm → 30% Shock Magnitude). ✅ https://maxroll.gg/poe2/resources/runes-and-soul-cores, https://poe2db.tw/us/Rune
- **Desert/Glacial/Storm/Iron/Body/Mind/Rebirth/Inspiration/Stone/Vision/Tempered** + атрибутные **Robust/Adept/Resolve** + 0.5: **Ward/Charging/Masterwork**.
- **Soul Cores** — Trial of Chaos, сильнее рун, обычно Limited 1; **Jiquani's Soul Cores** (Forbidden Rites): «Weapon: +1 to Level of all Strike/Storm/Herald/… Skill Gems» — актуальный путь к +уровням скиллов. ✅ https://poe2db.tw/us/Forbidden_Rites
- **Качество** (макс 20%): оружие +1% more Phys/1%; броня +1% more def/1%; материалы: Whetstone, Armourer's Scrap, Glassblower's, GCP, **Arcanist's Etcher** (жезлы/посохи), Cartographer's Chisel (waystone), **Катализаторы** (biжутерия, теговые), Vaal Infusers (+10% сверх макс с шансом коррупта), Essence of the Breach (+20% max quality кольцам). ✅ https://poe2db.tw/us/Quality

## 5. Спец-системы 0.4/0.5/0.5.5

- **Desecration (Abyss-крафт)**: Preserved Rib/Jawbone/Collarbone (броня/оружие/бижутерия) → скрытый desecrated-мод → **Well of Souls**: выбор 1 из 3. На 4-модовом — 4-й мод; на 6-модовом — замена случайного. **Не занимает crafted-слот.** Управление — Necromancy-омены. ✅ maxroll, poe2db
- **Alloys (0.5 Runes of Aldur, Expedition)**: добавить гарантированный мод, заменяя случайный — прямой таргет-инструмент. ✅ https://maxroll.gg/poe2/resources/runes-of-aldur-overview
- **Runeforging (Verisium)**: Ward-моды и апгрейд уникал-оружия. **Aldur's Legacy** — руна из уникала, **Uhtred's Sidereus** — Chronomancy-моды в пул ботинок.
- **Flux-валюта**: Blazing/Chilling/Crackling/Void — конвертация резистов на предметах (исправление «не того» резиста). ✅ maxroll
- **Reforging Bench** (Act 3, Ziggurat Encampment): 3 → 1 (базы, эссенции — ~2.5% шанс Greater по краудсорс-данным ❓, руны/соколы), рецикл провальных крафтов; 3 маджика → rare-заготовка. ✅ https://maxroll.gg/poe2/resources/reforging-bench-guide
- **Salvage Bench** (Act 1): разборка → материалы/Artificer's Shards. ✅
- **Forbidden Rites (0.5.5)**: Ritual-энкаунтеры campaign (крафтовая валюта на левелинге), 13 Jiquani's + 4 Atziri's Soul Cores (детерминированная коррупция «Corrupting will always result in change»). ✅ патчноуты: https://www.pathofexile.com/forum/view-thread/4000864

## 6. Методология: «крафт с целью» пошагово

Основа: maxroll «How to Craft in PoE2» v3 (ZiggyD, 18.06.2026) ✅.

**Рецепт «двух якорей» (0.5-мета):**
1. **Цель → 3 префикса + 3 суффикса** на конкретный слот (для CI Invoker body: ES% / ES-плоский / гибрид-def — пре; резисты/спид/эссенс-каст — суф).
2. **Пул на poe2db**: страница класса (`https://poe2db.tw/us/Body_Armours_int#ModifiersCalc`) → для каждого мода: mod level (≈ilvl-требование тира; T1 резистов — ilvl 81–82), Pre/Suf, **Weight** (относит. вероятность). Группы: 1 мод из группы на предмет.
3. **База**: НЕ белый и НЕ рандомный rare, а **Magic с уже нужным модом** (дроп/фильтр) — или целевая база ilvl ≥ mod level главного тира.
4. **Якорь №1 (crafted-слот): Greater/Perfect эссенция** → Magic→Rare с гарантированным модом.
5. **Якорь №2 (desecrated-слот): Desecration-кость + Necromancy-omen** → выбор из 3 на Well of Souls.
6. **Заполнение с расчётом**: p = weight(цель) / Σweight(открытой стороны) → **Expected Exalts = 1/p**. Управление: Greater/Perfect Exalt (floor тиров), Sinistral/Dextral Exaltation (сторона), Greater Exaltation (+2 мода). Для шансов <1/100 — масс-симуляция ≥1 млн прогонов в **Craft of Exile (?game=poe2)** (данные обновлены до 0.5 ✅, 0.5.5 ❓).
7. **Чистка**: лишний мод — Chaos + Whittling/Erasure; провалившийся desecrated — Omen of Light + Annulment → повтор.
8. **Дожим**: Divine (числа в рамках тиров) → (опц.) Fracturing Orb на 4+ модах → Vaal последним.

**Экономика SSF:**
- Не вкладывать Divine/Preset/Pear-валюту в базы ниже ilvl ~81 — «T1 не выпадет на ilvl 78, никакая валюта это не чинит». Илvl базы = уровень зоны дропа.
- Дешёвый цикл: Greater Transmute/Augment на Magic-кольцах/амулетах → Greater Essence якорь → Desecration 4-й мод. До T15+ — этого достаточно.
- Дорогое не жечь: Erasure-омены, Omen of Whittling, Perfect-валюта — хай-энд.
- Провал → Reforging Bench 3→1, не мусорить Perfect-валюту.
- Типовые рецепты: MS-ботинки (Magic 30-35% MS + резист-эссенс + Rib), резист-кольцо (Life-кольцо + Grounding/Thawing/Insulation/Ruin + Catalysing Exaltation для Life-префикса), ES-броня (Magic INT-база + Enhancement).

**Флаг подмены предмета**: essence-only моды — в пуле помечены `is_essence_only` (см. `packages/core/src/repoe.ts:137`) — их через Exalted не получить, только эссенцией.

## 7. Инструменты

- **poe2db.tw** — база модов/весов/тиров (`/us/Modifiers`, `#ModifiersCalc`). Веса — краудсорс (Prohibited Library Discord), не официальные GGG.
- **Craft of Exile** — https://www.craftofexile.com/?game=poe2 : Calculator/Simulator/Emulator/Weightings под PoE2. Данные 0.5.
- **PoE2Planner** — https://maxroll.gg/poe2/planner.

## 8. Не проверено / хвосты

- game8, dotesports, fextralife — 403 у агентов, содержание не проверено.
- CoE обновление до 0.5.5 — проверить changelog.
- Точная доля возврата Salvage Bench — ❓.
- Шанс 2.5% Greater при 3→1 эссенций — краудсорс-замер, ❓.
- Реликты PoE1-интуиции (Item Power, Lineage-моды, «мастера») в PoE2 отсутствуют — не искать.
