/**
 * Вкладка «👑 Пиннакл» (№262, Этап 1): чекап готовности к пиннакл-боссам
 * в web — перенос №111 оверлея (Ctrl+F7) на те же данные ядра:
 * core.estimate.estimateBuild(rawPoBCode) → core.optimize.pinnacleChecklist.
 *
 * КРИТИЧНО (№130-ф1): в estimateBuild уходит rawInput — исходный PoB-код/XML,
 * а НЕ слоты: из строки наполняются pobStats (резисты с дерева и гира),
 * из массива слотов pobStats пуст и чек-лист ложно краснеет. В web источники
 * кода: localStorage poe2k.lastBuildCode (пишется одной транзакцией с
 * poe2k.lastBuild при импорте) или поле «Импорт билда» (#build-input).
 *
 * verdict='unknown' — честная частичность (данных в билде нет), не ошибка.
 */
import { core, setStatus } from './ui';
import { estimateBuild } from '@poe2-kit/core';

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

type Verdict = 'pass' | 'fail' | 'unknown';

const VERDICT_HTML: Record<Verdict, string> = {
  pass: '<b style="color:#57a355">✔ pass</b>',
  fail: '<b style="color:#d05555">✘ fail</b>',
  unknown: '<span class="dim">? нет данных</span>',
};

async function runPinnacle(code: string): Promise<void> {
  const el = document.getElementById('out-pinnacle')!;
  const trimmed = code.trim();
  if (!trimmed) {
    el.innerHTML =
      '<p class="err">Нет PoB-кода. Разбери билд во вкладке «Импорт билда», затем вернись, или вставь код в поле там и нажми «Из поля „Импорт билда“».</p>';
    return;
  }
  el.innerHTML = '<em>Считаю EHP и чек-лист по билду…</em>';
  setStatus('Чекап пиннакла…');
  try {
    const est = await estimateBuild(trimmed);
    const res = core.optimize.pinnacleChecklist(est);
    const avail = res.checks.filter((c) => c.verdict !== 'unknown').length;
    const fails = res.checks.filter((c) => c.verdict === 'fail').length;
    const worst = est.worstEhp
      ? `${esc(est.worstEhp.damageType)}: <b>${est.worstEhp.effectiveHp}</b> EHP`
      : '—';
    el.innerHTML = `
      <h3>🧬 Билд: ${esc(est.className ?? '?')}${est.ascendancy ? ` (${esc(est.ascendancy)})` : ''}, ур. ${est.characterLevel ?? '?'} <span class="dim">· источник: ${esc(est.source)}</span></h3>
      <p class="hint">Против плейсхолдеров ${esc(res.enemy.boss)} ур. ${res.enemy.level} (канон PoB Misc.lua). Худший EHP — ${worst}. Проверок: ${avail}/${res.checks.length} доступно, провалено: <b style="color:${fails ? '#d05555' : '#57a355'}">${fails}</b>.</p>
      <div class="sim-scroll"><table class="tbl">
        <thead><tr><th>Проверка</th><th>Вердикт</th><th>Детали</th></tr></thead>
        <tbody>
          ${res.checks
            .map(
              (c) =>
                `<tr><td><b>${esc(c.item)}</b></td><td>${VERDICT_HTML[c.verdict]}</td><td>${esc(c.detail)}</td></tr>`,
            )
            .join('')}
        </tbody>
      </table></div>
      ${est.notes.length ? `<h4>⚠️ Приближения расчёта</h4><ul class="mp-mods">${est.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      <p class="note">Эвристики (сколько ударов держать и т.п.) — не игровые данные; проверяй в бою.</p>`;
    setStatus(`Чекап пиннакла: ${avail}/${res.checks.length}, провалов ${fails}.`);
  } catch (e) {
    el.innerHTML = `<p class="err">Не удалось посчитать чек-лист: ${esc(e instanceof Error ? e.message : String(e))}</p>`;
  }
}

function lastBuildCode(): string {
  try {
    return localStorage.getItem('poe2k.lastBuildCode') ?? '';
  } catch {
    return '';
  }
}

// ─── Вкладка: init ───────────────────────────────────────────────────────────

export function initPinnacleTab(): void {
  document.querySelector('#btn-pinnacle-last')?.addEventListener('click', () => {
    void runPinnacle(lastBuildCode());
  });
  document.querySelector('#btn-pinnacle-build')?.addEventListener('click', () => {
    const ta = document.querySelector('#build-input') as HTMLTextAreaElement | null;
    void runPinnacle(ta?.value ?? '');
  });
}
