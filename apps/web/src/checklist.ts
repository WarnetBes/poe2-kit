/**
 * Интерактивный чек-лист прокачки PoE2 (P2 #16).
 *
 * Зоны актов + квестовые награды — реальные данные из core
 * (core.leveling.getLevelingPlan()). Покупки — гибкий список, который игрок
 * ведёт сам (по умолчанию подсеян минимумом полезного для Ice Strike Monk,
 * всё редактируется/дополняется).
 *
 * Состояние галок хранится в localStorage, ОТДЕЛЬНО под каждую лигу
 * (ключ poe2k:checklist:<league>). Кнопка «Сбросить для новой лиги» очищает
 * текущий бакет — чтобы начать заново на старте нового сезона.
 */

import { core, getActiveLeague } from './ui';

// ── Модель состояния ─────────────────────────────────────────────
interface ChecklistState {
  v: number;
  /** `${act}|${zone}` → true */
  zones: Record<string, boolean>;
  /** `${act}|${zone}|${reward}` → true */
  rewards: Record<string, boolean>;
  /** label → true (и default-, и кастомные) */
  purchases: Record<string, boolean>;
  /** Пометки, которые игрок добавил сам (для кнопки ✕) */
  custom: string[];
}

/** Полезный минимум покупок под Ice Strike Monk (редактируется игроком). */
const DEFAULT_PURCHASES: string[] = [
  'Quarterstaff с высоким физ-уроном и attack speed',
  'Саппорт: Added Cold Damage',
  'Саппорт: Melee Physical',
  'Саппорт: Basic Attack Speed',
  'Herald of Ice (Uncut Spirit Gem)',
  'Слоты с резистами после Акта 2',
];

const STATE_VERSION = 1;
const CHECKLIST_PREFIX = 'poe2k:checklist:';
const LEAGUE_UNKNOWN = 'default';

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

function leagueKey(): string {
  return getActiveLeague() || LEAGUE_UNKNOWN;
}

function storageKey(): string {
  return CHECKLIST_PREFIX + leagueKey();
}

function loadState(): ChecklistState {
  try {
    const raw = localStorage.getItem(storageKey());
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ChecklistState>;
      if (parsed && typeof parsed === 'object' && parsed.v === STATE_VERSION) {
        const st: ChecklistState = {
          v: STATE_VERSION,
          zones: parsed.zones ?? {},
          rewards: parsed.rewards ?? {},
          purchases: parsed.purchases ?? {},
          custom: parsed.custom ?? [],
        };
        seedPurchases(st);
        return st;
      }
    }
  } catch {
    /* повреждённый JSON — начинаем заново */
  }
  const st: ChecklistState = { v: STATE_VERSION, zones: {}, rewards: {}, purchases: {}, custom: [] };
  seedPurchases(st);
  return st;
}

function saveState(st: ChecklistState): void {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(st));
  } catch {
    /* localStorage недоступен — просто не сохраняем */
  }
}

/** Добить отсутствующие default/custom покупки в purchases (для ✕/галок). */
function seedPurchases(st: ChecklistState): void {
  for (const label of DEFAULT_PURCHASES) if (st.purchases[label] === undefined) st.purchases[label] = false;
  for (const label of st.custom) if (st.purchases[label] === undefined) st.purchases[label] = false;
}

/** Очистить галки (не трогая покупки-пометки). */
function clearChecks(st: ChecklistState): void {
  st.zones = {};
  st.rewards = {};
  st.purchases = {};
  seedPurchases(st);
  saveState(st);
}

/** Сброс под новую лигу: выход из текущего бакета. */
function resetForNewLeague(): void {
  try {
    localStorage.removeItem(storageKey());
  } catch {
    /* ignore */
  }
}

// ── Рендер ────────────────────────────────────────────────────────
function render(): HTMLElement {
  const el = document.getElementById('out-checklist');
  if (!el) throw new Error('missing output element out-checklist');
  const st = loadState();
  const plan = core.leveling.getLevelingPlan();

  // Группировка по актам.
  const byAct = new Map<number, typeof plan>();
  for (const z of plan) {
    const arr = byAct.get(z.act) ?? [];
    arr.push(z);
    byAct.set(z.act, arr);
  }

  // Извлекаем все награды с уникальным ключом.
  interface Rw { key: string; zone: string; act: number; reward: string }
  const rewards: Rw[] = [];
  for (const z of plan) {
    for (const rw of z.rewards ?? []) {
      const key = `${z.act}|${z.zone}|${rw}`;
      rewards.push({ key, zone: z.zone, act: z.act, reward: rw });
    }
  }

  const totalZones = plan.length;
  const doneZones = plan.filter((z) => st.zones[`${z.act}|${z.zone}`]).length;
  const totalRewards = rewards.length;
  const doneRewards = rewards.filter((r) => st.rewards[r.key]).length;
  const purchaseLabels = [...DEFAULT_PURCHASES, ...st.custom];
  const totalPurchases = purchaseLabels.length;
  const donePurchases = purchaseLabels.filter((p) => st.purchases[p]).length;

  const actBlocks: string[] = [];
  for (const [act, zones] of byAct) {
    const actDoneZones = zones.filter((z) => st.zones[`${act}|${z.zone}`]).length;
    const actRewards = rewards.filter((r) => r.act === act);
    const actDoneRewards = actRewards.filter((r) => st.rewards[r.key]).length;

    const zoneRows = zones
      .map((z) => {
        const k = `${act}|${z.zone}`;
        const checked = !!st.zones[k];
        const zRewards = (z.rewards ?? []).join('; ');
        return (
          `<label class="ck-row ck-zone ${checked ? 'done' : ''}">` +
          `<input type="checkbox" data-typ="zone" data-key="${esc(k)}" ${checked ? 'checked' : ''}>` +
          `<span class="ck-box"></span>` +
          `<span class="ck-txt"><b>${esc(z.zone)}</b> <span class="dim">(ур. ${z.monsterLevel})</span>` +
          (z.hasWaypoint ? ` <span class="wp" title="Есть вайпоинт">⚑</span>` : '') +
          (zRewards ? ` <span class="reward">🏆 ${esc(zRewards)}</span>` : '') +
          `</span></label>`
        );
      })
      .join('');

    const rewardRows = actRewards
      .map((r) => {
        const checked = !!st.rewards[r.key];
        return (
          `<label class="ck-row ck-reward ${checked ? 'done' : ''}">` +
          `<input type="checkbox" data-typ="reward" data-key="${esc(r.key)}" ${checked ? 'checked' : ''}>` +
          `<span class="ck-box"></span>` +
          `<span class="ck-txt"><span class="dim">в ${esc(r.zone)}:</span> <b>${esc(r.reward)}</b></span></label>`
        );
      })
      .join('');

    actBlocks.push(
      `<div class="ck-act">` +
        `<div class="ck-acthead"><h3>${esc(zones[0]?.actName ?? `Акт ${act}`)}</h3>` +
        `<span class="ck-progress">зоны ${actDoneZones}/${zones.length} · награды ${actDoneRewards}/${actRewards.length}</span></div>` +
        (zoneRows ? `<ul class="ck-list">${zoneRows}</ul>` : '') +
        (rewardRows ? `<ul class="ck-list ck-rewards">${rewardRows}</ul>` : '') +
        `</div>`,
    );
  }

  const purchaseRows = purchaseLabels
    .map((p) => {
      const checked = !!st.purchases[p];
      const isCustom = st.custom.includes(p);
      return (
        `<label class="ck-row ck-purchase ${checked ? 'done' : ''}">` +
        `<input type="checkbox" data-typ="purchase" data-key="${esc(p)}" ${checked ? 'checked' : ''}>` +
        `<span class="ck-box"></span>` +
        `<span class="ck-txt">${esc(p)}</span>` +
        (isCustom ? `<button type="button" class="ck-remove" data-key="${esc(p)}" title="Удалить">✕</button>` : '') +
        `</label>`
      );
    })
    .join('');

  const header = [
    `<div class="ck-head">`,
    `<div><span class="ck-title">Чек-лист прокачки</span> <span class="dim">· лига «${esc(leagueKey())}»</span></div>`,
    `<div class="ck-total">✅ зоны ${doneZones}/${totalZones} · 🏆 награды ${doneRewards}/${totalRewards} · 🛒 покупки ${donePurchases}/${totalPurchases}</div>`,
    `<div class="ck-actions">`,
    `<button type="button" class="ghost mini" data-act="uncheck">Снять все галки</button>`,
    `<button type="button" class="ghost mini danger" data-act="reset">Сбросить для новой лиги</button>`,
    `</div>`,
    `</div>`,
  ].join('');

  const purchasesBlock =
    `<div class="ck-act">` +
    `<div class="ck-acthead"><h3>🛒 Покупки и цели</h3>` +
    `<span class="ck-progress">${donePurchases}/${totalPurchases}</span></div>` +
    `<ul class="ck-list">${purchaseRows}</ul>` +
    `<div class="ck-add">` +
    `<input id="ck-purchase-input" type="text" placeholder="Добавить покупку/цель…">` +
    `<button type="button" class="ghost" data-act="add" id="ck-purchase-add">+ Добавить</button>` +
    `</div></div>`;

  el.innerHTML = header + actBlocks.join('') + purchasesBlock +
    `<p class="note">Чек-лист сохраняется в браузере отдельно для каждой лиги. «Новая лига» — очистить текущий список на старте сезона.</p>`;
  return el;
}

// ── Обработчики (делегирование; контейнер живёт, меняется только innerHTML) ──
function onContainerClick(e: Event): void {
  const target = e.target as HTMLElement;
  const checkbox = target.closest<HTMLInputElement>('input[type="checkbox"]');
  if (checkbox) {
    const typ = checkbox.dataset.typ;
    const key = checkbox.dataset.key ?? '';
    if (typ && key !== undefined) {
      const st = loadState();
      if (typ === 'zone') st.zones[key] = checkbox.checked;
      else if (typ === 'reward') st.rewards[key] = checkbox.checked;
      else if (typ === 'purchase') st.purchases[key] = checkbox.checked;
      saveState(st);
      render(); // перерисуем, чтобы обновить счётчики прогресса
    }
    return;
  }
  const removeBtn = target.closest<HTMLButtonElement>('button.ck-remove');
  if (removeBtn && removeBtn.dataset.key !== undefined) {
    const st = loadState();
    const key = removeBtn.dataset.key;
    delete st.purchases[key];
    st.custom = st.custom.filter((c) => c !== key);
    saveState(st);
    render();
    return;
  }
  const addBtn = target.closest<HTMLButtonElement>('[data-act="add"]');
  if (addBtn) {
    addPurchase();
    return;
  }
  const action = target.closest<HTMLButtonElement>('[data-act]');
  if (action) {
    const act = action.dataset.act;
    if (act === 'uncheck') {
      const st = loadState();
      clearChecks(st);
      render();
    } else if (act === 'reset') {
      resetForNewLeague();
      render();
    }
  }
}

function onContainerKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter') {
    const input = e.target as HTMLInputElement;
    if (input && input.id === 'ck-purchase-input') {
      e.preventDefault();
      addPurchase();
    }
  }
}

function addPurchase(): void {
  const input = document.getElementById('ck-purchase-input') as HTMLInputElement | null;
  const label = (input?.value ?? '').trim();
  if (!label) return;
  const st = loadState();
  if (st.purchases[label] === undefined) st.custom.push(label);
  st.purchases[label] = false;
  saveState(st);
  render();
}

let bound = false;

/** Показать чек-лист (вызывается при открытии вкладки «Чек-лист»). */
export function showChecklist(): void {
  if (!bound) bind();
  render();
}

/** Подключить делегированные обработчики один раз. */
function bind(): void {
  bound = true;
  const el = document.getElementById('out-checklist');
  el?.addEventListener('click', onContainerClick);
  el?.addEventListener('keydown', onContainerKeydown);
}