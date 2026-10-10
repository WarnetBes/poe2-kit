/**
 * Вкладка «📖 Слэнг» (№262, Этап 3): словарь игрового слэнга PoE2 в web.
 *
 * Данные — @poe2-kit/core/slang.ts (тот же источник, что вкладка оверлея):
 * 5 секций, RU-объяснения. Ленивый рендер по первому клику, офлайн.
 */
import { setStatus } from './ui';
import { SLANG_SECTIONS, SLANG_GLOSSARY } from '@poe2-kit/core';

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

const SECTION_TITLE: Record<string, string> = Object.fromEntries(SLANG_SECTIONS);

function renderSlang(el: HTMLElement): void {
  const groups = new Map<string, typeof SLANG_GLOSSARY[number][]>();
  for (const row of SLANG_GLOSSARY) {
    const [term, def, sect] = row;
    const arr = groups.get(sect) ?? [];
    arr.push(row);
    groups.set(sect, arr);
  }
  const sections = SLANG_SECTIONS.filter(([id]) => id === 'all' || groups.has(id));
  el.innerHTML = sections
    .map(([id, title]) => {
      const rows =
        id === 'all' ? SLANG_GLOSSARY : (groups.get(id) ?? []);
      return `<details class="craft-acc"${id === 'all' ? ' open' : ''}>
        <summary>${title} (${rows.length})</summary>
        <ul class="mp-mods slang-list">
          ${rows.map(([t, d]) => `<li><b>${esc(t)}</b> — ${esc(d)}</li>`).join('')}
        </ul>
      </details>`;
    })
    .join('');
}

export function initSlangTab(): void {
  let rendered = false;
  document.querySelector('[data-tab="slang"]')?.addEventListener('click', () => {
    if (rendered) return;
    rendered = true;
    const el = document.getElementById('out-slang');
    if (!el) return;
    renderSlang(el);
    setStatus(`Словарь слэнга: ${SLANG_GLOSSARY.length} терминов (общий источник с оверлеем).`);
  });
}
