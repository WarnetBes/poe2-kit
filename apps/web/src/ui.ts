/**
 * UI-связка веб-приложения PoE2 Kit c ядром @poe2-kit/core.
 * Все данные — только бесплатные публичные API.
 */
import {
  core,
  KNOWN_LEAGUES,
  type League,
} from '@poe2-kit/core';

export { core, KNOWN_LEAGUES };

const LEAGUE_KEY = 'poe2k.league';

// Сохранённая пользователем лига (если есть), иначе null → определяем актуальную.
function savedLeague(): string | null {
  try {
    const saved = localStorage.getItem(LEAGUE_KEY);
    return saved || null;
  } catch {
    return null;
  }
}

let activeLeague: string | null = savedLeague();

/**
 * Активная лига по умолчанию — актуальная текущая из poe2scout.
 * Вызывается один раз после старта: если пользователь не выбирал лигу, берём
 * актуальную и фиксируем её как активную (а не устаревший KNOWN_LEAGUES[0]).
 */
export async function initActiveLeague(): Promise<string> {
  if (!activeLeague) {
    try {
      activeLeague = await core.trade.currentDefaultLeague();
    } catch {
      activeLeague = null;
    }
    if (activeLeague) core.trade.setLeague(activeLeague);
  }
  return activeLeague ?? '';
}

/** Загрузить актуальный список лиг из poe2scout. */
export async function loadLeagueList(): Promise<League[]> {
  const list = await core.trade.fetchLeagues();
  if (list?.length) return list;
  return KNOWN_LEAGUES;
}

/** Установить выбранную лигу (также сохраняется в localStorage). */
export function selectLeague(id: string | null): void {
  if (id) {
    activeLeague = id.trim();
    core.trade.setLeague(activeLeague);
    try {
      localStorage.setItem(LEAGUE_KEY, activeLeague);
    } catch {
      /* ignore */
    }
  } else {
    // Сброс на «по умолчанию» — актуальную лигу определяем асинхронно.
    activeLeague = null;
    try {
      localStorage.removeItem(LEAGUE_KEY);
    } catch {
      /* ignore */
    }
    void initActiveLeague();
  }
}

/** Получить активную лигу (имя/id). */
export function getActiveLeague(): string {
  return activeLeague ?? '';
}

/** Принудительно обновить кэш данных выбранной лиги (курсы/цены). */
export function refreshLeagueData(): void {
  core.trade.invalidateLeagues();
  core.trade.clearRatesCache();
  core.trade.clearScoutCache();
  setStatus(`Список лиг и кэш «${activeLeague}» обновлены.`);
}

// Браузер блокирует прямые запросы к poe.ninja/poe2scout/trade из-за CORS.
// Vite (dev/preview) настроен на реверс-прокси; переписываем абсолютные URL на
// относительные пути через тот же хост. В Node (MCP/оверлей) это не нужно.
if (typeof window !== 'undefined') {
  // Относительные префиксы (без ведущего слэша) — липпка работает и из корня, и из подпапки
  // (/poe2kit/). В dev/preview это те же пути, что проксирует Vite.
  core.http.setProxyBaseMap({
    'poe.ninja': 'proxy/poeninja',
    'poe2scout.com': 'proxy/scout',
    'pathofexile.com': 'proxy/trade',
    'repoe-fork.github.io': 'proxy/repower',
  });
}

export function setStatus(msg: string): void {
  const el = document.querySelector('#status-text');
  if (el) el.textContent = msg;
}

const AI_SETTINGS_KEY = 'poe2k.ai.settings';

export interface AISettings {
  base: string;
  key: string;
  model: string;
}

/** Загрузить настройки ИИ из localStorage (со значениями по умолчанию). */
export function loadAISettings(): AISettings {
  const dflt: AISettings = { base: '', key: '', model: '' };
  try {
    const raw = localStorage.getItem(AI_SETTINGS_KEY);
    if (raw) return { ...dflt, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return dflt;
}

/** Сохранить настройки ИИ. */
export function saveAISettings(s: AISettings): void {
  try {
    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string };

let _chatHistory: ChatMsg[] = [];

export async function sendAIMessage(text: string, context?: Record<string, unknown>): Promise<void> {
  const el = out('out-ai');
  const settings = loadAISettings();
  if (!settings.base || !settings.model) {
    el.innerHTML =
      '<p class="err">Сначала настрой ИИ в полях выше: базовый URL эндпоинта (OpenAI-совместимый) и модель. Пример: <code>https://…/v1</code> и <code>glm-5-3</code>.</p>';
    setStatus('Нужны настройки ИИ.');
    return;
  }
  if (!text?.trim()) {
    el.innerHTML = '<p class="err">Введи вопрос.</p>';
    return;
  }

  _chatHistory.push({ role: 'user', content: text });
  _renderChat();
  setStatus('Запрос к ИИ…');
  try {
    const reply = await core.ai.callChatEndpoint(settings.base, settings.key || undefined, settings.model, text, context);
    _chatHistory.push({ role: 'assistant', content: reply });
  } catch (e) {
    _chatHistory.push({ role: 'assistant', content: `⚠ Ошибка: ${e instanceof Error ? e.message : String(e)}\n\nПроверь URL/key/модель и доступность эндпоинта.` });
  }
  _renderChat();
  setStatus('Готово.');
}

function _bubble(m: ChatMsg): string {
  const cls = m.role === 'user' ? 'bubble me' : 'bubble ai';
  return `<div class="${cls}"><pre>${esc(m.content)}</pre></div>`;
}

function _renderChat(): void {
  const el = out('out-ai');
  const msg = _chatHistory.map((m) => _bubble(m)).join('');
  el.innerHTML =
    (msg ? `<div class="chatlog">${msg}</div>` : '') +
    `<div class="aipane">
       <textarea id="ai-input" rows="3" placeholder="Спроси про билд, прокачку, торговлю…"></textarea>
       <button id="ai-send" class="primary">Отправить</button>
     </div>`;
  const send = el.querySelector('#ai-send');
  const input = el.querySelector('#ai-input') as HTMLTextAreaElement;
  send?.addEventListener('click', () => void submitAI());
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submitAI();
    }
  });
}

function submitAI(): void {
  const el = out('out-ai');
  const input = el.querySelector('#ai-input') as HTMLTextAreaElement;
  void sendAIMessage(input?.value ?? '');
}

export function showAIChat(): void {
  _renderChat();
  // записать настройки в поля и подвязать сохранение
  const s = loadAISettings();
  const sb = document.querySelector('#ai-base') as HTMLInputElement;
  const sk = document.querySelector('#ai-key') as HTMLInputElement;
  const sm = document.querySelector('#ai-model') as HTMLInputElement;
  if (sb) sb.value = s.base;
  if (sk) sk.value = s.key;
  if (sm) sm.value = s.model;
  [sb, sk, sm].forEach((f) =>
    f?.addEventListener('change', () => {
      saveAISettings({
        base: (document.querySelector('#ai-base') as HTMLInputElement).value.trim(),
        key: (document.querySelector('#ai-key') as HTMLInputElement).value.trim(),
        model: (document.querySelector('#ai-model') as HTMLInputElement).value.trim(),
      });
    }),
  );
}

/** Собрать контекст текущего билда (если разобран) для отправки в ИИ. */
export function currentBuildContext(): Record<string, unknown> | undefined {
  try {
    const raw = localStorage.getItem('poe2k.lastBuild');
    if (raw) return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return undefined;
}

/** Очистить историю чата. */
export function clearAIChat(): void {
  _chatHistory = [];
  _renderChat();
  setStatus('История чата очищена.');
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
  setStatus(`Запрос курсов (лига «${activeLeague}»)…`);
  try {
    core.trade.setLeague(activeLeague);
    const league = activeLeague ?? undefined;
    const rates = await core.trade.fetchBestCurrencyRates(league);
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
      <p class="note">Источник: poe2scout + poe.ninja · лига «${esc(activeLeague ?? '')}».</p>`;
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
  setStatus(`Прайс-чек (лига «${activeLeague}»)…`);
  try {
    core.trade.setLeague(activeLeague);
    const league = activeLeague ?? undefined;
    const res = await core.trade.priceCheck(text, { league });
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
    lines.push(`<p class="note">Лига: ${esc(res.league ?? activeLeague ?? '')} · Источники: ${res.sources.join(', ') || '—'}.</p>`);
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
    const ls: string[] = ['<h3>Билд</h3>', '<ul class="kv">'];
    ls.push(`<li>Класс: <b>${esc(b.class ?? '—')}</b>${b.ascendancy ? ` / ${esc(b.ascendancy)}` : ''}</li>`);
    ls.push(`<li>Уровень: <b>${b.level ?? '—'}</b></li>`);
    if (b.skills.length) ls.push(`<li>Скиллы: ${b.skills.map(esc).join(', ')}</li>`);
    if (b.passiveNodes.length) ls.push(`<li>Узлы пассивок: <b>${b.passiveNodes.length}</b></li>`);
    const st = b.stats ?? {};
    if (st.TotalDPS != null || st.CombinedDPS != null) {
      ls.push(`<li>DPS: <b>${Math.round(st.TotalDPS ?? st.CombinedDPS!).toLocaleString('ru-RU')}</b></li>`);
    }
    const hp = st.Life ?? st['EnergyShield'];
    if (hp != null) ls.push(`<li>Жизнь/ES: <b>${Math.round(hp).toLocaleString('ru-RU')}</b></li>`);
    ls.push('</ul>');
    const gear =
      b.gear && Object.keys(b.gear).length
        ? Object.entries(b.gear).map(([s, v]) => `<li><b>${esc(s)}:</b> ${esc(v)}</li>`).join('')
        : '';
    if (gear) ls.push('<h4>Снаряжение</h4><ul class="kv">' + gear + '</ul>');
    if (b.passiveNodes.length) ls.push(`<p class="note">Пассивок: ${b.passiveNodes.length} · углублённый анализ — через ИИ (вкладка «AI»)/MCP.</p>`);
    el.innerHTML = ls.join('');
    try {
      localStorage.setItem(
        'poe2k.lastBuild',
        JSON.stringify({
          class: b.class,
          ascendancy: b.ascendancy,
          level: b.level,
          skills: b.skills,
          passiveNodes: b.passiveNodes,
          gear: b.gear,
          stats: b.stats,
          summary: core.build.summarizeBuild(b),
        }),
      );
    } catch {
      /* ignore */
    }
    setStatus('Билд разобран.');
  } catch (e) {
    el.innerHTML = `<p class="err">Ошибка декода: ${esc(e instanceof Error ? e.message : String(e))}</p>`;
    setStatus('Ошибка декода.');
  }
}

/** Прайс-чек всего снаряжения билда по живым ценам. */
export async function showBuildPrice(code: string): Promise<void> {
  const el = out('out-build-price');
  if (!code?.trim()) {
    el.innerHTML = '<p class="err">Вставь share-код PoB.</p>';
    return;
  }
  el.innerHTML = '<em>Оценка снаряжения по живым ценам…</em>';
  setStatus('Прайс-чек билда…');
  try {
    const report = await core.trade.priceBuild(code.trim());
    const lines: string[] = [
      '<h3>Прайс-чек билда</h3>',
      `<ul class="kv">
        <li>Лига: <b>${esc(report.league ?? '—')}</b></li>
        <li>Предметов обработано: <b>${report.totalItems}</b></li>
        <li>Оценено цен: <b>${report.pricedCount}</b></li>
        <li>Суммарная нижняя граница: <b>${report.totalMin.toFixed(2)}</b></li>
        <li>Время: ${report.elapsedMs} мс</li>
      </ul>`,
      '<table><thead><tr><th>Слот</th><th>Имя</th><th>Редкость</th><th>Медиана</th><th>min–max</th><th>Объявл.</th></tr></thead><tbody>',
    ];
    for (const it of report.items) {
      const median = it.estimate?.median;
      const range = it.estimate
        ? `${it.estimate.min.toFixed(2)}–${it.estimate.max.toFixed(2)}`
        : '—';
      lines.push(
        `<tr>
          <td>${esc(it.slot || '—')}</td>
          <td>${esc(it.name || '—')}</td>
          <td>${esc(it.rarity)}</td>
          <td>${median != null ? median.toFixed(2) : '—'}</td>
          <td>${range}</td>
          <td>${it.listingsCount}</td>
        </tr>`,
      );
    }
    lines.push('</tbody></table>');
    el.innerHTML = lines.join('');
    setStatus(`Прайс-чек: ${report.pricedCount}/${report.totalItems} оценено.`);
  } catch (e) {
    el.innerHTML = `<p class="err">Ошибка прайс-чека: ${esc(e instanceof Error ? e.message : String(e))}</p>`;
    setStatus('Ошибка прайс-чека билда.');
  }
}