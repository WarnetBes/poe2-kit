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

/** Сокращённая подпись гема для кнопки. */
function shortLabel(s: string): string {
  const t = s.trim();
  return t.length > 12 ? t.slice(0, 11) + '…' : t;
}

interface Pb {
  /** позиция центра */
  x: number;
  y: number;
  rx: number;
  ry: number;
  /** форма */
  shape: 'circle' | 'capsule' | 'rect';
  /** подпись формы (нотация Xbox) */
  label: string;
  /** подпись в PS-нотации */
  psLabel?: string;
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
  const nameSize = opts.small ? 11 : 12;
  const btnName = opts.small ? 10 : 11;
  const nameY = p.shape === 'circle' ? p.y + 4 : p.y + 4;
  const sub =
    s && s.role === 'system' && s.system
      ? `<text x="${p.x}" y="${nameY}" text-anchor="middle" font-size="${nameSize}" fill="${C_TEXT}">${esc(shortLabel(s.system))}</text>`
      : s && s.gem
        ? `<text x="${p.x}" y="${nameY}" text-anchor="middle" font-size="${nameSize}" fill="${C_TEXT}">${esc(shortLabel(s.gem))}</text>`
        : '';
  return (
    `<g>` +
    shape +
    hybrid +
    (p.label
      ? `<text x="${p.x}" y="${p.y + p.ry + 14}" text-anchor="middle" font-size="${btnName}" fill="${filled ? stroke : C_DIM}" font-weight="bold">${esc(p.label)}${p.psLabel ? `<tspan fill="${C_DIM}"> / ${esc(p.psLabel)}</tspan>` : ''}</text>`
      : '') +
    sub +
    `</g>`
  );
}

/** Капсула L2-слоя (геймпад): «удерживай LT + кнопка». */
function l2chip(key: string, ps: string, s: KeybindSlot | undefined): string {
  const colors = s?.gem ? gemColors(s.gem) : [];
  const stroke = colors[0] ?? (s?.role === 'system' ? C_DIM : C_FRAME);
  const name = s?.gem ?? s?.system ?? '—';
  return (
    `<g>` +
    `<rect x="0" y="-15" width="150" height="30" rx="15" fill="#1c2029" stroke="${stroke}" stroke-width="1.5"/>` +
    `<text x="10" y="5" font-size="12" font-weight="bold" fill="${stroke}">${esc(key)}</text>` +
    `<text x="10" y="5" dx="46" font-size="11" fill="${s?.gem || s?.system ? C_TEXT : C_DIM}">${esc(shortLabel(name))}</text>` +
    (ps ? `<text x="140" y="-20" font-size="9" fill="${C_DIM}" text-anchor="end">${esc(ps)}</text>` : '') +
    `</g>`
  );
}

/** SVG-схема геймпада: слой 0 на корпусе, L2-слой — панелью под ним. */
function gamepadSvg(a: KeybindAdvice): string {
  const m = slotMap(a);
  const ps = a.platform === 'playstation';
  const at = (slot: string): KeybindSlot | undefined => m.get(slot);
  const parts: string[] = [];

  // корпус
  parts.push(
    `<path d="M 150 80 Q 130 78 118 100 L 64 190 Q 52 214 78 226 L 150 258 Q 200 278 320 278 Q 440 278 490 258 L 562 226 Q 588 214 576 190 L 522 100 Q 510 78 490 80 L 420 74 L 220 74 Z" fill="${C_BODY}" stroke="${C_FRAME}" stroke-width="3"/>`,
  );

  // триггеры и бампера
  parts.push(gButton({ x: 210, y: 62, rx: 46, ry: 14, shape: 'rect', label: ps ? 'L2 (модификатор)' : 'LT (модификатор)' }, undefined, { small: true }));
  parts.push(gButton({ x: 430, y: 62, rx: 46, ry: 14, shape: 'rect', label: ps ? 'R2' : 'RT' }, at('RT'), { small: true }));
  parts.push(gButton({ x: 175, y: 100, rx: 34, ry: 13, shape: 'capsule', label: ps ? 'L1' : 'LB' }, at('LB'), { small: true }));
  parts.push(gButton({ x: 465, y: 100, rx: 34, ry: 13, shape: 'capsule', label: ps ? 'R1' : 'RB' }, at('RB'), { small: true }));

  // стики (используются игрой, в PoE2 правый — камера)
  const stick = (x: number, y: number, label: string): string =>
    `<g><circle cx="${x}" cy="${y}" r="34" fill="#1c2029" stroke="${C_FRAME}" stroke-width="2"/>` +
    `<circle cx="${x}" cy="${y}" r="24" fill="#252b38" stroke="${C_FRAME}"/>` +
    `<text x="${x}" y="${y + 44}" text-anchor="middle" font-size="10" fill="${C_DIM}">${esc(label)}</text></g>`;
  parts.push(stick(150, 190, ps ? 'левый стик' : 'left stick'));
  parts.push(stick(320, 250, ps ? 'правый стик (камера)' : 'right stick (camera)'));

  // D-pad: ▲▼ — фляги (система), ◀▶ — база под L2-слой
  const dx = 150;
  const dy = 120;
  const dpad = (x: number, y: number, label: string, s: KeybindSlot | undefined): string => {
    const filled = !!s && s.role === 'system';
    const name = s?.system ? shortLabel(s.system) : '';
    return (
      `<g><circle cx="${x}" cy="${y}" r="14" fill="${filled ? '#1c2029' : '#1c2029'}" stroke="${filled ? C_DIM : C_FRAME}" stroke-width="1.5"/>` +
      `<text x="${x}" y="${y + 4}" text-anchor="middle" font-size="11" fill="${C_DIM}">${esc(label)}</text>` +
      (name ? `<text x="${x}" y="${y + 28}" text-anchor="middle" font-size="10" fill="${C_TEXT}">${esc(name)}</text>` : '') +
      `</g>`
    );
  };
  parts.push(dpad(dx, dy - 18, '▲', at('D-Pad ▲')));
  parts.push(dpad(dx, dy + 18, '▼', at('D-Pad ▼')));
  parts.push(dpad(dx - 18, dy, '◀', undefined));
  parts.push(dpad(dx + 18, dy, '▶', undefined));

  // face-кнопки
  parts.push(gButton({ x: 465, y: 120, rx: 24, ry: 24, shape: 'circle', label: ps ? '△' : 'Y', psLabel: ps ? 'Y' : '△' }, at('Y')));
  parts.push(gButton({ x: 405, y: 175, rx: 24, ry: 24, shape: 'circle', label: ps ? '□' : 'X', psLabel: ps ? 'X' : '□' }, at('X')));
  parts.push(gButton({ x: 525, y: 175, rx: 24, ry: 24, shape: 'circle', label: ps ? '○' : 'B', psLabel: ps ? 'B' : '○' }, at('B')));
  parts.push(gButton({ x: 465, y: 230, rx: 24, ry: 24, shape: 'circle', label: ps ? '✕' : 'A', psLabel: ps ? 'A' : '✕' }, at('A')));

  // центральные
  parts.push(
    `<circle cx="255" cy="120" r="10" fill="#1c2029" stroke="${C_FRAME}"/>` +
      `<circle cx="385" cy="120" r="10" fill="#1c2029" stroke="${C_FRAME}"/>` +
      `<circle cx="320" cy="120" r="14" fill="#1c2029" stroke="${C_DIM}"/>`,
  );

  // L2-слой: панель под корпусом
  const l2order = ['LT+RB', 'LT+RT', 'LT+Y', 'LT+X', 'LT+B', 'LT+◀', 'LT+▶'];
  const chips = l2order
    .map((slot, i) => {
      const s = at(slot);
      if (!s || s.role === 'free') return '';
      const keyLabel = ps ? 'L2+' + slot.slice(3) : 'LT+' + slot.slice(3);
      return `<g transform="translate(${(i % 4) * 160}, ${Math.floor(i / 4) * 44})">${l2chip(keyLabel, '', s)}</g>`;
    })
    .join('');
  parts.push(
    `<g transform="translate(40, 300)">` +
      `<text x="0" y="0" font-size="12" fill="${C_DIM}">${ps ? 'Удерживай L2 + кнопка (редкие слоты)' : 'Удерживай LT + кнопка (редкие слоты)'}</text>` +
      `<g transform="translate(0, 24)">${chips}</g>` +
      `</g>`,
  );

  const h = Math.ceil(
    (l2order.filter((k) => {
      const s = at(k);
      return s && s.role !== 'free';
    }).length + 3) / 4,
  );
  return `<svg viewBox="0 0 640 ${h > 1 ? 370 : 320}" xmlns="${SVGNS}" role="img" aria-label="Схема раскладки геймпада" font-family="inherit">${parts.join('')}</svg>`;
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
        `<text x="145" y="${dy}" font-size="12" fill="${c}">${esc(s.slot)}: ${esc(shortLabel(s.gem))}</text>`,
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
  parts.push(gButton({ x: 320, y: 240, rx: 120, ry: 20, shape: 'rect', label: 'Space', psLabel: '' }, at('Space')));
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
  const svg = a.platform === 'keyboard' ? keyboardSvg(a) : gamepadSvg(a);
  const note =
    a.platform === 'keyboard'
      ? 'Схема клавиатуры: кнопки окрашены стихией навыка (сила/ловкость/интеллект). Деы фляг/Space — эвристика дефолтов, сверь в игре.'
      : 'Схема геймпада: кнопки окрашены стихией навыка (сила/ловкость/интеллект). Слой «удерживай LT/L2» — редкие слоты, вынесен панелью.';
  return `<div class="kb-visual"><details open><summary>Схема контроллера</summary>${svg}<p class="kb-note">${esc(note)}</p></details></div>`;
}
