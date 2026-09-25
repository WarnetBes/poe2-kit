/**
 * Сравнение билда с топ-лестницей класса (P2 web, #17).
 *
 * Логика — та же, что в MCP poe2_build_compare (P1 #6): сохраняет поведение
 * между веб-UI и MCP. Декодим PoB share-код → класс/асценданси → качаем пул
 * лестницы того же класса с poe.ninja → сверяем DPS/EHP (медиана/топ +
 * перцентиль пользователя). Честно: числа из poe.ninja — суммарные движка PoB,
 * ваши — PlayerStat (если билд считался в PoB) или приближённая геар-оценка.
 */

import { core, setStatus, getActiveLeague } from './ui';

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

function out(): HTMLElement {
  const el = document.getElementById('out-compare');
  if (!el) throw new Error('missing output element out-compare');
  return el;
}

/** Совет: по умолчанию слаг снапшот-лиги poe.ninja для референса. */
export const DEFAULT_LADDER_SLUG = 'forbiddenrites';

/** Сравнить билд по share-коду с пулом лестницы класса. */
export async function showBuildCompare(code: string, slug: string): Promise<void> {
  const el = out();
  if (!code?.trim()) {
    el.innerHTML = '<p class="err">Вставь share-код PoB (или XML).</p>';
    return;
  }
  el.innerHTML = '<em>Сравнение… (пул билдов того же класса качается с poe.ninja)</em>';
  setStatus('Сравнение билда с топ-лестницей класса…');
  try {
    const est = await core.estimate.estimateBuild(code.trim(), {
      expectedHitSize: 1000,
      attackerAccuracy: 2000,
    });
    const className = est.ascendancy ?? est.className;
    if (!className) {
      el.innerHTML = '<p class="err">Не удалось определить класс/асценданси — сравнение с лестницей невозможно.</p>';
      setStatus('Класс не определён.');
      return;
    }
    const leagueSlug = (slug?.trim() || DEFAULT_LADDER_SLUG);
    let rows: Awaited<ReturnType<typeof core.ladder.topLadderBuilds>> = [];
    try {
      rows = await core.ladder.topLadderBuilds(leagueSlug, { className, sort: 'dps', limit: 100 });
    } catch {
      /* пул недоступен — покажем оценку без меты */
    }
    const userDps = est.pobStats.TotalDPS ?? (est.weapon.totalDps > 0 ? est.weapon.totalDps : null);
    const userEhp = est.pobStats.TotalEHP ?? (est.worstEhp ? est.worstEhp.effectiveHp : null);
    const ref = core.advice.buildReferenceFromRows(rows, {
      level: est.characterLevel ?? undefined,
      dps: userDps,
      ehp: userEhp,
      className,
    });
    el.innerHTML = renderCompare(est, ref, className, leagueSlug, rows.length);
    setStatus(`Сравнение: пул ${ref.poolSize} строк «${className}» (лига «${leagueSlug}»).`);
  } catch (e) {
    el.innerHTML = `<p class="err">Ошибка сравнения: ${esc(e instanceof Error ? e.message : String(e))}</p>`;
    setStatus('Ошибка сравнения билда.');
  }
}

/** Отрисовать результат сравнения с топ-лестницей класса. */
function renderCompare(
  est: Awaited<ReturnType<typeof core.estimate.estimateBuild>>,
  ref: Awaited<ReturnType<typeof core.advice.buildReferenceFromRows>>,
  className: string,
  leagueSlug: string,
  poolSize: number,
): string {
  const d = est.defenses;
  const srcLabel = est.source === 'pob+gear' ? 'гир + PlayerStat PoB' : 'только гир';
  const userDps = est.pobStats.TotalDPS ?? (est.weapon.totalDps > 0 ? est.weapon.totalDps : null);
  const dpsSrc = est.pobStats.TotalDPS !== undefined ? 'движок PoB' : 'геар-оценка (только оружие)';
  const userEhp = est.pobStats.TotalEHP ?? (est.worstEhp ? est.worstEhp.effectiveHp : null);
  const ehpSrc = est.pobStats.TotalEHP !== undefined ? 'движок PoB' : 'геар-оценка (слабейший тип)';

  const row = (label: string, value: string) => `<tr><td>${esc(label)}</td><td>${value}</td></tr>`;

  // ── Перцентили ──
  const pctRows: string[] = [];
  if (ref.dpsPercentile != null && userDps != null) {
    pctRows.push(row(
      'DPS',
      `<b>${esc(core.advice.fmtSuffix(userDps))}</b> → ~${ref.dpsPercentile.toFixed(0)}-й перцентиль <span class="dim">(медиана ${esc(core.advice.fmtSuffix(ref.medianDps))}, топ ${esc(core.advice.fmtSuffix(ref.topDps))})</span>`,
    ));
  } else {
    pctRows.push(row('DPS', '<span class="dim">пул лестницы или оценка недоступны</span>'));
  }
  if (ref.ehpPercentile != null && userEhp != null) {
    pctRows.push(row(
      'EHP',
      `<b>${esc(core.advice.fmtSuffix(userEhp))}</b> → ~${ref.ehpPercentile.toFixed(0)}-й перцентиль <span class="dim">(медиана ${esc(core.advice.fmtSuffix(ref.medianEhp))}, топ ${esc(core.advice.fmtSuffix(ref.topEhp))})</span>`,
    ));
  } else {
    pctRows.push(row('EHP', '<span class="dim">пул лестницы или оценка недоступны</span>'));
  }

  // ── Сводка против меты ──
  const verdicts: string[] = [];
  if (userDps != null && ref.topDps != null && ref.topDps > 0) {
    const ratio = userDps / ref.topDps;
    verdicts.push(
      `<li>${ratio >= 0.9
        ? `DPS ${ratio >= 1 ? 'на уровне/впереди' : 'почти вплотную к'} топ-1.`
        : `DPS в <b>${(ref.topDps / userDps).toFixed(1)}× ниже</b> топ-1 (${esc(core.advice.fmtSuffix(ref.topDps))}).`}</li>`,
    );
  } else if (userDps != null) {
    verdicts.push(`<li>DPS: ${esc(core.advice.fmtSuffix(userDps))} (без пула меты).</li>`);
  }
  if (userEhp != null && ref.topEhp != null && ref.topEhp > 0) {
    const ratio = userEhp / ref.topEhp;
    verdicts.push(
      `<li>${ratio >= 0.9
        ? 'EHP на уровне топ-1 класса.'
        : `EHP в <b>${(ref.topEhp / userEhp).toFixed(1)}× ниже</b> топ-1 (${esc(core.advice.fmtSuffix(ref.topEhp))}).`}</li>`,
    );
  } else if (userEhp != null) {
    verdicts.push(`<li>EHP: ${esc(core.advice.fmtSuffix(userEhp))} (без пула меты).</li>`);
  }
  const minRes = Math.min(d.fireRes, d.coldRes, d.lightningRes, d.chaosRes);
  verdicts.push(
    d.fireRes < 75 || d.coldRes < 75 || d.lightningRes < 75
      ? `<li>Резисты ниже капа 75% — хуже всего <b>${minRes.toFixed(0)}%</b> — чинить в первую очередь.</li>`
      : '<li>Резисты все ≥ 75% (кап) — ок.</li>',
  );

  return [
    `<h3>Сравнение с топ-лестницей класса: <b>${esc(className)}</b></h3>`,
    `<p class="meta">Референс: <b>${esc(leagueSlug)}</b>, ${poolSize} строк «${esc(className)}» (сортировка по DPS). Пул с poe.ninja.</p>`,
    '<h4>Ваш билд</h4>',
    '<table class="tbl"><tbody>',
    row('Персонаж', `${esc(est.className ?? '?')}${est.ascendancy ? ` / ${esc(est.ascendancy)}` : ''}, уровень ${est.characterLevel ?? '?'}`),
    row('Источник', esc(srcLabel)),
    row('DPS', `<b>${userDps != null ? esc(core.advice.fmtSuffix(userDps)) : '—'}</b> <span class="dim">(${esc(dpsSrc)})</span>`),
    row('EHP', `<b>${userEhp != null ? esc(core.advice.fmtSuffix(userEhp)) : '—'}</b> <span class="dim">(${esc(ehpSrc)})</span>`),
    row('Скорость атаки', `${est.weapon.attacksPerSecond ? `${est.weapon.attacksPerSecond.toFixed(2)} aps` : '—'} <span class="dim">(${esc(est.weapon.weapon ?? 'оружие не распознано')})</span>`),
    row('Резисты', `fire ${d.fireRes}% / cold ${d.coldRes}% / light ${d.lightningRes}% / chaos ${d.chaosRes}% <span class="dim">(кап 75%)</span>`),
    '</tbody></table>',
    '<h4>Позиция на лестнице (перцентиль, vs медиана/топ)</h4>',
    `<table class="tbl"><tbody>${pctRows.join('')}</tbody></table>`,
    '<h4>Сводка против меты</h4>',
    `<ul class="verdicts">${verdicts.join('')}</ul>`,
    '<p class="note">Сравнение — «порядок величины»: poe.ninja даёт суммарные числа движка PoB, ваши — как выше (PlayerStat точнее геар-оценки). Для точных перцентилей лучше открыть билд в PoB.</p>',
    `<p class="note">Активная лига в шапке: ${esc(getActiveLeague() || '—')}. Снапшот-лига референса лестницы задаётся отдельным полем.</p>`,
  ].join('\n');
}