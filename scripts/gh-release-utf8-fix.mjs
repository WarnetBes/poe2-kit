/**
 * gh-release-utf8-fix.mjs — №702: лечение mojibake тел GitHub-релизов.
 *
 * ДИАГНОЗ (страница github.com/WarnetBes/poe2-kit/releases, 30.10.2026):
 * тела релизов v1.0.31/v1.0.36 содержат «╨░╨╗╨╕╨░╤Б»-класс мусора: исходные
 * UTF-8 байты русского текста были декодированы как cp866 (дефолт русской
 * виндовой консоли) и в таком виде сохранены. Латиница/цифры_Decодировались
 * нейтрально (0x20–0x7E совпадают) — поэтому замусорены только русские фрагменты.
 *
 * ЛЕЧЕНИЕ: обратная перекодировка — каждому символу тела возвращаем его
 * cp866-байт (таблица из TextDecoder('ibm866')) → исходные UTF-8 байты →
 * UTF-8. Смесь «английский + замусоренный русский» восстанавливается целиком.
 * Тела без mojibake-маркеров НЕ трогаем (детектор по box-drawing/кракозябрам
 * из диапазонов U+25xx/D1 xx-паттернов).
 *
 * ЗАПУСК (нужен живой `gh auth login -h github.com`):
 *   node scripts/gh-release-utf8-fix.mjs           # показать (dry-run)
 *   node scripts/gh-release-utf8-fix.mjs --apply   # PATCH тел
 * Гейты: перекодированное тело обязано содержать кириллицу и не содержать
 * маркеров мусора — иначе релиз пропускается.
 */
import { execSync } from 'node:child_process';

const REPO = process.env.POE2K_GH_REPO ?? 'WarnetBes/poe2-kit';
const APPLY = process.argv.includes('--apply');

// cp866: байт → чар (однократно, каноническим декодером Node).
const dec866 = new TextDecoder('ibm866');
const charToByte = new Map();
for (let b = 0; b < 256; b++) charToByte.set(dec866.decode(new Uint8Array([b])), b);

const looksMojibake = (s) => /[╨╤][\u2500-\u25FF\u0410-\u044F]|╤В|┬а/.test(s);

/** Обратная перекодировка cp866→UTF-8. null = чар вне cp866 (текст не мусор). */
function restore(s) {
  const bytes = [];
  for (const ch of s) {
    const b = charToByte.get(ch);
    if (b === undefined) return null;
    bytes.push(b);
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
}

const gh = (args, input) =>
  execSync(`gh api ${args}`, {
    encoding: 'utf8',
    maxBuffer: 1 << 26,
    timeout: 60_000,
    ...(input != null ? { input } : {}),
  });

const releases = JSON.parse(gh(`repos/${REPO}/releases?per_page=100`));
let fixed = 0;
for (const r of releases) {
  const body = r.body ?? '';
  if (!looksMojibake(body)) {
    console.log(`[skip] ${r.tag_name}: маркеров mojibake нет`);
    continue;
  }
  const restored = restore(body);
  const ok = restored != null && /[\u0400-\u04FF]/.test(restored) && !looksMojibake(restored);
  if (!ok) {
    console.log(`[HOLD] ${r.tag_name}: восстановление не прошло гейт — ручная проверка!`);
    continue;
  }
  console.log(`[${APPLY ? 'fix' : 'dry'}] ${r.tag_name}: ${restored.slice(0, 80).replace(/\n/g, ' ')}…`);
  if (APPLY) {
    gh(`--method PATCH repos/${REPO}/releases/${r.id} --input -`, JSON.stringify({ body: restored }));
    fixed++;
  }
}
if (!APPLY) console.log('\ndry-run; повторите с --apply для PATCH.');
else console.log(`\nвылечено релизов: ${fixed}`);
