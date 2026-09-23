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

Полезно для «хватит ли Spirit на всех миньонов/ауры».`,
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
      },
      annotations: { readOnlyHint: true },
    },
    async ({ sources, includeQuestSkulls, reservations, suggest }) => {
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

  return count;
}
