/**
 * Вкладка «🔨 Крафт» (№262, Этап 1): перенос крафтового блока оверлея в web.
 *
 * Данные и логика — только из @poe2-kit/core (craftGuide.ts / parse.ts):
 * тот же источник питает вкладку «Крафт» оверлея и MCP-гайд №126/№130.
 * Здесь — только рендер. Дисциплина честности: ru-имена эссенций могут быть
 * null (неверифицированные) — показываем EN, без выдумывания.
 *
 * Персональный план: Ctrl+C по предмету в игре → поле/«Из буфера» →
 * parseItemText → craftPlan (методология «двух якорей», база знаний §6).
 * Waystone-плитки уводятся в waystoneCraftPlan самим craftPlan (№130).
 */
import { setStatus } from './ui';
import {
  CRAFT_RECIPES,
  CRAFT_ESSENCES,
  CRAFT_SPEC_ESSENCES,
  CRAFT_ALLOYS,
  CRAFT_PERFECT_ESSENCES_HINT,
  CRAFT_OMENS,
  craftPlan,
  essenceSuggestions,
  parseItemText,
  itemDisplayName,
  resolveModTiers,
  tiersBadgeText,
} from '@poe2-kit/core';

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

/** Похоже ли на текст предмета PoE2 (минимальный гейт как в оверлее main.ts). */
function looksLikeItemText(text: string): boolean {
  return /Rarity:|Редкость:|--------/.test(text.trim());
}

// ── Каталоги (статические, из core) ─────────────────────────────────────────

function renderRecipes(): string {
  const bySystem = new Map<string, typeof CRAFT_RECIPES>();
  for (const r of CRAFT_RECIPES) {
    const arr = bySystem.get(r.system) ?? [];
    arr.push(r);
    bySystem.set(r.system, arr);
  }
  const sysNames: Record<string, string> = {
    currency: '💵 Валюта', essence: '✨ Эссенции', omen: '🔮 Омены', rune: '🔻 Руны',
    quality: '📐 Качество', bench: '🛠 Верстак', desecration: '☠ Desecrate',
    special: '⭐ Особые', waystone: '🗺 Waystone',
  };
  return `<details class="craft-acc"><summary>📖 Каталог рецептов (${CRAFT_RECIPES.length})</summary>
    ${[...bySystem.entries()]
      .map(
        ([sys, list]) => `<h4 class="craft-sys">${sysNames[sys] ?? sys} <span class="dim">(${list.length})</span></h4>
        <ul class="mp-mods">
          ${list
            .map(
              (r) =>
                `<li><b>${esc(r.name)}</b> — ${esc(r.recipe)}${r.ssfNote ? ` <span class="dim">SSF: ${esc(r.ssfNote)}</span>` : ''}</li>`,
            )
            .join('')}
        </ul>`,
      )
      .join('')}
  </details>`;
}

function renderEssenceTable(): string {
  return `<details class="craft-acc"><summary>✨ Эссенции (${CRAFT_ESSENCES.length}) и Спец-эссенции (${CRAFT_SPEC_ESSENCES.length})</summary>
    <div class="sim-scroll"><table class="tbl">
      <thead><tr><th>Эссенция</th><th>Гарантированный мод</th><th>Perfect-версия</th></tr></thead>
      <tbody>
        ${CRAFT_ESSENCES.map(
          (e) =>
            `<tr><td><b>${esc(e.en)}</b>${e.ru ? ` <span class="dim">/ ${esc(e.ru)}</span>` : ''}</td>
             <td>${esc(e.guaranteed)}</td><td>${esc(e.perfect ?? '—')}</td></tr>`,
        ).join('')}
        ${CRAFT_SPEC_ESSENCES.map(
          (e) => `<tr><td><b>${esc(e.en)}</b> <span class="dim">spec</span></td><td colspan="2">${esc(e.perSlot)}</td></tr>`,
        ).join('')}
      </tbody>
    </table></div>
    <p class="note">${esc(CRAFT_PERFECT_ESSENCES_HINT)}</p>
  </details>`;
}

function renderPriceCatalog(): string {
  const alloys = CRAFT_ALLOYS.map((a) => `<li><b>${esc(a.en)}</b> — ${esc(a.perSlot)}</li>`).join('');
  const omens = CRAFT_OMENS.map(
    (o) => `<li><b>${esc(o.en)}</b> — ${esc(o.purpose)}${o.drop ? ` <span class="dim">(${esc(o.drop)})</span>` : ''}</li>`,
  ).join('');
  return `<details class="craft-acc"><summary>🥇 Сплавы (${CRAFT_ALLOYS.length}) и 🔮 Омены (${CRAFT_OMENS.length})</summary>
    <h4 class="craft-sys">Сплавы</h4><ul class="mp-mods">${alloys || '<li>—</li>'}</ul>
    <h4 class="craft-sys">Омены</h4><ul class="mp-mods">${omens || '<li>—</li>'}</ul>
  </details>`;
}

// ── Персональный план по предмету ───────────────────────────────────────────

async function runCraftPlan(text: string): Promise<void> {
  const el = document.getElementById('out-craft')!;
  const trimmed = text.trim();
  if (!looksLikeItemText(trimmed)) {
    el.innerHTML =
      '<p class="err">Это не похоже на предмет PoE2. Наведи на предмет в игре → Ctrl+C → вставь в поле выше (или нажми «Из буфера»).</p>';
    return;
  }
  try {
    const parsed = parseItemText(trimmed);
    const name = itemDisplayName(parsed) || parsed.baseType || 'предмет';
    const plan = craftPlan({
      itemClass: parsed.itemClass,
      baseType: parsed.baseType,
      itemLevel: parsed.itemLevel,
      rarity: parsed.rarity,
      parsed,
    });
    const ess = essenceSuggestions(parsed.itemClass, parsed.baseType);
    // Тир-досье по RePoE (№ P2/W1): тир каждого мода, совершенство ролла, свободные слоты.
    let dossierHtml = '';
    try {
      const d = await resolveModTiers(trimmed);
      if (d.modTiers.length || d.unmatchedExplicits.length) {
        dossierHtml = `<h4>📋 Тир-досье (RePoE)</h4>
          <p class="hint">Префиксы ${d.prefixCount}/${d.maxPrefixes} (свободно ${Math.max(0, d.openPrefix)}), суффиксы ${d.suffixCount}/${d.maxSuffixes} (свободно ${Math.max(0, d.openSuffix)}).</p>
          <ul class="mp-mods">
            ${d.modTiers.map((m) => {
              const roll = m.rollPct === null ? '' : ` · ролл ${Math.round(m.rollPct)}%`;
              return `<li><b>${tiersBadgeText(m)}</b> <span class="dim">(${esc(m.affixName)}, ${esc(m.prefixSuffix)})</span> ${esc(m.modText)}${roll}</li>`;
            }).join('')}
            ${d.unmatchedExplicits.map((u) => `<li class="dim">${esc(u)} — тир не найден (unique/гибрид)</li>`).join('')}
          </ul>`;
      }
    } catch { /* досье опционально: без него план всё равно валиден */ }
    el.innerHTML = `
      <h3>🧾 План для «${esc(name)}» <span class="dim">(${esc(parsed.itemClass)}, ilvl ${parsed.itemLevel ?? '?'}, ${esc(parsed.rarity)})</span></h3>
      ${dossierHtml}
      <ol class="sim-steps">
        ${plan.map((s) => `<li><b>${esc(s.step)}</b><br>${esc(s.detail)}</li>`).join('')}
      </ol>
      ${ess.length ? `<h4>✨ Эссенции под этот слот</h4><ul class="mp-mods">${ess.map((e) => `<li><b>${esc(e.en)}</b>${e.ru ? ` <span class="dim">/ ${esc(e.ru)}</span>` : ''} — ${esc(e.guaranteed)}</li>`).join('')}</ul>` : ''}
      <p class="note">Методология «двух якорей» (база знаний §6). Планы — эвристические, сверяй с игрой.</p>
      ${renderRecipes()}${renderEssenceTable()}${renderPriceCatalog()}`;
    setStatus(`План крафта для «${name}»: ${plan.length} шагов.`);
  } catch (e) {
    el.innerHTML = `<p class="err">Не удалось разобрать предмет: ${esc(e instanceof Error ? e.message : String(e))}</p>`;
  }
}

// ─── Вкладка: init + ленивый рендер каталога ─────────────────────────────────

export function initCraftTab(): void {
  let rendered = false;
  const CRAFT_LS = 'poe2k.craftItem';
  const ta = document.querySelector('#craft-item-input') as HTMLTextAreaElement | null;
  // персональный предмет переживает перезагрузку (вкладка была единственной без LS)
  if (ta) {
    try { ta.value = localStorage.getItem(CRAFT_LS) ?? ''; } catch { /* ignore */ }
    ta.addEventListener('input', () => {
      try {
        if (ta.value.trim()) localStorage.setItem(CRAFT_LS, ta.value);
        else localStorage.removeItem(CRAFT_LS);
      } catch { /* quota — молча */ }
    });
  }

  document.querySelector('#btn-craft-plan')?.addEventListener('click', () => {
    if (!rendered) {
      rendered = true;
      // Каталог показываем сразу: план перепишет зону каталога целиком (внутри out-craft).
    }
    const ta = document.querySelector('#craft-item-input') as HTMLTextAreaElement | null;
    void runCraftPlan(ta?.value ?? '');
  });

  document.querySelector('#btn-craft-clipboard')?.addEventListener('click', () => {
    const ta = document.querySelector('#craft-item-input') as HTMLTextAreaElement | null;
    navigator.clipboard
      ?.readText()
      .then((t) => {
        if (ta) ta.value = t;
        return runCraftPlan(t);
      })
      .catch(() =>
        setStatus('Clipboard недоступен (нужен https/localhost) — вставь предмет в поле вручную (Ctrl+V).'),
      );
  });

  // Первый показ вкладки — каталог без плана (лениво).
  document.querySelector('[data-tab="craft"]')?.addEventListener('click', () => {
    if (rendered) return;
    rendered = true;
    const el = document.getElementById('out-craft');
    if (!el) return;
    const anyPlan = (document.querySelector('#craft-item-input') as HTMLTextAreaElement | null)?.value.trim();
    if (anyPlan) {
      void runCraftPlan(anyPlan);
    } else {
      el.innerHTML = `<p class="hint">План по предмету: Ctrl+C по предмету в игре → кнопка «Из буфера». Или вставь текст предмета в поле и нажми «План по предмету».</p>${renderRecipes()}${renderEssenceTable()}${renderPriceCatalog()}`;
      setStatus('Каталог крафта открыт (рецепты/эссенции/омены из ядра poe2-kit).');
    }
  });
}
