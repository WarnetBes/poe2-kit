/**
 * Вкладка «🌀 Simulacrum» (№239): энциклопедия + гайд по активности
 * Simulacrum (Delirium 0.5.x) в PoE2. Режим — статический гайд
 * (решение владельца): цепочка доступа, волны, шарды, боссы, лут,
 * стратегии, атлас-ноды Delirium, чек-лист готовности.
 *
 * Данные — в ядре @poe2-kit/core (core.simulacrum, Phase-2 №239):
 * тот же источник питает MCP-тул poe2_simulacrum_guide. Здесь — только
 * рендер. Дисциплина честности: спорные факты — с пометкой «unverified»
 * (механизмы №236/№222: помечаем, не скрываем). Рендер ленивый —
 * по первому клику вкладки. Ни одного внешнего запроса.
 */
import { setStatus } from './ui';
import {
  SIM_FACTS,
  SIM_ACCESS_STEPS,
  SIM_ACCESS_NOTE,
  SIM_WAVES,
  SIM_WAVES_NOTE,
  SIM_SHARDS,
  SIM_SHARDS_NOTE,
  SIM_BOSSES,
  SIM_LOOT,
  SIM_LOOT_NOTE,
  SIM_TIPS,
  SIM_ATLAS_NODES,
  SIM_ATLAS_NOTE,
  SIM_CHECKLIST,
  SIM_FOOTNOTE,
  SIM_KNOWN_ISSUES,
} from '@poe2-kit/core';

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

/** Строки из core содержат markdown-жирность (**…**) — в HTML это <b>. */
function md(s: string): string {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

/** Полоска опасности 0..10 — тот же визуальный язык, что mapPrep.sevBar (№236). */
function sevBar(severity: number): string {
  const pct = Math.round(Math.max(0, Math.min(10, severity)) * 10);
  const color = severity >= 6 ? '#d05555' : severity >= 3 ? '#d0a355' : '#57a355';
  return `<span class="mp-sev" style="display:inline-block;width:64px;height:8px;border-radius:4px;background:rgba(255,255,255,0.12);vertical-align:middle"><span style="display:block;width:${pct}%;height:100%;border-radius:4px;background:${color}"></span></span>`;
}

/** Пометка для спорных фактов (фирменный ⚠️-рендер poe2-kit). */
function unver(title: string): string {
  return ` <b class="mp-unver" title="${esc(title)}">unverified</b>`;
}

/** Событие/факт core-структуры → HTML (текст + опц. unverified-хвост). */
function evHtml(text: string, unverified?: string): string {
  return md(text) + (unverified ? unver(unverified) : '');
}

// ─── Рендер ──────────────────────────────────────────────────────────────────

function renderSimulacrum(el: HTMLElement): void {
  const p: string[] = [];

  // B0. Fact-box
  p.push(`
    <div class="sim-facts">
      ${SIM_FACTS.map(
        (f) => `<div class="sim-fact"><b>${esc(f.value)}</b><span>${esc(f.label)}${f.unverified ? unver(f.unverified) : ''}</span></div>`,
      ).join('')}
    </div>`);

  // B1. Доступ — stepper
  p.push(`
    <h3 id="sim-access">🔗 Как попасть</h3>
    <ol class="sim-steps">
      ${SIM_ACCESS_STEPS.map(
        (st) => `<li>${evHtml(st.text, st.unverified)}</li>`,
      ).join('')}
    </ol>
    <p class="note">${esc(SIM_ACCESS_NOTE)}</p>`);

  // B2. Волны + шарды
  p.push(`
    <h3 id="sim-waves">🌊 Волны (7)</h3>
    <div class="sim-scroll"><table class="tbl sim-waves">
      <thead><tr><th>Волна</th><th>Deliriousness</th><th>Опасность (расчёт)</th><th>События</th></tr></thead>
      <tbody>
        ${SIM_WAVES.map(
          (w) => `<tr${w.wave === 7 ? ' class="sim-final"' : ''}>
            <td><b>${w.wave}</b></td>
            <td>${esc(w.deliriousness)}</td>
            <td>${sevBar(w.danger)}</td>
            <td>${w.events.map((e) => `<span class="sim-badge">${evHtml(e.text, e.unverified)}</span>`).join(' ') || '—'}</td>
          </tr>`,
        ).join('')}
      </tbody>
    </table></div>
    <p class="note">${esc(SIM_WAVES_NOTE)}</p>

    <h4>Выбор между волнами: Fracturing Shards</h4>
    <p class="note">${esc(SIM_SHARDS_NOTE)}</p>
    <div class="sim-shards">
      ${SIM_SHARDS.map(
        (s) => `<div class="sim-shard">
          <h4>${esc(s.name)} ${sevBar(s.danger)}</h4>
          <p>${esc(s.effect)}</p>
          <p class="dim">${esc(s.rec)}</p>
        </div>`,
      ).join('')}
    </div>`);

  // B3. Боссы
  p.push(`
    <h3 id="sim-bosses">👹 Боссы</h3>
    <div class="sim-bosses">
      ${SIM_BOSSES.map(
        (b) => `<div class="sim-boss">
          <h4>${esc(b.name)} <span class="dim">— ${esc(b.sub)}</span></h4>
          <div class="sim-bosstags">${b.tags.map((t) => `<span class="sim-badge">${esc(t)}</span>`).join('')}</div>
          <div class="sim-scroll"><table class="tbl">
            <thead><tr><th>Атака</th><th>Телеграф</th><th>Ответ</th><th>Опасность</th></tr></thead>
            <tbody>
              ${b.attacks.map(
                (a) => `<tr><td><b>${esc(a.attack)}</b></td><td>${esc(a.telegraph)}</td><td>${esc(a.response)}</td><td>${sevBar(a.danger)}</td></tr>`,
              ).join('')}
            </tbody>
          </table></div>
          <p class="note">${esc(b.note)}${b.noteUnverified ? unver(b.noteUnverified) : ''}</p>
        </div>`,
      ).join('')}
    </div>`);

  // B4. Лут
  p.push(`
    <h3 id="sim-loot">💰 Лут и экономика</h3>
    <div class="sim-scroll"><table class="tbl sim-loot">
      <thead><tr><th>Награда</th><th>Источник</th><th>Тип</th><th>Заметки</th></tr></thead>
      <tbody>
        ${SIM_LOOT.map(
          (l) => `<tr><td><b>${esc(l.reward)}</b></td><td>${esc(l.source)}</td><td>${esc(l.kind)}</td>
            <td>${esc(l.note)}${l.unverified ? unver(l.unverified) : ''}</td></tr>`,
        ).join('')}
      </tbody>
    </table></div>
    <p class="note">${esc(SIM_LOOT_NOTE)}</p>`);

  // B5. Стратегии
  p.push(`
    <h3 id="sim-strategy">🧭 Стратегии</h3>
    ${SIM_TIPS.map(
      (t) => `<details class="sim-collapse"${t.title === 'Топ-5 причин смерти' ? ' open' : ''}>
        <summary>${esc(t.title)}</summary>
        <ul class="mp-mods">${t.body.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
      </details>`,
    ).join('')}`);

  // B6. Атлас-ноды
  p.push(`
    <h3 id="sim-atlas">🗺 Атлас-ноды Delirium</h3>
    <div class="sim-scroll"><table class="tbl">
      <thead><tr><th>Нода</th><th>Разблокировка</th><th>Эффект</th><th>Приоритет</th></tr></thead>
      <tbody>
        ${SIM_ATLAS_NODES.map(
          (n) => `<tr><td><b>${esc(n.name)}</b></td><td>${esc(n.req)}</td><td>${esc(n.effect)}</td>
            <td>${n.priority === 'mandatory' ? '<b style="color:#d05555">обязательная</b>' : n.priority === 'high' ? '<b style="color:#d0a355">высокий</b>' : 'опционально'}</td></tr>`,
        ).join('')}
      </tbody>
    </table></div>
    <p class="note">${esc(SIM_ATLAS_NOTE)}</p>`);

  // B7. Чек-лист
  p.push(`
    <h3 id="sim-check">⚖️ Готовность — чек-лист перед входом</h3>
    <div class="sim-known">
      <h4>⚠️ Известные баги (open, 0.5.x)</h4>
      ${SIM_KNOWN_ISSUES.map(
        (k) => `<p class="note"><b>${esc(k.issue)}</b><br>Воркараунд: ${esc(k.workaround)}<br>
          <span class="dim">Статус: ${esc(k.status)}</span>${k.unverified ? unver(k.unverified) : ''}</p>`,
      ).join('')}
    </div>
    <div class="sim-checklist">
      <button id="sim-copy-checklist" class="ghost">📋 Скопировать чек-лист</button>
      <ul class="mp-checks">
        ${SIM_CHECKLIST.map((c) => `<li class="mp-check">${esc(c)}</li>`).join('')}
      </ul>
    </div>
    <p class="note">${esc(SIM_FOOTNOTE)}</p>`);

  el.innerHTML = p.join('');
}

// ─── Вкладка: init + ленивый рендер ───────────────────────────────────────────

export function initSimulacrumTab(): void {
  let rendered = false;
  document.querySelector('[data-tab="simulacrum"]')?.addEventListener('click', () => {
    if (rendered) return;
    rendered = true;
    const el = document.getElementById('out-simulacrum');
    if (!el) return;
    renderSimulacrum(el);
    document.getElementById('sim-copy-checklist')?.addEventListener('click', () => {
      const text = SIM_CHECKLIST.map((c, i) => `${i + 1}. [ ] ${c}`).join('\n');
      navigator.clipboard
        ?.writeText(`Simulacrum — готовность (poe2-kit):\n${text}`)
        .then(() => setStatus('Чек-лист скопирован в буфер.'))
        .catch(() => setStatus('Clipboard недоступен — выдели и скопируй текст вручную.'));
    });
    setStatus('Гайд Simulacrum открыт (0.5.x; помеченные пункты требуют сверки с игрой).');
  });
}
