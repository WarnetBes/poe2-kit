/**
 * Тест «🛡 Радара» (Этап 4-2, №256): known_issues.json + tricks.json.
 *
 * Покрывает:
 *  - схема: id/title/status/mechanism обязательны; risk/severity из enum;
 *    fixed обязан иметь fixed_in (иначе запись - брак курации);
 *  - data-файлы: все записи валидны, id уникальны, у live-записей
 *    есть sources (дисциплина источников);
 *  - фильтры live/unverified/fixed/feature + radarMeta-счётчики;
 *  - parse-функции: мусорные payload'ы - стойкая обработка;
 *  - findIssue/findTrick по id.
 */

import { describe, it, expect } from 'vitest';
import {
  parseKnownIssues,
  parseKnownTricks,
  listKnownIssues,
  listKnownTricks,
  liveIssues,
  unconfirmedIssues,
  fixedIssues,
  featureIssues,
  findIssue,
  findTrick,
  radarMeta,
  type KnownIssue,
} from '../src/radar.js';

describe('radar: known_issues + tricks data-словарь (№256)', () => {
  it('data-файлы: все записи валидны, id уникальны', () => {
    const issues = listKnownIssues();
    const tricks = listKnownTricks();
    expect(issues.length).toBeGreaterThanOrEqual(15);
    expect(tricks.length).toBeGreaterThanOrEqual(5);

    const ids = new Set<string>();
    for (const i of issues) {
      expect(i.id.match(/^[\w-]+$/)).not.toBeNull();
      expect(ids.has(i.id), `дубль id: ${i.id}`).toBe(false);
      ids.add(i.id);
      if (i.status === 'fixed') expect(i.fixed_in).toBeTruthy();
      if (i.status !== 'fixed') expect(i.fixed_in).toBeUndefined();
    }
    const tids = new Set<string>();
    for (const t of tricks) {
      expect(tids.has(t.id), `дубль id трюка: ${t.id}`).toBe(false);
      tids.add(t.id);
    }
  });

  it('live-записи имеют sources (дисциплина источников №245)', () => {
    for (const i of liveIssues()) {
      expect(i.sources?.length ?? 0, `live без sources: ${i.id}`).toBeGreaterThan(0);
    }
  });

  it('фильтры-секции радара непустые и непересекающиеся', () => {
    const live = liveIssues();
    const fixed = fixedIssues();
    const feat = featureIssues();
    const unconf = unconfirmedIssues();
    expect(live.length).toBeGreaterThan(0);
    expect(fixed.length).toBeGreaterThan(0);
    expect(feat.length).toBeGreaterThan(0);
    expect(unconf.length).toBeGreaterThan(0);
    const all = live.length + fixed.length + feat.length + unconf.length;
    expect(all).toBe(listKnownIssues().length);
  });

  it('ключевые записи волны-2 на месте (Abyss, Ol-Roth, фича Arbiter, Trial-of-Chaos)', () => {
    expect(findIssue('abyss-no-rare-spawn')?.status).toBe('live');
    expect(findIssue('delirium-island-arena')?.status).toBe('live');
    const arb = findIssue('arbiter-non-quest-core');
    expect(arb?.status).toBe('feature');
    const toc = findIssue('trial-of-chaos-ascendancy-exploit');
    expect(toc?.fixed_in).toBe('0.5.5b');
    expect(findTrick('ritual-postpone-limit')?.risk).toBe('none');
    expect(findTrick('nope')).toBeNull();
    expect(findIssue('nope')).toBeNull();
  });

  it('unverified-записи несут пометку (не выдавать за факт)', () => {
    for (const i of unconfirmedIssues()) {
      expect(i.unverified, `unverified без пояснения: ${i.id}`).toBeTruthy();
    }
  });

  it('radarMeta согласована с фильтрами', () => {
    const m = radarMeta();
    expect(m.issuesTotal).toBe(listKnownIssues().length);
    expect(m.issuesTotal).toBe(m.issuesLive + m.issuesFixed + m.issuesFeature + m.issuesUnconfirmed);
    expect(m.tricksTotal).toBe(listKnownTricks().length);
    expect(m.patch).toBe('0.5.5e');
    expect(m.asOf).toMatch(/^2026-10-\d{2}$/);
  });

  it('parseKnownIssues: мусор пропускает, fixed без fixed_in отбраковывает', () => {
    expect(parseKnownIssues(null)).toEqual([]);
    expect(parseKnownIssues({})).toEqual([]);
    expect(parseKnownIssues({ issues: 'nope' })).toEqual([]);
    expect(parseKnownTricks({ tricks: 42 })).toEqual([]);

    const good = [
      { id: 'x', title: 'T', status: 'live', mechanism: 'm' },
      { id: 'y', title: 'F', status: 'fixed', mechanism: 'm' }, // без fixed_in - брак
      { id: '', title: 'E', status: 'live', mechanism: 'm' },
      { id: 'z', title: 'R', status: 'weird-status', mechanism: 'm' },
      { id: 'w', title: 'W', status: 'live', mechanism: 'm', risk: 'nonsense' }, // risk вне enum
      null,
      42,
    ];
    const out = parseKnownIssues({ issues: good });
    expect(out.length).toBe(1);
    expect(out[0]!.id).toBe('x');

    const tricks = parseKnownTricks({
      tricks: [
        { id: 't1', title: 'T', mechanism: 'm', usage: 'u' },
        { id: 't2', title: 'T', mechanism: 'm' }, // без usage - брак
        { id: 't3', title: 'T', mechanism: 'm', usage: 'u', risk: 'maybe' },
      ],
    });
    expect(tricks.length).toBe(1);
    expect(tricks[0]!.id).toBe('t1');
  });

  it('severity-enum гейт: неизвестный severity отбраковывается', () => {
    const bad = [{ id: 's', title: 'S', status: 'live', mechanism: 'm', severity: 'gamebreaking' }] as unknown as KnownIssue[];
    expect(parseKnownIssues({ issues: bad }).length).toBe(0);
  });
});
