/**
 * «Вставь предмет из игры» (P2 web).
 *
 * Читает системный буфер обмена (navigator.clipboard.readText) по нажатию
 * кнопки и сразу запускает анализ/прайс-чек без ручной вставки. Умеет
 * отличать текст предмета от PoB share-кода и маршрутизирует в нужную вкладку.
 *
 * Ограничение браузера: clipboard API работает только в защищённом контексте
 * (https или localhost) и по пользовательскому жесту — поэтому вызывается из
 * click-обработчика, а при отказе доступа честно сообщаем и предлагаем
 * ручную вставку.
 */

import { core, setStatus } from './ui';
import { showPriceCheck } from './ui';

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

/** Прочитать текстовое содержимое системного буфера. */
async function readClipboardText(): Promise<string> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
    throw new Error('Clipboard API недоступен (нужен безопасный контекст: https или localhost).');
  }
  return await navigator.clipboard.readText();
}

/**
 * Похоже ли содержимое на PoB share-код: длинная urlsafe-base64 строка без
 * переводов строк и без признаков предмета (Rarity/Редкость/--------).
 */
export function looksLikePobCode(text: string): boolean {
  const t = text.trim();
  if (t.length < 40) return false;
  // Предметы PoE2 почти всегда содержат строку редкости или разделители модов.
  if (/Rarity:|Редкость:|--------/.test(t)) return false;
  // Share-код — это base64(zlib(xml)): допустимы [A-Za-z0-9+/=_-], без пробелов/переводов строк.
  return /^[A-Za-z0-9+/=_-]+$/.test(t) && !/\s/.test(t);
}

/** Заполнить textarea прайс-чека и запустить оценку. */
function fillPriceAndCheck(text: string): void {
  const ta = document.querySelector('#price-input') as HTMLTextAreaElement | null;
  if (ta) ta.value = text;
  void showPriceCheck(text);
}

/** Заполнить поле импорта билда, переключиться на его вкладку и разобрать код. */
function fillBuildAndImport(code: string): void {
  const ta = document.querySelector('#build-input') as HTMLTextAreaElement | null;
  if (ta) ta.value = code;
  const tab = document.querySelector('[data-tab="build"]') as HTMLElement | null;
  tab?.click(); // переключиться на вкладку «Импорт билда»
  setStatus('PoB share-код распознан из буфера — разбираю билд.');
  const btn = document.querySelector('#btn-build') as HTMLButtonElement | null;
  btn?.click(); // «Разобрать»
}

/**
 * Прочитать буфер, определить тип содержимого и запустить нужное действие.
 * Возвращает распознанный тип ('item' | 'pob' | 'none').
 */
export async function pasteFromClipboard(): Promise<'item' | 'pob' | 'none'> {
  let text: string;
  try {
    text = await readClipboardText();
  } catch (e) {
    setStatus(
      `Не удалось прочитать буфер: ${e instanceof Error ? e.message : String(e)}. Вставь предмет в поле вручную (Ctrl+V).`,
    );
    const el = document.getElementById('out-price');
    if (el) el.innerHTML = `<p class="err">⚠ Не удалось прочитать буфер: ${esc(e instanceof Error ? e.message : String(e))}.<br>Это может быть из-за того, что страница не в защищённом контексте (нужен https/localhost) — просто вставь предмет в поле выше (Ctrl+V).</p>`;
    return 'none';
  }

  const trimmed = text.trim();
  if (!trimmed) {
    setStatus('Буфер пуст. Скопируй предмет в игре (Ctrl+C) или вставь вручную.');
    const el = document.getElementById('out-price');
    if (el) el.innerHTML = '<p class="err">Буфер пуст. Скопируй предмет в игре (Ctrl+C), затем повтори.</p>';
    return 'none';
  }

  if (looksLikePobCode(trimmed)) {
    fillBuildAndImport(trimmed);
    return 'pob';
  }

  fillPriceAndCheck(trimmed);
  return 'item';
}