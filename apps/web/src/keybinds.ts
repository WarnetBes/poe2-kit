/**
 * Вкладка «Раскладка» (№221): советчик биндов навыков под геймпад (Xbox/PS)
 * и клавиатуру по билду PoB. Ядро — core.keybinds (переносимо в overlay/MCP).
 */
import { core, setStatus } from './ui';
import type { KeybindAdvice, KeybindPlatform, KeybindMovementMode, KeybindRole, KeybindSlot } from '@poe2-kit/core';
import { visualBlock } from './keybindsVisual';

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

const ROLE_LABEL: Record<string, string> = {
  primary: 'основной',
  secondary: 'частый',
  burst: 'редкий/burst',
  movement: 'движение',
  buff: 'баф',
  curse: 'курс/марка',
  aura: 'резервация',
  unknown: 'не распознан',
  system: 'система',
  free: 'свободно',
};

function slotCard(s: KeybindSlot, opts: { dim?: boolean } = {}): string {
  const badge = s.unverified ? ' <span class="kb-unver" title="' + esc(s.unverified) + '">⚠️</span>' : '';
  const sub = s.role === 'system'
    ? `<span class="kb-gem">${esc(s.system ?? '')}${badge}</span>`
    : s.role === 'free'
      ? '<span class="kb-gem kb-free-slot">—</span>'
      : `<span class="kb-gem">${esc(s.gem ?? '')}${badge}</span>`;
  const role = ROLE_LABEL[s.role] ?? s.role;
  return `<div class="kbkey${opts.dim ? ' kb-dim' : ''}${s.role === 'primary' ? ' kb-primary' : ''}${s.role === 'system' ? ' kb-system' : ''}">
    <div class="kb-slot">${esc(s.slot)}${s.ps ? `<span class="kb-ps">${esc(s.ps)}</span>` : ''}</div>
    ${sub}
    <span class="kb-role">${role}</span>
    <span class="kb-why">${esc(s.reason)}</span>
  </div>`;
}

function adviceBlock(a: KeybindAdvice): string {
  const parts: string[] = [];
  parts.push(`<h4>Боевые слоты (${a.assignments.length})</h4><div class="kbgrid">${a.assignments.map((s) => slotCard(s)).join('')}</div>`);
  if (a.system.length) {
    parts.push(`<h4>Системные — не перебивать (${a.system.length})</h4><div class="kbgrid">${a.system.map((s) => slotCard(s, { dim: true })).join('')}</div>`);
  }
  if (a.free.length) {
    parts.push(`<p class="kb-note">Свободных слотов в шаблоне: <b>${a.free.length}</b> — запас под рост билда${a.platform !== 'keyboard' ? ` (всего у геймпада PoE2 бинд-слотов: ${a.totalSlots})` : ''}.</p>`);
  }
  if (a.spirit.length) {
    const rows = a.spirit
      .map((s) => `<li><b>${esc(s.gem)}</b>${s.spiritCost != null ? ` <span class="kb-spirit">−${s.spiritCost} Spirit</span>` : ''} — ${esc(s.note)}</li>`)
      .join('');
    parts.push(`<h4>Spirit-блок — НЕ биндить (${a.spirit.length})</h4><ul class="kb-spirit-list">${rows}</ul>`);
  }
  if (a.unassigned.length) {
    parts.push(`<p class="kb-note err">Без слота (укажи вручную): ${a.unassigned.map(esc).join(', ')}.</p>`);
  }
  parts.push('<h4>Как выставить в игре</h4><ol class="kb-manual">' + a.manual.map((m) => `<li>${esc(m)}</li>`).join('') + '</ol>');
  if (a.unverifiedNotes.length) {
    parts.push(
      '<details class="kb-unver-box"><summary>⚠️ Не сверено с игрой (' + a.unverifiedNotes.length + ')</summary><ul>' +
        a.unverifiedNotes.map((n) => `<li>${esc(n)}</li>`).join('') +
        '</ul></details>',
    );
  }
  return parts.join('');
}

/** Ленивая загрузка датасетов (№222/№223): полная копия офлайн-датасета гемов
 *  (теги HasReservation/Cooldown/Spirit-cost) + компактная карта стихий камней
 *  (gem_colors: раскраска кнопок схем контроллера) из public/datasets/.
 *  Идемпотентно: повторные вызовы ждут того же промиса. */
let datasetPromise: Promise<void> | null = null;

function fetchJson(url: string): Promise<unknown> {
  return fetch(url).then((res) => {
    if (!res.ok) throw new Error(`датасет не загружен (${url}: HTTP ${res.status})`);
    return res.json();
  });
}

function ensureBrowserDataset(): Promise<void> {
  if (datasetPromise) return datasetPromise;
  const base = import.meta.env.BASE_URL ?? '/';
  datasetPromise = (async () => {
    const [gems, colors] = await Promise.all([
      fetchJson(base + 'datasets/skill_gems_v2.json'),
      fetchJson(base + 'datasets/gem_colors.json'),
    ]);
    core.dataset.installBrowserDataset('skill_gems/skill_gems_v2.json', gems);
    core.dataset.installBrowserDataset('skill_gems/gem_colors.json', colors);
  })().catch((e: unknown) => {
    datasetPromise = null; // не держим отвергнутый промис — следующий клик ретраит
    throw e;
  }) as Promise<void>;
  return datasetPromise;
}

export async function showKeybinds(code: string, platform: KeybindPlatform, movementMode: KeybindMovementMode, overrides?: Partial<Record<string, KeybindRole>>): Promise<void> {
  const el = document.getElementById('out-keybinds');
  if (!el) throw new Error('missing #out-keybinds');
  if (!code?.trim()) {
    el.innerHTML = '<p class="err">Вставь share-код PoB (или возьми из последнего разобранного билда).</p>';
    return;
  }
  el.innerHTML = '<em>Декодирование билда…</em>';
  setStatus('Строю раскладку…');
  try {
    await ensureBrowserDataset();
    const xml = await core.build.toXml(code.trim());
    const b = await core.build.importBuild(xml);
    if (!b.skillGroups?.length) {
      el.innerHTML = '<p class="err">В билде нет групп навыков (&lt;Skill&gt;) — нужен PoB2-экспорт со скиллами.</p>';
      return;
    }
    const advice = core.keybinds.adviseKeybinds(b, { platform, movement_mode: movementMode, overrides });
    el.innerHTML =
      `<p class="kb-head">🎮 <b>${esc(b.class ?? '?')}${b.ascendancy ? ` / ${esc(b.ascendancy)}` : ''}</b>` +
      ` · платформа: <b>${esc(platform === 'keyboard' ? 'клавиатура' : platform === 'playstation' ? 'PlayStation' : 'Xbox')}</b>` +
      (platform === 'keyboard' ? ` · режим: ${movementMode === 'wasd' ? 'WASD' : 'клик-мув'}` : '') +
      (platform === 'keyboard' ? ' · хотбар LMB/RMB/Q-W-E-R-T' : ' · шаблон: L2-модификатор + советы GGG (22 слота)') + '</p>' +
      visualBlock(advice) +
      adviceBlock(advice);
    setStatus('Раскладка готова.');
  } catch (e) {
    el.innerHTML = `<p class="err">Ошибка: ${esc(e instanceof Error ? e.message : String(e))}</p>`;
    setStatus('Ошибка раскладки.');
  }
}

/** Клик по кнопке «Построить раскладку» в main.ts. */
export function keybindsFromInputs(): void {
  const code = (document.querySelector('#keybinds-input') as HTMLTextAreaElement)?.value ?? '';
  const platform = (<HTMLSelectElement>document.querySelector('#keybinds-platform'))?.value as KeybindPlatform ?? 'xbox';
  const mode = (<HTMLSelectElement>document.querySelector('#keybinds-mode'))?.value as KeybindMovementMode ?? 'wasd';
  void showKeybinds(code, platform, mode);
}

/** «Из последнего билда»: подставляет код из «Импорта билда» (или localStorage). */
export function keybindsFromLastBuild(): void {
  const ta = document.querySelector('#keybinds-input') as HTMLTextAreaElement | null;
  const buildInput = (document.querySelector('#build-input') as HTMLTextAreaElement)?.value ?? '';
  if (buildInput.trim()) {
    if (ta) ta.value = buildInput;
  } else {
    try {
      const saved = localStorage.getItem('poe2k.lastBuild');
      if (saved && ta) {
        // lastBuild — разобранный JSON без исходного кода; честно просим код.
        el_warn_noCode();
        return;
      }
    } catch { /* ignore */ }
  }
  keybindsFromInputs();
}

function el_warn_noCode(): void {
  const el = document.getElementById('out-keybinds');
  if (el) el.innerHTML = '<p class="err">Вкладка «Импорт билда» хранит разбор, но не исходный код — вставь share-код PoB в поле выше.</p>';
  setStatus('Нужен share-код PoB.');
}
