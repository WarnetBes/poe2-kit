# Исследование источников данных PoE2 для poe2-kit

> Дата: 2026-09-25 · Куб: КУБ-2/KIT
> Цель: найти полезные игровые данные/библиотеки/API Path of Exile 2 для улучшения poe2-kit.
> Статус: исследование готово. Внедрены приоритеты №1 (уники) и №4 (waypoint-карта зон).

---

## Резюме (TL;DR)

poe2-kit силён в живых ценах (poe.ninja/poe2scout/trade2) и уже качает `base_items.json` +
`mods.json` с **repoe-fork.github.io/poe2** (свежий снимок game build **4.5.5.2**, т.е. патч 0.5.5).
Пробелы и дешёвые выигрыши:

1. **Каталог уников** — kit сейчас не имеет локального списка уникальных предметов.
   Цена уников идёт через poe2scout по имени/категории «вслепую».
   Есть ровно 2 готовых источника: (а) `Uniques/*.lua` в PoB2-репо (уже склонирован в `_research`,
   структурировано: имя → база → имплиситы → моды → League), (б) `uniques.json` на repoe-fork
   (только имена + art, но это валидация «точно уника»). Извлечение каталога — аналог уже сделанного
   `_extract_tree_numeric_ids.mjs`.
2. **`mods_by_base.json`** на repoe-fork — явный маппинг «мод → база», вместо текущей эвристики по
   тегам spawn_weights в `matchSingleModTier`. Прямо улучшает прайс рарных предметов по тирам.
3. **Свежесть встроенных данных**: датасет в `data/game` — патч **0.5** (июнь). Текущая игра —
   **0.5.5 Forbidden Rites** (сентябрь). Live repoe-fork закрывает дыру только для base/mods.
   `skill_gems`, `ascendancies`, `stat_descriptions` в бандле — старые на 0.5. Нужен re-extract.
4. **Вспомогательные датасеты repoe-fork** под kit-фичи: `characters.json` (базовые статы классов →
   точнее `estimateBuild`), `world_areas.json` (уровни зон → прокачка), `skills.json`+`skill_gems.json`
   (живее бандла), `gem_tags.json`/`tags.json`/`item_classes.json` (словарь тегов для тиров модов).

---

## Что уже использует kit (проверено 2026-09-25)

- **poe.ninja** `/poe2/api/economy/exchange/current/overview` — цены валют; лимит 10 req/5 мин.
  Честно: истории цен по дням нет — только sparkline изменений (реализовано в `fetchCurrencyHistory`).
- **poe2scout** `api.poe2scout.com/poe2` — актуальные лиги + цены валют и уников в любой лиге.
- **trade2** `pathofexile.com/api/trade2` — живой поиск лотов (stack-rate ~8 req/min, риск бана IP).
  В `tradeQuery.ts` уже учтено: нет `weapon_filters`, лига в URL отображаемым именем.
- **repoe-fork.github.io/poe2** — `base_items.json` + `mods.json` (TTL 7 дней). Всё остальное — нет.
- **poe2wiki.net**, локальный `Client.txt`, локальный бандл `data/game/{ascendancies,passive_tree,skill_gems,stat_descriptions,support_gems,base_items,stats}` (патч 0.5).

---

## Новые источники данных (рекомендации)

### A. repoe-fork.github.io/poe2  — game build **4.5.5.2** (патч 0.5.5, актуально)

Хост уже «свой» (TTL/лимиты прописаны). Доступны датасеты, которые kit пока не использует:

| Файл | Что даёт | Куда в kit |
|---|---|---|
| `uniques.json` | Имена + art всех уников | Валидация «точно уника» и канонизация имени перед poe2scout; дешёво, без roundtrip |
| `mods_by_base.json` | Явный список «какие моды могут выпасть на какую базу» | `matchSingleModTier`/`matchAllModTiers` — замена эвристики по тегам, точнее прайс раров |
| `characters.json` | Базовые статы классов (life/ES/атрибуты по уровню) | `estimateBuild` — точнее база жизни/ES до геара |
| `world_areas.json` | Уровни/типы зон+ | Кросс-проверка/дозаполнение `LEVELING_ZONES` в `leveling.ts` |
| `skills.json`, `skill_gems.json`, `gem_tags.json` | Живой каталог скил-гемов (0.5.5) | Свежее бандла `skill_gems/`; словарь тегов гемов |
| `stats.json`, `stat_translations/` | Стат-id → текст | Дополняет бандл `stat_descriptions`; для объяснения модов |
| `tags.json`, `item_classes.json` | Словарь тегов предметов/классов | Тиры модов, категоризация |
| `default_monster_stats.json` | Базовые статы монстров по уровню | Контекст DPS-оценки (малоценно) |

Снимок на дату проверки — репозиторий `repoe-fork/repoe` (10k+ коммитов, обновлён 2026-08-27, 90★),
хостится на GitHub Pages `https://repoe-fork.github.io/`.

### B. PoB2 community — `_research/path-of-building-poe2/src/Data/Uniques/*.lua`

Уже склонирован в RESEARCH. Каталог уников по базовым типам (bow, ring, staff, weapon.lua и т.д.).
Формат записи:
```
[[ <Name>
<Base type>
[League: X]
[Requires Level N]
Implicits: N
<имплиситы>
<моды> ]]
```
- **Это лучший источник локального каталога уников**: имя → база → имплиситы → моды → League.
- Прямое улучшение `priceUnique` / `buildCodeToGear`: офлайн-резолв базы по имени,
  валидация что предмет действительно уника, определение категории без poe2scout.
- Механика та же, что уже применена к `numeric_ids.json` (`_extract_tree_numeric_ids.mjs`).
- Ограничения: `soulcore.lua` пуст (soul cores в PoB2 пока не распознаны); часть новых 0.5.5
  уников может отсутствовать — живой `uniques.json` repoe-fork покроет свежие имена.

### C. poe2db.tw — патч 0.5.5 «Forbidden Rites»

Богатый каталог (итемы, уники, моды, гемы, пассивное дерево, эндгейм, актуальные лиги),
но это HTML, API нет. Кросс-проверка имён/баз/лиг руками. Источник: `/us/`, `/ru/`.
Не включать в автосборку (скрейпить — против духа «только бесплатные API»).

---

## Пробел свежести бандла

`data/game/version.json` декларирует патч 0.5 «Return of the Ancients» (извлечено 2026-06-01).
Текущая игра — 0.5.5 «Forbidden Rites» (лига, которую отдаёт `fetchLeagues`). Для `base_items`/`mods`
дыру закрывает live repoe-fork, но `skill_gems/`, `ascendancies/`, `stat_descriptions/` в бандле
остаются 0.5. Рекомендация: при следующем патче пере-экстракция бандла (та же машина,
`extracted_by: HivemindMinion`) против 0.5.5.

---

## Приоритет внедрения (предложение)

1. **P-высокий**: извлечь `uniques_catalog.json` из `Uniques/*.lua` (PoB2) + фолбэк на
   live `uniques.json` repoe-fork → улучшить `priceUnique`/прайс билда для уников.
2. **P-средний**: `mods_by_base.json` repoe-fork → заменить эвристику тегов в тирах модов.
3. **P-средний**: `characters.json` → точнее `estimateBuild`. ⚠️ **Проверено (2026-09-25) и НЕ реализовано:** файл даёт только стартовые статы уровня 1 (life 16/mana 30/str-dex-int по архетипу, 6 классов PoE2 `...Fourb`), **без per-level-прогрессии жизни**, а именно она нужна для «точнее базы жизни/ES». Быстрой per-level-жизни нет ни в бандле, ни в repoe → форсировать «улучшение» = имитация. Осознанно отложено.
4. **P-низкий**: `world_areas.json` → дозаполнить `LEVELING_ZONES`. ✅ **Внедрено**:
   `waypoints.ts` (`CAMPAIGN_WAYPOINTS`) — флаг вайпоинта для каждой зоны кампании,
   показан ⚑ в web-чек-листе (#16) и MCP `poe2_leveling_plan`. Уровни зон НЕ перезаписаны
   (raw `area_level` из world_areas систематически ниже наших рекомендаций Kami-Guru и
   немонотонен в Акте 4 — перезапись деградировала бы гид).
5. **P-плановый**: re-extract бандла на 0.5.5. **Частично закрыто (2026-09-26, `0a34702`):** baseline `base_items.json` обновлён из живого снапшота repoe-fork (4.5.5.2/0.5.5, от 11.09): 5382 → 5496 (+114, 0 удалено, item_class стабилен), экстрактор `_extract_base_items.mjs`; waypoints перепроверены 65/65 (флаги не изменились). Live-smoke ALL OK. Остаток (skill_gems, stat_descriptions, ascendancies, stats, passive_tree — всё ещё патч 0.5) требует лицензионной установки — ждёт следующего re-extract'а от hivemind. На 25.09 все живые источники (repoe-fork 11.09, PoB2 tip 10.09, hivemind upstream 11.08) стоят на 0.5.5 — новее данных публично нет; актуальная лига «Runes of Aldur» обслуживается живыми API.

---

*Этот файл — носитель КУБ-2/KIT. Основной журнал и сквозные знания — `cubes/cube5_log.md`.*