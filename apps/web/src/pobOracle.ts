/**
 * Вкладка «🧮 PoB-оракул» (Фаза 3-хвост, №463): тонкий web-клиент поверх
 * персист-сессии headless-PoB из serve-dist.mjs:
 *   GET  /api/pob/status — состояние сессии (не поднимает движок)
 *   POST /api/pob/load   — загрузить билд (PoB share-код или XML)
 *   POST /api/pob/rpc    — whitelist-RPC: whatif (матрица сценариев, контракт 4)
 *
 * UI-принципы кита: дедупликация PoB-кода (кнопка «Из поля "Импорт билда"»,
 * как №262 в «Сравнение»); честный вывод при 503 (лайт-сборка/нет рантайма —
 * показываем hint из ответа сервера, не молчим); whatif не трогает baseline
 * (CAS-откат в хосте), поэтому кнопка безопасна для повторных прогонов.
 */
import { setStatus } from './ui';

function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

function fmt(v: unknown): string {
  if (typeof v === 'number') {
    return Math.abs(v) >= 100 ? Math.round(v).toLocaleString('ru-RU') : String(Math.round(v * 100) / 100);
  }
  return v == null ? '—' : esc(v);
}

type StatRow = Record<string, unknown>;

const WHATIF_KEYS = ['Life', 'TotalDPS', 'FullDPS', 'EnergyShield', 'TotalEHP', 'Spirit'] as const;
const SHOW_KEYS = ['Life', 'TotalDPS', 'FullDPS', 'EnergyShield', 'TotalEHP', 'Spirit'] as const;

/** Пресеты сценариев = ровно то, что проверялось живьём в Фазах 1–3. */
const PRESETS: { id: string; label: string; scenario: { name: string; config?: Record<string, unknown>; level?: number } }[] = [
  { id: 'boss', label: 'Босс (рез. 30)', scenario: { name: 'Босс', config: { enemyIsBoss: 'Boss' } } },
  { id: 'pinnacle', label: 'Пиннакл + хаос 75', scenario: { name: 'Пиннакл+Хаос75', config: { enemyIsBoss: 'Pinnacle', enemyChaosResist: 75 } } },
  { id: 'uber', label: 'Uber', scenario: { name: 'Uber', config: { enemyIsBoss: 'Uber' } } },
  { id: 'lvl92', label: 'Уровень 92', scenario: { name: 'lvl92', level: 92 } },
  { id: 'lvl95', label: 'Уровень 95', scenario: { name: 'lvl95', level: 95 } },
  { id: 'lvl100', label: 'Уровень 100', scenario: { name: 'lvl100', level: 100 } },
];

async function postJson(url: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    data = { ok: false, error: `Сервер вернул не-JSON (HTTP ${res.status})` };
  }
  return { status: res.status, data };
}

function apiError(data: Record<string, unknown>, status: number): string {
  const hint = data.hint ? `<div class="pob-hint">${esc(data.hint)}</div>` : '';
  const err = data.error ? `: ${esc(data.error)}` : '';
  return `<div class="pob-err">Оракул недоступен (HTTP ${status}${err}).${hint}</div>`;
}

function renderStatsTable(stats: StatRow, heading: string): string {
  const cells = SHOW_KEYS.filter((k) => stats[k] !== undefined)
    .map((k) => `<td>${fmt(stats[k])}</td>`)
    .join('');
  if (!cells) return '';
  return `<table class="pob-stats"><caption>${esc(heading)}</caption><tr>${SHOW_KEYS.map((k) => `<th>${k}</th>`).join('')}</tr><tr>${cells}</tr></table>`;
}

let loadedBuild: Record<string, unknown> | null = null;

async function refreshStatus(): Promise<void> {
  const el = document.getElementById('pob-status');
  if (!el) return;
  try {
    const res = await fetch('/api/pob/status');
    const data = (await res.json()) as {
      ok?: boolean;
      core?: boolean;
      session?: { status?: string; runtimeContract?: number | null; pid?: number | null; rpcCount?: number; loaded?: boolean; lastError?: string | null } | null;
    };
    if (!data.core) {
      el.innerHTML = '<span class="pob-bad">core недоступен</span> — персист-PoB только в полной сборке (лайт-сборка честно не умеет).';
      return;
    }
    const s = data.session;
    if (!s) {
      el.innerHTML = '<span class="pob-mid">Сессия не поднята</span> — первый «Загрузить» настартует движок (~2–3 с один раз).';
      return;
    }
    const tone = s.status === 'ready' ? 'pob-ok' : s.status === 'crashed' ? 'pob-bad' : 'pob-mid';
    el.innerHTML =
      `<span class="${tone}">${esc(s.status ?? '?')}</span>` +
      ` · контракт ${esc(s.runtimeContract ?? '—')}` +
      ` · RPC ${String(s.rpcCount ?? 0)}` +
      ` · билд ${s.loaded ? 'загружен' : '—'}` +
      (s.lastError ? ` · ⚠ ${esc(s.lastError)}` : '');
  } catch (e) {
    el.innerHTML = `<span class="pob-bad">status-запрос упал</span>: ${esc(e instanceof Error ? e.message : String(e))} (сервер запущен без serve-dist.mjs?)`;
  }
}

async function loadBuild(): Promise<void> {
  const out = document.getElementById('out-pob');
  const code = (document.getElementById('pob-code-input') as HTMLTextAreaElement | null)?.value?.trim() ?? '';
  const isXml = code.startsWith('<?xml') || code.startsWith('<PathOfBuilding');
  if (!code) {
    setStatus('PoB-оракул: вставь share-код или XML билда.');
    return;
  }
  if (out) out.innerHTML = '<div class="pob-mid">Загружаю билд в оракул (первый bootstrap движка ~2–3 с)…</div>';
  const { status, data } = await postJson('/api/pob/load', isXml ? { xml: code } : { pob_code: code });
  if (!data.ok) {
    loadedBuild = null;
    if (out) out.innerHTML = apiError(data, status);
    return;
  }
  loadedBuild = (data.build as Record<string, unknown>) ?? null;
  const b = loadedBuild ?? {};
  const stats = (b.stats as StatRow) ?? {};
  const sg = Array.isArray(b.skillGroups) ? (b.skillGroups as { label?: string; main?: string }[]) : [];
  if (out) {
    out.innerHTML =
      `<div class="pob-ok">Билд в сессии</div>` +
      `<div class="pob-meta">Скилл: <b>${esc(b.mainSkill ?? '—')}</b> · уровень ${esc(b.characterLevel ?? '—')} · дерево ${esc(b.treeVersion ?? '—')}${b.treeVersion && b.treeVersion !== b.latestTreeVersion ? ` (актуально [${esc(b.latestTreeVersion)}])` : ''}</div>` +
      (sg.length ? `<details class="craft-acc"><summary>Сокет-группы (${sg.length})</summary><ul class="mp-mods">${sg.map((g) => `<li><b>${esc(g.label ?? '')}</b> — ${esc(g.main ?? '')}</li>`).join('')}</ul></details>` : '') +
      renderStatsTable(stats, 'Baseline (загруженный билд)');
  }
  setStatus('PoB-оракул: билд загружен в персист-сессию.');
  void refreshStatus();
}

async function runWhatif(): Promise<void> {
  const out = document.getElementById('out-pob-whatif');
  if (!out) return;
  if (!loadedBuild) {
    out.innerHTML = '<div class="pob-err">Сначала загрузи билд — whatif считается поверх него.</div>';
    return;
  }
  const scenarios: { name: string; config?: Record<string, unknown>; level?: number }[] = [];
  for (const p of PRESETS) {
    const cb = document.getElementById(`pob-preset-${p.id}`) as HTMLInputElement | null;
    if (cb?.checked) scenarios.push(p.scenario);
  }
  const lvlRaw = (document.getElementById('pob-level') as HTMLInputElement | null)?.value?.trim();
  if (lvlRaw) {
    const lvl = Number(lvlRaw);
    if (Number.isFinite(lvl) && lvl >= 1 && lvl <= 100) scenarios.push({ name: `lvl${lvl}`, level: lvl });
    else {
      out.innerHTML = `<div class="pob-err">Уровень должен быть 1–100, получено «${esc(lvlRaw)}».</div>`;
      return;
    }
  }
  if (scenarios.length === 0) {
    out.innerHTML = '<div class="pob-err">Отметь хотя бы один пресет или укажи уровень.</div>';
    return;
  }
  out.innerHTML = '<div class="pob-mid">Считаю матрицу what-if (один движок, CAS-изоляция сценариев)…</div>';
  const { status, data } = await postJson('/api/pob/rpc', {
    method: 'whatif',
    params: { keys: [...WHATIF_KEYS], scenarios },
  });
  if (data.ok === false) {
    out.innerHTML = apiError(data, status);
    return;
  }
  const frame = data as { ok?: boolean; error?: string; result?: { baseline?: StatRow; scenarios?: { name?: string; ok?: boolean; stats?: StatRow; errorCode?: string; errors?: string[]; warnings?: string[]; autoResists?: StatRow }[] } };
  if (frame.ok === false) {
    out.innerHTML = `<div class="pob-err">RPC whatif отклонён: ${esc(frame.error ?? '?')}</div>`;
    return;
  }
  const r = frame.result ?? {};
  const baseline = r.baseline ?? {};
  const rows: string[] = [];
  const pct = (key: string, s?: StatRow): string => {
    const b = Number(baseline[key]);
    const v = Number(s?.[key]);
    if (!Number.isFinite(b) || !Number.isFinite(v) || b === 0) return '';
    const d = ((v - b) / b) * 100;
    const tone = d > 0.5 ? 'pob-up' : d < -0.5 ? 'pob-down' : 'pob-mid';
    return `<td class="${tone}">${d >= 0 ? '+' : ''}${Math.round(d * 10) / 10}%</td>`;
  };
  for (const sc of r.scenarios ?? []) {
    if (sc.ok) {
      rows.push(
        `<tr><td>${esc(sc.name ?? '?')}${sc.autoResists ? ` <small>(рез. ${Object.entries(sc.autoResists as Record<string, unknown>).map(([k, v]) => `${esc(k)} ${fmt(v)}`).join(', ')})</small>` : ''}</td>` +
        `<td>${fmt(sc.stats?.Life)}</td>${pct('Life', sc.stats)}` +
        `<td>${fmt(sc.stats?.TotalDPS)}</td>${pct('TotalDPS', sc.stats)}` +
        `<td>${fmt(sc.stats?.TotalEHP)}</td>${pct('TotalEHP', sc.stats)}` +
        (sc.warnings?.length ? `<td><small>⚠ ${esc(sc.warnings.join('; '))}</small></td>` : '<td></td>') +
        `</tr>`,
      );
    } else {
      rows.push(
        `<tr class="pob-fail"><td>${esc(sc.name ?? '?')}</td><td colspan="6">✗ ${esc(sc.errorCode ?? 'error')}: ${esc((sc.errors ?? []).join('; '))}</td></tr>`,
      );
    }
  }
  out.innerHTML =
    renderStatsTable(baseline, 'Baseline') +
    `<table class="pob-stats pob-matrix"><caption>What-if матрица (${(r.scenarios ?? []).length} сценариев)</caption>` +
    `<tr><th>Сценарий</th><th>Life</th><th>Δ</th><th>TotalDPS</th><th>Δ</th><th>TotalEHP</th><th>Δ</th><th>⚠</th></tr>` +
    rows.join('') +
    `</table><p class="hint">Сценарии CAS-изолированы: каждый поверх baseline, откат в хосте (контракт 4). Порядок не влияет.</p>`;
  setStatus('PoB-оракул: матрица what-if готова.');
  void refreshStatus();
}

export function initPobOracleTab(): void {
  const tab = document.querySelector<HTMLButtonElement>('[data-tab="poboracle"]');
  if (!tab) return;
  let inited = false;
  tab.addEventListener('click', () => {
    if (!inited) {
      inited = true;
      const box = document.getElementById('pob-presets-box');
      if (box) {
        box.innerHTML = PRESETS.map(
          (p) => `<label class="pob-preset"><input type="checkbox" id="pob-preset-${p.id}" /> ${esc(p.label)}</label>`,
        ).join('');
      }
      document.getElementById('btn-pob-status')?.addEventListener('click', () => void refreshStatus());
      document.getElementById('btn-pob-load')?.addEventListener('click', () => void loadBuild());
      document.getElementById('btn-pob-whatif')?.addEventListener('click', () => void runWhatif());
      document.getElementById('btn-pob-load-last')?.addEventListener('click', () => {
        const code = (document.getElementById('build-input') as HTMLTextAreaElement | null)?.value?.trim() ?? '';
        if (!code) {
          setStatus('Поле «Импорт билда» пусто: вставь там PoB share-код.');
          return;
        }
        const ta = document.getElementById('pob-code-input') as HTMLTextAreaElement | null;
        if (ta) ta.value = code;
        setStatus('PoB-код взят из поля «Импорт билда».');
      });
    }
    void refreshStatus();
  });
}
