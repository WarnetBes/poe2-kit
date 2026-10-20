/**
 * Вкладка «📚 Гайды» (poeshop-волна): база билд-гайдов poeshop.ru/blog?game=poe2 —
 * 298 билдов PoE 2 (все классы и асценданси), перенесённая как ФАКТУРА:
 * названия, классы, тиры S/A/B/C, связки скиллов с уровнями/качеством, уники.
 * Прозаические тексты poeshop НЕ копируются — каждую карточку ведёт ссылка
 * на оригинальный гайд (поле url). Датасет — офлайн, запекается при build:
 * packages/core/data/game/guides/poeshop_guides.json → public/datasets/guides/.
 *
 * Рендер ленивый (по первому клику), поиск+фильтры локальные, внешних запросов нет.
 * Тир-лист: видимая часть секций S/A/B/C (полный список — их JS, у нас пометка).
 */

import { setStatus } from './ui';
import { queuePlannerImport } from './planner';
import classBgDefault from './classBgAssets';

// ─── Типы датасета (mirror gen-poeshop-guides.mjs) ───────────────────────────

interface GuideGem { name: string; level: number | null; quality: number | null }
interface GuideSkill { category: string | null; main: string | null; color: string | null; gems: GuideGem[] }
interface GuideUnique { name: string; slug: string }
interface Guide {
  slug: string; url: string; title: string;
  class_en: string | null; asc_en: string | null; asc_ru: string | null;
  date: string | null; read_min: number | null; tier: string | null;
  skills: GuideSkill[]; uniques: GuideUnique[];
}
interface GuidesDataset { _meta: { scraped_at: string; counts?: Record<string, number> }; guides: Guide[] }

type Tier = 'S' | 'A' | 'B' | 'C';

const TIER_RANK: Record<string, number> = { S: 0, A: 1, B: 2, C: 3 };

const CLASS_RU: Record<string, string> = {
  warrior: 'Воин', mercenary: 'Наёмник', witch: 'Ведьма', sorceress: 'Чародейка',
  monk: 'Монах', ranger: 'Охотница', huntress: 'Копейщица', druid: 'Друид',
};

const TIER_LABEL: Record<Tier, string> = {
  S: 'Обязателен', A: 'Отличный выбор', B: 'Рабочий', C: 'Нишевый',
};

// ─── Утилиты ─────────────────────────────────────────────────────────────────

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

function classRu(g: Guide): string {
  return CLASS_RU[g.class_en ?? ''] ?? g.class_en ?? '—';
}

// ─── Загрузка датасета (ленивая, с промис-кэшем) ──────────────────────────────

let dataPromise: Promise<GuidesDataset> | null = null;

function loadGuides(): Promise<GuidesDataset> {
  if (dataPromise) return dataPromise;
  const base = import.meta.env.BASE_URL ?? '/';
  dataPromise = fetch(base + 'datasets/guides/poeshop_guides.json')
    .then((res) => {
      if (!res.ok) throw new Error(`датасет не загружен (HTTP ${res.status})`);
      return res.json() as Promise<GuidesDataset>;
    });
  return dataPromise;
}

// ─── Рендер карточки ─────────────────────────────────────────────────────────

const GEM_COLOR: Record<string, string> = { red: '#d05555', blue: '#5588d0', green: '#55a066' };

function gemChip(gem: GuideGem): string {
  const lvl = gem.level != null ? ` <b>${gem.level}</b>` : '';
  const q = gem.quality != null ? ` <span class="dim">${gem.quality}%</span>` : '';
  return `<span class="pg-gem">${esc(gem.name)}${lvl}${q}</span>`;
}

function skillHtml(s: GuideSkill): string {
  if (!s.category && !s.main && !s.gems.length) return '';
  const main = s.main
    ? `<b class="pg-main" style="color:${GEM_COLOR[s.color ?? ''] ?? 'inherit'}">${esc(s.main)}</b>`
    : '';
  const gems = s.gems.length ? `<div class="pg-gems">${s.gems.map(gemChip).join('')}</div>` : '';
  const cat = s.category ? `<span class="dim"> · ${esc(s.category)}</span>` : '';
  return `<div class="pg-skill">${main}${cat}${gems}</div>`;
}

function tierBadge(tier: string | null): string {
  if (!tier) return '<span class="pg-tier pg-tier-none">—</span>';
  return `<span class="pg-tier pg-tier-${tier}" title="${esc(TIER_LABEL[tier as Tier] ?? '')}">${tier}</span>`;
}

function classBg(en: string | null): string | undefined {
  if (!en) return undefined;
  const cap = en.charAt(0).toUpperCase() + en.slice(1).toLowerCase();
  return classBgDefault[cap] ?? classBgDefault[en];
}

/** Жетон гема в стиле слотов навыков: круг цвета гема с инициалами. */
function gemToken(name: string, color: string | null | undefined): string {
  const c = GEM_COLOR[color ?? ''] ?? 'rgba(140,140,150,.5)';
  const initials = esc((name.replace(/[^\p{L}\p{N} ]/gu, '').match(/\S+/g) ?? [name]).map((w) => w[0]).slice(0, 2).join(''));
  return `<span class="pg-token" style="border-color:${c};background:radial-gradient(circle at 30% 25%, ${c}22, ${c}55 60%, ${c}22)">${initials}</span>`;
}

function cardHtml(g: Guide): string {
  const bg = classBg(g.class_en);
  const skills = g.skills.map(skillHtml).filter(Boolean).join('');
  const uniques = g.uniques.length
    ? `<p class="note"><b>Уники:</b> ${g.uniques.map((u) => esc(u.name)).join(', ')}</p>`
    : '';
  const meta: string[] = [classRu(g)];
  if (g.asc_ru || g.asc_en) meta.push(g.asc_ru ?? g.asc_en ?? '');
  if (g.date) meta.push(g.date);
  // превью-гемы: жетоны main-гемов всех связок
  const tokens = g.skills.map((s) => (s.main ? gemToken(s.main, s.color) : '')).filter(Boolean).join('');
  const mainSkill = g.skills.find((s) => s.category === 'Основной скилл' && s.main)?.main
    ?? g.skills[0]?.main ?? '';
  return `<article class="pg-card2 pg-t2-${esc(g.tier ?? 'none')}" data-pgcard>
    <div class="pg-cover" style="${bg ? `background-image:url('${bg}')` : ''}">
      <div class="pg-cover-shade"></div>
      ${tierBadge(g.tier)}
      <span class="pg-read">${g.read_min ? esc(String(g.read_min)) + ' мин' : ''}</span>
      <h4>${esc(g.title)}</h4>
      <div class="pg-cover-meta"><span class="pg-chip">${esc(classRu(g))}${g.asc_ru || g.asc_en ? ` · ${esc(g.asc_ru ?? g.asc_en ?? '')}` : ''}</span></div>
    </div>
    <div class="pg-body">
      ${tokens ? `<div class="pg-tokens">${tokens}</div>` : ''}
      ${mainSkill ? `<p class="dim">Осн. скилл: <b>${esc(mainSkill)}</b></p>` : '<p class="dim">Связки не разобраны — смотри оригинал.</p>'}
      <div class="pg-details">${skills ? `<div class="pg-skills">${skills}</div>` : ''}${uniques}</div>
      <p class="dim pg-src">Источник: <a href="${esc(g.url)}" target="_blank" rel="noreferrer">poeshop.ru — оригинал гайда</a>${g.date ? ` · ${esc(g.date)}` : ''}</p>
    </div>
    ${skills ? `<button type="button" class="pg-toggle" data-pg-toggle aria-expanded="false">Связки ▾</button>` : ''}
    <button type="button" class="pg-toggle sb-open2plan" data-pg-open="${esc(g.slug)}" title="Гемы связок и уники — в Планнер">→ 🛠 Открыть в Планнере</button>
  </article>`;
}

// ─── Рендер вкладки ──────────────────────────────────────────────────────────

interface Filters { query: string; cls: string; tier: string }

function matches(g: Guide, f: Filters): boolean {
  if (f.cls && g.class_en !== f.cls) return false;
  if (f.tier === 'none') { if (g.tier) return false; }
  else if (f.tier && g.tier !== f.tier) return false;
  if (f.query) {
    const q = f.query.toLowerCase();
    const hay = [g.title, g.asc_en, g.asc_ru, g.class_en, ...g.uniques.map((u) => u.name),
      ...g.skills.flatMap((s) => [s.main ?? '', ...s.gems.map((x) => x.name)])]
      .join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function render(out: HTMLElement, ds: GuidesDataset, f: Filters): void {
  const all = ds.guides;
  const list = all.filter((g) => matches(g, f));
  const tiered = list.filter((g) => g.tier);
  const untiered = list.filter((g) => !g.tier);
  tiered.sort((a, b) =>
    (TIER_RANK[a.tier!] - TIER_RANK[b.tier!]) || String(b.date ?? '').localeCompare(String(a.date ?? ''))
  );
  untiered.sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')) || a.title.localeCompare(b.title));

  const classes = [...new Set(all.map((g) => g.class_en).filter(Boolean))] as string[];
  const counts = { total: all.length, tiered: all.filter((g) => g.tier).length };

  const p: string[] = [];
  if (!list.length) {
    p.push('<p class="note">Ничего не найдено — ослабь фильтры или другой запрос.</p>');
  }

  if (tiered.length) {
    p.push('<h3>Тир-лист S → C</h3>');
    p.push(`<div class="pg-grid">${tiered.map(cardHtml).join('')}</div>`);
  }
  if (untiered.length) {
    p.push(`<h3>Без тира (${untiered.length}) <span class="dim">— полный тир-лист poeshop пря­чется в их JS, видимой части у нас нет</span></h3>`);
    p.push(`<div class="pg-grid">${untiered.map(cardHtml).join('')}</div>`);
  }
  out.innerHTML = p.join('');
}

// ─── Вкладка: init ───────────────────────────────────────────────────────────

export function initPoeguidesTab(): void {
  let rendered = false;
  const btn = document.querySelector<HTMLButtonElement>('[data-tab="poeguides"]');
  const out = () => document.getElementById('out-poeguides');
  const input = document.querySelector<HTMLInputElement>('#poeguides-search');
  const tierBar = document.querySelector<HTMLElement>('#poeguides-tier-chips');
  const classBar = document.querySelector<HTMLElement>('#poeguides-class-chips');

  const state: Filters = { query: '', cls: '', tier: '' };

  // Деревья пассивок гайдов (№582): poeshop RSC code → {a?, n: GGG node ids}.
  // Грузим лениво при первом «→ в Планнер» (один fetch, кэш на сессии).
  let treesBox: Record<string, { a?: string; n: number[]; n1?: number[]; n2?: number[] }> | null = null;
  const ensureTrees = async (): Promise<Record<string, { a?: string; n: number[]; n1?: number[]; n2?: number[] }>> => {
    if (treesBox) return treesBox;
    try {
      const base = import.meta.env.BASE_URL ?? '/';
      const raw = (await (await fetch(base + 'datasets/guides/guide_trees.json')).json()) as { trees?: Record<string, { a?: string; n: number[]; n1?: number[]; n2?: number[] }> };
      treesBox = raw.trees ?? {};
    } catch { treesBox = {}; } // офлайн/нет датасета — дерево гайда просто не переносится
    return treesBox;
  };

  const chip = (label: string, value: string, count: number, icon = ''): string =>
    `<button type="button" class="pg-chip2${'' === value ? ' pg-chip2-on' : ''}" data-v="${esc(value)}">${icon}${esc(label)}<i>${count}</i></button>`;

  const renderChips = (ds: GuidesDataset): void => {
    if (tierBar) {
      const tiers = ['S', 'A', 'B', 'C'] as const;
      tierBar.innerHTML =
        chip('Все тиры', '', ds.guides.length) +
        tiers.map((t) => chip(`Тир ${t}`, t, ds.guides.filter((g) => g.tier === t).length)).join('') +
        chip('Без тира', 'none', ds.guides.filter((g) => !g.tier).length);
    }
    if (classBar) {
      const classes = [...new Set(ds.guides.map((g) => g.class_en).filter(Boolean))] as string[];
      classes.sort((a, b) => ds.guides.filter((g) => g.class_en === b).length - ds.guides.filter((g) => g.class_en === a).length);
      classBar.innerHTML =
        chip('Все классы', '', ds.guides.length) +
        classes.map((c) => {
          const bg = classBg(c);
          const mini = bg ? `<span class="pg-chip-ico" style="background-image:url('${bg}')"></span>` : '';
          return chip(CLASS_RU[c] ?? c, c, ds.guides.filter((g) => g.class_en === c).length, mini);
        }).join('');
    }
  };

  const markChips = (): void => {
    for (const bar of [tierBar, classBar]) {
      const key = bar === tierBar ? state.tier : state.cls;
      bar?.querySelectorAll<HTMLButtonElement>('.pg-chip2').forEach((b) => {
        b.classList.toggle('pg-chip2-on', (b.dataset.v ?? '') === key);
      });
    }
  };

  const doRender = (ds: GuidesDataset): void => {
    const el = out();
    if (el) render(el, ds, state);
    markChips();
  };

  btn?.addEventListener('click', () => {
    if (rendered) return;
    rendered = true;
    loadGuides()
      .then((ds) => {
        renderChips(ds);
        doRender(ds);
        input?.addEventListener('input', () => {
          state.query = input.value.trim();
          doRender(ds);
        });
        for (const bar of [tierBar, classBar]) {
          bar?.addEventListener('click', (ev) => {
            const b = (ev.target as HTMLElement).closest('.pg-chip2') as HTMLButtonElement | null;
            if (!b) return;
            const key = bar === tierBar ? 'tier' : 'cls';
            state[key] = b.dataset.v ?? '';
            doRender(ds);
          });
        }
        // делегированный аккордеон карточек + «→ в Планнер»
        out()?.addEventListener('click', (ev) => {
          const plan = (ev.target as HTMLElement).closest('[data-pg-open]') as HTMLButtonElement | null;
          if (plan) {
            const g = ds.guides.find((x) => x.slug === plan.dataset.pgOpen);
            if (g) {
              // дерево пассивок гайда — грузим лениво (однократный fetch, №582)
              void ensureTrees().then((trees) => {
              const cap = (s: string | null | undefined): string | undefined =>
                s ? s.charAt(0).toUpperCase() + s.slice(1) : undefined;
              const groups = g.skills
                .map((s) => ({
                  gem: (s.main ?? s.gems[0]?.name ?? '').trim(),
                  supports: s.gems.map((x) => x.name.trim()).filter((n) => n && n !== (s.main ?? '')),
                }))
                .filter((x) => x.gem)
                .slice(0, 12);
              // 🧭 план прокачки: уровни взятия гемов из скилл-таблицы гайда (RU-имена)
              const leveling = g.skills
                .flatMap((s) =>
                  (s.gems ?? [])
                    .filter((x) => x.level != null && x.name)
                    .map((x) => ({ level: Number(x.level), name: x.name, cat: s.category ?? undefined })),
                )
                .sort((a, b) => a.level - b.level);
              queuePlannerImport({
                title: g.title,
                class: cap(g.class_en),
                ascendancy: cap(g.asc_en),
                groups,
                uniques: g.uniques.map((u) => u.name),
                leveling,
                // дерево пассивок гайда, если harvested (№582)
                ...(trees[g.slug] ? { tree: trees[g.slug] } : {}),
              });
              });
            }
            return;
          }
          const t = (ev.target as HTMLElement).closest('[data-pg-toggle]') as HTMLButtonElement | null;
          if (!t) return;
          const card = t.closest('[data-pgcard]') as HTMLElement | null;
          const open = card?.classList.toggle('pg-open');
          t.setAttribute('aria-expanded', String(Boolean(open)));
          t.textContent = open ? 'Связки ▴' : 'Связки ▾';
        });
        setStatus('Гайды открыты: база билд-гайдов poeshop.ru (298 карточек), фактура + ссылки на оригиналы.');
      })
      .catch((e: unknown) => {
        const el = out();
        if (el) el.innerHTML = `<p class="note">⚠ Датасет гайдов не загрузился: ${esc(String(e))}</p>`;
      });
  });
}
