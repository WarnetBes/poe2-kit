/**
 * Вкладка «🗺 Карты» (№234, Этап 4): Map Prep Assistant в web.
 * Выбор карты + тир waystone + моды камня (каждый с новой строки) → вердикт
 * core.mapPrep: какие моды опасны, каких резистов/EHP не хватает, что взять.
 *
 * Логика — ТОЛЬКО в core: web лишь подаёт вход (map id / tier / mods строки /
 * DefensiveStats) и рендерит MapThreat + MapPrepCheck. Датасеты карт (75 КБ)
 * — лениво fetch'd через installBrowserDataset (механизм №222), файлы кладёт
 * scripts/copy-datasets.mjs в public/datasets/maps/ при build/dev.
 *
 * Резисты: автоиз последнего разобранного билда (PoB PlayerStat: FireResist/
 * ColdResist/LightningResist/ChaosResist + Life/EnergyShield); без билда —
 * ручной ввод 4 полей (fallback по SPEC §6), персональные EHP-чеки честно
 * помечаются (пул жизни неизвестен → 3000 условно).
 */
import { core, currentBuildContext, setStatus } from './ui';
import type { DefensiveStats, MapPrepCheck, MapThreat } from '@poe2-kit/core';

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

// ─── Ленивая загрузка датасетов карт (maps/maps.json + waystone_mods.json) ───
let mapsDataPromise: Promise<void> | null = null;

function fetchJson(url: string): Promise<unknown> {
  return fetch(url).then((res) => {
    if (!res.ok) throw new Error(`датасет не загружен (${url}: HTTP ${res.status})`);
    return res.json();
  });
}

function ensureMapsData(): Promise<void> {
  if (mapsDataPromise) return mapsDataPromise;
  const base = import.meta.env.BASE_URL ?? '/';
  mapsDataPromise = (async () => {
    const [maps, mods] = await Promise.all([
      fetchJson(base + 'datasets/maps/maps.json'),
      fetchJson(base + 'datasets/maps/waystone_mods.json'),
    ]);
    core.dataset.installBrowserDataset('maps/maps.json', maps);
    core.dataset.installBrowserDataset('maps/waystone_mods.json', mods);
  })().catch((e: unknown) => {
    mapsDataPromise = null; // отвергнутый промис не держим — клик ретраит
    throw e;
  });
  return mapsDataPromise;
}

// ─── Резисты: из последнего билда (PoB PlayerStat) ────────────────────────────

interface BuildResists {
  life: number | null;
  energyShield: number | null;
  fireRes: number | null;
  coldRes: number | null;
  lightningRes: number | null;
  chaosRes: number | null;
}

/** Статы обороны из последнего разобранного билда (localStorage poe2k.lastBuild). */
function resistsFromLastBuild(): BuildResists {
  try {
    const ctx = currentBuildContext();
    const st = (ctx?.stats ?? {}) as Record<string, number>;
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    return {
      life: num(st.Life) ?? num(st.LifeUnreserved),
      energyShield: num(st.EnergyShield),
      fireRes: num(st.FireResist),
      coldRes: num(st.ColdResist),
      lightningRes: num(st.LightningResist),
      chaosRes: num(st.ChaosResist),
    };
  } catch {
    return { life: null, energyShield: null, fireRes: null, coldRes: null, lightningRes: null, chaosRes: null };
  }
}

// ─── Рендер ──────────────────────────────────────────────────────────────────

function sevBar(severity: number): string {
  // 0..10 → полоска; цвет: зелёный < 3, янтарный < 6, красный ≥ 6
  const pct = Math.round(Math.max(0, Math.min(10, severity)) * 10);
  const color = severity >= 6 ? '#d05555' : severity >= 3 ? '#d0a355' : '#57a355';
  return `<span class="mp-sev" style="display:inline-block;width:64px;height:8px;border-radius:4px;background:rgba(255,255,255,0.12);vertical-align:middle"><span style="display:block;width:${pct}%;height:100%;border-radius:4px;background:${color}"></span></span>`;
}

function threatIcon(t: MapThreat, mod: MapThreat['matchedMods'][number]): string {
  const th = mod.threat;
  if (!th) return '🤷';
  if (th.kind === 'player_debuff') return '⚠';
  if (th.kind === 'monster_res') return '🛡';
  return th.element === 'fire' ? '🔥' : th.element === 'cold' ? '❄' : th.element === 'lightning' ? '⚡' : th.element === 'chaos' ? '☠' : '⚔';
}

function renderVerdict(el: HTMLElement, threat: MapThreat, checks: MapPrepCheck[], statsNote: string): void {
  const parts: string[] = [];

  // Заголовок: уровень + босс + резисты монстров.
  const head: string[] = [`area level <b>${threat.area_level}</b>`];
  head.push(`босс: ${threat.boss.name ? `<b>${esc(threat.boss.name)}</b>` : 'шаблонный'} — элем-резист ${threat.boss.res.ele}%, chaos ${threat.boss.res.chaos}%`);
  if ((threat.monsterEleBonus ?? 0) > 0 || (threat.monsterChaosRes ?? 0) > 0) {
    head.push(`резисты монстров: +${threat.monsterEleBonus ?? 0}% элем / +${threat.monsterChaosRes ?? 0}% chaos (элем-DPS с запасом)`);
  }
  parts.push(`<p class="mp-head">${head.join(' · ')}</p>`);

  // Опасные моды (только с threat; биомы/вариетис НЕ рендерим — SPEC §6).
  const danger = threat.matchedMods.filter((m) => m.threat);
  if (danger.length) {
    const rows = danger
      .map((m) => {
        const th = m.threat!;
        const v = th.value;
        const desc =
          th.kind === 'player_debuff'
            ? `эффект на игроке: <b>${esc(th.effect ?? '?')}</b>${v != null ? ` −${v}%` : ''}`
            : th.kind === 'monster_res'
              ? 'монстры с бонусными резистами'
              : `<b>${esc(th.element ?? '?')}</b>-угроза, вес ${threat.elements?.[th.element!] ?? '?'}`;
        return `<li>${threatIcon(threat, m)} <b>${esc(m.name)}</b> (ступень ${m.tierIndex + 1}): ${desc}</li>`;
      })
      .join('');
    parts.push(`<h4>⚠ Моды камня — что давит</h4><ul class="mp-mods">${rows}</ul>`);
  }
  if (threat.unknownMods.length) {
    parts.push(
      `<h4>❓ Не распознанные моды — проверь вручную</h4><ul class="mp-mods">${threat.unknownMods.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>`,
    );
  }

  // Пробелы обороны (чек-лист core.mapPrep): и упавшие, и severity ≥ 3.
  if (checks.length) {
    const rows = checks
      .filter((c) => !c.passed || c.severity >= 3)
      .map(
        (c) =>
          `<li class="mp-check">${sevBar(c.severity)} ${c.passed ? '✅' : '⛔'} ${esc(c.advice_ru)}` +
          `${c.unverified ? ' <b class="mp-unver" title="цифры/пороги не верифицированы в игре">unverified</b>' : ''}` +
          ` <span class="dim">(severity ${c.severity.toFixed(1)})</span></li>`,
      )
      .join('');
    parts.push(`<h4>🛡 Пробелы обороны по твоим статам</h4><ul class="mp-checks">${rows || '<li>Критичных пробелов по модели — но сверяйся с игрой.</li>'}</ul>`);
  } else {
    parts.push('<p class="note">Персональные EHP-чеки пропущены: билд не импортирован и резисты не заполнены. Импортируй билд во вкладке «Импорт билда» или заполни поля резистов выше.</p>');
  }
  if (statsNote) parts.push(`<p class="dim">${esc(statsNote)}</p>`);

  // Unverified-пункты — жёстко видимыми (SPEC §6).
  if (threat.unverifiedNotes.length) {
    parts.push(
      `<details class="mp-unver-box" open><summary>⚠️ Unverified-пометки (${threat.unverifiedNotes.length})</summary><ul>${threat.unverifiedNotes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></details>`,
    );
  }
  el.innerHTML = parts.join('');
}

// ─── Вкладка: init + обработчик «Вердикт» ────────────────────────────────────

function resolveMapQuery(query: string): string | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  const entry = core.dataset
    .getMapEntries()
    .find((m) => m.id.toLowerCase() === q || m.name_en.toLowerCase() === q);
  return entry?.id;
}

async function runMapPrep(): Promise<void> {
  const el = document.getElementById('out-mapprep');
  if (!el) throw new Error('missing #out-mapprep');
  setStatus('Считаю вердикт по карте…');
  el.innerHTML = '<em>Загрузка датасетов карт…</em>';
  try {
    await ensureMapsData();
    const mapQuery = (document.getElementById('mapprep-map') as HTMLInputElement).value;
    const mapId = resolveMapQuery(mapQuery);
    const tierRaw = (document.getElementById('mapprep-tier') as HTMLSelectElement).value;
    const tier = tierRaw ? parseInt(tierRaw, 10) : undefined;
    const mods = (document.getElementById('mapprep-mods') as HTMLTextAreaElement)
      .value.split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const res = (['fire', 'cold', 'lightning', 'chaos'] as const).map(
      (k) => (document.getElementById(`mapprep-res-${k}`) as HTMLInputElement)?.value.trim() ?? '',
    );
    const hasManual = res.every((v) => v !== '');

    const b = resistsFromLastBuild();
    const stats: DefensiveStats | null = hasManual
      ? {
          life: b.life ?? 3000, // пул неизвестен → условные 3000 (не рождаем ложный low_hp)
          energyShield: b.energyShield ?? undefined,
          fireRes: parseFloat(res[0]),
          coldRes: parseFloat(res[1]),
          lightningRes: parseFloat(res[2]),
          chaosRes: parseFloat(res[3]),
        }
      : b.fireRes != null && b.coldRes != null && b.lightningRes != null && b.chaosRes != null
        ? {
            life: b.life ?? 3000,
            energyShield: b.energyShield ?? undefined,
            fireRes: b.fireRes,
            coldRes: b.coldRes,
            lightningRes: b.lightningRes,
            chaosRes: b.chaosRes,
          }
        : null;

    const threat = core.mapPrep.mapThreat({
      map: mapId ?? (mapQuery.trim() || undefined),
      mods,
      tier,
    });
    const checks = stats ? core.mapPrep.mapPrepChecklist(stats, threat) : [];
    const statsNote = !stats
      ? ''
      : b.life == null
        ? 'Билд не импортирован: пул жизни учтён как 3000 (условно), резисты — по полям выше.'
        : 'Статы обороны из последнего разобранного билда (вкладка «Импорт билда»).';
    renderVerdict(el, threat, checks, statsNote);
    setStatus('Вердикт по карте готов.');
  } catch (e) {
    el.innerHTML = `<p class="err">Ошибка: ${esc(e instanceof Error ? e.message : String(e))}</p>`;
    setStatus('Ошибка вердикта по карте.');
  }
}

/** Заполнить datalist 135 картами (после первой загрузки датасета). */
async function fillMapDatalist(): Promise<void> {
  try {
    await ensureMapsData();
    const dl = document.getElementById('mapprep-maps');
    if (!dl) return;
    const entries = core.dataset.getMapEntries().slice().sort((a, b2) => a.name_en.localeCompare(b2.name_en));
    dl.innerHTML = entries.map((m) => `<option value="${esc(m.name_en)}"></option>`).join('');
  } catch {
    // без датасета вкладка деградирует: mapThreat бросит понятную ошибку
  }
}

export function initMapPrepTab(): void {
  const btn = document.getElementById('btn-mapprep');
  btn?.addEventListener('click', () => void runMapPrep());

  // Резисты из последнего билда — в поля (editable fallback), один раз на загрузку.
  const b = resistsFromLastBuild();
  if (b.fireRes != null && b.coldRes != null && b.lightningRes != null && b.chaosRes != null) {
    const put = (id: string, v: number | null): void => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (el && v != null) el.value = String(Math.round(v));
    };
    put('mapprep-res-fire', b.fireRes);
    put('mapprep-res-cold', b.coldRes);
    put('mapprep-res-lightning', b.lightningRes);
    put('mapprep-res-chaos', b.chaosRes);
  }

  // Datalist — лениво, при первом открытии вкладки (как renderFullMap).
  let datalistFilled = false;
  document.querySelector('[data-tab="mapprep"]')?.addEventListener('click', () => {
    if (datalistFilled) return;
    datalistFilled = true;
    void fillMapDatalist();
  });
}
