/**
 * Вкладка «🛡 Радар» (№256): что изменилось в игре и что сейчас сломано.
 *
 * Секции: патч-таймлайн (patches.json), живые баги (known_issues.json,
 * live), ❓ неподтверждённые, ✅ исправленные, 🧩 фичи-не-баги, 💡 хитрости
 * (tricks.json), свежесть данных (core.freshness — в браузере деградирует
 * до «—», полный прогон — через MCP-тул poe2_data_freshness).
 *
 * Данные — в @poe2-kit/core (radar.ts, №256/Этап 4-2); здесь — только
 * рендер. Дисциплина честности: unverified-записи — с ❓-пометкой,
 * источники — у каждой live-записи. Рендер ленивый, по первому клику.
 * Ни одного внешнего запроса.
 */

import { setStatus } from './ui';
import {
  listKnownPatches,
  latestKnownPatch,
  knownPatchesMeta,
  listKnownIssues,
  listKnownTricks,
  radarMeta,
  datasetFreshnessList,
  type KnownIssue,
  type KnownTrick,
} from '@poe2-kit/core';

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

function md(s: string): string {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

function unver(title: string): string {
  return ` <b class="mp-unver" title="${esc(title)}">unverified</b>`;
}

const DAYS_MS = 86_400_000;

/** Дней от фиксированной точки (as_of радара) до даты патча — без часового пояса клиента. */
function agoLabel(iso: string, nowMs: number): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const d = Math.round((nowMs - ms) / DAYS_MS);
  if (d < 0) return 'скоро';
  if (d === 0) return 'сегодня';
  return `${d} дн назад`;
}

const SEV_LABEL: Record<string, string> = {
  'progress-block': 'блокирует прогресс',
  'progress-loss': 'потеря прогресса/лута',
  loot: 'влияет на лут',
  damage: 'молча режет урон',
  perf: 'производительность',
  exploit: 'был эксплойтом',
  'endgame-plan': 'влияет на эндгейм-план',
  'perk-broken': 'сломанная механика',
  minor: 'мелочь',
};

function issueCard(i: KnownIssue): string {
  const risk = i.risk === 'ban' ? '<b style="color:#d05555"> ⚠ ToS-риск</b>' : '';
  const src = (i.sources ?? [])
    .map((u) =>
      /^https?:/.test(u) ? `<a href="${esc(u)}" target="_blank" rel="noreferrer">источник</a>` : esc(u.split('(')[0].trim()),
    )
    .join(' · ');
  return `<div class="rad-issue">
    <h4>${esc(i.title)} <span class="dim">(${esc(i.id)})</span></h4>
    <p>${md(i.mechanism)}${i.unverified ? unver(i.unverified) : ''}</p>
    ${i.workaround ? `<p class="note"><b>Воркараунд:</b> ${esc(i.workaround)}${risk}</p>` : risk ? `<p class="note">${risk}</p>` : ''}
    <p class="dim">${i.fixed_in ? `Исправлено в ${esc(i.fixed_in)} · ` : ''}${esc(SEV_LABEL[i.severity ?? ''] ?? '')}${i.severity && Array.isArray(i.report_dates) && i.report_dates.length ? ' · ' : ''}${(i.report_dates ?? []).join(', ') ?? ''}${src ? ` · ${src}` : ''}</p>
  </div>`;
}

function trickCard(t: KnownTrick): string {
  const src = (t.sources ?? [])
    .map((u) =>
      /^https?:/.test(u) ? `<a href="${esc(u)}" target="_blank" rel="noreferrer">источник</a>` : esc(u.split('(')[0].trim()),
    )
    .join(' · ');
  return `<div class="rad-issue">
    <h4>${t.unverified ? '❓ ' : ''}${esc(t.title)} <span class="dim">(${esc(t.id)})</span></h4>
    <p>${md(t.mechanism)}</p>
    <p class="note"><b>Как использовать:</b> ${esc(t.usage)}</p>
    <p class="dim">${t.category ? `${esc(t.category)} · ` : ''}${src}</p>
  </div>`;
}

interface VerifyBox {
  box: HTMLElement | null;
}

function renderRadar(el: HTMLElement): void {
  const nowMs = Date.now();
  const m = radarMeta();
  const pm = knownPatchesMeta();
  const patches = listKnownPatches();
  const last = latestKnownPatch();
  const p: string[] = [];

  // B0. Факты-строка: срез + счётчики
  p.push(`
    <div class="sim-facts">
      <div class="sim-fact"><b>${esc(m.patch ?? '—')}</b><span>патч-контур, срез ${esc(m.asOf ?? '—')}</span></div>
      <div class="sim-fact"><b style="color:#d05555">${m.issuesLive}</b><span>живых багов</span></div>
      <div class="sim-fact"><b style="color:#d0a355">${m.issuesUnconfirmed}</b><span>❓ неподтверждённых</span></div>
      <div class="sim-fact"><b style="color:#57a355">${m.issuesFixed}</b><span>исправлено</span></div>
      <div class="sim-fact"><b>${m.issuesFeature}</b><span>фич-не-багов</span></div>
      <div class="sim-fact"><b>${m.tricksTotal}</b><span>легальных хитростей</span></div>
    </div>`);

  // B1. Патч-таймлайн
  p.push(`
    <h3 id="rad-patches">⏱ Патч-таймлайн</h3>
    <p class="hint lvhead">? <b>${esc(last ? `${last.version} (${last.date})` : '—')}</b>: последний подтверждённый патч; версии с неточной датой — с пометкой.</p>
    <div class="sim-scroll"><table class="tbl">
      <thead><tr><th>Версия</th><th>Дата</th><th>Тип</th><th>Название</th><th>Возраст</th></tr></thead>
      <tbody>
        ${[...patches]
          .reverse()
          .map(
            (x) => `<tr>
              <td><b>${esc(x.version)}</b></td>
              <td>${x.date_accuracy ? `<span title="точность даты: ${esc(x.date_accuracy)}">≈</span> ` : ''}${esc(x.date)}${x.date_accuracy ? ` <span class="dim" title="точность даты: ${esc(x.date_accuracy)}">(${esc(x.date_accuracy)})</span>` : ''}</td>
              <td>${x.hotfix ? 'хотфикс' : x.league ? '<b>лига</b>' : 'патч'}</td>
              <td>${esc(x.title ?? '—')}${x.unverified ? unver(x.unverified) : ''}</td>
              <td class="dim">${agoLabel(x.date, nowMs)}</td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table></div>
    <p class="note">Реестр: ${pm.total} версий, из них ${pm.unverified} имеют неточную дату. Курация ручная — при выходе нового патча обновляется волной ресёрча.</p>`);

  // B2. Живые баги
  const issues = listKnownIssues();
  const live = issues.filter((i) => i.status === 'live');
  const unconf = issues.filter((i) => i.status === 'unverified');
  const fixed = issues.filter((i) => i.status === 'fixed');
  const feats = issues.filter((i) => i.status === 'feature');

  p.push(`
    <h3 id="rad-live">🐛 Сейчас сломано (${live.length})</h3>
    ${live.map((i) => issueCard(i)).join('')}`);

  p.push(`
    <h3 id="rad-unconf">❓ Подтверждено слабо — не факт (${unconf.length})</h3>
    ${unconf.map((i) => issueCard(i)).join('') || '<p class="note">Ничего сомнительного не накоплено.</p>'}`);

  // B3. Исправлено
  p.push(`
    <h3 id="rad-fixed">✅ Исправлено (${fixed.length})</h3>
    ${fixed.map((i) => issueCard(i)).join('') || '<p class="note">Архив пуст.</p>'}`);

  // B4. Фичи-не-баги
  p.push(`
    <h3 id="rad-features">🧩 Фичи-не-баги (${feats.length})</h3>
    <p class="note">Официально задокументированная механика, которую легко принять за баг — паника необоснованна.</p>
    ${feats.map((i) => issueCard(i)).join('')}`);

  // B5. Хитрости
  const tricks = listKnownTricks();
  p.push(`
    <h3 id="rad-tricks">💡 Легальные хитрости (${tricks.length})</h3>
    ${tricks.map((t) => trickCard(t)).join('')}`);

  // B6. Свежесть данных kit'а
  let freshRows = '';
  let freshNote = '';
  try {
    const fresh = datasetFreshnessList(nowMs);
    const stale = fresh.filter((d) => d.stale).length;
    const readable = fresh.some((d) => d.fetchedAt != null);
    freshNote = readable
      ? `Протухших: ${stale} из ${fresh.length}. Полный прогон и обновление — MCP-тул poe2_data_freshness / npm run refresh-data.`
      : 'В браузере чтение датасетов с диска недоступно (манифест без fetchedAt) — живую свежесть смотри через MCP-тул poe2_data_freshness.';
    freshRows = fresh
      .slice(0, 8)
      .map(
        (d) => `<tr>
          <td>${esc(d.rel)}</td>
          <td>${esc(d.sourceId)}</td>
          <td>${esc(d.kind)}/${esc(d.update)}</td>
          <td>${d.fetchedAt ? esc(d.fetchedAt.slice(0, 10)) : '—'}</td>
          <td>${d.stale ? `<b style="color:#d05555">STALE (${esc(d.staleReason ?? '')})</b>` : d.note ? `⚠ ${esc(d.note)}` : '✅'}</td>
        </tr>`,
      )
      .join('');
  } catch {
    freshNote = 'Свежесть недоступна (браузерный режим без диска) — используй MCP-тул poe2_data_freshness.';
  }
  p.push(`
    <h3 id="rad-fresh">📊 Свежесть данных kit'а</h3>
    <div class="sim-scroll"><table class="tbl">
      <thead><tr><th>Датасет</th><th>Источник</th><th>kind/update</th><th>Дата</th><th>Состояние</th></tr></thead>
      <tbody>${freshRows}</tbody>
    </table></div>
    <p class="note">${esc(freshNote)}</p>`);

  el.innerHTML = p.join('');
}

// ─── Вкладка: init + ленивый рендер ───────────────────────────────────────────

export function initRadarTab(): void {
  let rendered = false;
  document.querySelector('[data-tab="radar"]')?.addEventListener('click', () => {
    if (rendered) return;
    rendered = true;
    const el = document.getElementById('out-radar');
    if (!el) return;
    renderRadar(el);
    setStatus('Радар открыт: срез 0.5.5e-эпохи; ❓-пункты требуют сверки с игрой.');
  });
}
