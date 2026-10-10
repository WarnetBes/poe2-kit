/**
 * «Саппорт-советы» для разобранного билда (№266, suppadv-web).
 *
 * Движок — core.gemSupports (№192/№262-Э4): слои meta_supports (эталон меты:
 * билд+дата) → recommended_supports (base-ранги poe2db). Оверлей использует
 * его с диска; web — лениво подтягивает датасеты из public/datasets/
 * (копирует scripts/copy-datasets.mjs) и инжектит через installBrowserDataset
 * (паттерн №222 «Раскладка»/«Карты»). После инжекта — сброс кэшей движка:
 * они заполняются один раз за процесс (см. gemSupports.ts:49-53).
 *
 * Дисциплина честности: мету-эталон выводим с пометкой источника (билд+дата),
 * base — с рангами; пусто = «нет данных по этому кому», без выдумок.
 * Ни одного внешнего запроса: только public-датасеты (офлайн).
 */
import { core } from './ui';

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

/** Ленивая загрузка датасетов саппорт-слоёв (идемпотентно, как №222). */
let supportsPromise: Promise<void> | null = null;

function fetchJson(url: string): Promise<unknown> {
  return fetch(url).then((res) => {
    if (!res.ok) throw new Error(`датасет не загружен (${url}: HTTP ${res.status})`);
    return res.json();
  });
}

function ensureSupportsDataset(): Promise<void> {
  if (supportsPromise) return supportsPromise;
  const base = import.meta.env.BASE_URL ?? '/';
  supportsPromise = (async () => {
    const [meta, reco] = await Promise.all([
      fetchJson(base + 'datasets/meta_supports.json'),
      fetchJson(base + 'datasets/recommended_supports.json'),
    ]);
    core.dataset.installBrowserDataset('skill_gems/meta_supports.json', meta);
    core.dataset.installBrowserDataset('skill_gems/recommended_supports.json', reco);
    core.gemSupports.resetGemSupportCaches(); // кэши могли заполниться пустыми до инжекта
  })().catch((e: unknown) => {
    supportsPromise = null; // не держим отвергнутый промис — ретрай на след. разборе
    throw e;
  }) as Promise<void>;
  return supportsPromise;
}

function supportsBlock(gem: string): string {
  const recos = core.gemSupports.supportsForActive(gem);
  if (!recos.length) return '';
  const isMeta = recos[0]!.tier === 'meta';
  const note = recos[0]!.note;
  const list = recos
    .map((r) =>
      isMeta
        ? `<li>${esc(r.en)}</li>`
        : `<li>${esc(r.en)} <span class="dim">(ранг ${r.rank})</span></li>`,
    )
    .join('');
  return `<div class="rad-issue">
    <h4>${esc(gem)} <span class="dim">(${isMeta ? 'эталон меты' : 'base-ранги'})</span></h4>
    <ul>${list}</ul>
    ${note ? `<p class="dim">${esc(note)}</p>` : ''}
  </div>`;
}

/** Отрисовать советы саппортов по активным гемам разобранного билда. Офлайн. */
export async function renderSupportsAdvice(skills: string[]): Promise<void> {
  const el = document.getElementById('out-supports');
  if (!el) return;
  // Активные гемы билда: фильтр мусора сводки (starvation-метки и пр. — не имена).
  const gems = (skills ?? []).map((s) => String(s).trim()).filter((s) => s.length > 1 && !/^\d/.test(s));
  if (!gems.length) {
    el.innerHTML = '';
    return;
  }
  try {
    await ensureSupportsDataset();
  } catch (e) {
    el.innerHTML = `<p class="note">Саппорт-датасеты недоступны (${esc(e instanceof Error ? e.message : String(e))}) — советы отключены.</p>`;
    return;
  }
  const blocks = gems.map(supportsBlock).filter(Boolean);
  el.innerHTML = blocks.length
    ? `<h3>Саппорт-советы по активным гемам <span class="dim">(${blocks.length} из ${gems.length}; офлайн, меты 0.5.5-среза)</span></h3>
       ${blocks.join('')}
       <p class="note">Слои: эталон меты (жёсткие билды топ-игроков) → base-ранги poe2db. Нет гема в слоях — честное пусто, без выдумок.</p>`
    : '';
}
