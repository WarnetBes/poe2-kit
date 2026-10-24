import { describe, it, expect } from 'vitest';
import { buildTradeQueryFromItem } from '../src/tradeQuery.js';

/**
 * №620 «Unknown item base type»: RU-клиент Ctrl+C отдаёт кириллические
 * name/baseType, а trade2 принимает только EN. buildTradeQueryFromItem обязан
 * канонизировать RU→EN офлайн-словарём руЛокали ДО query.type.
 */

/** RU-фикстура: редкий щит, кириллическая база «Баклер эгиды» (Sidekick-слой). */
const RU_RARE_SHIELD = `Класс предмета: Щиты
Редкость: Редкий
Ужасный оберег
Баклер эгиды
--------
Броня: 120
--------
+80 к максимуму жизни
--------
Уровень предмета: 72
`;

/** RU-фикстура: база, которой нет в словаре, — прежнее поведение (сырая). */
const RU_UNKNOWN_BASE = `Класс предмета: Щиты
Редкость: Редкий
Странный оберег
Несуществующий баклер
--------
Броня: 120
--------
Уровень предмета: 72
`;

/** EN-фикстура: прежний путь, никакой канонизации не должно происходить. */
const EN_RARE_RING = `Item Class: Rings
Rarity: Rare
Loop of Ashes
Two-Stone Ring
--------
+18 to maximum Life
--------
Item Level: 30
`;

describe('tradeQuery: RU baseType → EN канон до query.type (№620)', () => {
  it('RU-база «Баклер эгиды» резолвится в query.type = Aegis Buckler', () => {
    const q = buildTradeQueryFromItem(RU_RARE_SHIELD);
    expect(q.query.type).toBe('Aegis Buckler');
    expect(q.baseTypeResolved).toBe(true);
  });

  it('EN-предмет не меняется, baseTypeResolved отсутствует', () => {
    const q = buildTradeQueryFromItem(EN_RARE_RING);
    expect(q.query.type).toBe('Two-Stone Ring');
    expect(q.baseTypeResolved).toBeUndefined();
  });

  it('неизвестная RU-база — сырая, как раньше, baseTypeResolved = false', () => {
    const q = buildTradeQueryFromItem(RU_UNKNOWN_BASE);
    expect(q.query.type).toBe('Несуществующий баклер');
    expect(q.baseTypeResolved).toBe(false);
  });

  it('RU name уника канонизируется в EN (query.name)', () => {
    const q = buildTradeQueryFromItem(`Класс предмета: Пояса
Редкость: Уникальный
Адская пряжка
Абиссальный ремень
--------
Скорость передвижения повышена
--------
Уровень предмета: 60
`);
    expect(q.query.name).toBe('Infernoclasp');
  });
});
