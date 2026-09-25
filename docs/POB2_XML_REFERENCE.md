# Справочник: XML-формат билда Path of Building 2 (PoB2)

> Источник: исследование исходников `PathOfBuildingCommunity/PathOfBuilding-PoE2`
> (клон в `_research/path-of-building-poe2`, ветка `dev`, коммит `ce566ea`).
> Все ссылки на файлы/строки — по этому репозиторию. Лицензия исходников — MIT
> (см. `_research/path-of-building-poe2/LICENSE.md`); сюда перенесены **знания о формате**,
> не код. Актуально для PoB2 0.23.x, treeVersion 0_1–0_5.

## 0. Как устроена сериализация

- **Корневой элемент — `<PathOfBuilding2>`, БЕЗ атрибутов** (`src/Modules/Build.lua:2757-2781`, writer `SaveDB`).
  В PoB1 корень — `<PathOfBuilding>`; PoB2-парсер требует **ровно** `PathOfBuilding2`
  (`Build.lua:2711`: `"Error parsing '%s': 'PathOfBuilding2' root element missing"`).
- Порядок секций — алфавитный (реестр сейверов `Build.lua:544-557`, сортировка `pairsSortByKey`):
  `Build, Calcs, Config, Import, Items, Notes, Party, Skills, Tree, TreeView`.
  `legacyLoaders = { Spec = treeTab }` — легаси- одиночная спека PoB1.
- Writer: `runtime/lua/xml.lua:167-178` (`ComposeXML`):
  - первая строка `<?xml version="1.0" encoding="UTF-8"?>`;
  - **атрибуты сортируются по алфавиту** в каждом элементе (xml.lua:129-130);
  - отступ — табуляция; элемент без детей — самозакрывающийся `<Elem/>`;
  - экранирование: `& < > ' "` → `&amp; &lt; &gt; &apos; &quot;` (xml.lua:17-23);
  - парсер понимает `<![CDATA[..]]>`, вырезает комментарии, игнорирует `<?..?>`.
- «Версия формата» живёт не на корне, а: `targetVersion` на `<Build>` и `treeVersion` на каждом `<Spec>`
  (`src/GameVersions.lua`: `treeVersionList = { 0_1, 0_2, 0_3, 0_4, 0_5 }`).
- Импорт/экспорт-код: `base64(Deflate(xml))` c `+`→`-`, `/`→`_`
  (`src/Classes/ImportTab.lua:136/263-272`) — уже реализовано в нашем `core build.decodeShareCode`.

## 1. `<Build>` (writer `Build.lua:1180-1270`, reader `1138-1178`)

Атрибуты (`Build.lua:1181-1189`):

| Атрибут | Значение | Пояснение |
|---|---|---|
| `targetVersion` | `"0_0" \| "0_1"` | `"0_1"` = живая версия игры, `"0_0"` = легаси |
| `viewMode` | TREE/SKILLS/ITEMS/CALCS/CONFIG/NOTES/PARTY/IMPORT | активная вкладка |
| `level` | 1..100 | уровень персонажа |
| `characterLevelAutoMode` | true/false | авто-уровень |
| `mainSocketGroup` | число | индекс главной группы сокетов (1-based) |
| `className` | string | **отображаемое** имя класса (реальный класс — в `<Spec>`) |
| `ascendClassName` | string | отображаемое имя аскенденси |

Дети `<Build>`:
- `<Spectre id="Metadata/Monsters/…"/>` — спектры;
- `<BeastCompanion id="…"/>` — PoE2-специфика;
- `<PlayerStat stat="…" value="…"/>` — **снимок статов с вывода калькулятора**
  (кэш: `Build.lua:1196-1234`; при открытии в PoB пересчитывается) — самый ценный
  источник точных чисел для внешнего анализатора (TotalDPS, Life, EnergyShield, …);
- `<FullDPSSkill stat="…" value="…" skillPart="…" source="…"/>` — раскладка FullDPS по скиллам;
- `<MinionStat stat="…" value="…"/>` — статы миньонов;
- `<Buffs buffList="…" combatList="…" curseList="…"/>` — списки бафов/курсов (CSV имён).

Pantheon-атрибутов в PoB2 `<Build>` нет (механика PoE1).

## 2. `<Tree activeSpec="N">` → `<Spec …>`

`<Tree>`: единственный атрибут `activeSpec` (1-based индекс). Reader `TreeTab.lua:492-519`, writer 527-538.

`<Spec …>` (writer `PassiveSpec.lua:252-370`, reader `117-250`):

| Атрибут | Пояснение |
|---|---|
| `title` | имя набора спеки |
| `treeVersion` | `"0_1".."0_5"` |
| `classId` / `ascendClassId` | **легаси** числовые id (0 = None аскенденси) |
| `classInternalId` / `ascendancyInternalId` | **новый** стабильный формат (пусто = None) |
| `secondaryAscendClassId` | вторая аскенденси — PoE2-новинка |
| `nodes` | выделенные узлы: `nodes="1,2,3,42"` через запятую, без пробелов |
| `masteryEffects` | `{masteryId,effectId}` через запятую |

Дети `<Spec>`:
- `<URL>…</URL>` — закодированная ссылка дерева (легаси, но пишется всегда; `DecodeURL` в PassiveSpec.lua:246-248);
- `<WeaponSet1 nodes="…"/>` / `<WeaponSet2 nodes="…"/>` — PoE2 weapon-set аллокация узлов;
- `<Sockets><Socket nodeId="…" itemId="…"/></Sockets>` — джувелы в узлах дерева;
- `<Overrides><AttributeOverride strNodes= intNodes= dexNodes=/></Overrides>`;
- `<Notes><Note nodeId="…">текст</Note></Notes>` — **PoE2-новинка**: авторские заметки на узлах.

## 3. `<Items …>` (writer `ItemsTab.lua:1327-1417`, reader `1198-1325`)

Атрибуты `<Items>`: `activeItemSet`, `useSecondWeaponSet` (true/false), `showStatDifferences`.

`<Item id="…" variant="…" variantAlt…>`:
- тело — **клир-текст предмета PoB** (`Rarity: …\nИмя\nБаза\nImplicits: N\n…моды…`),
  всегда самосогласован (`item:BuildAndParseRaw()`, ItemsTab.lua:1347);
- `{variant:N}…`-префиксы строк модов — варианты уник-предметов; `variantAlt/variantAlt2..5` — до 6 вариантов;
- `<ModRange id="K" range="V"/>` — roll-диапазоны; `id` — сквозной индекс по порядку:
  `buffModLines → enchantModLines → runeModLines → implicitModLines → explicitModLines`.

`<ItemSet id="…" title="…" useSecondWeaponSet="…">` — наборы экипировки (Loadouts). Дети:
- `<Slot name="…" itemId="…" active="true" itemPbURL="" note="…"/>`.
  **Полный список базовых слотов PoE2** (`ItemsTab.lua:32`):
  ```
  Weapon 1, Weapon 2, Helmet, Body Armour, Gloves, Boots, Amulet,
  Ring 1, Ring 2, Ring 3, Belt, Charm 1, Charm 2, Charm 3, Flask 1, Flask 2,
  Arm 1, Arm 2, Leg 1, Leg 2
  ```
  плюс парные `"Weapon N Swap"` для каждого `Weapon N` (ItemsTab.lua:233-244).
  PoE2-специфика: **Charm 1–3** вместо PoE1-флаконов, всего **Flask 1/2**, слоты **Ring 3, Arm 1/2, Leg 1/2**.
  Атрибут `note` слота — авторская заметка (экспортируется в .build как `additional_text`).
- `<SocketIdURL name="…" nodeId="…"/>` — джувелы в сокетах дерева (пишутся только при аллоцированном узле);
- `<RuneSlot slotName="…" runeName="…"/>` — **PoE2-новинка**: рунные слоты персонажа
  (`characterRuneSlotList`, ItemsTab.lua:35-39): `Helmet Rune #1, Body Armour Rune #1/2, Gloves Rune #1, Boots Rune #1`;
- `<TradeSearchWeights><Stat …/></TradeSearchWeights>` — веса trade-поиска.

Легаси: `<Items><Slot …/></Items>` вне ItemSet читается для старых файлов (ItemsTab.lua:1261-1270).

## 4. `<Skills …>` (writer `SkillsTab.lua:451-526`, reader `288-449`)

Атрибуты `<Skills>`: `activeSkillSet`, `defaultGemLevel` (число | `"characterLevel"` | `"normalMaximum"`),
`defaultGemQuality` (0..23), `showSupportGemTypes` (`"ALL"`), `sortGemsByDPS`, `sortGemsByDPSField`.

`<SkillSet id="…" title="…">` → группы `<Skill …>` (легаси: `<Skill>` прямо в `<Skills>` → SkillSet #1).

Атрибуты `<Skill>`:
| Атрибут | Пояснение |
|---|---|
| `enabled` (легаси `active`) | группа включена |
| `includeInFullDPS` | учитывать в FullDPS |
| `groupCount` | множитель повторений группы |
| `label` | подпись группы |
| `slot` | слот-источник группы |
| `source` | происхождение: `"Tree:…"`, `"Item:…"`, `"Default Attack"`… |
| `set1` / `set2` | доступность в weapon-сете 1/2 (PoE2) |
| `mainActiveSkill` / `mainActiveSkillCalcs` | индекс главного активного скилла группы |
| `removed*` | память об авто-удалённых группах (не терять состояние при реимпорте) |

Атрибуты `<Gem>` (writer 497-526, reader 307-364):
- `nameSpec` — имя как вводит пользователь (пишется всегда);
- `gemId` — игровой id гема; `skillId` — granted effect (fallback); `variantId` — вариант/трансфигурация;
- `level`, `quality`, `enabled` (отсутствие = true), `count`;
- `enableGlobal1/2` — глобальные тумблеры;
- `statSetIndex`(+`Calcs`) — **PoE2-новинка**: у одного гема несколько наборов статов;
- `skillPart`(+`Calcs`), `skillStageCount`(+`…Calcs`), `skillMineCount`(+`…`),
  `skillMinion`(+`…`), `skillMinionItemSet`, `skillMinionSkill`;
- `corrupted` (true/false), `corruptLevel` (PoE2), `note` — авторская заметка к гему (PoE2).
- Дети: `<StatSetIndex grantedEffect= index=/>`, `<MinionSkillIndexLookup>` — мапы статсетов.

Группы-пассивки (даны деревом/восхождением) определяются по `source="Tree:…"` или
`gemId` вида `…/ascendancy…` — эвристика, которую использует наш `buildGemSetups`.

## 5. `<Config>` и `<Calcs>`

### `<Config activeConfigSet="1">` (writer `ConfigTab.lua:1001-1045`, reader `878-941`)

- Дети — `<ConfigSet id="…" title="…">` (наборы конфигураций/Loadouts);
- `<Input name="…" number="…" | string="…" | boolean="…"/>` — **сохраняются только отличия от дефолта**;
  `name` — точный `var` из `src/Modules/ConfigOptions.lua` **без точек**: `enemyIsBoss`, `enemyLevel`, …;
- `<Placeholder name=…/>` — placeholder-значения;
- `<CustomModifierBlock title=… enabled=…>…текст модов…</CustomModifierBlock>` — PoB2-новинка.

Миграции при Load (ConfigTab.lua:891-900): `enemyIsBoss`: `Uber Atziri→Boss`, `Shaper/Sirus→Pinnacle`; из `presetBossSkills` срезается префикс `"Uber "`.

### Ключевые имена входов (ConfigOptions.lua, секция «Enemy»)

`enemyIsBoss` (список: `None|Boss|Pinnacle|Uber`), `enemyLevel`, `conditionEnemyRareOrUnique`,
`presetBossSkills`, `bossSkillMode`, `enemyPhysicalReduction`, `enemyFirePen/ColdPen/LightningPen`,
`enemyBlockChance`, `enemyCritChance`, … полный список — в `src/Modules/ConfigOptions.lua`.

### `<Calcs>` (легаси, `CalcsTab.lua:200-261`)

`<Input name=…/>` в старом формате при пустом `<Config>` импортируются
(`configTab:ImportCalcSettings()`, Build.lua:596-599); в новых файлах здесь только
`<Section id=… subsection=… collapsed=…/>` — состояние свёрнутости секций UI.

## 6. Что из этого уже использует poe2-kit и что теряет

Наш парсер `packages/core/src/build.ts` (`parseBuildXml2`):
- ✅ `<Build level/className/ascendClassName>`, `<PlayerStat>`, активный `<Spec nodes>`,
  пул `<Item id>` + активный `<ItemSet><Slot name/itemId>`, имена предметов из клир-текста
  (`Rarity:` → первая строка не вида `Ключ: значение`);
- ✅ `<Skills>`: группы `<Skill>`/`<Gem>` (уровни, quality, `enabled`, `variantId`), `mainSocketGroup`,
  `label`/`source`, `<FullDPSSkill>`, `<Buffs>`;
- ✅ `<Config>`: `<ConfigSet><Input>` (режим босса, уровень врага и пр.), активный ConfigSet, `<Notes>`;
- ⚠️ **не читает**: `<WeaponSet1/2>` узлы, jewel-сокеты `<Sockets>`/`<SocketIdURL>`, `<RuneSlot>`,
  `<MinionStat>`, `<StatSetIndex>`-мапы гемов, `<Placeholder>`, `<CustomModifierBlock>`;
- ⚠️ regex-парсер: XML writer PoB2 сортирует атрибуты по алфавиту и кладёт текст
  предмета снаружи элемента (между `<Item …>` и первым вложенным тегом) — наши
  регулярки на это уже рассчитаны, но порядок атрибутов хардкодить нельзя.

## 6a. Прочие разделы

- `<Import>` (`ImportTab.lua:136/263-272`): `<LastBuild>…</LastBuild>` — исходный share-code;
  поддержано (`core.build.decodeShareCode`).
- `<Party>` (`PartyTab.lua`): только состояние UI — для расчётов бесполезно.
- `<TimelessData>`: легаси PoE1 (timeless jewels), в PoE2 пуст/отсутствует.
- Раздела `Plan` (PoE1 gem/quest-plan) в PoE2 **нет**.
- Префиксы строк модов: `{variant:N}` (варианты), `{tags:…}`, `{range:…}` (roll) — валидны в клир-тексте `<Item>`.
- `<Calcs>` — в новых файлах только состояние UI-секций; боевой конфиг — в `<Config>`.
## 7. PoB1 vs PoB2 — сводка различий формата

| Аспект | PoB1 | PoB2 |
|---|---|---|
| Корень | `<PathOfBuilding>` (атрибуты `<xml>`-версий нет) | `<PathOfBuilding2>`, без атрибутов |
| Слоты | Flask 1–5, нет чармов | Flask 1–2, Charm 1–3, Ring 3, Arm 1/2, Leg 1/2, Weapon N Swap |
| Дерево | `<Spec>` легаси на верхнем уровне | `<Tree><Spec …>` (+`WeaponSet1/2`, узловые Notes) |
| Гемы | нет statSetIndex | `statSetIndex`, `variantId`, `corruptLevel` |
| Конфиг | `<Calcs><Input/>` | `<Config><ConfigSet>` (+`CustomModifierBlock`) |
| Предметы | ModRange-порядок PoB1 | + `runeModLines` в порядке ModRange; рунные слоты персонажа |
| Атрибуты дерева | `classId/ascendClassId` | + `classInternalId/ascendancyInternalId`, `secondaryAscendClassId` |

## 8. Ссылки

- Writer/reader-функции: `src/Modules/Build.lua` (544-557, 1138-1270, 2702-2781);
- XML-механика: `runtime/lua/xml.lua`;
- Эталонные тесты формата: `spec/System/TestImportReimport_spec.lua`, `TestBuildExportPoE2_spec.lua`,
  `TestTreeTab_spec.lua`, `TestSkills_spec.lua`, `TestLoadouts_spec.lua`;
- Экспорт в официальный .build (Build Planner): `src/Modules/BuildExportPoE2.lua`
  (его формат JSON уже поддержан нашим `parseBuildJson`).
