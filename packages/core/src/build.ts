/**
 * Анализ и импорт билдов.
 * Поддерживает:
 *  - декодирование PoB share-кодов: urlsafe(base64(zlib(xml))) с восстановлением Adler-32
 *  - ссылки pobb.in / pastebin
 *  - сырой .build JSON (официальный формат Build Planner)
 * Полный расчёт DPS/EHP полагается на внешний движок (PoB), доступный через MCP.
 */

import type { BuildBuffs, BuildGearItem, BuildImport, BuildSkillGroup } from './types.js';
import { getSkillGemDetails } from './dataset.js';
import { PobCodeError, decodeShareCode, encodeShareCode } from './pobcode.js';

// Публичный API декодера переехал в pobcode.ts (оптимизированный), сохраняем
// доступ через namespace build.* для обратной совместимости.
export { PobCodeError, decodeShareCode, encodeShareCode, clearPobCodeCache } from './pobcode.js';


const _WS = /\s+/g;
const _POBB = /^https?:\/\/(?:www\.)?pobb\.in\/([A-Za-z0-9_-]+)\/?$/i;
const _PASTEBIN = /^https?:\/\/(?:www\.)?pastebin\.com\/(?:raw\/)?([A-Za-z0-9]+)\/?$/i;
// poe.ninja: шard-билд /poe2/pob/{id} (есть raw-эндпоинт /pob/raw/{id})
const _NINJA_BUILD = /^https?:\/\/(?:www\.)?poe\.ninja\/poe2\/pob\/(\d+)\/?$/i;
// poe.ninja: страница персонажа профиля /poe2/profile/{account}/{league}/character/{name}
const _NINJA_PROFILE_CHAR =
  /^https?:\/\/(?:www\.)?poe\.ninja\/poe2\/profile\/([^/\s?#]+)\/([^/\s?#]+)\/character\/([^/\s?#]+)\/?/i;
// Сайты, отдающие HTML-страницу, а не сырой код — их нельзя скрейпить.
const _PAGE_HOSTS = /^https?:\/\/(?:www\.)?(maxroll\.gg|pobarchives\.com|poe\.ninja|poe2\.ninja|mobalytics\.gg|pathofexile\.com)\//i;

/** Классифицировать вход: ссылка или код. */
function isLink(source: string): boolean {
  return /^https?:\/\//i.test(source.trim());
}

/** Сопоставить URL-ссылку с raw-эндпоинтом. */
function toRawUrl(url: string): string {
  const t = url.trim();
  const pb = _POBB.exec(t);
  if (pb) return `https://pobb.in/${pb[1]}/raw`;
  const pin = _PASTEBIN.exec(t);
  if (pin) return `https://pastebin.com/raw/${pin[1]}`;
  const ninja = _NINJA_BUILD.exec(t);
  if (ninja) return `https://poe.ninja/poe2/pob/raw/${ninja[1]}`;
  return t;
}

/** Скачать сырой PoB-код по ссылке. */
async function fetchCode(url: string, timeoutMs = 15000): Promise<string> {
  const rawUrl = toRawUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(rawUrl, {
      headers: { 'User-Agent': 'poe2-kit/0.1.0' },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new PobCodeError(`не удалось получить билд по ${rawUrl} (HTTP ${res.status})`);
    }
    return (await res.text()).trim();
  } catch (e) {
    if (e instanceof PobCodeError) throw e;
    throw new PobCodeError(`не удалось получить билд по ${rawUrl} (${String(e)})`);
  } finally {
    clearTimeout(timer);
  }
}

/** Превратить любое содержимое ссылки в XML, толерантно к raw-эндпоинтам. */
function coerceToXml(content: string, origin: string): string {
  const c = (content || '').trim();
  if (!c) throw new PobCodeError(`ссылка ${origin} вернула пустой контент`);
  if (c.includes('PathOfBuilding') && c.indexOf('<') < 200) return c;
  const head = c.slice(0, 256).toLowerCase().replace(/^\s+/, '');
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.includes('<head') || head.includes('<body')) {
    throw new PobCodeError(`ссылка ${origin} вернула HTML-страницу, а не PoB-код`);
  }
  return decodeShareCode(c);
}

/** Принять код ИЛИ ссылку и вернуть XML билда. */
export async function toXml(source: string): Promise<string> {
  const src = (source || '').trim();
  if (isLink(src)) {
    // raw-эндпоинты poe.ninja (шard-билд и персонаж профиля) отдают чистый код.
    const ninjaRaw = _NINJA_BUILD.test(src) || /\/pob\/raw\//.test(src);
    if (_PAGE_HOSTS.test(src) && !ninjaRaw) {
      throw new PobCodeError('это страница-билда, а не сырой PoB-код. Вставьте код экспорта.');
    }
    return coerceToXml(await fetchCode(src), src);
  }
  // Сырой decoded XML (export PoB / уже разобранный код) — пропускаем как есть.
  // Те же критерии, что в coerceToXml: PathOfBuilding в начале контента.
  if (src.includes('PathOfBuilding') && src.indexOf('<') < 200) return src;
  return decodeShareCode(src);
}

// ─── Разбор форматов ────────────────────────────────────────────────────

/** Грубый парсер XML PoB (PoB1 и PoB2): класс, асcенданси, уровень, гемы, дерево, снаряжение. */
function parseBuildXml(xml: string): Partial<BuildImport> {
  if (xml.includes('<PathOfBuilding2')) return parseBuildXml2(xml);
  const get = (tag: string): string | undefined => {
    const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
    return m?.[1]?.trim();
  };
  const asc = get('AscendancyName');
  const cls = get('ClassName') ?? get('AscendancyName');
  const levelRaw = get('characterLevel') ?? get('Level');
  const skillNames: string[] = [];
  const gemRe = /<Gem[^>]*>([\s\S]*?)<\/Gem>/g;
  let m: RegExpExecArray | null;
  while ((m = gemRe.exec(xml))) {
    const name = m[1].trim();
    if (name && !skillNames.includes(name)) skillNames.push(name);
  }
  const passives = (get('Tree') ?? '')
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const items: Record<string, string> = {};
  const itemRe = /<Item[^>]*slot="([^"]*)"[^>]*>(?:<Name>([^<]*)<\/Name>)?[\s\S]*?<\/Item>/g;
  let im: RegExpExecArray | null;
  while ((im = itemRe.exec(xml))) {
    if (im[1]) items[im[1]] = im[2]?.trim() ?? '';
  }

  return {
    class: cls,
    ascendancy: asc,
    level: levelRaw ? parseInt(levelRaw, 10) : undefined,
    skills: skillNames,
    passiveNodes: passives,
    gear: items,
  };
}

/** Парсер PoB2-формата (`<PathOfBuilding2>`): другие теги, атрибуты и вложенность. */
function parseBuildXml2(xml: string): Partial<BuildImport> {
  // <Build level="95" className="Monk" ascendClassName="Invoker" mainSocketGroup="4">
  const buildMatch = xml.match(/<Build\b([^>]*)>([\s\S]*?)<\/Build>/);
  const buildAttrs = _attrs(buildMatch?.[1] ?? '');
  const levelRaw = buildAttrs.level;
  const cls = buildAttrs.className;
  const asc = buildAttrs.ascendClassName;

  // Расчётные характеристики PoB — <PlayerStat stat="TotalDPS" value="449538..."/>.
  const stats: Record<string, number> = {};
  const psRe = /<PlayerStat\s+stat="([^"]+)"\s+value="([^"]*)"\s*\/>/g;
  let pm: RegExpExecArray | null;
  while ((pm = psRe.exec(buildMatch?.[2] ?? ''))) {
    const v = parseFloat(pm[2]!);
    if (Number.isFinite(v)) stats[pm[1]!] = v;
  }

  // Скиллы — группы <Skill …><Gem …/></Skill> (docs/POB2_XML_REFERENCE.md, §4).
  // mainSocketGroup (1-based) указывает на главную группу активного SkillSet.
  const mainGroupIdx = parseInt(buildAttrs.mainSocketGroup ?? '', 10) || 0;
  const skillGroups: BuildSkillGroup[] = [];
  const skills: string[] = [];
  const groupRe = /<Skill\b([^>]*)>([\s\S]*?)<\/Skill>/g;
  let gm: RegExpExecArray | null;
  while ((gm = groupRe.exec(xml))) {
    const gAttrs = _attrs(gm[1]!);
    // №106: привязка к оружейному набору — зеркало логики PoB2 SkillsTab.lua
    // (reader 302-303 строгий: attrib=="true"; label-функция 1408-1416:
    // оба → Both, set2 → Set 2, иначе Set 1). Атрибуты отсутствуют только в
    // легаси/ручных XML — тогда не показываем бейдж вовсе (не угадываем).
    const hasSet1 = gAttrs.set1 !== undefined;
    const set1 = gAttrs.set1 === 'true';
    const set2 = gAttrs.set2 === 'true';
    const weaponSet: BuildSkillGroup['weaponSet'] =
      hasSet1 || gAttrs.set2 !== undefined ? (set1 && set2 ? 'both' : set2 ? '2' : '1') : undefined;
    const group: BuildSkillGroup = {
      label: _unescape(gAttrs.label ?? '') || _unescape(gAttrs.slot ?? ''),
      enabled: gAttrs.enabled !== 'false' && gAttrs.active !== 'false',
      source: gAttrs.source ? _unescape(gAttrs.source) : undefined,
      weaponSet,
      gems: [],
    };
    const gemRe = /<Gem\b([^>]*?)\/?>/g;
    let gemMatch: RegExpExecArray | null;
    while ((gemMatch = gemRe.exec(gm[2]!))) {
      const a = _attrs(gemMatch[1]!);
      const name = _unescape(a.nameSpec ?? a.skillId ?? a.gemId ?? '');
      if (!name || name === 'nil' || a.enabled === 'false') continue;
      group.gems.push({
        name,
        level: /^\d+$/.test(a.level ?? '') ? Number(a.level) : null,
        quality: /^\d+$/.test(a.quality ?? '') ? Number(a.quality) : null,
      });
      if (!skills.includes(name)) skills.push(name);
    }
    if (group.gems.length > 0) skillGroups.push(group);
  }
  if (skillGroups.length > 0 && mainGroupIdx > 0 && mainGroupIdx <= skillGroups.length) {
    skillGroups[mainGroupIdx - 1]!.main = true;
  }

  // Бафы/проклятия — <Buffs buffList="…" combatList="…" curseList="…"/> внутри <Build>.
  let buffs: BuildBuffs | undefined;
  const buffsM = (buildMatch?.[2] ?? '').match(/<Buffs\b([^>]*)\/?>/);
  if (buffsM) {
    const a = _attrs(buffsM[1]!);
    buffs = {
      buffList: _csv(a.buffList),
      combatList: _csv(a.combatList),
      curseList: _csv(a.curseList),
    };
  }

  // Раскладка FullDPS — <FullDPSSkill stat="…" value="…" …/>.
  const fullDps: Array<{ stat: string; value: number }> = [];
  const fdRe = /<FullDPSSkill\s+stat="([^"]+)"\s+value="([^"]*)"[^>]*\/>/g;
  let fm: RegExpExecArray | null;
  while ((fm = fdRe.exec(buildMatch?.[2] ?? ''))) {
    const v = parseFloat(fm[2]!);
    if (Number.isFinite(v)) fullDps.push({ stat: _unescape(fm[1]!), value: v });
  }

  // Конфиг боя — активный <ConfigSet> из <Config activeConfigSet="…"> (легаси: Inputs прямо в <Config>).
  let config: Record<string, string> | undefined;
  const configEl = xml.match(/<Config\b([^>]*)>([\s\S]*?)<\/Config>/);
  if (configEl) {
    const cAttrs = _attrs(configEl[1]!);
    const cBody = configEl[2]!;
    const sets = [...cBody.matchAll(/<ConfigSet\b([^>]*)>([\s\S]*?)<\/ConfigSet>/g)].map((s) => ({
      id: _attrs(s[1]!).id ?? '',
      body: s[2]!,
    }));
    // Внутри ConfigSet-ов могут лежать секции <Section collapsed=…> — Inputs ищем по всему телу.
    const activeId = cAttrs.activeConfigSet ?? '';
    const active = sets.find((s) => s.id === activeId) ?? sets[0];
    const inputBody = active ? active.body : cBody;
    const inputs: Record<string, string> = {};
    const inpRe = /<Input\b([^>]*)\/>/g;
    let im: RegExpExecArray | null;
    while ((im = inpRe.exec(inputBody))) {
      const a = _attrs(im[1]!);
      if (!a.name) continue;
      inputs[a.name] = a.number ?? a.string ?? a.boolean ?? '';
    }
    if (Object.keys(inputs).length > 0) config = inputs;
  }

  // Заметки — верхнеуровневая секция <Notes> (не узловые <Notes> внутри <Spec>:
  // секция Tree идёт после Notes, значит ищем <Notes> до начала <Tree).
  let notes: string | undefined;
  const treeIdx = xml.search(/<Tree\b/);
  const notesRe = /<Notes\b[^>]*>([\s\S]*?)<\/Notes>/g;
  let nm: RegExpExecArray | null;
  while ((nm = notesRe.exec(xml))) {
    if (treeIdx !== -1 && nm.index > treeIdx) break;
    const t = _unescape(nm[1]!.trim());
    if (t) notes = t.slice(0, 2000);
    break;
  }

  // Дерево — <Tree><Spec nodes="id1,id2" .../></Tree>. Берём активный Spec (activeSpec 1-based).
  let passiveNodes: string[] = [];
  let treeVersion: string | undefined;
  const treeEl = xml.match(/<Tree\b([^>]*)>([\s\S]*?)<\/Tree>/);
  if (treeEl) {
    const treeAttrs = _attrs(treeEl[1]!);
    const rawActiveSpec = Math.max(1, parseInt(treeAttrs.activeSpec, 10) || 1);
    const specs = [...treeEl[2]!.matchAll(/<Spec\b([^>]*)\/?>/g)].map((s) => _attrs(s[1]!));
    if (specs.length > 0) {
      const chosen = specs[Math.min(rawActiveSpec, specs.length) - 1] ?? specs[0]!;
      passiveNodes = (chosen.nodes ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      // Версия дерева (treeVersionList = 0_1..0_5) — для авто-детекта рассинхрона с патчем датасета.
      treeVersion = chosen.treeVersion || undefined;
    }
  }

  // Снаряжение — пул <Item id=..><Name>..</Name>…</Item>, картируем через активный <ItemSet><Slot name=.. itemId=..>.
  const itemNames = new Map<string, string>();
  const itemRe = /<Item\b([^>]*)>([\s\S]*?)<\/Item>/g;
  let itm: RegExpExecArray | null;
  while ((itm = itemRe.exec(xml))) {
    const attrs = _attrs(itm[1]!);
    const id = attrs.id ?? '';
    // Имя предмета: PoB2 пишет тело КЛИР-ТЕКСТОМ (без <Name>): «Rarity: …\nИмя\nБаза\n…».
    // Ключевые строки вида «Item Level: 24» отсеиваем; имя = первая обычная строка.
    const raw = itm[2]!;
    const lt = raw.indexOf('<');
    const text = (lt >= 0 ? raw.slice(0, lt) : raw).trim();
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const keyValRe = /^[A-Za-z][\w' ]*:\s/;
    const bodyStart = lines.findIndex((l) => /^Rarity:/i.test(l)) + 1;
    const body = (bodyStart > 0 ? lines.slice(bodyStart) : lines).filter((l) => !keyValRe.test(l));
    const name = ((body[0] ?? '').trim() || lines[0] || '');
    if (id) itemNames.set(id, name);
  }
  const gear: Record<string, string> = {};
  // активный ItemSet (1-based activeItemSet) — его слоты <Slot name="Helm" itemId="3">
  const itemsEl = xml.match(/<Items\b([^>]*)>([\s\S]*?)<\/Items>/);
  if (itemsEl) {
    const itemsAttrs = _attrs(itemsEl[1]!);
    const itemSets = [
      ...itemsEl[2]!.matchAll(/<ItemSet\b([^>]*)>([\s\S]*?)<\/ItemSet>/g),
    ].map((s) => ({
      attrs: _attrs(s[1]!),
      slots: s[2]!,
    }));
    let chosenSet: string | undefined;
    const rawActive = parseInt(itemsAttrs.activeItemSet, 10) || 1;
    if (itemSets.length > 0) {
      chosenSet = (itemSets[Math.min(rawActive, itemSets.length) - 1] ?? itemSets[0]!).slots;
    }
    const slotRe = /<Slot\b([^>]*)\/?>/g;
    let sm: RegExpExecArray | null;
    while ((sm = slotRe.exec(chosenSet ?? ''))) {
      const a = _attrs(sm[1]!);
      const slotName = a.name;
      const itemId = a.itemId;
      if (slotName && itemId && itemId !== '0') {
        const nm = itemNames.get(itemId) ?? '';
        if (slotName in gear) continue; // первый выигрывает
        gear[slotName] = nm;
      }
    }
    // Подстраховка: если слотов нет, но есть именованные предметы — покажем их как есть.
    if (Object.keys(gear).length === 0) {
      for (const [id, nm] of itemNames) gear[id] = nm;
    }
  }

  return {
    class: cls,
    ascendancy: asc,
    level: levelRaw ? parseInt(levelRaw, 10) : undefined,
    skills,
    passiveNodes,
    treeVersion,
    gear,
    stats,
    skillGroups,
    buffs,
    fullDps: fullDps.length > 0 ? fullDps : undefined,
    config,
    notes,
  };
}

/** Декодировать XML-сущности (&amp; &lt; &gt; &apos; &quot;) в обычный текст. */
function _unescape(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

/** CSV-строка PoB («Herald of Ice,Precision») → массив имён. */
function _csv(s: string | undefined): string[] {
  if (!s) return [];
  return s
    .split(',')
    .map((x) => _unescape(x.trim()))
    .filter(Boolean);
}

/** Разобрать атрибуты XML-элемента `<a b="1" c/>` в объект (значения без кавычек). */
function _attrs(chunk: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*"(.*?)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(chunk))) out[m[1]!] = m[2] ?? '';
  return out;
}

/** Парсер официального .build JSON (Build Planner). */
function parseBuildJson(json: Record<string, unknown>): BuildImport {
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  const lvl = (v: unknown): number | undefined => {
    if (typeof v === 'number') return v;
    if (Array.isArray(v)) return v[0] as number | undefined;
    return undefined;
  };
  const passivesRaw = Array.isArray(json.passives) ? json.passives : [];
  const passiveNodes: string[] = [];
  for (const p of passivesRaw) {
    if (typeof p === 'string') passiveNodes.push(p);
    else if (p && typeof p === 'object') passiveNodes.push(String((p as { id?: unknown }).id ?? ''));
  }
  const skillsRaw = Array.isArray(json.skills) ? json.skills : [];
  const skills: string[] = [];
  for (const s of skillsRaw) {
    if (s && typeof s === 'object') {
      const id = (s as { id?: unknown }).id;
      if (id) skills.push(String(id));
    }
  }
  const items: Record<string, string> = {};
  const inv = Array.isArray(json.inventory_slots)
    ? json.inventory_slots
    : Array.isArray(json.items)
      ? json.items
      : [];
  for (const it of inv) {
    if (it && typeof it === 'object') {
      const o = it as { inventory_id?: unknown; unique_name?: unknown };
      if (o.inventory_id) items[String(o.inventory_id)] = o.unique_name ? String(o.unique_name) : '';
    }
  }
  return {
    source: 'build',
    class: str(json.className) ?? str(json.class) ?? str(json.ascendancy),
    ascendancy: str(json.ascendancy),
    level: lvl(json.level),
    skills,
    passiveNodes,
    gear: items,
    raw: json,
  };
}

/** Импортировать билд из кода/ссылки/сырого XML/.build JSON. */
export async function importBuild(input: string): Promise<BuildImport> {
  const trimmed = input.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      return parseBuildJson(JSON.parse(trimmed) as Record<string, unknown>);
    } catch {
      throw new Error('Не удалось разобрать .build JSON.');
    }
  }
  if (isLink(trimmed)) {
    const content = await fetchCode(trimmed);
    if (content.startsWith('{') && content.endsWith('}')) {
      return parseBuildJson(JSON.parse(content) as Record<string, unknown>);
    }
    const xml = coerceToXml(content, trimmed);
    return fromXml(xml);
  }
  // Код или сырой XML
  if (trimmed.includes('<PathOfBuilding') || trimmed.startsWith('<')) {
    return fromXml(trimmed);
  }
  const xml = decodeShareCode(trimmed);
  return fromXml(xml);
}

function fromXml(xml: string): BuildImport {
  const parsed = parseBuildXml(xml);
  return {
    source: 'pob',
    class: parsed.class,
    ascendancy: parsed.ascendancy,
    level: parsed.level,
    skills: parsed.skills ?? [],
    passiveNodes: parsed.passiveNodes ?? [],
    treeVersion: parsed.treeVersion,
    gear: parsed.gear ?? {},
    stats: parsed.stats,
    skillGroups: parsed.skillGroups,
    buffs: parsed.buffs,
    fullDps: parsed.fullDps,
    config: parsed.config,
    notes: parsed.notes,
    raw: { preview: xml.slice(0, 2000) },
  };
}

/**
 * Извлечь снаряжение билда с полным клир-текстом предметов (для прайс-чека).
 * Принимает share-код, сырой XML или ссылку на PoB.
 *
 * Возвращает по слотам активного ItemSet полный клир-текст каждого предмета —
 * ровно тот формат, который понимает `parseItemText`/`priceCheck`.
 * Предметы, текст которых не удалось распознать, пропускаются.
 */
export async function buildCodeToGear(input: string): Promise<BuildGearItem[]> {
  const trimmed = input.trim();
  let xml: string;

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    // .build JSON (официальный Build Planner / mobalytics): уникальные имеют
    // unique_name (минимальный клир-текст Rarity: Unique), у остальных —
    // additional_text, где первая строка — базовый тип, дальше целевые аффиксы
    // («1. +33 to maximum Mana», …). Синтезируем клир-текст рара: прайс-чек
    // построит stat-фильтры по этим аффиксам (searchTradeByStats).
    const result: BuildGearItem[] = [];
    try {
      const json = JSON.parse(trimmed) as {
        inventory_slots?: Array<{
          inventory_id?: string;
          unique_name?: string;
          name?: string;
          additional_text?: string;
        }>;
        items?: Array<{
          inventory_id?: string;
          unique_name?: string;
          name?: string;
          additional_text?: string;
        }>;
      };
      const inv = json.inventory_slots ?? json.items ?? [];
      for (const it of inv) {
        const slot = it.inventory_id ?? '';
        const uname = it.unique_name;
        if (uname) {
          const base = it.name ?? '';
          const itemText = [
            'Rarity: Unique',
            uname,
            base || 'Unknown',
            '--------',
          ].join('\n');
          result.push({ slot, name: uname, itemText });
          continue;
        }
        const add = it.additional_text;
        if (add) {
          const lines = add.split('\n').map((l) => l.trim()).filter(Boolean);
          if (!lines.length) continue;
          const base = lines[0];
          const mods = lines.slice(1).map((l) => l.replace(/^\d+\.\s*/, ''));
          const itemText = [
            'Rarity: Rare',
            `${base} (build target)`,
            base,
            '--------',
            ...mods,
          ].join('\n');
          result.push({ slot, name: base, itemText });
        }
      }
      return result;
    } catch {
      return [];
    }
  }
  if (trimmed.includes('<PathOfBuilding') || trimmed.startsWith('<')) {
    xml = trimmed;
  } else if (isLink(trimmed)) {
    xml = await toXml(trimmed);
  } else {
    xml = decodeShareCode(trimmed);
  }

  const items: BuildGearItem[] = [];

  // Пул предметов: id → клир-текст (до первого вложенного тега <ModRange/> и т.п.)
  const itemTextById = new Map<string, string>();
  const itemRe = /<Item\b([^>]*)>([\s\S]*?)<\/Item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml))) {
    const attrs = _attrs(m[1]!);
    if (!attrs.id) continue;
    const raw = m[2]!;
    // клир-текст — это всё до первого вложенного `<`-тега (ModRange и прочее).
    // XML-сущности (&apos; в «Arakaali&apos;s Gift» и т.п.) декодируем сразу,
    // иначе они протекают в имя/itemText (панель «носите:», прайс-чек).
    const lt = raw.indexOf('</');
    const text = _unescape(lt >= 0 ? raw.slice(0, lt) : raw).trim();
    if (text) itemTextById.set(attrs.id, text);
  }

  // Активные слоты через активный ItemSet
  const itemsEl = xml.match(/<Items\b([^>]*)>([\s\S]*?)<\/Items>/);
  if (itemsEl) {
    const itemsAttrs = _attrs(itemsEl[1]!);
    const itemSets = [
      ...itemsEl[2]!.matchAll(/<ItemSet\b([^>]*)>([\s\S]*?)<\/ItemSet>/g),
    ].map((s) => ({ attrs: _attrs(s[1]!), slots: s[2]! }));
    const rawActive = parseInt(itemsAttrs.activeItemSet, 10) || 1;
    const chosen =
      itemSets.length > 0
        ? (itemSets[Math.min(rawActive, itemSets.length) - 1] ?? itemSets[0]!).slots
        : '';
    const seen = new Set<string>();
    const slotRe = /<Slot\b([^>]*)\/?>/g;
    let sm: RegExpExecArray | null;
    while ((sm = slotRe.exec(chosen))) {
      const a = _attrs(sm[1]!);
      const slot = a.name ?? '';
      const itemId = a.itemId ?? '';
      if (!itemId || itemId === '0') continue;
      const text = itemTextById.get(itemId);
      if (!text || seen.has(itemId)) continue;
      seen.add(itemId);
      const parsedName = text.match(/^Rarity:[^\n]*\n([^\n]+)/m)?.[1]?.trim() ?? '';
      items.push({ slot, name: parsedName, itemText: text });
    }
    // Подстраховка: если слотов не оказалось — возьмём все распознанные предметы.
    if (items.length === 0) {
      for (const [id, text] of itemTextById) {
        const parsedName = text.match(/^Rarity:[^\n]*\n([^\n]+)/m)?.[1]?.trim() ?? '';
        items.push({ slot: '', name: parsedName, itemText: text });
      }
    }
  }

  return items;
}

/** Сетап камней билда: активный камень + поддержки + подсказка «куда вставлять». */
export interface GemSetup {
  /** Активный камень (имя как в игре). */
  active: string;
  /** Уровень активного камня из билда. */
  activeLevel: number | null;
  /** Поддержки, вставляемые в тот же предмет. */
  supports: string[];
  /** Откуда сетап: сокет предмета / пассивно с дерева/восхождения. */
  source: 'socket' | 'passive';
  /** Подсказка, в какой слот снаряжения вставлять. */
  where: string;
  /**
   * №106: привязка группы камней к оружейному набору (атрибуты PoB2
   * set1/set2, зеркалит PoB2 SkillsTab.lua). 'both' = любой набор;
   * '1'/'2' = только этот набор; undefined = в XML данных нет (легаси).
   * Если камень вставлен в предмет набора II, а активен I — игра пишет
   * «нельзя использовать с текущими настройками оружия».
   */
  weaponSet?: 'both' | '1' | '2';
}

/**
 * Разобрать сетапы камней из билда (PoB XML): группы <Skill> с <Gem>.
 * Подсказка «куда» — эвристика по типам скилла из базы RePoE:
 * атаки → оружейный слот, гаральды/резервации → крупный предмет, прочее — куда угодно.
 */
export async function buildGemSetups(input: string): Promise<GemSetup[]> {
  // Сырой XML принимаем напрямую (как importBuild), иначе — код/ссылка PoB.
  const t = input.trim();
  const xml = t.includes('<PathOfBuilding') || t.startsWith('<') ? t : await toXml(input);
  const setups: GemSetup[] = [];
  const groups = xml.match(/<Skill\b[\s\S]*?<\/Skill>/g) ?? [];
  for (const g of groups) {
    const gTag = g.match(/<Skill\b[^>]*>/)?.[0] ?? '';
    if (!/\benabled="true"/.test(gTag)) continue;
    const treeSource = /\bsource="Tree:[^"]*"/.test(g);
    // №106: привязка к оружейному набору — set1/set2 (см. GemSetup.weaponSet).
    // Явное 'false' у обоих и невозможность (кнопки PoB не снимают оба) не
    // обрабатываем — логика PoB: оба true → 'both', set2 → '2', иначе '1'.
    // Отсутствие обоих атрибутов (легаси/ручной XML) → undefined.
    const ws1 = /\bset1="([^"]*)"/.exec(gTag)?.[1];
    const ws2 = /\bset2="([^"]*)"/.exec(gTag)?.[1];
    const weaponSet: GemSetup['weaponSet'] =
      ws1 === undefined && ws2 === undefined
        ? undefined
        : ws1 === 'true' && ws2 === 'true'
          ? 'both'
          : ws2 === 'true'
            ? '2'
            : '1';
    const gemRe = /<Gem\b([^>]*?)\/?>/g;
    let m: RegExpExecArray | null;
    const gems: Array<{ name: string; level: number | null; gemId: string; variant: string; count: string | null }> = [];
    while ((m = gemRe.exec(g))) {
      const a = _attrs(m[1]);
      const name = String(a.nameSpec ?? a.skillId ?? '')
        .replace(/&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();
      if (!name || name === 'nil') continue;
      if (a.enabled === 'false') continue;
      gems.push({
        name,
        level: a.level != null && /^\d+$/.test(String(a.level)) ? Number(a.level) : null,
        gemId: String(a.gemId ?? ''),
        variant: String(a.variantId ?? ''),
        count: a.count != null ? String(a.count) : null,
      });
    }
    if (!gems.length) continue;
    // Пассивные: выданы деревом/восхождением (source=Tree, ascendancy-вариант, count=nil).
    const passive = treeSource || gems.every((x) => /\/ascendancy/i.test(x.gemId) || x.variant.startsWith('Ascendancy')) || gems.every((x) => x.count === 'nil');
    if (passive) {
      const act = gems[0];
      if (setups.some((s) => s.active === act.name)) continue;
      setups.push({ active: act.name, activeLevel: null, supports: [], source: 'passive', where: 'не вставляется — пассивно (дерево/восхождение)' });
      continue;
    }
    // Активный камень: не саппорт (по gemId), саппорты — остальные.
    // №141: добавлен name-тест «… Support» — верифицировано по датасету
    // (680/680 саппортов оканчиваются на « Support», 0/1365 активных так не
    // называются). Нужен кодам БЕЗ gemId/variantId (конструктор связок №141
    // пишет честный nameSpec — выдумывать PoB-идентификаторы запрещено).
    const isSupport = (x: { gemId: string; variant: string; name: string }) =>
      /support/i.test(x.gemId) || /Support$/.test(x.variant) || /\sSupport$/.test(x.name);
    const activeGem = gems.find((x) => !isSupport(x)) ?? gems[0];
    // Ascendancy-камень (напр. Meditate) — пассивный, не вставляется никуда.
    if (/ascendancy/i.test(activeGem.gemId) || activeGem.variant.startsWith('Ascendancy')) {
      if (!setups.some((s) => s.active === activeGem.name)) {
        setups.push({
          active: activeGem.name,
          activeLevel: null,
          supports: [],
          source: 'passive',
          where: 'не вставляется — даётся восхождением',
        });
      }
      continue;
    }
    const supports = gems.filter((x) => x !== activeGem && isSupport(x)).map((x) => x.name);
    const otherActives = gems.filter((x) => x !== activeGem && !isSupport(x)).map((x) => x.name);
    // Подсказка «куда» по типам скилла. Порядок важен: гаральды содержат
    // тип Attack, поэтому проверяем резервацию раньше.
    let where = 'куда угодно (шлем / броня / перчатки…)';
    let detTypes: string[] = [];
    try {
      detTypes = getSkillGemDetails(activeGem.name)?.skillTypes ?? [];
    } catch {
      /* базы нет — дефолт */
    }
    const sock = gems.length;
    if (detTypes.includes('Herald') || detTypes.includes('HasReservation')) {
      where = 'куда угодно, НЕ в оружие — резервация духа';
    } else if (detTypes.includes('Attack')) {
      where = sock > 3 ? `в оружие; связка из ${sock} камней — часть саппортов в другие предметы` : 'в оружие (Weapon)';
    } else if (detTypes.includes('Spell')) {
      where = 'куда угодно (напр., Body Armour)';
    }
    // №106: группа привязана к оружейному набору — камень нельзя вставлять
    // в предмет другого набора; предупреждаем прямо в подсказке.
    if (weaponSet === '1' || weaponSet === '2') {
      where += `; только набор оружия ${weaponSet === '1' ? 'I' : 'II'} (set${weaponSet} в PoB) — вне набора игра блокирует: «нельзя использовать с текущими настройками оружия»`;
    }
    const existing = setups.find((s) => s.active === activeGem.name);
    if (existing) {
      // №106: тот же камень в нескольких группах — доносим привязку, если
      // она строже уже записанной (например, '2' вместо отсутствия).
      if (weaponSet && (!existing.weaponSet || existing.weaponSet === 'both')) existing.weaponSet = weaponSet;
      continue;
    }
    setups.push({
      active: activeGem.name,
      activeLevel: activeGem.level,
      supports: [...otherActives.map((n) => `${n} (активный!)`), ...supports],
      source: 'socket',
      where,
      weaponSet,
    });
  }
  return setups;
}

/** Простые метрики билда (детально — через MCP/AI). */
export function summarizeBuild(build: BuildImport): string {
  const skills = build.skills.length ? build.skills.slice(0, 3).join(', ') : 'не указаны';
  const nodes = build.passiveNodes.length;
  const gearEntries = Object.keys(build.gear ?? {}).length;
  const st = build.stats ?? {};
  const dps = st.TotalDPS ?? st.CombinedDPS;
  const life = st.Life ?? st['_Life'] ?? st['LifeUnreservedMax'];
  const es = st['EnergyShield'] ?? st['_EnergyShield'];
  const lines = [
    `Класс: ${build.class ?? '?'}${build.ascendancy ? ` (${build.ascendancy})` : ''}`,
    `Уровень: ${build.level ?? '?'}`,
    `Основные скиллы: ${skills}`,
    `Узлов дерева: ${nodes}`,
    `Слотов снаряжения: ${gearEntries}`,
  ];
  if (dps !== undefined) lines.push(`DPS: ${Math.round(dps).toLocaleString('ru-RU')}`);
  if (life !== undefined) lines.push(`Жизнь: ${Math.round(life).toLocaleString('ru-RU')}`);
  if (es !== undefined) lines.push(`Щит энергии: ${Math.round(es).toLocaleString('ru-RU')}`);
  return lines.join('\n');
}

// ─── Персонаж профиля poe.ninja (автосинхронизация экипа) ──────────────────

/** Ссылка на страницу персонажа профиля poe.ninja. */
export interface ProfileCharacterRef {
  account: string;
  league: string;
  character: string;
}

/**
 * Распознать ссылку на страницу персонажа профиля poe.ninja:
 * https://poe.ninja/poe2/profile/{account}/{league}/character/{name}
 */
export function parseProfileCharacterUrl(input: string): ProfileCharacterRef | null {
  const m = _NINJA_PROFILE_CHAR.exec((input || '').trim());
  if (!m) return null;
  return {
    account: decodeURIComponent(m[1]!),
    league: decodeURIComponent(m[2]!),
    character: decodeURIComponent(m[3]!),
  };
}

/** raw-эндпоинт с PoB-кодом персонажа профиля (публичный, без авторизации). */
export function profileCharacterCodeUrl(ref: ProfileCharacterRef): string {
  return `https://poe.ninja/poe2/pob/raw/profile/code/${ref.account}/${ref.league}/${ref.character}`;
}

/**
 * Скачать актуальный эквип персонажа с публичного профиля poe.ninja
 * и вернуть его в формате BuildGearItem[] (клир-текст каждого предмета).
 *
 * Принимает ссылку на страницу персонажа или готовый ProfileCharacterRef.
 * Бросает PobCodeError при недоступном/приватном профиле.
 */
export async function fetchProfileCharacterGear(
  input: string | ProfileCharacterRef,
  timeoutMs = 15000,
): Promise<BuildGearItem[]> {
  const ref = typeof input === 'string' ? parseProfileCharacterUrl(input) : input;
  if (!ref) {
    throw new PobCodeError('не ссылка на персонажа poe.ninja');
  }
  const code = await fetchCode(profileCharacterCodeUrl(ref), timeoutMs);
  const xml = coerceToXml(code, `profile:${ref.character}`);
  return buildCodeToGear(xml);
}