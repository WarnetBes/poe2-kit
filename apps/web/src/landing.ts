/**
 * Лендинг «Сейчас» (№262, Этап 0): дефолт-панель web-дашборда.
 *
 * Отвечает на один вопрос: «что мне сейчас делать в игре» — склейка
 * существующих данных без новых датасетов (чек-лист верификатора №258: п.4 «дедуп»):
 *   - 📈 прокачка: первая невзятая зона чек-листа (снимок состояния из checklist.ts);
 *   - 🧬 билд: класс/асценданси + резисты последнего разобранного билда
 *     (currentBuildContext, тот же мост, что у «🗺 Карты»);
 *   - 🛡 радар: до 5 live-багов (core.listKnownIssues, тот же источник, что вкладка «Радар»).
 * Никакой сети при первом рендере: всё — офлайн-данные уже в браузере.
 * Дисциплина честности: ❓-записи на лендинг не попадают (только live).
 */

import { currentBuildContext, getActiveLeague, setStatus } from './ui';
import { liveIssues } from '@poe2-kit/core';
import { checklistSnapshot } from './checklist';

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

/** Карточка-обёртка. */
function card(cls: string, title: string, body: string): string {
  return `<div class="now-card ${cls}"><h3>${title}</h3><div class="now-body">${body}</div></div>`;
}

/** Переход на вкладку: активировать её группу, затем саму вкладку. */
function gotoTab(id: string): void {
  const tab = document.querySelector<HTMLButtonElement>(`[data-tab="${id}"]`);
  if (!tab) {
    setStatus(`Вкладка ${id} не найдена.`);
    return;
  }
  const group = tab.dataset.group ?? 'now';
  const tg = document.querySelector<HTMLButtonElement>(`.tg[data-group="${group}"]`);
  tg?.click();
  tab.click();
}

function renderNow(): void {
  const el = document.getElementById('out-now');
  if (!el) return;

  // ── 📈 Прокачка: первая невзятая зона ──────────────────────────────
  const snap = checklistSnapshot();
  const league = getActiveLeague();
  const cardLevel =
    snap.next
      ? card(
          'now-level',
          '📈 Прокачка',
          `<p>Лига: <b>${esc(league || 'по умолчанию')}</b> · зон пройдено <b>${snap.done}/${snap.total}</b>.</p>` +
            `<p>Следующая зона: <b>${esc(snap.next.zone)}</b> <span class="dim">(акт ${snap.next.act}, ур. ${snap.next.monsterLevel})</span>` +
            `${snap.next.reward ? ` — награда 🏆 <b>${esc(snap.next.reward)}</b>` : ''}</p>` +
            `<button class="ghost" id="now-goto-checklist">Открыть чек-лист</button>`,
        )
      : card(
          'now-level',
          '📈 Прокачка',
          `<p>Загружаю план прокачки… Открой чек-лист, чтобы начать.</p>` +
            `<button class="ghost" id="now-goto-checklist">Открыть чек-лист</button>`,
        );

  // ── 🧬 Билд: последний разбор ────────────────────────────────────
  const ctx = currentBuildContext();
  let cardBuild: string;
  if (ctx) {
    const st = (ctx.stats ?? {}) as Record<string, number>;
    const num = (v: unknown): string =>
      typeof v === 'number' && Number.isFinite(v) ? String(v) : '—';
    const cls = typeof ctx.class === 'string' ? ctx.class : '';
    const level = typeof ctx.level === 'number' ? ctx.level : null;
    const res = `fire ${num(st.FireResist)}% · cold ${num(st.ColdResist)}% · light ${num(st.LightResist)}% · chaos ${num(st.ChaosResist)}%`;
    cardBuild = card(
      'now-build',
      '🧬 Билд',
      `<p><b>${esc(cls || 'импортирован')}</b>${level ? `, уровень ${level}` : ''}</p>` +
        `<p class="dim">Резисты: ${esc(res)}</p>` +
        `<p class="dim">Оборона: жизнь ${num(st.Life)} · ES ${num(st.EnergyShield)}</p>` +
        `<button class="ghost" id="now-goto-build">Открыть «Импорт билда»</button>`,
    );
  } else {
    cardBuild = card(
      'now-build',
      '🧬 Билд',
      `<p class="dim">Билд ещё не разобран: вставь PoB share-код во вкладке «Импорт билда» — резисты подтянутся в «🗺 Карты» автоматически.</p>` +
        `<button class="ghost" id="now-goto-build">Импортировать билд</button>`,
    );
  }

  // ── 🛡 Радар: live-баги ───────────────────────────────────────────
  let cardRadar: string;
  try {
    const live = liveIssues() as Array<{
      title?: string;
      id?: string;
      severity?: string;
    }>;
    const top = live.slice(0, 5);
    cardRadar = card(
      'now-radar',
      '🛡 Live-баги',
      top.length
        ? `<ul class="now-list">${top
            .map(
              (i) =>
                `<li>${esc(i.title ?? '—')}${i.severity ? ` <span class="dim">(${esc(i.severity)})</span>` : ''}</li>`,
            )
            .join('')}</ul><button class="ghost" id="now-goto-radar">Весь радар</button>`
        : '<p class="dim">Live-багов в базе нет.</p>',
    );
  } catch {
    cardRadar = card('now-radar', '🛡 Live-баги', '<p class="err">Не удалось прочитать радар.</p>');
  }

  el.innerHTML = `<div class="now-grid">${cardLevel}${cardBuild}${cardRadar}</div>`;

  document.getElementById('now-goto-checklist')?.addEventListener('click', () => gotoTab('checklist'));
  document.getElementById('now-goto-build')?.addEventListener('click', () => gotoTab('build'));
  document.getElementById('now-goto-radar')?.addEventListener('click', () => gotoTab('radar'));
}

/** Инициализация лендинга: рендер + refresh при выборе лиги (чек-лист пересчитывается). */
export function initLandingTab(): void {
  renderNow();
  document.getElementById('btn-refresh-leagues')?.addEventListener('click', () => renderNow());
}
