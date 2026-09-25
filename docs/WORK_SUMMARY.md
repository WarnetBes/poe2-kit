# Сводка работ — poe2-kit

> Обновлено: 25.09.2026
> Ветка: `main` · HEAD: `018b216` (синхронизирован с origin)

---

## fix(trade2) — `8c655dc`

Исправления построителя запросов к официальному trade2 API (`packages/core/src/tradeQuery.ts`) по итогам живых POST-запросов:

- **Группы фильтров:** в trade2 PoE2 группы `weapon_filters` не существует (API отвечает 400 «Unknown filter group»). Поля dps/pdps/edps кладутся в `type_filters`.
- **Лига в URL:** слаг даёт 400 — используется отображаемое имя (например `Forbidden Rites`, в URL — `Forbidden%20Rites`). Резолв через `resolveLeague`.
- **Stat-id:** таблица `MOD_TEXT_TO_STAT` расширена проверенными explicit stat-id; выбор локальных weapon-id против глобальных по флагу `weapon` (для dps-фильтра: % phys, Attack Speed, flat phys).

| Мод | stat-id |
|-----|---------|
| Increased Physical % | `stat_1509134228` |
| Flat Physical (local) | `stat_1940865751` |
| Flat Physical to Attacks | `stat_3032590688` |
| Attack Speed (local) | `stat_210067635` |
| Attack Speed (global) | `stat_681332047` |
| Critical Hit Chance % | `stat_587431675` |
| Critical Damage Bonus % | `stat_3556824919` |
| Increased Energy Shield % | `stat_2482852589` |
| Increased Cold Damage % | `stat_3291658075` |
| Skill Speed % | `stat_970213192` |
| Stun Threshold from ES | `stat_416040624` |

Ограничения trade2: stack-rate 8 req/min, при 429 бан IP. Вызов `poe2_trade_search` без `execute` не отправляет POST — безопасен для проверки построения запроса.

## feat(leveling) — `018b216`

Универсальные гайды прокачки для всех 8 базовых классов PoE2 (ранее был только Ice Strike Monk):

- `CLASS_LEVELING_GUIDES` в `packages/core/src/leveling.ts` — Monk, Warrior, Sorceress, Ranger, Mercenary, Witch, Druid, Huntress; по 4 диапазона уровней (камни / экипировка / механика / асценданси).
- `resolveLevelingClass()` — резолвит базовый класс ИЛИ асценданси (Invoker→Monk, Lich→Witch, Titan→Warrior, Deadeye→Ranger, Witchhunter→Mercenary, Amazon→Huntress).
- `validateGuideGems()` — каждый камень в гайдах сверяется с датасетом `skill_gems`; все имена реальны.
- Асценданси сверены с данными патча 0.5 (Druid — Oracle/Shaman; Witch — Abyssal Lich/Blood Mage/Infernalist/Lich; Sorceress — Stormweaver/Chronomancer/Disciple of Varashta; Ranger — Deadeye/Pathfinder).
- `classLevelingAdvice` в AI выбирает гайд по className/ascendancy из контекста.
- MCP: `poe2_leveling_monk` заменён на **`poe2_leveling_class`** (параметры `class`/`level`/`list`); `poe2_leveling_plan` получил параметр `class`. Итого в MCP 35 тулов.
- Старые `getMonkLeveling*` сохранены как обёртки для совместимости.
- Smoke-тесты расширены (8 классов, резолв, валидация гемов) — ALL OK; MCP --smoke exit 0.

## Анализ билда Invoker (Ice Strike, ур. 95)

- Метрики билда: DPS 449.5к, крит 75.5% / ×5.29, EHP 38.7к, CI, 123 узла.
- Сравнение с топ-инвокером лиги (#6): 3.2M DPS.
- Направления разгона: посох в Weapon-слот, крит-мульти ×5.29→×10, AS 3.10→6.18, уровни Herald'ов, рефанд ~8–10 защитных нотаблов.
- Живые trade-поиски (Forbidden Rites): Quarterstaff — 1613 лотов; Sapphire-джевел (ES%) — 1050 лотов.

## Инфраструктура

- `packages/core/dist` в .gitignore — пересобирается локально через `npm run build -w @poe2-kit/core`; MCP-сервер подхватывает новый dist после пересоздания процесса.
- Локальный MCP-перезапуск: пересоздать процесс `node dist/index.js`, затем `POST /api/experimental/mcp/poe2-kit/connect` через opencode-cli.
- Push из PowerShell может давать exit code 1 из-за stderr-шума git — успех проверять `git status -sb`.
