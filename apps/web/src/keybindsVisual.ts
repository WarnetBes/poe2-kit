/**
 * Визуальные схемы раскладки (№223): SVG-геймпад (Xbox/PS) и SVG-клавиатура
 * с навыками, посаженными на кнопки. Арты активных гемов из CDN недоступны
 * (poe2db блокирует не-браузерные запросы; путей poecdn не выдумываем) —
 * кнопки окрашиваются стихией камня: core.dataset.supportGemColors()
 * (стихии PoE2: intelligence=синий, strength=красный, dexterity=зелёный).
 * Схема — наша стилизация, не официальный арт GGG.
 */
import type { KeybindAdvice, KeybindSlot } from '@poe2-kit/core';
import { core } from './ui';

const SVGNS = 'http://www.w3.org/2000/svg';

const COLOR_HEX: Record<string, string> = {
  blue: '#4f8fd4',
  red: '#d15454',
  green: '#57c47a',
};

const C_TEXT = '#e8e2d0';
const C_DIM = '#6b7280';
const C_FRAME = '#3a4050';
const C_BODY = '#14171e';

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

/** Цвет(а) стихии камня: массив hex (0–2) или [] → серый. */
function gemColors(en: string): string[] {
  const cs = core.dataset.supportGemColors(en);
  if (!cs?.length) return [];
  return cs.map((c) => COLOR_HEX[c] ?? C_DIM);
}

/** №227: перенос подписи в 1–2 строки (вместо уродливой обрезки 12 симв.). */
function wrapLabel(s: string, maxChars: number, maxLines = 2): string[] {
  const words = s.trim().split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if (`${cur} ${w}`.length <= maxChars) cur += ` ${w}`;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  // №227: одиночное слово длиннее maxChars резать с «…» (wrap по пробелам его не трогает).
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i] ?? '').length > maxChars) lines[i] = (lines[i] ?? '').slice(0, Math.max(1, maxChars - 1)) + '…';
  }
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1]!.slice(0, Math.max(1, maxChars - 1)) + '…';
    return kept;
  }
  return lines;
}

interface Pb {
  /** позиция центра */
  x: number;
  y: number;
  rx: number;
  ry: number;
  /** форма кнопки: одна нотация платформы (Y или △), без дублей «Y / △» */
  shape: 'circle' | 'capsule' | 'rect';
  /** подпись формы, нотация текущей платформы */
  label: string;
}

function slotMap(a: KeybindAdvice): Map<string, KeybindSlot> {
  const m = new Map<string, KeybindSlot>();
  for (const s of [...a.assignments, ...a.system, ...a.free]) m.set(s.slot, s);
  return m;
}

/** Отрисовка одной кнопки корпуса: цвет по стихии + подписи гема/системы. */
function gButton(p: Pb, s: KeybindSlot | undefined, opts: { small?: boolean } = {}): string {
  const colors = s && s.gem ? gemColors(s.gem) : [];
  const filled = !!s && s.role !== 'free';
  const stroke = filled ? (colors[0] ?? '#c8a24a') : C_FRAME;
  const fill = filled ? (colors[0] ?? '#c8a24a') + '33' : '#1c2029';
  const shape =
    p.shape === 'circle'
      ? `<ellipse cx="${p.x}" cy="${p.y}" rx="${p.rx}" ry="${p.ry}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`
      : p.shape === 'capsule'
        ? `<rect x="${p.x - p.rx}" y="${p.y - p.ry}" width="${p.rx * 2}" height="${p.ry * 2}" rx="${p.ry}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`
        : `<rect x="${p.x - p.rx}" y="${p.y - p.ry}" width="${p.rx * 2}" height="${p.ry * 2}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
  // гибрид (2 стихии): вторая — дуга-обводка
  const hybrid =
    colors.length > 1
      ? `<path d="M ${p.x - p.rx} ${p.y} a ${p.rx} ${p.ry} 0 0 0 ${p.rx * 2} 0" fill="none" stroke="${colors[1]}" stroke-width="2" opacity="0.85"/>`
      : '';
  // №227: имя — переносом до 2 строк в кнопке, полное имя — в <title>-tooltip.
  const tip = s && (s.gem || s.system) ? `<title>${esc(s.gem ?? s.system ?? '')}</title>` : '';
  const firstName = s && s.role === 'system' && s.system ? s.system : (s?.gem ?? '');
  const multi = !!firstName && !opts.small && p.shape === 'circle';
  const nameSize = opts.small ? 10.5 : 11;
  const nameLines = multi ? wrapLabel(firstName, p.rx > 20 ? 8 : 9, 2) : [];
  const nameText = nameLines.length
    ? nameLines
        .map(
          (ln, i) =>
            `<text x="${p.x}" y="${p.y + (nameLines.length === 1 ? 5 : -3 + i * (nameSize + 1))}" text-anchor="middle" font-size="${nameSize}" fill="${C_TEXT}">${esc(ln)}</text>`,
        )
        .join('')
    : firstName
      ? `<text x="${p.x}" y="${p.y + 9}" text-anchor="middle" font-size="${nameSize}" fill="${C_TEXT}">${esc(wrapLabel(firstName, 22, 1)[0]!)}</text>`
      : '';
  const labelAbove = p.label && nameLines.length ? p.y - p.ry - 5 : null;
  const labelText = p.label
    ? labelAbove != null
      ? `<text x="${p.x}" y="${labelAbove}" text-anchor="middle" font-size="11" font-weight="bold" fill="${filled ? stroke : C_DIM}">${esc(p.label)}</text>`
      : firstName
        ? // капсула/таб с навыком: нотация сверху, имя ниже, межстрочный зазор ≥13px — без пересечения глифов
          `<text x="${p.x}" y="${p.y - 5}" text-anchor="middle" font-size="10.5" font-weight="bold" fill="${filled ? stroke : C_DIM}">${esc(p.label)}</text>`
        : `<text x="${p.x}" y="${p.y + 4}" text-anchor="middle" font-size="12" font-weight="bold" fill="${filled ? C_TEXT : C_DIM}">${esc(p.label)}</text>`
    : '';
  return `<g>${tip}${shape}${hybrid}${labelText}${nameText}</g>`;
}

/** Капсула L2-слоя (геймпад): «удерживай LT + кнопка». */
function l2chip(key: string, ps: string, s: KeybindSlot | undefined): string {
  const colors = s?.gem ? gemColors(s.gem) : [];
  const stroke = colors[0] ?? (s?.role === 'system' ? C_DIM : C_FRAME);
  const name = s?.gem ?? s?.system ?? '—';
  return (
    `<g>` +
    `<title>${esc(name)}</title>` +
    `<rect x="0" y="-15" width="150" height="30" rx="15" fill="#1c2029" stroke="${stroke}" stroke-width="1.5"/>` +
    `<text x="10" y="5" font-size="12" font-weight="bold" fill="${stroke}">${esc(key)}</text>` +
    `<text x="10" y="5" dx="46" font-size="11" fill="${s?.gem || s?.system ? C_TEXT : C_DIM}">${esc(wrapLabel(name, 15, 1)[0]!)}</text>` +
    (ps ? `<text x="140" y="-20" font-size="9" fill="${C_DIM}" text-anchor="end">${esc(ps)}</text>` : '') +
    `</g>`
  );
}

/** SVG-схема геймпада (№227: начисто): симметричный корпус, LT — подсказка,
 *  одна нотация кнопок, русские подписи, без пересечений D-pad/стик/фляги. */
function gamepadSvg(a: KeybindAdvice): string {
  const m = slotMap(a);
  const ps = a.platform === 'playstation';
  const at = (slot: string): KeybindSlot | undefined => m.get(slot);
  const parts: string[] = [];

  // триггеры: тонкие язычки над корпусом; LT не «кнопка» — подпись-подсказка
  parts.push(
    `<rect x="115" y="44" width="130" height="20" rx="10" fill="#1c2029" stroke="${C_FRAME}" stroke-width="1.5"/>` +
      `<text x="180" y="58" text-anchor="middle" font-size="10" fill="${C_DIM}">${ps ? 'L2 — слой 2 (удерживай)' : 'LT — слой 2 (удерживай)'}</text>`,
  );
  parts.push(gButton({ x: 460, y: 54, rx: 65, ry: 13, shape: 'rect', label: ps ? 'R2' : 'RT' }, at('RT'), { small: true }));

  // бамперы
  parts.push(gButton({ x: 170, y: 104, rx: 40, ry: 14, shape: 'capsule', label: ps ? 'L1' : 'LB' }, at('LB'), { small: true }));
  parts.push(gButton({ x: 470, y: 104, rx: 40, ry: 14, shape: 'capsule', label: ps ? 'R1' : 'RB' }, at('RB'), { small: true }));

  // корпус — симметричен относительно x=320
  parts.push(
    `<path d="M 130 108 L 510 108 Q 585 112 600 200 Q 612 296 540 316 L 452 332 Q 415 340 392 318 L 360 288 L 280 288 L 248 318 Q 225 340 188 332 L 100 316 Q 28 296 40 200 Q 55 112 130 108 Z" fill="${C_BODY}" stroke="${C_FRAME}" stroke-width="3"/>`,
  );

  // центральные кнопки
  parts.push(
    `<circle cx="285" cy="132" r="8" fill="#1c2029" stroke="${C_FRAME}"/>` +
      `<circle cx="355" cy="132" r="8" fill="#1c2029" stroke="${C_FRAME}"/>` +
      `<circle cx="320" cy="132" r="11" fill="#1c2029" stroke="${C_DIM}"/>`,
  );

  // D-pad (влевее, отдель от левого стика). ◀▶ — база LT-слоя (чипы ниже).
  const dx = 140;
  const dy = 190;
  const dpad = (x: number, y: number, label: string, s: KeybindSlot | undefined, capAbove: boolean): string => {
    const filled = !!s && (s.role === 'system' || !!s.gem);
    const firstName = s && s.role === 'system' && s.system ? s.system : (s?.gem ?? '');
    const lines = firstName ? wrapLabel(firstName, 9, 2) : [];
    const caption = lines
      .map((ln, i) => {
        const yy = capAbove ? 128 - (lines.length - 1 - i) * 10 : 248 + i * 10;
        return `<text x="${x}" y="${yy}" text-anchor="middle" font-size="9" fill="${filled ? C_TEXT : C_DIM}">${esc(ln)}</text>`;
      })
      .join('');
    return (
      `<g><title>${esc(firstName || label)}</title>` +
      `<circle cx="${x}" cy="${y}" r="15" fill="${filled ? '#262c3a' : '#1c2029'}" stroke="${filled ? C_DIM : C_FRAME}" stroke-width="1.5"/>` +
      `<text x="${x}" y="${y + 4}" text-anchor="middle" font-size="12" fill="${C_DIM}">${esc(label)}</text>` +
      caption +
      `</g>`
    );
  };
  parts.push(dpad(dx, dy - 32, '▲', at('D-Pad ▲'), true));
  parts.push(dpad(dx, dy + 32, '▼', at('D-Pad ▼'), false));
  parts.push(dpad(dx - 32, dy, '◀', undefined, true));
  parts.push(dpad(dx + 32, dy, '▶', undefined, true));

  // стики: левый — движение, правый — камера (по-русски, №227)
  const stick = (x: number, y: number, label: string, slot?: KeybindSlot): string =>
    `<g><title>${esc(slot?.gem ?? label)}</title>` +
    `<circle cx="${x}" cy="${y}" r="34" fill="#1c2029" stroke="${C_FRAME}" stroke-width="2"/>` +
    `<circle cx="${x}" cy="${y}" r="24" fill="#252b38" stroke="${C_FRAME}"/>` +
    `<text x="${x}" y="${y + 48}" text-anchor="middle" font-size="10" fill="${C_DIM}">${esc(label)}</text></g>`;
  parts.push(stick(250, 258, 'движение', at('left stick')));
  parts.push(stick(390, 258, 'камера', at('right stick')));

  // face-кнопки: ромб, одна нотация платформы
  parts.push(gButton({ x: 500, y: 156, rx: 22, ry: 22, shape: 'circle', label: ps ? '△' : 'Y' }, at('Y')));
  parts.push(gButton({ x: 464, y: 192, rx: 22, ry: 22, shape: 'circle', label: ps ? '□' : 'X' }, at('X')));
  parts.push(gButton({ x: 536, y: 192, rx: 22, ry: 22, shape: 'circle', label: ps ? '○' : 'B' }, at('B')));
  parts.push(gButton({ x: 500, y: 228, rx: 22, ry: 22, shape: 'circle', label: ps ? '✕' : 'A' }, at('A')));

  // L2-слой: панель под корпусом — чипы без дыр (сквозная нумерация, не по слоту)
  const l2order = ['LT+RB', 'LT+RT', 'LT+Y', 'LT+X', 'LT+B', 'LT+◀', 'LT+▶'];
  const chipDefs = l2order
    .map((k) => ({ k, s: at(k) }))
    .filter(({ s }) => s && s.role !== 'free')
    .map(({ k, s }) => ({
      // LT+RB -> «LT+RB», LT+◀ -> «LT+◀» (сплайс уже с нужным суффиксом)
      key: (a.platform === 'playstation' ? 'L2+' : 'LT+') + k.slice(3),
      s,
    }));
  const chips = chipDefs
    .map(
      ({ key, s }, i) =>
        `<g transform="translate(${(i % 4) * 160}, ${Math.floor(i / 4) * 44})">${l2chip(key, '', s)}</g>`,
    )
    .join('');
  parts.push(
    `<g transform="translate(40, 356)">` +
      `<text x="0" y="0" font-size="12" fill="${C_DIM}">${ps ? 'Удерживай L2 + кнопка (второй слой)' : 'Удерживай LT + кнопка (второй слой)'}</text>` +
      `<g transform="translate(0, 24)">${chips}</g>` +
      `</g>`,
  );

  const rows = Math.ceil(chipDefs.length / 4);
  const h = 356 + 24 + rows * 44 + 14;
  return `<svg viewBox="0 0 640 ${h}" xmlns="${SVGNS}" role="img" aria-label="Схема раскладки геймпада" font-family="inherit">${parts.join('')}</svg>`;
}


/** SVG-схема клавиатуры: мышь + ряд QWERT + Space + фляги 1–5. */
function keyboardSvg(a: KeybindAdvice): string {
  const m = slotMap(a);
  const at = (slot: string): KeybindSlot | undefined => m.get(slot);
  const parts: string[] = [];

  // мышь
  parts.push(
    `<path d="M 60 60 L 110 60 Q 132 60 132 92 L 132 150 Q 132 182 110 182 L 60 182 Q 38 182 38 150 L 38 92 Q 38 60 60 60 Z" fill="${C_BODY}" stroke="${C_FRAME}" stroke-width="3"/>` +
      `<line x1="85" y1="60" x2="85" y2="140" stroke="${C_FRAME}" stroke-width="2"/>`,
  );
  const mouseBtn = (key: string, label: string, y: number, h: number): string =>
    `<g>${gButton({ x: 85, y: y, rx: 42, ry: h, shape: 'rect', label: '' }, at(key), { small: true })}` +
    `<text x="85" y="${y + 18}" text-anchor="middle" font-size="11" font-weight="bold" fill="${C_DIM}">${esc(label)}</text></g>`;
  parts.push(mouseBtn('LMB', 'LMB', 86, 14));
  parts.push(
    `<g>${gButton({ x: 85, y: 114, rx: 14, ry: 12, shape: 'rect', label: '' }, at('MMB'), { small: true })}` +
      `<text x="85" y="118" text-anchor="middle" font-size="9" fill="${C_DIM}">MMB</text></g>`,
  );
  parts.push(mouseBtn('RMB', 'RMB', 142, 14));

  // подпись гемов мыши — правее (не лезут в корпус)
  for (const [key, dy] of [['LMB', 80], ['RMB', 150]] as Array<[string, number]>) {
    const s = at(key);
    if (s?.gem) {
      const c = gemColors(s.gem)[0] ?? '#c8a24a';
      parts.push(
        `<g><title>${esc(s.gem)}</title><text x="145" y="${dy}" font-size="12" fill="${c}">${esc(s.slot)}: ${esc(wrapLabel(s.gem, 18, 1)[0]!)}</text></g>`,
      );
    }
  }

  // клавиши Q W E R T
  const keys: Array<{ k: string; x: number }> = [
    { k: 'Q', x: 230 },
    { k: 'W', x: 298 },
    { k: 'E', x: 366 },
    { k: 'R', x: 434 },
    { k: 'T', x: 502 },
  ];
  for (const { k, x } of keys) parts.push(gButton({ x, y: 70, rx: 30, ry: 30, shape: 'rect', label: k }, at(k)));

  // WASD-кластер (в wasd-режиме занят движением)
  const wasd = (x: number, y: number, k: string): string =>
    `<g><rect x="${x - 16}" y="${y - 16}" width="32" height="32" rx="6" fill="#1c2029" stroke="${C_FRAME}" stroke-width="1.5"/>` +
    `<text x="${x}" y="${y + 5}" text-anchor="middle" font-size="13" fill="${C_DIM}">${esc(k)}</text></g>`;
  parts.push(`<g><text x="230" y="130" font-size="11" fill="${C_DIM}">движение:</text>${wasd(310, 140, 'W')}${wasd(278, 176, 'A')}${wasd(310, 176, 'S')}${wasd(342, 176, 'D')}</g>`);

  // Space — Dodge, 1–5 — фляги
  parts.push(gButton({ x: 320, y: 240, rx: 120, ry: 20, shape: 'rect', label: 'Space' }, at('Space')));
  parts.push(
    `<g><text x="230" y="300" font-size="11" fill="${C_DIM}">фляги (дефолт):</text>` +
      [1, 2, 3, 4, 5]
        .map(
          (n, i) =>
            `<g><rect x="${310 + i * 40}" y="286" width="32" height="24" rx="5" fill="#1c2029" stroke="${C_FRAME}"/><text x="${326 + i * 40}" y="303" text-anchor="middle" font-size="12" fill="${C_DIM}">${n}</text></g>`,
        )
        .join('') +
      `</g>`,
  );

  return `<svg viewBox="0 0 600 330" xmlns="${SVGNS}" role="img" aria-label="Схема раскладки клавиатуры" font-family="inherit">${parts.join('')}</svg>`;
}

/** Блок «картинка контроллера» для вкладки: над текстовыми карточками. */
export function visualBlock(a: KeybindAdvice): string {
  const kb = a.platform === 'keyboard';
  const svg = kb ? keyboardSvg(a) : gamepadSvg(a);
  const note = kb
    ? 'Схема клавиатуры: клавиши окрашены стихией навыка (сила/ловкость/интеллект). Дефолты фляг/Space — эвристика, сверь в игре. Полное имя навыка — наведи курсор.'
    : 'Схема геймпада: кнопки окрашены стихией навыка (сила/ловкость/интеллект). Второй слой — «удерживай LT/L2 + кнопка», панель под корпусом. Полное имя навыка — наведи курсор.';
  return `<div class="kb-visual"><details open><summary>${kb ? 'Схема клавиатуры' : 'Схема геймпада'}</summary>${svg}<p class="kb-note">${esc(note)}</p></details></div>`;
}
