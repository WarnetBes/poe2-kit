/**
 * Вкладка «🧬 Билды» (№257): курируемые стартовые билды PoE2 0.5.x
 * из ресёрч-волн №471-№477 (lootkeeper/maxroll/poe.ninja).
 *
 * Данные — в @poe2-kit/core (starterBuildGuides.ts, starter_builds.json);
 * здесь — только рендер: поиск, группировка по классам, карточки со
 * стадиями/ценами, униками, порядком асценденси и PoB-ссылками.
 *
 * Дисциплина честности (как radar.ts): неопубликованные цены —
 * «цена не опубликована», ❓-примечания видны, warning-позиции —
 * заметно. Рендер ленивый, по первому клику. Внешних запросов нет.
 */

import { setStatus } from './ui';
import {
  listStarterBuildGuides,
  starterBuildClasses,
  starterBuildGuidesMeta,
  searchStarterBuildGuides,
  type StarterBuildGuide,
  type StarterBuildNameRef,
} from '@poe2-kit/core';

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

function nameRefHtml(r: StarterBuildNameRef): string {
  const name = r.ru ?? r.en ?? '—';
  const other = r.ru && r.en && r.ru !== r.en ? ` <span class="dim">(${esc(r.en)})</span>` : '';
  const note = r.note ? ` <b class="mp-unver" title="${esc(r.note)}">❓ ${esc(r.note)}</b>` : '';
  return `${esc(name)}${other}${note}`;
}

const STAGE_LABEL: Record<'starter' | 'mid' | 'main' | 'max', string> = {
  starter: 'Старт',
  mid: 'Мид',
  main: 'Мейн',
  max: 'Макс',
};

function stagesHtml(b: StarterBuildGuide): string {
  const keys = ['starter', 'mid', 'main', 'max'] as const;
  const rows = keys
    .filter((k) => b.stages?.[k])
    .map((k) => {
      const s = b.stages![k]!;
      const cost = s.cost ? `<b>${esc(s.cost)}</b>` : '<span class="dim">цена не опубликована</span>';
      const rub = s.lootkeeper_rub ? ` <span class="dim" title="₽-прайс витрины услуг lootkeeper (НЕ стоимость гира)">витрина: ${esc(s.lootkeeper_rub)}</span>` : '';
      const note = s.note ? ` <span class="dim">(${esc(s.note)})</span>` : '';
      return `<tr><td>${STAGE_LABEL[k]}</td><td>${cost}${rub}${note}${s.delta ? `<br><span class="dim">${esc(s.delta)}</span>` : ''}</td></tr>`;
    });
  if (!rows.length) return '';
  return `<div class="sim-scroll"><table class="tbl"><thead><tr><th>Стадия</th><th>Цена / что меняется</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function buildCard(b: StarterBuildGuide): string {
  const src = (b.sources ?? [])
    .map((u) =>
      /^https?:/.test(u) ? `<a href="${esc(u)}" target="_blank" rel="noreferrer">источник</a>` : esc(u.split('(')[0].trim()),
    )
    .filter(Boolean)
    .join(' · ');
  const pobs = (b.pob_links ?? [])
    .map((u, i) => (/^https?:/.test(u) ? `<a href="${esc(u)}" target="_blank" rel="noreferrer">PoB ${i + 1}</a>` : esc(u)))
    .join(' · ');
  const ms = b.main_skill;
  const gear = b.gear_tips && Object.keys(b.gear_tips).length
    ? `<p class="note"><b>Гир:</b> ${Object.entries(b.gear_tips).map(([k, v]) => `${esc(k)} — ${esc(v)}`).join('; ')}</p>`
    : '';
  return `<div class="rad-issue">
    <h4>${esc(b.title_ru)}${b.title_en ? ` <span class="dim">(${esc(b.title_en)})</span>` : ''} <span class="dim">(${esc(b.id)})</span></h4>
    <p class="dim">${esc(b.class_ru)}${b.ascendancy_ru || b.ascendancy_en ? ` · ${esc(b.ascendancy_ru ?? b.ascendancy_en)}` : ''} · скилл: ${nameRefHtml(ms)}${ms.gem_level ? ` (гем ур. ${ms.gem_level})` : ''}</p>
    ${b.warning ? `<p class="note"><b style="color:#d05555">⚠ ${esc(b.warning)}</b></p>` : ''}
    ${b.variant_note ? `<p class="note"><b>Вариант:</b> ${esc(b.variant_note)}</p>` : ''}
    ${b.seller_note ? `<p class="note"><b>Продавец:</b> ${esc(b.seller_note)}${b.seller_prices_ru ? ` — ${esc(b.seller_prices_ru)}` : ''}</p>` : ''}
    <p>${esc(b.mechanics_ru)}</p>
    ${b.supports?.length ? `<p class="note"><b>Саппорты:</b> ${b.supports.map(nameRefHtml).join(', ')}</p>` : ''}
    ${b.ascendancy_order?.length ? `<p class="note"><b>Порядок асценденси:</b> ${b.ascendancy_order.map(nameRefHtml).join(' → ')}</p>` : ''}
    ${b.key_uniques?.length ? `<p class="note"><b>Ключевые уники:</b> ${b.key_uniques.map(nameRefHtml).join(', ')}</p>` : ''}
    ${gear}
    ${b.pros?.length ? `<p class="note"><b>Плюсы:</b> ${esc(b.pros.join('; '))}</p>` : ''}
    ${b.cons?.length ? `<p class="note"><b>Минусы:</b> ${esc(b.cons.join('; '))}</p>` : ''}
    ${stagesHtml(b)}
    <p class="dim">${pobs ? `${pobs} · ` : ''}${src}</p>
  </div>`;
}

function renderStarterBuilds(el: HTMLElement, query: string): void {
  const m = starterBuildGuidesMeta();
  const all = query ? searchStarterBuildGuides(query) : listStarterBuildGuides();
  const p: string[] = [];

  p.push(`
    <div class="sim-facts">
      <div class="sim-fact"><b>${esc(m.patch ?? '—')}</b><span>патч · лига ${esc(m.league ?? '—')} · срез ${esc(m.asOf ?? '—')}</span></div>
      <div class="sim-fact"><b>${m.buildsTotal}</b><span>билдов</span></div>
      <div class="sim-fact"><b>${m.withPrices}</b><span>с ценами гайдов</span></div>
      <div class="sim-fact"><b>${m.classesTotal}</b><span>классов</span></div>
      <div class="sim-fact"><b>${m.pobLinksTotal}</b><span>PoB-ссылок</span></div>
    </div>`);

  if (query && !all.length) {
    p.push('<p class="note">Ничего не найдено — попробуй другое слово (мишколь в 1-2 символа игнорируется).</p>');
  }

  for (const cls of starterBuildClasses()) {
    const group = all.filter((b) => b.class_ru === cls.class_ru);
    if (!group.length) continue;
    p.push(`
      <h3 id="sb-${esc(cls.class_ru)}">${esc(cls.class_ru)}${cls.class_en && cls.class_en !== cls.class_ru ? ` <span class="dim">${esc(cls.class_en)}</span>` : ''} (${group.length})</h3>
      ${group.map(buildCard).join('')}`);
  }

  el.innerHTML = p.join('');
}

// ─── Вкладка: init + ленивый рендер + поиск ───────────────────────────────────

export function initStarterBuildsTab(): void {
  let rendered = false;
  const input = document.querySelector<HTMLInputElement>('#starterbuilds-filter');
  const out = () => document.getElementById('out-starterbuilds');

  const render = (q: string): void => {
    const el = out();
    if (el) renderStarterBuilds(el, q.trim());
  };

  document.querySelector('[data-tab="starterbuilds"]')?.addEventListener('click', () => {
    if (rendered) return;
    rendered = true;
    render(input?.value ?? '');
    setStatus('Билды открыты: курируемые стартовые билды 0.5.5, цены — срез гайдов (не Live).');
  });

  input?.addEventListener('input', () => render(input.value));
}
