/**
 * UI-связка веб-приложения PoE2 Kit c ядром @poe2-kit/core.
 * Все данные — только бесплатные публичные API.
 */
import { core, KNOWN_LEAGUES } from '@poe2-kit/core';

export { core, KNOWN_LEAGUES };

const defaultLeague = KNOWN_LEAGUES[0]?.name ?? 'Runes of Aldur';

// Браузер блокирует прямые запросы к poe.ninja/poe2scout/trade из-за CORS.
// Vite (dev/preview) настроен на реверс-прокси; переписываем абсолютные URL на
// относительные пути через тот же хост. В Node (MCP/оверлей) это не нужно.
if (typeof window !== 'undefined') {
  core.http.setProxyBaseMap({
    'poe.ninja': '/proxy/poeninja',
    'poe2scout.com': '/proxy/scout',
    'pathofexile.com': '/proxy/trade',
    'repoe-fork.github.io': '/proxy/repower',
  });
}

export function setStatus(msg: string): void {
  const el = document.querySelector('#status-text');
  if (el) el.textContent = msg;
}

function out(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing output element ${id}`);
  return el;
}

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

export async function showCurrencyRates(): Promise<void> {
  const el = out('out-currency');
  el.innerHTML = '<em>Загрузка курсов…</em>';
  setStatus('Запрос курсов к poe.ninja…');
  try {
    core.trade.setLeague(defaultLeague);
    const rates = await core.trade.fetchCurrencyRates(defaultLeague);
    if (!rates.length) {
      el.innerHTML = '<p class="err">Нет данных о валютах. Проверь сеть/лигу.</p>';
      setStatus('Нет данных.');
      return;
    }
    const rows = rates
      .filter((r) => r.chaosValue != null)
      .sort((a, b) => (b.chaosValue ?? 0) - (a.chaosValue ?? 0))
      .slice(0, 25)
      .map(
        (r) =>
          `<tr><td>${esc(r.name)}</td><td class="num">${r.chaosValue!.toFixed(2)}</td></tr>`,
      );
    el.innerHTML = `<table class="tbl"><thead><tr><th>Валюта</th><th>chaos</th></tr></thead><tbody>${rows.join('')}</tbody></table>
      <p class="note">Источник: poe.ninja PoE2 Economy API · лига «${esc(defaultLeague)}».</p>`;
    setStatus(`Показано валют: ${rows.length}.`);
  } catch (e) {
    el.innerHTML = `<p class="err">Ошибка: ${esc(e instanceof Error ? e.message : String(e))}</p>`;
    setStatus('Ошибка запроса.');
  }
}

export async function showPriceCheck(text: string): Promise<void> {
  const el = out('out-price');
  if (!text?.trim()) {
    el.innerHTML = '<p class="err">Вставь текст предмета.</p>';
    return;
  }
  el.innerHTML = '<em>Оценка цены…</em>';
  setStatus('Прайс-чек…');
  try {
    core.trade.setLeague(defaultLeague);
    const res = await core.trade.priceCheck(text);
    const lines: string[] = ['<h3>' + esc(res.itemName) + '</h3>', `<p class="meta">Редкость: <b>${esc(res.rarity)}</b></p>`];
    if (res.estimate) {
      lines.push(
        `<p class="est">Оценка: <b>${res.estimate.median}</b> chaos <span class="dim">(диапазон ${res.estimate.min}–${res.estimate.max}, доверие: ${res.estimate.confidence})</span></p>`,
      );
    } else {
      lines.push('<p class="est none">Оценка: нет данных (не найдено в бесплатных источниках).</p>');
    }
    if (res.listings.length) {
      lines.push('<h4>Похожие объявления (trade2)</h4>');
      lines.push(
        '<table class="tbl"><thead><tr><th>Цена</th><th>Валюта</th></tr></thead><tbody>' +
          res.listings
            .slice(0, 15)
            .map((l) => `<tr><td class="num">${l.price}</td><td>${esc(l.currency)}</td></tr>`)
            .join('') +
          '</tbody></table>',
      );
    }
    lines.push(`<p class="note">Источники: ${res.sources.join(', ') || '—'}.</p>`);
    el.innerHTML = lines.join('');
    setStatus('Прайс-чек готов.');
  } catch (e) {
    el.innerHTML = `<p class="err">Ошибка: ${esc(e instanceof Error ? e.message : String(e))}</p>`;
    setStatus('Ошибка прайс-чека.');
  }
}

export async function showLevelingPlan(): Promise<void> {
  const el = out('out-leveling');
  el.innerHTML = '<em>Загрузка плана…</em>';
  try {
    const plan = core.leveling.getLevelingPlan();
    const byAct = new Map<number, typeof plan>();
    for (const z of plan) {
      const arr = byAct.get(z.act) ?? [];
      arr.push(z);
      byAct.set(z.act, arr);
    }
    const blocks: string[] = [];
    for (const [act, zones] of byAct) {
      const zrows = zones
        .map(
          (z) =>
            `<li><b>${esc(z.zone)}</b> <span class="dim">(ур. ${z.monsterLevel})</span>` +
            (z.rewards.length ? ` <span class="reward">🏆 ${esc(z.rewards.join('; '))}</span>` : '') +
            (z.steps.length ? `<ul class="steps">${z.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : '') +
            `</li>`,
        )
        .join('');
      blocks.push(`<div class="actblock"><h3>Акт ${act}</h3><ul class="zones">${zrows}</ul></div>`);
    }
    el.innerHTML = blocks.join('');
    setStatus(`Зон в плане: ${plan.length}.`);
  } catch (e) {
    el.innerHTML = `<p class="err">Ошибка: ${esc(e instanceof Error ? e.message : String(e))}</p>`;
  }
}

export async function showBuildImport(code: string): Promise<void> {
  const el = out('out-build');
  if (!code?.trim()) {
    el.innerHTML = '<p class="err">Вставь share-код PoB.</p>';
    return;
  }
  el.innerHTML = '<em>Декодирование…</em>';
  setStatus('Декод PoB…');
  try {
    const xml = core.build.decodeShareCode(code.trim());
    const b = await core.build.importBuild(xml);
    const gear =
      b.gear && Object.keys(b.gear).length
        ? Object.entries(b.gear).map(([s, v]) => `<li><b>${esc(s)}:</b> ${esc(v)}</li>`).join('')
        : '';
    el.innerHTML =
      '<h3>Билд</h3>' +
      `<ul class="kv"><li>Класс: <b>${esc(b.class ?? '—')}</b>${b.ascendancy ? ` / ${esc(b.ascendancy)}` : ''}</li>` +
      `<li>Уровень: <b>${b.level ?? '—'}</b></li>` +
      (b.skills.length ? `<li>Скиллы: ${b.skills.map(esc).join(', ')}</li>` : '') +
      (b.passiveNodes.length ? `<li>Узлы пассивок: ${b.passiveNodes.length}</li>` : '') +
      '</ul>' +
      (gear ? `<h4>Снаряжение</h4><ul class="kv">${gear}</ul>` : '');
    setStatus('Билд разобран.');
  } catch (e) {
    el.innerHTML = `<p class="err">Ошибка декода: ${esc(e instanceof Error ? e.message : String(e))}</p>`;
    setStatus('Ошибка декода.');
  }
}