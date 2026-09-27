/**
 * MCP-инструменты: калькуляторы механик PoE2 (EHP, Spirit, Stun).
 * TS-порт идей hivemind-poe2-mcp (src/calculator/; HivemindOverlord/poe2-mcp).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core } from '@poe2-kit/core';
import type { DefensiveStats, SpiritSourceType, SpiritReservationType, StunDamageType, StunAttackType } from '@poe2-kit/core';

export function registerCalculatorTools(server: McpServer): number {
  let count = 0;

  // ── EHP ──────────────────────────────────────────────────────────────
  server.registerTool(
    'poe2_ehp',
    {
      title: 'PoE2 EHP Calculator',
      description: `Эффективное HP (EHP) по типам урона с послойным разбором обороны и слабыми местами.

Слои PoE2 (по порядку): уклонение → блок (кап 50%) → армор (физ., ДО резистов, DR = A/(A+10*hit)) → резисты → пул HP.
Хаос: ES снимается с коэффициентом 2.

Аргументы:
  - life (нужно): макс. жизнь.
  - energyShield, armor, evasion, blockChance (%, 0-): прочие обороны.
  - fireRes, coldRes, lightningRes, chaosRes (%, может быть < 0).
  - hitSize (по умолч. 1000): ожидаемый размер удара (влияет на армор).
  - accuracy (по умолч. 2000): точность атакующего (влияет на уклонение).
  - upgrade: JSON с теми же полями — сравнить EHP до/после апгрейда.

Полезно для «доживу ли я», «что качать: армор или резисты», «что даёт этот предмет».`,
      inputSchema: {
        life: z.number().positive().describe('Максимальная жизнь'),
        energyShield: z.number().min(0).optional(),
        armor: z.number().min(0).optional(),
        evasion: z.number().min(0).optional(),
        blockChance: z.number().min(0).optional().describe('Шанс блока, % (кап 50%)'),
        fireRes: z.number().optional().describe('Fire resistance, %'),
        coldRes: z.number().optional().describe('Cold resistance, %'),
        lightningRes: z.number().optional().describe('Lightning resistance, %'),
        chaosRes: z.number().optional().describe('Chaos resistance, %'),
        hitSize: z.number().positive().optional().describe('Ожидаемый размер удара (по умолч. 1000)'),
        accuracy: z.number().positive().optional().describe('Точность атакующего (по умолч. 2000)'),
        upgrade: z.record(z.number()).optional().describe('Апгрейд-статы (те же поля) для сравнения'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const { life, energyShield, armor, evasion, blockChance, fireRes, coldRes, lightningRes, chaosRes, hitSize, accuracy, upgrade } = args;
        const stats = { life, energyShield, armor, evasion, blockChance, fireRes, coldRes, lightningRes, chaosRes };
        const threat = { ...(hitSize ? { expectedHitSize: hitSize } : {}), ...(accuracy ? { attackerAccuracy: accuracy } : {}) };
        const ehp = core.ehp;
        const all = ehp.calculateAllEhp(stats, threat);
        const lines: string[] = [];
        lines.push(`## EHP (hit ${threat.expectedHitSize ?? 1000}, acc ${threat.attackerAccuracy ?? 2000})`, '');
        lines.push('| Тип урона | Raw HP | Mitigation | EHP |', '|---|---|---|---|');
        for (const dt of ehp.DAMAGE_TYPES) {
          const r = all[dt];
          lines.push(`| ${dt} | ${r.rawHp.toFixed(0)} | ${(r.totalMitigation * 100).toFixed(1)}% | ${r.effectiveHp.toFixed(0)} |`);
        }
        const gaps = ehp.identifyDefenseGaps(stats, threat);
        if (gaps.length) {
          lines.push('', '### Слабые места');
          for (const g of gaps.slice(0, 6)) lines.push(`- **${g.description}** — ${g.recommendation} (severity ${g.severity.toFixed(1)})`);
        } else {
          lines.push('', 'Слабых мест не найдено — оборона сбалансирована.');
        }
        if (upgrade) {
          const upStats = { ...stats, ...upgrade } as DefensiveStats;
          const cmp = ehp.compareEhpUpgrade(stats, upStats, threat);
          lines.push('', '### Сравнение с апгрейдом');
          for (const dt of ehp.DAMAGE_TYPES) {
            const g = cmp.gain[dt];
            lines.push(`- ${dt}: ${cmp.current[dt].toFixed(0)} → ${cmp.upgraded[dt].toFixed(0)} (${g.absolute >= 0 ? '+' : ''}${g.absolute.toFixed(0)}, ${g.percent.toFixed(1)}%)`);
          }
          lines.push(`Средний прирост: **${cmp.averagePercentGain.toFixed(1)}%**`);
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: `Ошибка EHP: ${error instanceof Error ? error.message : String(error)}` }] };
      }
    },
  );
  count++;

  // ── Spirit ─────────────────────────────────────────────────────────
  server.registerTool(
    'poe2_spirit',
    {
      title: 'PoE2 Spirit Calculator',
      description: `Расчёт Spirit PoE2: источники (квесты 30+30+40, гир, дерево, асценданси) и резервации (миньоны/ауры/мета-гемы) с саппорт-множителями (округление ВВЕРХ).

Аргументы (все JSON-массивы объектов или простые значения):
  - sources: массив [{ name, amount, type? }] (type: quest/gear/passive_tree/ascendancy/buff/other).
  - includeQuestSkulls (bool, по умолч. true): добавить базовые квестовые +100 Spirit.
  - reservations: массив [{ name, cost, type?, supports?: [[name, mult]...], priority? }] (1 = важнейшая).
  - suggest (bool, по умолч. true): как высвободить Spirit при нехватке.
  - budget (int, опц.): свободный Spirit для режима «что влезает в остаток».
  - candidates: массив [{ name, cost, priority? }] — ауры/миньоны-кандидаты; при наличии — режим «что влезает в остаток» (жадно по приоритету; бюджет = указанный budget или свободный Spirit).

Полезно для «хватит ли Spirit на всех миньонов/ауры» и «что из кандидатов влезает в остаток».`,
      inputSchema: {
        sources: z.array(z.object({
          name: z.string(),
          amount: z.number().int().min(0),
          type: z.string().optional(),
        })).optional(),
        includeQuestSkulls: z.boolean().optional(),
        reservations: z.array(z.object({
          name: z.string(),
          cost: z.number().int().min(0),
          type: z.string().optional(),
          supports: z.array(z.array(z.union([z.string(), z.number()]))).optional().describe('[[имя, множитель]...], множитель >= 1'),
          priority: z.number().int().min(1).max(10).optional(),
        })).optional(),
        suggest: z.boolean().optional(),
        budget: z.number().int().min(0).optional().describe('Свободный Spirit для режима «что влезает в остаток»'),
        candidates: z.array(z.object({
          name: z.string(),
          cost: z.number().int().min(0),
          priority: z.number().int().min(1).max(10).optional(),
        })).optional().describe('Ауры/миньоны-кандидаты для режима «что влезает в остаток»'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ sources, includeQuestSkulls, reservations, suggest, budget, candidates }) => {
      try {
        const sc = new core.spirit.SpiritCalculator();
        if (includeQuestSkulls !== false) sc.addDefaultQuestSpirit();
        for (const s of sources ?? []) {
          sc.addSource(s.name, s.amount, (s.type as SpiritSourceType | undefined) ?? 'other');
        }
        for (const r of reservations ?? []) {
          const sups = (r.supports ?? []) as Array<[string, number]>;
          sc.addReservation(r.name, r.cost, (r.type as SpiritReservationType | undefined) ?? 'other', sups, r.priority ?? 5);
        }
        // Режим P1 #9 «что влезает в остаток».
        if (candidates && candidates.length) {
          const available = budget != null ? budget : sc.availableSpirit();
          const cands = candidates.map((c) => ({ name: c.name, cost: c.cost, priority: c.priority ?? 5 }));
          const fit = core.spirit.fitSpiritByPriority(cands, available);
          const lines2: string[] = [
            '## Spirit — что влезает в остаток',
            '',
            `Свободно: **${available}** Spirit${budget != null ? ' (задан бюджет)' : ' (рассчитано из источников/резерваций)'}`,
            '',
            '### Влезают (по приоритету)',
          ];
          if (fit.selected.length) {
            for (const c of fit.selected) lines2.push(`- ✓ **${c.name}**: ${c.cost} Spirit (p${c.priority})`);
          } else {
            lines2.push('- —');
          }
          lines2.push('', `Занято из остатка: **${fit.costUsed}** Spirit; **осталось после: ${fit.remaining}**.`);
          if (fit.skipped.length) {
            lines2.push('', '### Не влезают');
            for (const s of fit.skipped) lines2.push(`- ✗ ${s.name}: ${s.cost} Spirit (p${s.priority}) — ${s.reason}`);
          }
          if (fit.skipped.length) lines2.push('', '_Приближение: жадный наброс по приоритету, не точный рюкзак._');
          return { content: [{ type: 'text', text: lines2.join('\n') }] };
        }
        const sum = sc.summary();
        const lines: string[] = [];
        lines.push('## Spirit', '');
        lines.push(`Максимум: **${sum.maximumSpirit}** | Занято: **${sum.reservedSpirit}** | Свободно: **${sum.availableSpirit}** (${sum.utilizationPercent.toFixed(0)}%)`);
        lines.push(`Источники: quest ${sum.sourceBreakdown.quest}, gear ${sum.sourceBreakdown.gear}, дерево ${sum.sourceBreakdown.passive_tree}, асценданси ${sum.sourceBreakdown.ascendancy}, прочее ${sum.sourceBreakdown.other + sum.sourceBreakdown.buff}`);
        if (sum.isOverflowing) {
          lines.push('', `**Оверфлоу: не хватает ${sum.overflowAmount} Spirit!**`);
        }
        if (sum.reservationDetails.length) {
          lines.push('', '### Резервации');
          for (const r of sum.reservationDetails) {
            const sup = r.supportGems.length ? ` (саппорты: ${r.supportGems.map((s) => `${s.name} x${s.multiplier}`).join(', ')})` : '';
            lines.push(`- ${r.enabled ? '✓' : '✗'} ${r.name} [${r.type}]: ${r.baseCost}${r.finalCost !== r.baseCost ? ` → **${r.finalCost}**` : ` = **${r.finalCost}**`}${sup} (p${r.priority})`);
          }
        }
        if (suggest !== false && sum.isOverflowing) {
          lines.push('', '### Как высвободить Spirit');
          for (const s of sc.suggestions().slice(0, 5)) lines.push(`- ${s.description}`);
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: `Ошибка Spirit: ${error instanceof Error ? error.message : String(error)}` }] };
      }
    },
  );
  count++;

  // ── Stun ───────────────────────────────────────────────────────────
  server.registerTool(
    'poe2_stun',
    {
      title: 'PoE2 Stun Calculator',
      description: `Станы PoE2: Light Stun (шанс = урон/HP цели, x1.5 физ., x1.5 мили; нужен >= 15%) и Heavy Stun (билдап-метр до 100% макс. HP цели → стан 3с; Primed >= 50% + Light = Crushing Blow).

Аргументы:
  - damage (нужно): урон за удар.
  - targetMaxLife (нужно): макс. HP цели.
  - damageType (phys/fire/cold/lightning/chaos), attackType (melee/ranged/spell).
  - increasedStunChance, reducedStunThreshold (опц.): модификаторы.

Возвращает: шанс Light Stun, билдап за удар, ударов до Light/Heavy Stun, эффективность против целей с разным HP.`,
      inputSchema: {
        damage: z.number().positive().describe('Урон за удар'),
        targetMaxLife: z.number().positive().describe('Макс. HP цели'),
        damageType: z.enum(['physical', 'fire', 'cold', 'lightning', 'chaos']).optional(),
        attackType: z.enum(['melee', 'ranged', 'spell']).optional(),
        increasedStunChance: z.number().optional().describe('Увеличенный шанс стана, %'),
        stunBuildupMultiplier: z.number().min(1).optional().describe('Множитель билдапа Heavy Stun (x1.5 = +50% more)'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const dType = (args.damageType ?? 'physical') as StunDamageType;
        const aType = (args.attackType ?? 'melee') as StunAttackType;
        const mods = {
          ...(args.increasedStunChance ? { increasedStunChance: args.increasedStunChance } : {}),
          ...(args.stunBuildupMultiplier ? { stunBuildupMultiplier: args.stunBuildupMultiplier } : {}),
        };
        const st = core.stun;
        const ls = st.lightStunChance(args.damage, args.targetMaxLife, dType, aType, mods);
        const ht = st.hitsToStun(args.damage, args.targetMaxLife, dType, aType, mods);
        const lines: string[] = [];
        lines.push(`## Стан: ${args.damage} урона, ${dType}/${aType}, vs ${args.targetMaxLife} HP`, '');
        lines.push(`- Light Stun: шанс **${ls.finalChance.toFixed(1)}%** (порог 15%) — ${ls.willStun ? '**станит**' : 'НЕ станит'}`);
        lines.push(`- Билдап Heavy Stun за удар: **${ht.buildupPerHit.toFixed(0)}** (${((ht.buildupPerHit / args.targetMaxLife) * 100).toFixed(1)}% метра)`);
        lines.push(`- Ударов до Heavy Stun: **${Number.isFinite(ht.hitsToHeavyStun) ? ht.hitsToHeavyStun : '∞'}**`);
        if (ls.willStun && ht.buildupPerHit / args.targetMaxLife >= 0.5) {
          lines.push(`- **Crushing Blow**: цель Primed после первого удара — следующий стан-удар даст Crushing Blow.`);
        }
        lines.push('', '### Против целей с разным HP');
        lines.push('| HP цели | Light Stun | Ударов до Heavy Stun |', '|---|---|---|');
        for (const hp of [500, 1000, 2500, 5000, 10000]) {
          const l = st.lightStunChance(args.damage, hp, dType, aType, mods);
          const h = st.hitsToStun(args.damage, hp, dType, aType, mods);
          lines.push(`| ${hp} | ${l.finalChance.toFixed(0)}%${l.willStun ? ' ✓' : ''} | ${Number.isFinite(h.hitsToHeavyStun) ? h.hitsToHeavyStun : '∞'} |`);
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: `Ошибка стана: ${error instanceof Error ? error.message : String(error)}` }] };
      }
    },
  );
  count++;

  // ── Enemy stats ─────────────────────────────────────────────────────
  server.registerTool(
    'poe2_enemy_stats',
    {
      title: 'PoE2 Enemy Stats',
      description: `Статы монстров PoE2 по уровню и пресеты боссов (канон PathOfBuilding-PoE2: Data/Misc.lua, ConfigOptions.lua).

Таблицы по уровням 1..100: уклонение, точность, HP, урон, броня, пороги айлментов и poise.
Пресеты боссов (Boss / Pinnacle / Uber): урон = monsterDamage × 1.5 × DPSMult (обычный 1/4.4, босс 4/4.4, пиннакл 8/4.4, убер 10/4.25), элем-резисты 0/30/50/50, пенетрация 0/0/3/8, poise-множитель ×1 / ×18.8 / ×56.3 / ×56.3, хаос-урон /2.5 (убер /4).

Аргументы:
  - level (нужно): уровень врага (для Pinnacle/Uber минимум 82).
  - boss: none/boss/pinnacle/uber (по умолчанию none).
  - armourMult, evasionMult: бонусы боссов из bossStats (1 = базовые таблицы).

Полезно для «какие статы у босса 84 уровня», «сколько EHP нужно против пиннакла», «какой poise у босса».`,
      inputSchema: {
        level: z.number().int().min(1).max(100).describe('Уровень врага'),
        boss: z.enum(['none', 'boss', 'pinnacle', 'uber']).optional().describe('Режим босса'),
        armourMult: z.number().optional().describe('Множитель брони босса из bossStats (доля > 1)'),
        evasionMult: z.number().optional().describe('Множитель уклонения босса из bossStats (доля > 1)'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const boss = args.boss ?? 'none';
        const p = core.enemy.enemyPlaceholders(args.level, boss, {
          ...(args.armourMult ? { armourMult: args.armourMult } : {}),
          ...(args.evasionMult ? { evasionMult: args.evasionMult } : {}),
        });
        const m = core.enemy.monsterStats(args.level);
        const lines: string[] = [];
        lines.push(`## Враг ур. ${p.level}${boss !== 'none' ? ` [${boss === 'boss' ? 'Standard Boss' : boss === 'pinnacle' ? 'Pinnacle' : 'Uber Pinnacle'}]` : ''}`, '');
        lines.push('| Стат | Значение |', '|---|---|');
        lines.push(`| Урон за удар (phys/ele) | **${p.damage}** |`);
        lines.push(`| Хаос-урон | ${p.chaosDamage} |`);
        lines.push(`| HP (обычный монстр) | ${p.life} |`);
        lines.push(`| Броня | ${p.armour} |`);
        lines.push(`| Уклонение | ${p.evasion} (точность ${m.accuracy}) |`);
        lines.push(`| Порог айлментов | ${m.ailmentThreshold} |`);
        lines.push(`| Порог poise | **${p.poiseThreshold}** (множитель ×${p.poiseMultiplier.toFixed(2)}) |`);
        lines.push(`| Элем-резисты | ${p.elementalResist}% (хаос ${p.chaosResist}%) |`);
        lines.push(`| Пенетрация элем-резистов | ${p.elementalPenetration}% |`);
        lines.push(`| Скорость | ${p.speed} |`);
        lines.push(`| Крит | ${p.critChance}% шанс, +${p.critMultiplier}% мульти |`);
        lines.push('', `_Канон: PathOfBuilding-PoE2, src/Data/Misc.lua (таблицы DefaultMonsterStats.dat), Modules/ConfigOptions.lua (пресеты боссов)._`);
        if (boss !== 'none') lines.push('Учтите: у Pinnacle/Uber PoB умножает броню/уклонение на средние бонусы из data.bossStats (BossSkills) — передайте armourMult/evasionMult для точности.');
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: `Ошибка enemy stats: ${error instanceof Error ? error.message : String(error)}` }] };
      }
    },
  );
  count++;

  // ── Ailments (DoT + buildup) ────────────────────────────────────────
  server.registerTool(
    'poe2_ailments',
    {
      title: 'PoE2 Ailments Calculator',
      description: `Айлменты PoE2 по канону PoB2: DoT (bleed/poison/ignite) и buildup (heavyStun/freeze/electrocute/pin).

DoT: DPS = hitDmg × 0.15/0.2/0.2 (bleed/poison/ignite, % удара в сек) × эффект × rate × стак × (1−резист)(1+взятый); длительность 5/2/4 с, кап DoT-DPS 35 791 394.
Buildup: % за удар = DamageScale (0.58/2.1/1.7/4.2) × урон / порог poise цели; у боссов порог ×18.8 (Boss) или ×56.3 (Pinnacle/Uber) — см. poe2_enemy_stats.
Шанс айлмента: (урон/порог × множитель[shock 25/ignite 20/прочие 25] + база) × (1+inc) × more.

Аргументы:
  - mode: dot / buildup / chance (нужно).
  - Для dot: hitDamage, ailment, stacks, targetResistPercent, increasedAilmentEffectPercent, increasedRatePercent.
  - Для buildup: hitDamage, type, enemyPoiseThreshold (или enemyLevel+boss — подставим из таблиц).
  - Для chance: hitDamage, type, enemyAilmentThreshold (или enemyLevel), baseChancePercent.`,
      inputSchema: {
        mode: z.enum(['dot', 'buildup', 'chance']).describe('Режим расчёта'),
        hitDamage: z.number().positive().describe('Средний урон удара-источника'),
        ailment: z.enum(['bleed', 'poison', 'ignite']).optional().describe('DoT-айлмент (mode=dot)'),
        type: z.enum(['heavyStun', 'freeze', 'electrocute', 'pin']).optional().describe('Buildup-тип (mode=buildup)'),
        chanceType: z.enum(['shock', 'ignite', 'chill', 'bleed', 'poison']).optional().describe('Тип шанса (mode=chance)'),
        stacks: z.number().int().min(1).optional().describe('Число стаков DoT'),
        targetResistPercent: z.number().optional().describe('Резист цели, %'),
        increasedAilmentEffectPercent: z.number().optional().describe('Increased ailment effect, %'),
        increasedRatePercent: z.number().optional().describe('Increased DoT rate, %'),
        increasedPercent: z.number().optional().describe('Increased buildup, %'),
        enemyPoiseThreshold: z.number().positive().optional().describe('Порог poise цели (иначе из таблиц)'),
        enemyAilmentThreshold: z.number().positive().optional().describe('Порог айлментов цели (иначе из таблиц)'),
        enemyLevel: z.number().int().min(1).max(100).optional().describe('Уровень врага для порогов из таблиц'),
        boss: z.enum(['none', 'boss', 'pinnacle', 'uber']).optional().describe('Режим босса для порога poise'),
        baseChancePercent: z.number().optional().describe('Базовый шанс айлмента от мода, %'),
        increasedChancePercent: z.number().optional().describe('Increased chance, %'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const ail = core.ailments;
        const lines: string[] = [];
        if (args.mode === 'dot') {
          if (!args.ailment) throw new Error('Для mode=dot укажите ailment (bleed/poison/ignite)');
          const r = ail.ailmentDotDps({
            hitDamage: args.hitDamage,
            ailment: args.ailment,
            ...(args.stacks ? { stacks: args.stacks } : {}),
            ...(args.targetResistPercent != null ? { targetResistPercent: args.targetResistPercent } : {}),
            ...(args.increasedAilmentEffectPercent != null ? { increasedAilmentEffectPercent: args.increasedAilmentEffectPercent } : {}),
            ...(args.increasedRatePercent != null ? { increasedRatePercent: args.increasedRatePercent } : {}),
          });
          lines.push(`## ${args.ailment} DoT (удар ${args.hitDamage})`, '');
          lines.push(`- DoT-DPS: **${r.damagePerSecond.toFixed(0)}**${r.capped ? ' (КАП DotDpsCap 35 791 394!)' : ''}`);
          lines.push(`- Длительность: ${r.durationSeconds.toFixed(2)} с; стаков: ${r.stacks}`);
          lines.push(`- Урон за длительность: ${r.totalDamage.toFixed(0)}`);
        } else if (args.mode === 'buildup') {
          if (!args.type) throw new Error('Для mode=buildup укажите type (heavyStun/freeze/electrocute/pin)');
          let poise = args.enemyPoiseThreshold;
          if (poise == null) {
            if (args.enemyLevel == null) throw new Error('Укажите enemyPoiseThreshold или enemyLevel');
            const lvl = Math.max(args.enemyLevel, (args.boss === 'pinnacle' || args.boss === 'uber') ? 82 : 1);
            const m = core.enemy.monsterStats(lvl);
            poise = Math.round(m.poiseThreshold * core.enemy.poiseMultiplier(args.boss ?? 'none'));
          }
          const r = ail.buildupPerHit({
            hitDamage: args.hitDamage,
            type: args.type,
            enemyPoiseThreshold: poise,
            ...(args.increasedPercent != null ? { increasedPercent: args.increasedPercent } : {}),
          });
          lines.push(`## Buildup: ${args.type} (удар ${args.hitDamage}, порог poise ${poise})`, '');
          lines.push(`- DamageScale: ${r.damageScale} (Misc.lua:49-66)`);
          lines.push(`- Билдап за удар: **${r.buildupPercentPerHit.toFixed(2)}%** метра`);
          lines.push(`- Ударов до срабатывания: **${Number.isFinite(r.hitsToTrigger) ? r.hitsToTrigger : '∞'}**`);
        } else {
          if (!args.chanceType) throw new Error('Для mode=chance укажите chanceType (shock/ignite/chill/bleed/poison)');
          let threshold = args.enemyAilmentThreshold;
          if (threshold == null) {
            if (args.enemyLevel == null) throw new Error('Укажите enemyAilmentThreshold или enemyLevel');
            threshold = core.enemy.monsterStats(args.enemyLevel).ailmentThreshold;
          }
          const r = ail.ailmentChance({
            hitDamage: args.hitDamage,
            enemyAilmentThreshold: threshold,
            type: args.chanceType,
            ...(args.baseChancePercent != null ? { baseChancePercent: args.baseChancePercent } : {}),
            ...(args.increasedChancePercent != null ? { increasedChancePercent: args.increasedChancePercent } : {}),
          });
          lines.push(`## Шанс ${args.chanceType} (удар ${args.hitDamage}, порог айлментов ${threshold})`, '');
          lines.push(`- Шанс: **${r.chancePercent.toFixed(1)}%**`);
          lines.push(`- Удар для гарантированного наложения: ${r.minimumHitDamage.toFixed(0)}`);
          if (args.chanceType === 'chill') lines.push(`- Порог Chill: ${ail.chillThreshold(threshold).toFixed(0)} (порог / ChillEffectMultiplier 100)`);
          if (args.chanceType === 'shock') lines.push(`- Shock magnitude: ${ail.shockMagnitude(args.hitDamage, threshold).toFixed(0)}% (база 20)`);
        }
        lines.push('', '_Канон: PathOfBuilding-PoE2, CalcOffence.lua:5244-5624, Modules/Data.lua:259-267, Data/Misc.lua._');
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: `Ошибка ailments: ${error instanceof Error ? error.message : String(error)}` }] };
      }
    },
  );
  count++;

  // ── Базовые пулы (life/mana/ES/реген маны) — канон PoB2 ─────────────────────
  server.registerTool(
    'poe2_base_pools',
    {
      title: 'PoE2 Base Resource Pools',
      description: `Базовые пулы персонажа PoE2 по канону PoB2 (БЕЗ Hivemind-legacy):

- Life = 12*level + 16 (атрибуты life НЕ дают — смена PoE2)
- Mana = 4*level + 30
- Реген маны = 4%/с от макс. маны (240%/мин)
- ES: базового ES от уровня НЕТ — только gear/tree (flat+increased+more)

Итог: (база + flat) * (1 + increased%) * (1+more_1)*(1+more_2)... , floor.

Аргументы:
  - level (нужен): уровень персонажа 1-100.
  - lifeFlat, lifeIncreasedPercent (опц.): моды жизни.
  - manaFlat, manaIncreasedPercent (опц.): моды маны.
  - esFlat, esIncreasedPercent, esMoreMultipliers (опц.): моды ES.

Возвращает базу и итог каждого пула + реген маны/с.`,
      inputSchema: {
        level: z.number().int().min(1).max(100).describe('Уровень персонажа'),
        lifeFlat: z.number().optional().describe('Плоский +life (gear/tree)'),
        lifeIncreasedPercent: z.number().optional().describe('Increased maximum life, %'),
        manaFlat: z.number().optional().describe('Плоский +mana'),
        manaIncreasedPercent: z.number().optional().describe('Increased maximum mana, %'),
        esFlat: z.number().optional().describe('Плоский +ES от gear'),
        esIncreasedPercent: z.number().optional().describe('Increased ES, %'),
        esMoreMultipliers: z.array(z.number()).optional().describe('ES more-множители (0.1 = +10%)'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const res = core.resources;
        const lifeMods = {
          ...(args.lifeFlat != null ? { flat: args.lifeFlat } : {}),
          ...(args.lifeIncreasedPercent != null ? { increasedPercent: args.lifeIncreasedPercent } : {}),
        };
        const manaMods = {
          ...(args.manaFlat != null ? { flat: args.manaFlat } : {}),
          ...(args.manaIncreasedPercent != null ? { increasedPercent: args.manaIncreasedPercent } : {}),
        };
        const esMods = {
          ...(args.esFlat != null ? { flat: args.esFlat } : {}),
          ...(args.esIncreasedPercent != null ? { increasedPercent: args.esIncreasedPercent } : {}),
          ...(args.esMoreMultipliers != null ? { moreMultipliers: args.esMoreMultipliers } : {}),
        };
        const life = res.maxLife(args.level, lifeMods);
        const mana = res.maxMana(args.level, manaMods);
        const es = res.maxEnergyShield(esMods);
        const base = (per: number, lv: number, off: number) => per * lv + off;
        const lines: string[] = [];
        lines.push(`## Базовые пулы PoE2 (уровень ${args.level})`, '');
        lines.push(`- Life: **${life}** (база ${base(res.RESOURCE_CONSTANTS.LIFE_PER_LEVEL, args.level, res.RESOURCE_CONSTANTS.LIFE_LEVEL_BASE)})`);
        lines.push(`- Mana: **${mana}** (база ${base(res.RESOURCE_CONSTANTS.MANA_PER_LEVEL, args.level, res.RESOURCE_CONSTANTS.MANA_LEVEL_BASE)})`);
        lines.push(`- ES: **${es}** (базового ES от уровня нет — только моды)`);
        lines.push(`- Реген маны: **${res.manaRegenPerSec(mana).toFixed(2)}/с** (4% от макс. маны)`);
        lines.push('', '_Канон: PathOfBuilding-PoE2 CalcSetup.lua:954-956 (Multiplier base=16/30), ModStore.lua:442 (value*mult+base), Data/Misc.lua:156-157,147._');
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: `Ошибка base_pools: ${error instanceof Error ? error.message : String(error)}` }] };
      }
    },
  );
  count++;

  return count;
}
