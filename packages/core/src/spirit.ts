/**
 * Калькулятор Spirit для Path of Exile 2 — уникальный ресурс PoE2,
 * ограничивающий постоянных миньонов, ауры и мета-гемы.
 *
 * TS-порт hivemind-poe2-mcp (src/calculator/spirit_calculator.py;
 * автор оригинала — HivemindOverlord/poe2-mcp).
 *
 * Механики PoE2:
 *  - базовый Spirit: 100 (3 квестовых черепа: 30 + 30 + 40);
 *  - стоимость = base_cost x множитель_саппорта_1 x ... (округление ВВЕРХ);
 *  - приоритет резерваций: 1-10 (1 = важнейшая).
 */

export type SpiritSourceType = 'quest' | 'gear' | 'passive_tree' | 'ascendancy' | 'buff' | 'other';
export type SpiritReservationType = 'permanent_minion' | 'aura' | 'meta_gem' | 'other';

export interface SpiritSource {
  name: string;
  amount: number;
  sourceType: SpiritSourceType;
  enabled: boolean;
}

export interface SpiritSupportGem {
  name: string;
  multiplier: number;
}

export interface SpiritReservation {
  name: string;
  baseCost: number;
  reservationType: SpiritReservationType;
  supportGems: SpiritSupportGem[];
  enabled: boolean;
  /** 1-10: ниже = важнее (авто-отключение жертвует высокими значениями первыми). */
  priority: number;
}

export interface SpiritOptimization {
  description: string;
  spiritSaved: number;
  actionType: 'disable_reservation' | 'remove_support';
  target: string;
}

/** Кандидат на резерв (P1 #9): готовая Spirit-стоимость и приоритет. */
export interface SpiritCandidate {
  name: string;
  /** Конечная Spirit-стоимость (уже с саппортами, ceil). */
  cost: number;
  /** 1-10: ниже = важнее — сначала берутся важные. */
  priority: number;
}

/** Что из кандидатов помещается в остаток (P1 #9). */
export interface SpiritFitResult {
  /** Доступный (свободный) Spirit — бюджет. */
  budget: number;
  /** Выбранные (влезли), по приоритету. */
  selected: SpiritCandidate[];
  /** Остаток после выбора. */
  remaining: number;
  /** Сколько всего выбрано / стоимость всех выбранных. */
  costUsed: number;
  /** Не влезли (с причиной). */
  skipped: Array<{ name: string; cost: number; priority: number; reason: string }>;
}

/**
 * «Что влезает в остаток» (P1 #9): жадный наброс кандидатов по приоритету
 * (1 = важнее) в доступный бюджет Spirit. При равном приоритете берётся
 * более дорогой (максимизируем ценность резерва). Честно: это приближение —
 * не точный рюкзак (knapsack), но для «ауры/миньоны в остаток» правит порядок.
 */
export function fitSpiritByPriority(
  candidates: SpiritCandidate[],
  budget: number,
): SpiritFitResult {
  const sorted = [...candidates].sort(
    (a, b) => a.priority - b.priority || b.cost - a.cost,
  );
  const selected: SpiritCandidate[] = [];
  const skipped: SpiritFitResult['skipped'] = [];
  let remaining = budget;
  for (const c of sorted) {
    if (c.cost <= 0) continue;
    if (c.cost <= remaining) {
      selected.push(c);
      remaining -= c.cost;
    } else {
      skipped.push({ name: c.name, cost: c.cost, priority: c.priority, reason: 'не влезает в остаток' });
    }
  }
  return {
    budget,
    selected,
    remaining,
    costUsed: budget - remaining,
    skipped,
  };
}

/** Квестовые черепа PoE2: +30 / +30 / +40 = базовые 100 Spirit. */
export const QUEST_SPIRIT_SKULLS = [30, 30, 40] as const;

/** Стоимость резервации: base_cost x произведение множителей саппортов, ceil. */
export function reservationCost(r: SpiritReservation): number {
  if (!r.enabled) return 0;
  let cost = r.baseCost;
  for (const sg of r.supportGems) if (sg.multiplier >= 1) cost *= sg.multiplier;
  // Spirit всегда округляется ВВЕРХ (PoE2).
  return Math.ceil(cost);
}

/** Быстрый расчёт: base + множители саппортов → ceil. */
export function supportGemCost(baseCost: number, multipliers: number[]): number {
  let cost = baseCost;
  for (const m of multipliers) if (m >= 1) cost *= m;
  return Math.ceil(cost);
}

/**
 * Калькулятор Spirit: источники (квесты/гир/дерево), резервации
 * (миньоны/ауры/мета-гемы) с саппортами, оверфлоу и оптимизации.
 */
export class SpiritCalculator {
  readonly sources: SpiritSource[] = [];
  readonly reservations: SpiritReservation[] = [];

  /** Добавить стандартные квестовые черепа (30+30+40). */
  addDefaultQuestSpirit(): this {
    QUEST_SPIRIT_SKULLS.forEach((amount, i) => {
      this.addSource(`Quest skull ${i + 1}`, amount, 'quest');
    });
    return this;
  }

  addSource(name: string, amount: number, sourceType: SpiritSourceType): this {
    if (amount < 0) throw new Error('Spirit amount cannot be negative');
    this.sources.push({ name, amount, sourceType, enabled: true });
    return this;
  }

  addReservation(
    name: string,
    baseCost: number,
    reservationType: SpiritReservationType = 'other',
    supportGems: Array<[string, number]> = [],
    priority = 5,
  ): SpiritReservation {
    if (baseCost < 0) throw new Error('Base cost cannot be negative');
    if (priority < 1 || priority > 10) throw new Error('Priority must be 1-10');
    const r: SpiritReservation = {
      name,
      baseCost,
      reservationType,
      supportGems: supportGems.map(([n, m]) => ({ name: n, multiplier: m })),
      enabled: true,
      priority,
    };
    this.reservations.push(r);
    return r;
  }

  maximumSpirit(): number {
    return this.sources.filter((s) => s.enabled).reduce((a, s) => a + s.amount, 0);
  }

  spiritByType(sourceType: SpiritSourceType): number {
    return this.sources.filter((s) => s.enabled && s.sourceType === sourceType).reduce((a, s) => a + s.amount, 0);
  }

  reservedSpirit(): number {
    return this.reservations.reduce((a, r) => a + reservationCost(r), 0);
  }

  availableSpirit(): number {
    return this.maximumSpirit() - this.reservedSpirit();
  }

  isOverflowing(): boolean {
    return this.availableSpirit() < 0;
  }

  overflowAmount(): number {
    const avail = this.availableSpirit();
    return avail < 0 ? -avail : 0;
  }

  summary() {
    const maximum = this.maximumSpirit();
    const reserved = this.reservedSpirit();
    const sourceBreakdown: Record<SpiritSourceType, number> = {
      quest: 0, gear: 0, passive_tree: 0, ascendancy: 0, buff: 0, other: 0,
    };
    for (const s of this.sources) if (s.enabled) sourceBreakdown[s.sourceType] += s.amount;
    const reservationDetails = this.reservations.map((r) => ({
      name: r.name,
      type: r.reservationType,
      baseCost: r.baseCost,
      finalCost: reservationCost(r),
      supportGems: r.supportGems,
      enabled: r.enabled,
      priority: r.priority,
    }));
    return {
      maximumSpirit: maximum,
      reservedSpirit: reserved,
      availableSpirit: this.availableSpirit(),
      isOverflowing: this.isOverflowing(),
      overflowAmount: this.overflowAmount(),
      utilizationPercent: maximum > 0 ? (reserved / maximum) * 100 : 0,
      sourceBreakdown,
      reservationDetails,
      activeReservations: this.reservations.filter((r) => r.enabled).length,
    };
  }

  /** Как высвободить Spirit: отключить резервации (по приоритету) или снять саппорты. */
  suggestions(targetSpiritToFree?: number): SpiritOptimization[] {
    const target = targetSpiritToFree ?? this.overflowAmount();
    if (target <= 0) return [];
    const out: SpiritOptimization[] = [];
    for (const r of [...this.reservations].sort((a, b) => b.priority - a.priority || reservationCost(b) - reservationCost(a))) {
      if (!r.enabled) continue;
      out.push({
        description: `Отключить '${r.name}' (priority ${r.priority}) — освободит ${reservationCost(r)}`,
        spiritSaved: reservationCost(r),
        actionType: 'disable_reservation',
        target: r.name,
      });
    }
    for (const r of this.reservations) {
      if (!r.enabled || !r.supportGems.length) continue;
      for (const sg of [...r.supportGems].sort((a, b) => b.multiplier - a.multiplier)) {
        const costWith = reservationCost(r);
        let mult = 1;
        for (const s of r.supportGems) if (s !== sg) mult *= s.multiplier;
        const costWithout = Math.ceil(r.baseCost * mult);
        const savings = costWith - costWithout;
        if (savings > 0) {
          out.push({
            description: `Снять '${sg.name}' с '${r.name}' — освободит ${savings}`,
            spiritSaved: savings,
            actionType: 'remove_support',
            target: `${r.name}::${sg.name}`,
          });
        }
      }
    }
    return out.sort((a, b) => b.spiritSaved - a.spiritSaved);
  }

  /** Автоматически гасит оверфлоу, отключая наименее важные резервации. */
  autoResolveOverflow(): string[] {
    const actions: string[] = [];
    const overflow = this.overflowAmount();
    if (overflow <= 0) return actions;
    let freed = 0;
    const sorted = [...this.reservations]
      .filter((r) => r.enabled)
      .sort((a, b) => b.priority - a.priority || reservationCost(b) - reservationCost(a));
    for (const r of sorted) {
      if (freed >= overflow) break;
      const cost = reservationCost(r);
      r.enabled = false;
      freed += cost;
      actions.push(`Отключено '${r.name}' (-${cost} Spirit, priority ${r.priority})`);
    }
    return actions;
  }
}
