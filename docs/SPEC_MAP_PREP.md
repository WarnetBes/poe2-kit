# SPEC: Советчик подготовки к картам (Map Prep Assistant)

> Модуль `core.mapPrep` + MCP-тул `poe2_map_prep` + web-вкладка «🗺 Карты» (+
> подключение существующей overlay-панели «Карты»). Вход — имя карты waystone /
> waystone-моды (строкой из игры) / PoB-билд владельца; выход — персональный
> вердикт: какие резисты/EHP добить, что взять с собой, перероллить ли камень.
> Статус: **этап 0 (SPEC), этапы 1–6 по плану №234 (журнал, 09.10.2026).**
> УСП против конкурентов: Sidekick (regex-предупреждения, без персонального
> совета) и poe2ref (онлайн, без персонализации) → наш вердикт = офлайн +
> «под ТВОЙ билд».

---

## 1. Верифицированные факты-фундамент (не выдумывать поверх)

| # | Факт | Источник (✅ проверено fetch'ем) |
|---|---|---|
| F1 | Пулы трэш-монстров карт **детерминированы per-map**: PoB2 `src/Data/WorldAreas.lua` (7397 строк) — `monsterVarieties`, `bossVarieties`, биом-теги `has_*_biome_monsters`, имя/level. | `_research/map_prep_data_sources_2026.md` (№233), fetch github raw |
| F2 | RePoE2 world_areas.json даёт `packs: null` — **дефект экспорта, не игры** (не использовать «нет данных» как аргумент «недетерминировано»). | там же; уточнение №232→№233 |
| F3 | Резисты монстров: normal 0% / map boss +30% / pinnacle +50% / uber +50% +70% less dmg. **Уже в нашем** `core.enemy` (`enemyPlaceholders`, порт №189 из PoB2 ConfigOptions.lua). Скейла с тирами НЕТ (позитивное отсутствие в 4 источниках). | №232-отчёт, `_research/poe2_map_prep_assistant_web_research.md` |
| F4 | Резисты монстров приходят ЯВНО: суффикс waystone «+(20–24/25–29/30–34)% Monster Elemental Resistances»; у редких — Archnemesis-суффиксы «Fire/Cold/Lightning/Chaos Resistant +50%». | poe2db.tw/us/Waystones, poe2db.tw/us/Monster |
| F5 | Пул waystone-модов = **35 групп (14 префиксов + 21 суффикс) × 4 ступени** (map_key_low/medium/high/highest). Опасные для подготовки: of Exposure (−3–4% max res игрока — САМЫЙ опасный), of Smothering (−20–40% recovery Life/ES), of Drought (фляги −20–24% зарядов), элементные of Flames/Sleet/Shocking/Venomous/Profane, of Siphoning (mana-siphon ground), of Grasping. | poe2db.tw/us/Waystones, poe2ref.com/atlas/waystones, PoB2 spec.lua:62101 |
| F6 | Кап монстр-резистов 75%. Waystone tier задаёт Area Level: T1=65 … T16=80 (и только его). | poe2db.tw/us/Monster, poe2db.tw/us/Waystones |
| F7 | «Элементной темы биома» НЕ существует (атлас-пассивы биомов = механики, не элементы). Элементы носят конкретные разновидности монстров (KelpDregCrossbowIceShot и т.п.), а не биом. Ассистент НЕ говорит «болото = хаос». | №232-отчёт (5 источников) |
| F8 | ⚠️ `packages/core/src/endgame.ts:12-13` — численные пороги Waystone-тиров НЕ верифицированы: любые советы по тирам помечать `verified: false`. Публичная таблица `WAYSTONE_TIERS` (=area level'ы F6) — верифицирована и пригодна. | локальный код endgame.ts:248 |
| F9 | Данные карт: боссы карты детерминированы; статы боссов — PoB2 `Bosses.lua`/`BossSkills.lua` + poe2db (таблица на странице карты, CC BY-NC-SA — для датасета в офлайн-продукт НЕ копировать indiscriminately, помечать источник; PoB2 = MIT, предпочтителен). | №233-отчёт |
| F10 | RU-тексты модов — poe2db /ru-страницы + RePoE2 `stat_translations/` (map_stat_descriptions, endgame_map_stat_descriptions, tablet_stat_descriptions). | №233-отчёт |

## 2. Верифицированная дисциплина (обязательна, как в bosses.ts)

- Каждый элемент данных, не подтверждённый живым источником, получает
  `verified: false` (или `unverifiedNote`), применяется в UI/MCP честной пометкой.
- Инференс элемента трэша по ИМЕНИ монстра (KelpDreg...IceShot) =
  **unverified-признак**: в вердиктах Фазы 1 используется только как
  информационная строка, НЕ как основание для «качай резист X».
- Никаких выдуманных порогов: эталонные пороги резистов взяты только из
  maxroll-верифицированных цифр (chaos 40–50% к T6+, ~75% к T11+) с пометкой
  `source: maxroll-atlas-tips` + verified-флагом на пересмотр по датамайну.

## 3. Данные (Этап 1)

### 3.1. Новые датасеты (`packages/core/data/game/maps/`)

`maps.json` — из PoB2 `WorldAreas.lua` (экстрактор `scripts/fetch_map_prep_data.mjs`):
```ts
interface MapEntry {
  id: string;            // 'MapRustbowl' (WorldArea id — ключ)
  name_ru?: string;       // из poe2db /ru, absence = EN-only
  name_en: string;        // WorldAreas.name
  area_level: number;     // T1..T16 → 65..80 (waystoneAreaLevel endgame.ts:254)
  biomes: string[];       // 生物-теги has_*_biome_monsters → короткие имена
  monster_varieties: string[];  // пул трэша (F1)
  boss_varieties: string[];     // боссы карты
  verified: true;         // источник PoB2, MIT
}
interface WaystoneModGroup {
  id: string;             // ключ группы (e.g. 'map_monster_ele_res')
  kind: 'prefix' | 'suffix';
  name_en: string;        // of Exposure ...
  name_ru?: string;
  tiers: Array<{ stat_text_en: string; stat_text_ru?: string; values?: unknown[] }>; // 4 ступени
  threat?: MapThreatDescriptor;   // см. §4.1 — чем опасен
  verified: boolean;
}
```
- Элемент-опасные моды описываются отдельной таблицей угроз `threat-catalog`
  (ядро логики, не сырьё): ключ → эффект (player max res −X / recovery −X /
  flask charges −X / monster +X res / элемент-профиль угрозы).
- RU-полная выкладка — этап 2-й очереди; EN — фаза 1 (игрок вставляет мод из
  игры — матчим по EN-тексту с нормализацией).

### 3.2. Свежесть
- `poe2_data_freshness` и `refresh-data.mjs` получают запись `maps` (версия
  патча из PoB2-репо фиксируется в `_meta` датасета — RGB ник никогда не
  выдумывается: дата fetch'а + имя источника).

## 4. Ядро `core.mapPrep` (Этап 2)

### 4.1. Модель угрозы
```ts
interface MapThreat {
  area_level: number;
  boss: { name?: string; res: { ele: number; chaos: number }; kind: BossMode };
  monsterEleBonus?: number;    // от суффикса +X% (F4)
  monsterChaosRes?: number;
  playerDebuffs: Array<{ fromMod: string; effect: 'max_res' | 'recovery' | 'flask' | 'regen_block' | 'slow' | 'marked' | 'unknown'; value?: number }>;
  elements?: Partial<Record<'fire'|'cold'|'lightning'|'chaos'|'physical', number>>; // веса 0..100, ONLY если подтверждено скиллами/модами; иначе отсутствует
  unverifiedElements?: string[];  // имена-monstrов с инференсом по имени
}
function mapThreat(mapId | mapName, mods: string[], tier): MapThreat
```

### 4.2. Вердикт (паттерн `pinnacleChecklist` optimize.ts:255)
```ts
interface MapPrepCheck {
  check: string;       // 'chaos_res_for_area_level_70'
  passed: boolean;
  severity: number;     // 0..10
  advice_ru: string;    // конкретное: «Exposure −4% max res ⇒ добей fire до 71%»
  unverified?: boolean;
}
function mapPrepChecklist(stats: DefensiveStats, threat: MapThreat): MapPrepCheck[]
```
- Мерж с `core.ehp.identifyDefenseGaps` (пробелы против угрозы), кастомные
  чеки по playerDebuffs (Exposure → требуемый резист = cap − X; Smothering →
  проверка regen/leech; Drought → предупреждение о флягах).
- Пороги chaos-резиста по tier'ам (maxroll, F-эталоны) → `verified: false`
  до датамайн-подтверждения чисел (сам китайский порог помечен).

### 4.3. Экспорт
- `mapPrepAdvice(stats, threat): string` — markdown (паттерн
  `keybindsToMarkdown`), секции: «⚠ Моды, требующие подготовки» /
  «Пробелы обороны» / «Что взять» / «unverified-пункты».

## 5. MCP-тул `poe2_map_prep` (Этап 3)

- `apps/mcp/src/tools/mapPrep.ts`, registerTool-паттерн ключей (№222),
  inputSchema: `{ map?: string; mods?: string[]; tier?: number;
  pob?: string (raw-код) | buildStats?: DefensiveStats }`.
- Выход: вердикт-чеклист + advice-markdown. Smoke-тест в `tests/smoke/`
  (`smoke_n234_map_prep.mjs`).

## 6. Web-вкладка «🗺 Карты» + overlay (Этап 4)

- web: паттерн «Атлас»/«Раскладка» (main.ts data-tab +
  `apps/web/src/mapPrep.ts`): селектор карты ( поиск по имени), тир, чекбоксы/
  textarea модов (вставка из игры), вердикт по последнему импортированному
  билду (уже в состоянии web), биомы как фильтр.
- Большие read-only таблицы — через `installBrowserDataset`
  лениво (паттерн skill_gems, №222).
- overlay: существующая панель «Карты» (main.ts:3336) получает кнопку
  «Вердикт» — только рендер, вся логика в core (ЗАПРЕТ третьего дубля логики).

## 7. Гейты (каждый этап)

| Этап | Гейт |
|---|---|
| 1 | экстрактор идемпотентен; JSON валиден (UTF-8 no BOM, префлайт make-portable); ≥140 карт; sanity: MapRustbowl/MapBackwash пулы совпадают с отчётом №233; `poe2_data_freshness` видит новый датасет |
| 2 | core tsc 0; vitest (все + новые); юнит-кейсы: Exposure-математика, SUF-элемент-мод → monsterEleBonus, пустые моды, unknown-мод → честный unknown |
| 3 | MCP smoke exit 0 (62 тула; 63 после №239 Phase-2), тул в списке `__poe2Registered` |
| 4 | web tsc+build; CDP-живой прогон вкладки (консоль 0); overlay tsc |
| 5 | vitest полный, smoke run-all, CDP_all |
| 6 | CHANGELOG, версии ×5 package.json, origin→github main+tag, gh release + portable |

## 8. Чего НЕТ в фазе 1 (осознанные границы)

- Живого датамайна .dat (тап `@poe2-toolkit/ggpk`) — 2-я очередь.
- RU-тексты модов полным набором — 2-я очередь (EN-матчинг + выборка RU).
- Трэш-элементы как ОСНОВАНИЕ вердиктов — только информационно, unverified.
- Панели для Unique maps/бесконечных механик (`bosses.ts` покрывает пиннаклы).
