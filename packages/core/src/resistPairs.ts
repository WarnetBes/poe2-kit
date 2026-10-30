/**
 * W3-3: резист-ПАРЫ — план закрытия капов ВМЕСТЕ двумя предметами
 * (кейс куба-1 №545: Cold −41, Light −3 — один предмет не закроет без
 * потери других статов; идея reference poe2-upgrade-checker «pairs of items
 * that cap your res together», GPL-3, реализация своя — №686/№687).
 *
 * Вход: текущие резисты персонажа (панель игры/PoB) + опц. клир-тексты гира
 * (чтобы не советовать стихию слоту, который её уже несёт).
 * Выход: планы — каждый план = 1-2 слотов с требуемыми минимумами стихий,
 * готовыми label-минимумами для poe2_trade_search.
 *
 * Честно: это эвристика распределения, НЕ оптимизация cost — цены на
 * каждый слот владелец/ассистент проверяет отдельным trade-запросом.
 */

export type Element = 'fire' | 'cold' | 'lightning' | 'chaos';

export interface ResistPairSlot {
  /** Категория trade-поиска (ключ TRADE_CATEGORY_MAP tradeQuery.ts). */
  slotCategory: string;
  /** Человекочитаемое имя слота. */
  slotName: string;
  /** Требования: стихия → минимум (с буфером). */
  needs: Partial<Record<Element, number>>;
}

export interface ResistPairPlan {
  /** Слоты плана (1 или 2). */
  slots: ResistPairSlot[];
  /** Резюме RU. */
  summary: string;
  /** Какой дефицит закрывает план (элемент → сумма). */
  closes: Partial<Record<Element, number>>;
  /** Что НЕ закрыто этим планом. */
  remains: Partial<Record<Element, number>>;
}

export interface PlanResistPairsInput {
  /** Текущие резисты (числа панели; cap−res может быть отрицательным = overcap). */
  resists: { fire: number; cold: number; lightning: number; chaos?: number };
  /** Кап (PoE2 = 75). */
  cap?: number;
  /** Буфер над капом: цель = gap + buffer (панель гуляет на пару процентов). */
  buffer?: number;
  /** Считать хаос (CI-билдам не нужен — default false). */
  includeChaos?: boolean;
}

/** Гибкие слоты для резистов, в порядке предпочтения (кольца дешевле всего). */
const FLEX_SLOTS: Array<{ slotCategory: string; slotName: string }> = [
  { slotCategory: 'ring', slotName: 'Кольцо' },
  { slotCategory: 'belt', slotName: 'Пояс' },
  { slotCategory: 'amulet', slotName: 'Амулет' },
  { slotCategory: 'boots', slotName: 'Сапоги' },
  { slotCategory: 'gloves', slotName: 'Перчатки' },
  { slotCategory: 'helmet', slotName: 'Шлем' },
];

const DEFAULT_CAP = 75;
const DEFAULT_BUFFER = 5;

/**
 * Планы закрытия капов. Алгоритм (прямой, нестохастический):
 *  1. Дефициты по стихиям (gap = cap − res, только > 0).
 *  2. Одна стихия: [A] один гибкий слот с min = gap+buffer; [B] если gap
 *     велик (>60) — сплит-пара: два слота по половине.
 *  3. Две стихии: [A] два слота — каждый со своей стихией; [B] компакт: один
 *     слот с ОБЕИМИ (двойной рез — редкий, проверять руками trade).
 *  Планы НЕ зависят от гира (гибкие слоты заведомо «резистоёмкие»); передача
 *  гира не нужна — вычёркивание «слот уже несёт стихию» делает ассистент,
 *  он видит гир (мы не гадаем о слотах, которых не знаем).
 */
export function planResistPairs(input: PlanResistPairsInput): ResistPairPlan[] {
  const cap = input.cap ?? DEFAULT_CAP;
  const buffer = input.buffer ?? DEFAULT_BUFFER;
  const els: Element[] = input.includeChaos
    ? ['fire', 'cold', 'lightning', 'chaos']
    : ['fire', 'cold', 'lightning'];
  const gaps = new Map<Element, number>();
  for (const el of els) {
    const res = el === 'fire' ? input.resists.fire
      : el === 'cold' ? input.resists.cold
        : el === 'lightning' ? input.resists.lightning
          : (input.resists.chaos ?? cap);
    const gap = cap - res;
    if (gap > 0) gaps.set(el, gap);
  }
  if (!gaps.size) {
    return [
      {
        slots: [],
        summary: `Резисты в капе (цель ${cap}) — пары не нужны.`,
        closes: {},
        remains: {},
      },
    ];
  }
  // Мультипликативный буфер: цель чуть выше строгого gap.
  const need = (gap: number) => gap + buffer;

  const RU_EL: Record<Element, string> = { fire: 'огонь', cold: 'холод', lightning: 'молния', chaos: 'хаос' };
  const LABEL_EL: Record<Element, string> = { fire: 'Fire Res', cold: 'Cold Res', lightning: 'Lightning Res', chaos: 'Chaos Res' };

  // Сортируем стихии по gap убыв — большая стихия получает самый гибкий слот.
  const sorted = [...gaps.entries()].sort((a, b) => b[1] - a[1]);
  const plans: ResistPairPlan[] = [];

  if (sorted.length === 1) {
    const [el, gap] = sorted[0]!;
    // A: один слот.
    plans.push({
      slots: [
        { ...FLEX_SLOTS[0]!, needs: { [el]: need(gap) } as Partial<Record<Element, number>> },
      ],
      summary: `${RU_EL[el]}: −${gap} → один предмет с ${LABEL_EL[el]} ≥ ${need(gap)} (кольцо — самый ликвидный слот).`,
      closes: { [el]: need(gap) } as Partial<Record<Element, number>>,
      remains: {},
    });
    if (gap > 60) {
      const half = Math.ceil(need(gap) / 2);
      plans.push({
        slots: [
          { ...FLEX_SLOTS[0]!, needs: { [el]: half } as Partial<Record<Element, number>> },
          { ...FLEX_SLOTS[1]!, needs: { [el]: half } as Partial<Record<Element, number>> },
        ],
        summary: `${RU_EL[el]}: −${gap} велик — надёжнее ПАРА: два предмета по ${LABEL_EL[el]} ≥ ${half} (дешевле одного с максимальным роллом).`,
        closes: { [el]: half * 2 } as Partial<Record<Element, number>>,
        remains: {},
      });
    }
    return plans;
  }

  // Две и более стихий: попарные планы (по две крупнейшие).
  for (let i = 0; i + 1 < Math.min(sorted.length, 4); i += 2) {
    const [el1, gap1] = sorted[i]!;
    const [el2, gap2] = sorted[i + 1]!;
    const a = FLEX_SLOTS[0]!;
    const b = FLEX_SLOTS[1]!;
    plans.push({
      slots: [
        { ...a, needs: { [el1]: need(gap1) } as Partial<Record<Element, number>> },
        { ...b, needs: { [el2]: need(gap2) } as Partial<Record<Element, number>> },
      ],
      summary: `Пара: ${a.slotName} с ${LABEL_EL[el1]} ≥ ${need(gap1)} + ${b.slotName} с ${LABEL_EL[el2]} ≥ ${need(gap2)} — каждая стихия своим предметом.`,
      closes: { [el1]: need(gap1), [el2]: need(gap2) } as Partial<Record<Element, number>>,
      remains: Object.fromEntries(sorted.filter(([e]) => e !== el1 && e !== el2).map(([e, g]) => [e, g])) as Partial<Record<Element, number>>,
    });
    // Компакт: один слот с двойным резом (дороже/реже — проверять руками).
    plans.push({
      slots: [
        {
          ...a,
          needs: { [el1]: need(gap1), [el2]: need(gap2) } as Partial<Record<Element, number>>,
        },
      ],
      summary: `Компакт: ОДИН предмет (${a.slotName}) сразу ${LABEL_EL[el1]} ≥ ${need(gap1)} И ${LABEL_EL[el2]} ≥ ${need(gap2)} — редкий ролл, листингов будет мало; если пусто — берите пару выше.`,
      closes: { [el1]: need(gap1), [el2]: need(gap2) } as Partial<Record<Element, number>>,
      remains: Object.fromEntries(sorted.filter(([e]) => e !== el1 && e !== el2).map(([e, g]) => [e, g])) as Partial<Record<Element, number>>,
    });
  }
  // Нечётный хвост (третья стихия) — одиночный план.
  if (sorted.length % 2 === 1) {
    const [el, gap] = sorted[sorted.length - 1]!;
    plans.push({
      slots: [{ ...FLEX_SLOTS[2]!, needs: { [el]: need(gap) } as Partial<Record<Element, number>> }],
      summary: `Хвост: ${RU_EL[el]} −${gap} → ${FLEX_SLOTS[2]!.slotName} с ${LABEL_EL[el]} ≥ ${need(gap)}.`,
      closes: { [el]: need(gap) } as Partial<Record<Element, number>>,
      remains: {},
    });
  }

  return plans;
}
