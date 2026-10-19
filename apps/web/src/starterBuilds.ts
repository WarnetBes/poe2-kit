/**
 * Вкладка «🧬 Билды» (№257 → редизайн-волна №565-UI): курируемые стартовые билды
 * PoE2 0.5.x из ресёрч-волн №471-№477 (lootkeeper/maxroll/poe.ninja).
 *
 * Данные — в @poe2-kit/core (starterBuildGuides.ts, starter_builds.json);
 * здесь — только рендер в стиле «Гайдов» (pg-grid/pg-card2-паттерн):
 *   • карточки-сетка с обложками классов (официальный экспорт GGG, classBgAssets);
 *   • ценовой бейдж на обложке (первая опубликованная стадия) либо честное
 *     «без цен» — дисциплина честности сохранена (№496: ₽-полей нет);
 *   • ⚠-бейдж и красная рамка для фейк-связок/предостережений;
 *   • чип-фильтры: классы (с счётчиками и мини-иконками) + наличие цен;
 *   • аккордеон «Подробнее ▾» (та же делегированная схема, что в Гайдах):
 *     стадии-таблица, уники, гир, асценденси-порядок, PoB-ссылки, источники.
 *
 * Рендер ленивый, поиск локальный, внешних запросов нет.
 */

import { setStatus } from './ui';
import classBgDefault from './classBgAssets';
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
  const note2 = r.note ? ` <b class="mp-unver" title="${esc(r.note)}">❓ ${esc(r.note)}</b>` : '';
  return `${esc(name)}${other}${note2}`;
}

const STAGE_LABEL: Record<'starter' | 'mid' | 'main' | 'max', string> = {
  starter: 'Старт',
  mid: 'Мид',
  main: 'Мейн',
  max: 'Макс',
};
const STAGE_KEYS = ['starter', 'mid', 'main', 'max'] as const;

/** Первая опубликованная цена (для бейджа обложки). */
function firstPrice(b: StarterBuildGuide): { label: string; cost: string } | null {
  for (const k of STAGE_KEYS) {
    const s = b.stages?.[k];
    if (s?.cost) return { label: STAGE_LABEL[k], cost: s.cost };
  }
  return null;
}

function hasPrice(b: StarterBuildGuide): boolean {
  return STAGE_KEYS.some((k) => b.stages?.[k]?.cost);
}

function classBg(en: string | null | undefined): string | undefined {
  if (!en) return undefined;
  const cap = en.charAt(0).toUpperCase() + en.slice(1).toLowerCase();
  return classBgDefault[cap] ?? classBgDefault[en];
}

// ─── Карточка ────────────────────────────────────────────────────────────────

function stagesHtml(b: StarterBuildGuide): string {
  const rows = STAGE_KEYS
    .filter((k) => b.stages?.[k])
    .map((k) => {
      const s = b.stages![k]!;
      const cost = s.cost ? `<b>${esc(s.cost)}</b>` : '<span class="dim">цена не опубликована</span>';
      const note = s.note ? ` <span class="dim">(${esc(s.note)})</span>` : '';
      return `<tr><td>${STAGE_LABEL[k]}</td><td>${cost}${note}${s.delta ? `<br><span class="dim">${esc(s.delta)}</span>` : ''}</td></tr>`;
    });
  if (!rows.length) return '<p class="note dim">Стадии не опубликованы.</p>';
  return `<div class="sim-scroll"><table class="tbl"><thead><tr><th>Стадия</th><th>Цена / что меняется</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function buildCard(b: StarterBuildGuide): string {
  const bg = classBg(b.class_en);
  const price = firstPrice(b);
  const warn = Boolean(b.warning);

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

  // краткая фактура для развёрнутой части
  const details: string[] = [];
  if (b.seller_note) details.push(`<p class="note"><b>Продавец:</b> ${esc(b.seller_note)}${b.seller_prices_ru ? ` — ${esc(b.seller_prices_ru)}` : ''}</p>`);
  if (b.variant_note) details.push(`<p class="note"><b>Вариант:</b> ${esc(b.variant_note)}</p>`);
  if (b.supports?.length) details.push(`<p class="note"><b>Саппорты:</b> ${b.supports.map(nameRefHtml).join(', ')}</p>`);
  if (b.ascendancy_order?.length) details.push(`<p class="note"><b>Порядок асценденси:</b> ${b.ascendancy_order.map(nameRefHtml).join(' → ')}</p>`);
  if (b.key_uniques?.length) details.push(`<p class="note"><b>Ключевые уники:</b> ${b.key_uniques.map(nameRefHtml).join(', ')}</p>`);
  if (gear) details.push(gear);
  if (b.pros?.length) details.push(`<p class="note"><b>Плюсы:</b> ${esc(b.pros.join('; '))}</p>`);
  if (b.cons?.length) details.push(`<p class="note"><b>Минусы:</b> ${esc(b.cons.join('; '))}</p>`);
  details.push(stagesHtml(b));
  if (pobs || src) details.push(`<p class="dim pg-src">${pobs ? `${pobs} · ` : ''}${src}</p>`);

  return `<article class="pg-card2 sb-card${warn ? ' sb-warn' : ''}" data-sbcard>
    <div class="pg-cover" style="${bg ? `background-image:url('${bg}')` : ''}">
      <div class="pg-cover-shade"></div>
      ${b.warning ? `<span class="pg-tier sb-tier-warn" title="${esc(b.warning)}">⚠</span>` : ''}
      <span class="sb-price${price ? '' : ' sb-price-none'}" title="первая опубликованная цена стадии (срез гайдов, не Live)">${price ? `${esc(price.label)} · ${esc(price.cost)}` : 'цены не опубликованы'}</span>
      <h4 title="${esc(b.title_ru)}${b.title_en ? ` (${esc(b.title_en)})` : ''}">${esc(b.title_ru)}</h4>
      <div class="pg-cover-meta"><span class="pg-chip">${esc(b.class_ru)}${b.ascendancy_ru || b.ascendancy_en ? ` · ${esc(b.ascendancy_ru ?? b.ascendancy_en)}` : ''}</span></div>
    </div>
    <div class="pg-body">
      <p class="dim">Скилл: <b>${nameRefHtml(ms)}</b>${ms.gem_level ? ` <span class="dim">(гем ур. ${ms.gem_level})</span>` : ''}</p>
      <p>${esc(b.mechanics_ru)}</p>
      ${b.warning ? `<p class="note"><b style="color:#e0705f">⚠ ${esc(b.warning)}</b></p>` : ''}
      <div class="pg-details">${details.join('')}</div>
      <p class="dim pg-src">${esc(b.id)}${b.title_en ? ` · ${esc(b.title_en)}` : ''}</p>
    </div>
    <button type="button" class="pg-toggle" data-sb-toggle aria-expanded="false">Подробнее ▾</button>
  </article>`;
}

// ─── Фильтры и рендер ────────────────────────────────────────────────────────

interface Filters { query: string; cls: string; price: 'with' | 'wo' | '' }

function localMatch(b: StarterBuildGuide, f: Filters): boolean {
  if (f.cls && b.class_ru !== f.cls) return false;
  if (f.price === 'with' && !hasPrice(b)) return false;
  if (f.price === 'wo' && hasPrice(b)) return false;
  return true;
}

function renderStarterBuilds(el: HTMLElement, f: Filters): void {
  const m = starterBuildGuidesMeta();
  const base = f.query ? searchStarterBuildGuides(f.query) : listStarterBuildGuides();
  const all = base.filter((b) => localMatch(b, f));
  const p: string[] = [];

  p.push(`
    <div class="sim-facts">
      <div class="sim-fact"><b>${esc(m.patch ?? '—')}</b><span>патч · лига ${esc(m.league ?? '—')} · срез ${esc(m.asOf ?? '—')}</span></div>
      <div class="sim-fact"><b>${all.length}</b><span>билдов в выборке${f.query || f.cls || f.price ? ` (из ${m.buildsTotal})` : ''}</span></div>
      <div class="sim-fact"><b>${m.withPrices}</b><span>с ценами гайдов</span></div>
      <div class="sim-fact"><b>${m.pobLinksTotal}</b><span>PoB-ссылок</span></div>
    </div>`);

  if (!all.length) {
    p.push('<p class="note">Ничего не найдено — ослабь фильтры или другой запрос (мишколь в 1-2 символа игнорируется).</p>');
  }

  for (const cls of starterBuildClasses()) {
    const group = all.filter((b) => b.class_ru === cls.class_ru);
    if (!group.length) continue;
    p.push(`
      <h3 id="sb-${esc(cls.class_ru)}">${esc(cls.class_ru)}${cls.class_en && cls.class_en !== cls.class_ru ? ` <span class="dim">${esc(cls.class_en)}</span>` : ''} <span class="dim">(${group.length})</span></h3>
      <div class="pg-grid">${group.map(buildCard).join('')}</div>`);
  }

  el.innerHTML = p.join('');
}

// ─── Вкладка: init + чипы + аккордеон ───────────────────────────────────────

export function initStarterBuildsTab(): void {
  let rendered = false;
  const input = document.querySelector<HTMLInputElement>('#starterbuilds-filter');
  const out = () => document.getElementById('out-starterbuilds');
  const classBar = document.querySelector<HTMLElement>('#starterbuilds-class-chips');
  const priceBar = document.querySelector<HTMLElement>('#starterbuilds-price-chips');

  const state: Filters = { query: '', cls: '', price: '' };

  const chip = (label: string, value: string, count: number, icon = ''): string =>
    `<button type="button" class="pg-chip2${value === '' ? ' pg-chip2-on' : ''}" data-v="${esc(value)}">${icon}${esc(label)}<i>${count}</i></button>`;

  const renderChips = (): void => {
    const all = listStarterBuildGuides();
    if (classBar) {
      classBar.innerHTML =
        chip('Все классы', '', all.length) +
        starterBuildClasses().map((c) => {
          const n = all.filter((b) => b.class_ru === c.class_ru).length;
          const bg = classBg(c.class_en);
          const mini = bg ? `<span class="pg-chip-ico" style="background-image:url('${bg}')"></span>` : '';
          return chip(c.class_ru, c.class_ru, n, mini);
        }).join('');
    }
    if (priceBar) {
      priceBar.innerHTML =
        chip('Все цены', '', all.length) +
        chip('С ценами', 'with', all.filter(hasPrice).length) +
        chip('Без цен', 'wo', all.filter((b) => !hasPrice(b)).length);
    }
  };

  const markChips = (): void => {
    const apply = (bar: HTMLElement | null, key: string) =>
      bar?.querySelectorAll<HTMLButtonElement>('.pg-chip2').forEach((b) => {
        b.classList.toggle('pg-chip2-on', (b.dataset.v ?? '') === key);
      });
    apply(classBar, state.cls);
    apply(priceBar, state.price);
  };

  const doRender = (): void => {
    const el = out();
    if (el) renderStarterBuilds(el, state);
    markChips();
  };

  document.querySelector('[data-tab="starterbuilds"]')?.addEventListener('click', () => {
    if (rendered) return;
    rendered = true;
    renderChips();
    doRender();
    input?.addEventListener('input', () => {
      state.query = input.value.trim();
      doRender();
    });
    for (const [bar, key] of [[classBar, 'cls'], [priceBar, 'price']] as const) {
      bar?.addEventListener('click', (ev) => {
        const b = (ev.target as HTMLElement).closest('.pg-chip2') as HTMLButtonElement | null;
        if (!b) return;
        if (key === 'cls') state.cls = b.dataset.v ?? '';
        else state.price = (b.dataset.v ?? '') as Filters['price'];
        doRender();
      });
    }
    // делегированный аккордеон (та же схема, что в «Гайдах»)
    out()?.addEventListener('click', (ev) => {
      const t = (ev.target as HTMLElement).closest('[data-sb-toggle]') as HTMLButtonElement | null;
      if (!t) return;
      const card = t.closest('[data-sbcard]') as HTMLElement | null;
      const open = card?.classList.toggle('pg-open');
      t.setAttribute('aria-expanded', String(Boolean(open)));
      t.textContent = open ? 'Подробнее ▴' : 'Подробнее ▾';
    });
    setStatus('Билды открыты: курируемые стартовые билды 0.5.5, цены — срез гайдов (не Live). ⚠-карточки — фейк-связки.');
  });
}
