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

У боссов есть **PoiseThreshold** (`ConfigOptions.lua:2024,2066,2107`): Unique ×5, Xesht ×9.
Длительность стана округляется к тику сервера 33 мс (`CalcDefence.lua:2799`).

## 2. Урон (src/Modules/CalcOffence.lua)

### 2.1 Точность

`hitChance` — см. §1.2 (атакующая формула). Dex даёт 6 точности (`AccuracyPerDexBase = 6`,
`Data.lua:242`). Дистанционный фоллофф: с 20 (`AccuracyFalloffStart`) до 90 (`…End`) единиц
дистанции штраф растёт линейно (`CalcOffence.lua:2718`).

### 2.2 Крит

```lua
-- CalcOffence.lua:3859-3901
CritChance  = (base_crit + Sum("BASE","CritChance")) × (1 + INC/100) × more,  кап = CritChanceCap
CritChance  = CritChance × AccuracyHitChance / 100        -- confirmation roll (не-крит может стать критом? нет: не-попадание)
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
| Boss | +30% эле-рез, 0 chaos-res | `stdBossDPSMult` ≈ 0.909 (`Data.lua:296`) | — | урон /2.5 |
| Pinnacle | +50% эле-рез | `pinnacleBossDPSMult` ≈ 1.818 (`Data.lua:297`) | 3 (`Data.lua:298`) | — |
| Uber | `DamageTaken MORE −70` у врага | `uberBossDPSMult` = 10/4.25 (`Data.lua:299`) | 8 (`Data.lua:300`) | /4 |

  Общее для боссов: `CurseEffectOnSelf MORE −50`, `ExposureEffectOnSelf MORE −50`,
  `PoiseThreshold MORE 500` (Xesht: 838), `MinimumMovementSpeed 20`.
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
| Poise у боссов | — | есть (×5..×9) | `ConfigOptions.lua:2024+` |
| Cap резистов (жёсткий) | 90 | 90, floor −200 | `Data.lua:248-249` |
