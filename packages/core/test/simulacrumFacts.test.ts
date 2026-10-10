/**
 * Тесты data-слоя Simulacrum (№247, Этап 3 «unverified-факты и known-issues
 * как обновляемый data-слой»).
 *
 * Покрывают:
 *  - known_issues грузится из data/game/guides/simulacrum_facts.json
 *    (баг «unable to proceed» из дайджеста №243c / гайда №244 жив);
 *  - open_questions (очередь перепроверки при патче, досье §7) рендерятся
 *    в markdown-хвост секции 'all';
 *  - пустой/битый data-файл — честная отработка, НЕ падение;
 *  - регресс: unverified-дисциплина и ключевые сущности не потерялись.
 */

import { describe, it, expect } from 'vitest';
import {
  SIM_KNOWN_ISSUES,
  SIM_OPEN_QUESTIONS,
  SIM_FACTS_META,
  parseSimulacrumFacts,
  simulacrumGuideMarkdown,
} from '../src/simulacrum.js';
import rawFactsFile from '../data/game/guides/simulacrum_facts.json' with { type: 'json' };

describe('simulacrumFacts: known-issues из data-файла (№247)', () => {
  it('SIM_KNOWN_ISSUES грузится из data и содержит ровно баг «unable to proceed»', () => {
    expect(Array.isArray(SIM_KNOWN_ISSUES)).toBe(true);
    expect(SIM_KNOWN_ISSUES.length).toBe(1);
    const k = SIM_KNOWN_ISSUES[0];
    expect(k.issue).toContain('unable to proceed');
    expect(k.workaround).toContain('End Delirium Encounter');
    expect(k.status).toContain('open');
    expect(k.unverified).toBeTruthy();
    expect(k.report_dates).toEqual(['05.10.2026', '06.10.2026', '09.10.2026', '10.10.2026']);
    // Волна-2 №256: второй триггер (островная арена босса Ol'Roth) в слитой записи
    expect(k.issue).toContain('островной');
  });

  it('данные действительно из файла: текст совпадает с JSON-источником', () => {
    const fileIssues = (rawFactsFile as { known_issues?: typeof SIM_KNOWN_ISSUES }).known_issues;
    expect(fileIssues).toBeDefined();
    expect(SIM_KNOWN_ISSUES[0].issue).toBe(fileIssues![0].issue);
  });

  it('_meta файла доступна (patch/as_of/sources для сверки с патчами)', () => {
    expect(SIM_FACTS_META.patch).toBe('0.5.x');
    expect(SIM_FACTS_META.as_of).toBe('2026-10-09');
    expect(SIM_FACTS_META.sources?.length).toBeGreaterThanOrEqual(2);
  });
});

describe('simulacrumFacts: open_questions — очередь на перепроверку (досье §7)', () => {
  it('4 главных открытых вопроса, каждый с условием проверки и as_of', () => {
    expect(SIM_OPEN_QUESTIONS.length).toBe(4);
    for (const q of SIM_OPEN_QUESTIONS) {
      expect(q.question.trim().length).toBeGreaterThan(0);
      expect(q.check_condition.trim().length).toBeGreaterThan(0);
      expect(q.as_of).toBe('09.10.2026');
    }
  });

  it('вопросы из досье §7: волны боссов 3–5, прирост Deliriousness, Realmgate, рейты Voices', () => {
    const joined = SIM_OPEN_QUESTIONS.map((q) => `${q.question} ${q.check_condition}`).join(' ');
    expect(joined).toContain('с 3-й или с 5-й');
    expect(joined).toContain('Deliriousness');
    expect(joined).toContain('Realmgate');
    expect(joined).toContain('Voices');
  });

  it("markdown 'all' содержит «Открытые вопросы» и вопросы досье §7", () => {
    const md = simulacrumGuideMarkdown('all');
    expect(md).toBeTruthy();
    expect(md).toContain('### ❓ Открытые вопросы (на перепроверку)');
    expect(md).toContain('Realmgate');
    expect(md).toContain('Voices');
    expect(md).toContain('as_of: 09.10.2026');
  });

  it("markdown отдельных секций не раздут вопросами (хвост только в 'all')", () => {
    for (const sec of ['overview', 'checklist', 'bosses'] as const) {
      expect(simulacrumGuideMarkdown(sec)).not.toContain('Открытые вопросы');
    }
  });
});

describe('simulacrumFacts: пустой/битый data-файл — честная отработка', () => {
  it('пустой known_issues = «багов не зафиксировано», не падение', () => {
    const r = parseSimulacrumFacts({ _meta: { patch: '0.5.6' }, known_issues: [], open_questions: [] });
    expect(r.knownIssues).toEqual([]);
    expect(r.openQuestions).toEqual([]);
    expect(r.meta.patch).toBe('0.5.6');
  });

  it('битые записи отфильтровываются, валидные выживают', () => {
    const r = parseSimulacrumFacts({
      known_issues: [
        null,
        { issue: '', workaround: 'x', status: 'y' },
        'not-an-object',
        { issue: 'баг A', workaround: 'воркараунд', status: 'open' },
      ],
      open_questions: [{ question: 'вопрос' }, 42, { question: 'вопрос B', check_condition: 'проверка' }],
    });
    expect(r.knownIssues.length).toBe(1);
    expect(r.knownIssues[0].issue).toBe('баг A');
    expect(r.openQuestions.length).toBe(1);
    expect(r.openQuestions[0].question).toBe('вопрос B');
  });

  it('полностью пустой/сломанный файл → пустые списки, не throw', () => {
    expect(() => parseSimulacrumFacts(null)).not.toThrow();
    expect(parseSimulacrumFacts('мусор').knownIssues).toEqual([]);
    expect(parseSimulacrumFacts({}).openQuestions).toEqual([]);
  });
});

describe('simulacrumFacts: регресс гайда №239/№244 не потерян', () => {
  const md = simulacrumGuideMarkdown('all') ?? '';

  it('unverified-дисциплина: ≥5 пометок в markdown', () => {
    expect((md.match(/unverified/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it('ключевые сущности и известные баги на месте', () => {
    expect(md).toContain('Kosis');
    expect(md).toContain("Tang'Mazu");
    expect(md).toContain('Voices');
    expect(md).toContain('Известные баги');
    expect(md).toContain('unable to proceed');
    expect(md).toContain('End Delirium Encounter');
  });
});
