# Справочник: формулы расчётов PoE2 по исходникам Path of Building 2

> Источник: исследование исходников `PathOfBuildingCommunity/PathOfBuilding-PoE2`
> (клон в `_research/path-of-building-poe2`, ветка `dev`, коммит `ce566ea`).
> Цитаты Lua — точные, с номерами строк. Мнемоники: `m_min/m_max` = `math.min/max`,
> `modDB:Sum("BASE"/"INC")` — сумма модов, `modDB:More(...)` — произведение more-модов.
> Этим формулам следуют калькуляторы ядра (`ehp.ts`, `estimate.ts`, `spirit.ts`, `stun.ts`).

## 1. Защита (src/Modules/CalcDefence.lua + src/Modules/Data.lua)

### 1.1 Physical Damage Reduction от брони

```lua
-- CalcDefence.lua:57-70
62      return -((armour / (armour + raw * data.misc.ArmourRatio) * 100))  -- отрицательная броня (Armour Break)
64  return (armour / (armour + raw * data.misc.ArmourRatio) * 100)
-- Data.lua:261
261  ArmourRatio = 10,
```

**DR% = Arm / (Arm + K × HitSize) × 100, где K = 10 в PoE2** (в PoE1 — 5).
Броня в PoE2 вдвое «слабее» на тот же размер удара — ключевое отличие.

- Cap DR игрока: `maximum_physical_damage_reduction_% = 90` (`src/Data/Misc.lua:150`).
- Cap DR монстров (для нашего урона по ним): 75 (`Misc.lua:251`).
- «Armour applies to element damage taken»: effArmour собирается долей от
  Armour/Evasion/ES, затем та же формула (`CalcDefence.lua:395-405`).

Цепочка митигации попадания (`CalcDefence.lua:427-436`):

```
taken = Raw × (1 − Res/100) × (1 − min(MaxDR, max(armourDR + flatDR − Overwhelm, 0))/100) × taken-мод
```

### 1.2 Уклонение — ДВЕ разные формулы

**Защищающийся (монстр бьёт игрока — нужно для EHP)**, `CalcDefence.lua:41-47`:

```lua
45  local rawChance = ( 1 - ( 0.95 * evasion ) / ( evasion + 4 * accuracy ) ) * 100
46  return m_max(m_min(round(rawChance), 100), 5)
```

**Hit% = 100 − 95·Ev / (Ev + 4·Acc)**, кламп [5..100].
Кап шанса уклониться: `DefaultMaxEvadeChancePercent = 95` (`Misc.lua:111`).
В PoE2 есть уклонение от спеллов (`SpellEvasion` и производные, `CalcDefence.lua:1456-1459`).

**Атакующий (игрок бьёт монстра)**, `CalcDefence.lua:33-39`:

```lua
37  local rawChance = ( accuracy * 1.25 ) / ( accuracy + evasion * 0.3 ) * 100
```

**Hit% = 125·Acc / (Acc + 0.3·Ev)**, кламп [5..100]. Не путать с оборонной!

⚠️ Реализовано в ядре: `estimate.ts:hitChance` и `ehp.ts:evasionChance` — оборонная;
`ehp.ts:attackerHitChance` — атакующая.

### 1.3 Deflect (механика PoE2)

```lua
-- CalcDefence.lua:49-55
53  local chanceToNotDeflect = accuracy / ( accuracy + deflection * 0.12 ) * 150 - 50
-- Cap: DeflectionChanceCap = 95 (Data.lua:251), эффект: 40% урона отражается (Data.lua:256)
```

### 1.4 Блок

```lua
-- CalcDefence.lua:1003-1035
1007 output.BlockChanceMax = m_min(... , data.misc.BlockChanceCap)   -- BlockChanceCap = 90 (Data.lua:253)
1034 local totalBlockChance = round((baseBlockChance + Sum("BASE", "BlockChance")) * (1 + inc/100) * more)
1035 output.BlockChance = m_min(totalBlockChance, output.BlockChanceMax)
```

Базовый cap **50%** (`object_inherent_base_maximum_block_%_from_ot = 50`, `Misc.lua:151`),
поднимается модами «+X% to maximum Block Chance», абсолютный предел **90%**.

### 1.5 Резисты

```lua
-- CalcDefence.lua:927-987
floor = data.misc.ResistFloor          -- −200 (Data.lua:248)
max   = m_min(data.misc.MaxResistCap, base + моды)  -- MaxResistCap = 90 (Data.lua:249)
final = m_max(m_min(total, max), floor)
```

Хаос считается в том же списке (`resistTypeList = { Fire, Cold, Lightning, Chaos }`).

### 1.6 Энергощит

- Порядок поглощения пулов (`reducePoolsByDamage`, `CalcDefence.lua:473-699`):
  союзные щиты → Aegis → Guard → **ES (×2 для Chaos)** → MoM (мана) → Life → Ward → overkill.
- **Chaos-урон снимает ES × 2** — PoE2-специфика
  (`CalcDefence.lua:592`: `esDamageTypeMultiplier = damageType == "Chaos" and not Flag("ChaosNotDoubleESDamage") and 2 or 1`);
  bypass ES по типам урона — 0..100% (`CalcDefence.lua:2917-2925`).
- Recharge (`CalcDefence.lua:1804-1824`): **12.5%/с** базы (`750%/мин`),
  задержка **4 с**, `faster start` сокращает: delay = 4 / (1 + INC/100).

### 1.7 EHP в PoB2

PoB2 считает EHP **итеративной симуляцией ударов** (`numberOfHitsToDie`,
`TotalEHP = TotalNumberOfHits × totalEnemyDamageIn`, `CalcDefence.lua:3402-3421`).
MaximumHitTaken решается **аналитически через квадратное уравнение** цепочки Arm/(Arm+K·RAW)
(`CalcDefence.lua:3709-3738`) — наш `armorNeededForDr` решает обратную задачу той же формулы.

### 1.8 Stun (PoE2: Stun + Poise)

```lua
-- CalcDefence.lua:2757: StunThreshold = Base(=Life) × INC × MORE
-- CalcDefence.lua:2828:
baseStunChance = m_min(StunBaseMult × enemyDamage / StunThreshold, 100)   -- StunBaseMult = 200 (Data.lua:284)
-- шанс учитывается только если baseStunChance > MinStunChanceNeeded = 20
```

У боссов повышенный **PoiseThreshold** (`ConfigOptions.lua:2024-2025,2066-2067,2107-2108`) —
MORE-моды перемножаются (×(1+pct/100)):
- любой босс: `PoiseThreshold MORE 500` (MonsterUnique2) → **×6**;
- Standard Boss дополнительно: `MORE 213` («Map Boss») → итого **×18.78**;
- Pinnacle/Uber дополнительно: `MORE 838` («Xesht») → итого **×56.28**
  (у Uber ещё `DamageTaken MORE −70` у врага).
Длительность стана округляется к тику сервера 33 мс (`CalcDefence.lua:2799`); база 500 мс
(`stun_base_duration_override_ms`). Heavy Stun длится 3000 мс у игрока (от монстра — гаснет
по-иному) и 2000 мс у монстра (`Misc.lua:216,268`).

## 2. Урон (src/Modules/CalcOffence.lua)

### 2.1 Точность

`hitChance` — см. §1.2 (атакующая формула). Dex даёт 6 точности (`AccuracyPerDexBase = 6`,
`Data.lua:242`). Дистанционный фоллофф: с 20 (`AccuracyFalloffStart`) до 90 (`…End`) единиц
дистанции штраф растёт линейно (`CalcOffence.lua:2718`).

### 2.2 Крит

```lua
-- CalcOffence.lua:3859-3901
CritChance  = (base_crit + Sum("BASE","CritChance")) × (1 + INC/100) × more,  кап = CritChanceCap
CritChance  = CritChance × AccuracyHitChance / 100        -- крит требует ВТОРУЮ проверку точности:
                                                        -- провал = крит «деградирует» в обычный удар
                                                        -- (комментарий PoB, CalcOffence.lua:3894-3898)
CritChance  = (1 − (1 − CritChance/100)²) × 100           -- при lucky
-- CalcOffence.lua:3983-4031
CritMultiplier = 1 + max(0, Sum("BASE","CritMultiplier")/100)
CritEffect     = 1 − critChance + critChance × CritMultiplier   -- средний множитель
```

Enemy crit avoidance реализован как enemy-моды `SelfCritChance` (BASE/INC).

### 2.3 Моды и конверсия

- BASE складываются, INC — `(1 + Σ/100)`, MORE — произведение (`Modules/ModStore.lua`).
- Порядок конверсии: **Physical → Lightning → Cold → Fire → Chaos** (`CalcDefence.lua:28`).
- «Gain as» — поверх конверсии без потерь (`CalcOffence.lua:4102-4125`).
- Added-урон масштабируется общим `baseMultiplier` скилла (`CalcOffence.lua:4131-4136`) —

### 2.4 DPS атак

```lua
-- CalcOffence.lua:4571-4576
AverageDamage = AverageHit × HitChance / 100
TotalDPS      = AverageDamage × Speed × DpsMultiplier × quantityMultiplier
-- средний удар: hit = (min+max)/2, lucky: (min + 2·max)/3 (CalcOffence.lua:4267-4269)
```

Броня врага учитывается той же формулой DR (§1.1) от среднего удара
(`CalcOffence.lua:4293-4303`). Против боссов: их резисты/pen/overwhelm из Config.
`CombinedDPS = TotalDPS + ImpaleDPS + DoT + mirage…` (`CalcOffence.lua:6265+`).

## 3. Стандартные входы расчёта (src/Modules/ConfigOptions.lua)

- `enemyLevel` (**max 85**, `Data.lua:291`; pinnacle/uber — минимум 82);
- `enemyIsBoss`: `None | Boss | Pinnacle | Uber` (в PoB2 **нет выбора босса по имени**):

| Режим | Моды врага | Множитель урона | Pen | Chaos |
|---|---|---|---|---|
| Boss | +30% эле-рез, 0 chaos-res | `stdBossDPSMult` = 4/4.40 (`Data.lua:308`) | — | урон /2.5 |
| Pinnacle | +50% эле-рез | `pinnacleBossDPSMult` = 8/4.40 (`Data.lua:309`) | 3 (`Data.lua:310`) | — |
| Uber | `DamageTaken MORE −70` у врага | `uberBossDPSMult` = 10/4.25 (`Data.lua:311`) | 8 (`Data.lua:311`) | /4 |

  Общее для боссов: `CurseEffectOnSelf MORE −50`, `ExposureEffectOnSelf MORE −50`,
  `KnockbackDistanceOnSelf MORE −75`, `SlowEffectOnSelf MORE −75`, `MinimumMovementSpeed 20`,
  `PoiseThreshold MORE 500` (+213 у Standard Boss; +838 у Pinnacle/Uber), `WarcryPower 20`.
  Обычный монстр — `normalEnemyDPSMult` = 1/4.40: урон = `monsterDamageTable[lvl] × 1.5 × mult`.
  Pinnacle/Uber: уровень врага = max(lvl, 82), броня/уклонение умножаются на средние бонусы из
  `data.bossStats` (считаются из `Data/BossSkills` при загрузке: `PinnacleArmourMean` и т.д.).
  Крит врага по умолчанию: 5% шанс, +30% мульти (`base_critical_hit_damage_bonus`, `Misc.lua:254`).
- Прочие inputs: `enemyPhysicalDamage/FireDamage/…`, `enemyFirePen/…`, `enemyPhysicalOverwhelm`,
  `enemyPhysicalReduction`, `enemyBlockChance`, `enemyEvasion`, `enemyArmour`,
  `enemyCritChance` (default 5), `enemyCritDamage`, `enemyDamageType`, `EHPUnluckyWorstOf`.
- Preset-скиллы боссов (`src/Data/BossSkills.lua:172-184`) — только legacy PoE1 имена
  (Atziri/Shaper/Sirus/…); PoE2-боссов в списке нет.

## 4. Эталонные числа из юнит-тестов (spec/System/TestDefence_spec.lua)

Сетап: `pob1and2Compat()` добавляет `-2 life, -60% chaos res, -10% ele res` → база ≈ 1000 life,
эле-пул ≈ 625.

- `+200 all res` → эле MaxHit = **240**; Physical (при 200% PDR-моде) = **600** (строки 210-214);
- `enemyPhysicalOverwhelm=15` → Physical 240 (Overwhelm ест DR), эле 600 (строки 221-227);
- `50% reduced damage taken` → ×2 к MaxHit (**1200**), `+50% less` → ещё ×2 (**2400**) (строки 232-252)
  — подтверждает мультипликативность inc и more;
- `+100% life as extra max ES` → `ChaosMaximumHitTaken = 4500` при эле 6000 —
  **подтверждение ×2-снятия ES chaos-уроном** (строки 281-288);
- Armour: `+10000 armour` → 50% DR против удара 2000; `+1e9` → cap 90%; `+overwhelm 15` → 75% DR
  (строки 291-380);
- `+10% Block chance` → `EHP ≈ 19008.02` (строки 692-750).

## 5. Сводка отличий PoE2 vs PoE1

| Параметр | PoE1 | PoE2 | Источник |
|---|---|---|---|
| K в формуле брони | 5 | **10** | `Data.lua:261` |
| Cap Physical DR игрока | 90% | 90% | `Misc.lua:150` |
| Базовый cap блока | 75% | **50%** (абс. 90%) | `Misc.lua:151`, `Data.lua:253` |
| Хаос vs ES | обходит ES | **снимает ES × 2** | `CalcDefence.lua:592` |
| Уклонение от спеллов | нет | есть (`SpellEvasion`) | `CalcDefence.lua:1456` |
| Механика Deflect | — | есть (cap 95%, 40% отражается) | `CalcDefence.lua:49-55` |
| Poise у боссов | — | есть (Standard ×18.78, Pinnacle/Uber ×56.28) | `ConfigOptions.lua:2024+` |
| Cap резистов (жёсткий) | 90 | 90, floor −200 | `Data.lua:248-249` |

## 6. Таблицы монстров по уровням (src/Data/Misc.lua:6-14)

Экспорт `DefaultMonsterStats.dat`, индекс = уровень 1..100. TS-порт —
`packages/core/src/enemy.ts` (`monsterStats(level)`, `enemyPlaceholders(level, boss)`);
массивы сверены с `Misc.lua` программно (100 элементов, побайтово).

| Таблица | ур. 66 | ур. 82 | ур. 85 | ур. 100 |
|---|---|---|---|---|
| `monsterEvasionTable` | 677 | 941 | 996 | 1304 |
| `monsterAccuracyTable` | 1158 | 2114 | 2357 | 4011 |
| `monsterLifeTable` | 7079 | 32 956 | 36 012 | 56 106 |
| `monsterDamageTable` | 219.11 | 353.67 | 385.42 | 584.05 |
| `monsterArmourTable` | 2146 | 5375 | 6355 | 14 441 |
| `monsterAilmentThresholdTable` | 10 228 | 71 303 | 79 967 | 123 287 |
| `monsterPoiseThresholdTable` | 28 651 | 236 905 | 271 810 | 446 335 |

Формулы-производные (`src/Export/Scripts/miscdata.lua:34-41`). Порог айлментов =
фактический LIFE с экстраполяцией после ур. 75 (`CalcOffence.lua:5610`).

## 7. DoT-айлменты: Bleed / Poison / Ignite (CalcOffence.lua:5244-5405)

```lua
-- базы (Data.lua:259-267; истоки Misc.lua:87-97):
BleedPercentBase  = 900/60/100  = 0.15  (% удара в сек), длит. 5 с
PoisonPercentBase = 1200/60/100 = 0.20, длит. 2 с
IgnitePercentBase = 1200/60/100 = 0.20, длит. 4 с
DotDpsCap = (2^31-1)/60 = 35 791 394

-- формула (CalcOffence.lua:5354-5405):
DPS = srcDmg(немитиг., взвеш. по криту: calcAilmentDamage, :5111-5121)
      × PercentBase × magnitude × AilmentEffect-inc × rateMod
      × stacks ≤ maxStacks × effMult,   min(DPS, DotDpsCap)
effMult = (1−resist/100) × (1+incTaken/100) × moreTaken   (:5367/5377/5388)
duration = base × durationMod / rateMod    (:5244-5248)
```

Средний roll при перенасыщении стаков: `(stacks−(max−1)/2)/(stacks+1)×100`, иначе 50
(`:5306-5311`). Скоринг стаков: `HitChance × chance × DpsMult × duration × speed` (`:5254-5262`).
TS-порт: `core.ailments.ailmentDotDps`.

## 8. Buildup-состояния: Heavy Stun / Freeze / Electrocute / Pin (CalcOffence.lua:5569-5582)

```lua
buildup% за удар = DamageScale × hitDamage / enemyPoiseThreshold × (1+inc/100) × more
enemyPoiseThreshold = monsterPoiseThresholdTable[enemyLevel] × PoiseThreshold-моды
DamageScale (Misc.lua:49,55,61,66): HeavyStun 0.58 | Freeze 2.1 | Electrocute 1.7 | Pin 4.2
```

ThresholdModifier у каждой механики = 500 (Misc.lua). Chill: порог =
`EnemyAilmentThreshold / ChillEffectMultiplier(100)`, кап эффекта 50% (`:5550-5552`, `Misc.lua:76-78`).
Шанс ignite/shock: `(hitDmg/ailmentThreshold × ChanceMultiplier + base) × (1+inc) × more`, где
множители `Misc.lua:72-74`: Shock 25, Ignite 20, прочие 25 (`:5614-5624`). Shock magnitude
база 20 (`Misc.lua:75`). TS-порт: `core.ailments.buildupPerHit`, `ailmentChance`, `chillThreshold`,
`shockMagnitude`.

## 9. Урон: Double/Triple, скорость, добавленный урон

- Double/Triple Damage (`CalcOffence.lua:4045-4062`): `TripleEffect = 2×TC/100`;
  `DD_eff = max(DD − TD×DD/100, 0)`; AverageHit множитель `= 1 + DD_eff + TripleEffect`;
  double damage only-on-crit взвешивается: `+DDonCrit × CritChance/100`.
- Скорость **не капится** статом, но серверный тик: `Speed = min(Speed, ServerTickRate × Repeats)`
  для НЕ-чаннелингов, `ServerTickRate = 1/0.033 ≈ 30.3/с` (`CalcOffence.lua:3016-3018`, `Data.lua:240-241`);
  при кулдауне `Speed = min(Speed, 1/Cooldown × Repeats)` (`:3008`), кулдаун округляется вверх к тику (`:1833`).
- Added damage: `baseMultiplier = gem.baseMulti or skillData.baseMulti or 1` (`:4131-4136`),
  added-часть ДОПОЛНИТЕЛЬНО × на свой `AddedDamage`-мод (added damage effectiveness).
- PvP (справочно): `(D/(T×M1))^E × T × M2`, константы `Data.lua:312-315`.

## 10. Прочие слои обороны PoE2 (CalcDefence.lua)

- **Spell Suppression** (`:1567-1598`): кап 100%, эффект 50% (`Data.lua:254-255`);
  в EHP учитывается **только при 100%**: весь spell-урон ×(1−50%/…) (`:2628-2641`).
- **Dodge** (`:1600-1616`, отдельная от уклонения механика): Attack/Spell Dodge кап 75
  (`Data.lua:252`); Acrobatics: `SpellDodge = Suppression/2` (`:1572-1573`).
- **Составные not-hit шансы** (`:2223-2226`):
  `MeleeNotHit = 1−(1−EvadeMelee)(1−AttackDodge)(1−AvoidAll)`;
  `SpellNotHit = 1−(1−SpellEvade)(1−SpellDodge)(1−AvoidAvoid)` (в PoE2 спеллы можно
  *уклонять*: `can_evade_spells = 1`, `Misc.lua:226`).
- **Ward** (`:524-525,688`): поглощается ДО Life, есть `WardBypass`; реген 300%/мин (`Misc.lua:129`).
- **Deflect**: кап 95%, отражает 40% в атакующего (`BasePercentDamageDeflected`, `Misc.lua:112`).
- **Отрицательная броня** (Armour Break): бонус урона к цели, кап +100% (`NegArmourDmgBonusCap`,
  `Data.lua:258`).
- **Lucky/unlucky-роллы** (`CalcDefence.lua:1085-1092, 3301-3305`):
  lucky `P = 1−(1−c)²` (при кратном lucky итеративно: `1−(1−c)^(2^n)`);
  worst-of через `EHPUnluckyWorstOf` делит шанс: `c²`, при worstOf=4 — `c⁴`.
  n доп. роллов `P = 1−(1−c)^(n+1)`. TS-порт: `core.ehp.luckyChance`, `chanceWithExtraRolls`.
- **Enemy crit как EHP-фактор**: `EnemyCritEffect = 1 + critChance×(critDmg −1)×(1−CritReduction)`
  (паттерн `CalcDefence.lua:1735-1738`).

TS-порты этих слоёв: `core.ehp` (`attackDodgeChance`, `spellDodgeChance`, `spellSuppressionChance`,
`ward` в `calculateEhp`).

## 11. Порядок митигации хита (скелет EHP)

Канонический порядок операций по хиту (`CalcDefence.lua:94-124, 2066-2086`):
1. резисты / пенетрация;
2. броня — DR по урону ПОСЛЕ резистов (в нашей упрощённой модели применяется ДО —
   осознанное упрощение EHP-оценки по гиру);
3. flat DR + overwhelm;
4. taken-множители (inc/more taken, suppressionMult);
5. пулы: ward → guard/MoM → ES → life.

## 12. Антиканон: PoE1-числа, НЕ переносящиеся в PoE2

Проверено по `PathOfBuilding` (PoE1, HEAD 16de4b8) и `PathOfBuilding-PoE2-v2` (pre-EA форк, jan. 2025):
- hit chance PoE1 `125·Acc / (Acc + (Ev/5)^0.9)` и v2 `1.5·Acc/(Acc+Ev)` — **не использовать**
  (PoB2-v2 это PoE1-наследие);
- K брони PoE1 = **5**;
- `StunNotMeleeDamageMult 0.75` (v2 `Data.lua:191`) — в актуальном PoB2 отсутствует: НЕ переносить;
- PoE1-механики, выпиленные из PoB2: Impale (в PoE2 нет: `ImpalePercentage` в Misc.lua — legacy),
  PoE1-таблицы монстров (уровни до 110), suppression из PoE1 (**в PoE2 формула своя**, §10),
  PoE1-стан-числа, cluster jewels/ward из PoE1 (ward PoE2 — Runic Ward, свой).

## 13. Свежесть канона

- Версия PoB2: `manifest.xml` → `<Version number>` (сейчас **0.23.1**), файл —
  `https://raw.githubusercontent.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/master/manifest.xml`;
  sha1 per-file в манифесте позволяет точечно проверять изменения `Data/*.lua`
  (схема Updater: `update_manifest.py`).
- Версии дерева игры: `src/Modules/GameVersions.lua` — `treeVersionList`, `latestTreeVersion`.
- `PathOfBuilding-Launcher`/`-Updater` — только инфраструктура (реестр/Update.exe), формул не содержат;
  `PathOfBuilding-PoE2-v2` — устаревший форк, использовать только как антиканон.
