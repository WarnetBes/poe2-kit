/**
 * Поиск узлов дерева пассивок (вкладка «Карта»).
 *
 * ИНДЕКС: строится из уже загруженного layout (nodes fullMap) — отдельной
 * загрузки данных НЕТ. id узла layout ≡ числовой GGG skill id (проверено
 * в fullMap: PoB Spec nodes 148/148 ≡ GGG, см. applySvgBuild).
 *
 * UI: input в панели .tree-top + дропдаун совпадений (имя + тип, asc-ветка).
 * '/' — фокус в поле (конфликтов hotkey нет: grep addEventListener('key') = только Escape).
 *
 * Фокус результата:
 *  - SVG-режим: центровка через deps.focusSvg(x,y) (пан/зум fullMap) + класс .mfocus.
 *  - WebGL-режим: deps.focusGame(skill) → GameHandle.focusNode (mount.ts →
 *    TreeView prop `focus` WorldRect) + `highlight` teal-кольцо — реальные
 *    API tree-react, без выдумок. Mastery/спрятанные — только пометка и кольцо.
 */
import type { Node as FullMapNode } from './fullMap';

export interface TreeSearchDeps {
  /** Центрировать SVG-вид на мировых координатах узла (лёгкий режим). */
  focusSvg: (x: number, y: number) => void;
  /** Пометить SVG-узел (класс .mfocus) по строковому id. */
  markSvg: (id: string) => void;
  /** true, если WebGL-вид сейчас смонтирован (фокус уйдёт в TreeView). */
  gameActive: () => boolean;
  /** Центрировать WebGL-вид на узле; false = узла нет в сцене / вид не смонтирован. */
  focusGame: (skill: number) => boolean;
  /** Teal-кольца в WebGL-виде на наборе узлов (или null — снять). */
  gameHighlight: (skills: number[] | null) => void;
  /** Показать имя узла в карточке (`.tree-detail`), как клик по нему. */
  showInfo: (id: string) => void;
  /** isMastery из экспорта GGG (только в WebGL-данных; без них false). */
  masteryOf: (skill: number) => boolean;
}

interface Hit {
  id: string;
  skill: number;
  name: string;
  nameLower: string;
  x: number;
  y: number;
  isKeystone: boolean;
  isNotable: boolean;
  ascendancy: string;
  /** 0 = имя начинается с запроса, 1 = вхождение в середину (ранжирование). */
  rank: number;
  /** Заполняется при выводе: keystone/notable/mastery/asc/обычный. */
  type: string;
}

const MAX_RESULTS = 30;

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

const typeOf = (h: Hit, mastery: boolean): string => {
  if (mastery) return 'mastery';
  if (h.isKeystone) return 'keystone';
  if (h.isNotable) return 'notable';
  if (h.ascendancy) return `asc: ${h.ascendancy}`;
  return 'обычный';
};

/**
 * Смонтировать поиск: input + дропдаун в панель .tree-top; hotkey '/'.
 * Вызывать один раз после полной разметки карты (из renderFullMap).
 */
export function initTreeSearch(top: HTMLElement, nodes: FullMapNode[], deps: TreeSearchDeps): void {
  const wrap = document.createElement('div');
  wrap.className = 'tree-search';
  wrap.innerHTML = `
    <input class="tree-search-input" type="text" placeholder="поиск узла… (/)" autocomplete="off" spellcheck="false">
    <div class="tree-search-drop" hidden></div>`;
  top.appendChild(wrap);
  const input = wrap.querySelector<HTMLInputElement>('.tree-search-input')!;
  const drop = wrap.querySelector<HTMLElement>('.tree-search-drop')!;

  // Индекс: только узлы с именами (структурные пустышки не ищем).
  const idx: Hit[] = [];
  for (const n of nodes) {
    if (!n.name) continue;
    idx.push({
      id: n.id,
      skill: Number(n.id),
      name: n.name,
      nameLower: n.name.toLowerCase(),
      x: n.x,
      y: n.y,
      isKeystone: n.isKeystone,
      isNotable: n.isNotable,
      ascendancy: n.ascendancy,
      rank: 0,
      type: '',
    });
  }
  const byId = new Map(idx.map((h) => [h.id, h] as const));

  const hideDrop = (): void => {
    drop.hidden = true;
    drop.innerHTML = '';
  };

  const focusHit = (h: Hit, mastery: boolean): void => {
    deps.gameHighlight([h.skill]); // teal-кольцо в WebGL (проп highlight)
    deps.showInfo(h.id); // карточка узла — как при клике по нему
    if (deps.gameActive()) {
      const ok = mastery ? false : deps.focusGame(h.skill);
      if (!ok) {
        drop.hidden = false;
        drop.innerHTML = `<div class="tree-search-note">фокус: ${esc(h.name)} — подсвечено кольцом; центровки нет (mastery/узел вне сцены)</div>`;
        return;
      }
    } else {
      deps.markSvg(h.id);
      deps.focusSvg(h.x, h.y);
    }
  };

  const search = (qRaw: string): void => {
    const q = qRaw.trim().toLowerCase();
    if (!q) {
      hideDrop();
      return;
    }
    const masteryCache = new Map<number, boolean>();
    const masteryOf = (skill: number): boolean => {
      let m = masteryCache.get(skill);
      if (m === undefined) {
        m = deps.masteryOf(skill);
        masteryCache.set(skill, m);
      }
      return m;
    };
    const hits: Hit[] = [];
    for (const h of idx) {
      const pos = h.nameLower.indexOf(q);
      if (pos < 0) continue;
      h.rank = pos === 0 ? 0 : 1;
      h.type = typeOf(h, masteryOf(h.skill));
      hits.push(h);
    }
    hits.sort((a, b) => a.rank - b.rank || a.name.length - b.name.length || a.nameLower.localeCompare(b.nameLower));
    const shown = hits.slice(0, MAX_RESULTS);
    if (!shown.length) {
      drop.hidden = false;
      drop.innerHTML = '<div class="tree-search-note">ничего не найдено</div>';
      return;
    }
    const extra = hits.length > shown.length ? `<div class="tree-search-note">…и ещё ${hits.length - shown.length}</div>` : '';
    drop.hidden = false;
    drop.innerHTML =
      shown
        .map(
          (h) => `
      <button type="button" class="tree-search-item" data-id="${esc(h.id)}">
        <span class="tree-search-name">${esc(h.name)}</span>
        <span class="tree-search-type">${esc(h.type)}</span>
      </button>`,
        )
        .join('') + extra;
  };

  input.addEventListener('input', () => search(input.value));
  input.addEventListener('focus', () => search(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.blur();
      hideDrop();
    }
  });
  wrap.addEventListener('focusout', (e) => {
    // Закрывать только когда фокус ушёл из поиска целиком.
    if (!wrap.contains(e.relatedTarget as Node | null)) hideDrop();
  });
  drop.addEventListener('mousedown', (e) => {
    // mousedown с preventDefault: фокус в input не теряется до выбора пункта.
    e.preventDefault();
    const btn = (e.target as Element).closest<HTMLElement>('.tree-search-item');
    if (!btn) return;
    const h = byId.get(btn.dataset.id ?? '');
    if (!h) return;
    focusHit(h, h.type === 'mastery');
  });

  // '/' — фокус в поле поиска (когда вкладка «Карта» видима и каретка не в поле).
  // Точка перед «/» на русской раскладке — тоже пускаем (code KeySlash).
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' && e.code !== 'Slash') return;
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    if (!top.offsetParent) return; // вкладка скрыта
    if (e.ctrlKey || e.metaKey || e.altKey) return; // чужие хоткеи не трогаем
    e.preventDefault();
    input.focus();
    input.select();
  });
}
