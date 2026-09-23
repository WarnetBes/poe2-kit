/**
 * Парсер предмета из клир-текста (Ctrl+C в Path of Exile 2).
 *
 * Алгоритм заимствован из poe2-mcp-server (src/tools/item.ts + src/services/strings.ts):
 *  - текст делится на секции разделителем "--------"
 *  - первая секция — шапка: Item Class / Rarity / Name / Base Type
 *  - следующие секции — статы (качество, защиты, нападение), требования, моды
 *  - моды классифицируются по маркерам (implicit/rune/enchant/crafted/fractured/desecrated)
 *
 * Мы реализуем быстрый англо-ориентированный вариант (английский клир-текст —
 * универсальный формат для всех торговых API), плюс распознавание редкости и
 * модов во многих языках. Авторская реализация, не копия исходных файлов.
 */

// ═══ Разделитель секций и маркеры модов ═══════════════════════════════════

const SECTION_DELIMITER = '--------';

/** Маркеры типа мода в конце строки (многоязычные) — по poe2-mcp-server. */
const MOD_MARKERS: Record<string, RegExp> = {
  implicit:
    /\((?:implicit|implizit|неявный|неотъемлемый|скрытый|implicite|implícito|고유|고정|固定|โดยกำเนิด|โดยปริยาย)\)$/i,
  rune: /\((?:rune|руна|runa|룬|ルーン|符文|รูน|อักขระ)\)$/i,
  enchant:
    /\((?:enchant|Verzauberung|зачарование|enchantement|encantamiento|encantamento|인챈트|エンチャント|附魔|เอ็นแชนท์)\)$/i,
  crafted:
    /\((?:crafted|hergestellt|создано|мастерский|forgé|fabriqué|fabricado|criado|제작|クラフト|製作|制作|工藝|工艺|คราฟต์|ประดิษฐ์)\)$/i,
  fractured:
    /\((?:fractured|frakturiert|расколотый|fracturé|fracturado|fraturado|분열|フラクチャー|裂痕|แตกหัก)\)$/i,
  desecrated:
    /\((?:desecrated|entweiht|осквернённый|profané|profanado|모독|冒涜|褻瀆|亵渎|ลบหลู่)\)$/i,
};

/** Паттерн строки "Item Class: ..." (многоязычный fallback). */
const ITEM_CLASS_PATTERN =
  /^(?:Item Class|Класс предмета|아이템 종류|物品種類|物品類別|物品类别|Gegenstandsklasse|Classe d'objet|アイテムクラス|Clase de objeto|Classe (?:do|de) [Ii]tem|ประเภทไอเท็ม|ประเภทไอเทม|ชนิดไอเท็ม|ชนิดไอเทม)[：:]\s*/;

/** Паттерн строки "Item Level: N". */
const ITEM_LEVEL_PATTERN =
  /^(?:Item Level|Уровень предмета|아이템 레벨|物品等級|物品等级|Gegenstandsstufe|Niveau de l'objet|アイテムレベル|Nivel (?:del? )?objeto|Nível do [Ii]tem|เลเวลไอเท็ม|เลเวลไอเทม)[：:]\s*(\d+)/;

/** Многоязычные альтернативные написания редкости (рода/транслит). */
const RARITY_ALTERNATES: Record<string, string[]> = {
  Rare: ['Rara', '레어', 'แรร์'],
  Magic: ['Mágica', '매직'],
  Unique: ['Única'],
};

// ═══ Типы ═════════════════════════════════════════════════════════════════

export type Rarity =
  | 'Normal'
  | 'Magic'
  | 'Rare'
  | 'Unique'
  | 'Currency'
  | 'Gem'
  | 'Unknown';

export type ModType =
  | 'explicit'
  | 'implicit'
  | 'rune'
  | 'enchant'
  | 'crafted'
  | 'fractured'
  | 'desecrated';

export interface ItemMod {
  text: string;
  type: ModType;
}

export interface NumericStat {
  value: number;
  augmented: boolean;
}

export interface DamageRange {
  min: number;
  max: number;
  augmented: boolean;
}

export interface ElementalDamage extends DamageRange {
  type: string;
}

export interface DefensiveStats {
  armour: NumericStat | null;
  evasion: NumericStat | null;
  energyShield: NumericStat | null;
  blockChance: NumericStat | null;
}

export interface OffensiveStats {
  physicalDamage: DamageRange | null;
  elementalDamage: ElementalDamage[];
  critChance: NumericStat | null;
  attacksPerSecond: NumericStat | null;
  reloadTime: NumericStat | null;
}

export interface ItemRequirements {
  level: number | null;
  strength: number | null;
  dexterity: number | null;
  intelligence: number | null;
}

export interface ParsedItem {
  /** Редкость. */
  rarity: Rarity;
  /** Имя (для Rare/Unique) или null. */
  name: string | null;
  /** Базовый тип. */
  baseType: string;
  /** Item Class, например "Body Armours". */
  itemClass: string;
  /** Уровень предмета (Item Level). */
  itemLevel: number | null;
  /** Качество (%). */
  quality: NumericStat | null;
  /** Защиты. */
  defences: DefensiveStats;
  /** Нападение (для оружия). */
  offense: OffensiveStats;
  /** Требования. */
  requirements: ItemRequirements;
  /** Все моды (Explicit + остальные) в порядке появления. */
  mods: ItemMod[];
  /** Сырые секции (полезно для прайс-чека по trade API). */
  sections: string[][];
}

// ═══ Помощники ═══════════════════════════════════════════════════════════

function normalizeColons(line: string): string {
  return line.replace(/：/g, ':');
}

/** Разбить клир-текст на секции по разделителю "--------". */
export function splitSections(text: string): string[][] {
  const lines = text.split(/\r?\n/);
  const sections: string[][] = [[]];
  for (const line of lines) {
    if (line.trim() === SECTION_DELIMITER) {
      sections.push([]);
    } else if (line.trim()) {
      sections[sections.length - 1]!.push(line);
    }
  }
  return sections.filter((s) => s.length > 0);
}

function mapRarity(str: string): Rarity {
  const t = str.trim();
  if (!t) return 'Unknown';
  const byValue: Record<string, Rarity> = {
    Normal: 'Normal',
    Magic: 'Magic',
    Rare: 'Rare',
    Unique: 'Unique',
    Currency: 'Currency',
    Gem: 'Gem',
  };
  if (byValue[t]) return byValue[t];
  for (const [rarity, alts] of Object.entries(RARITY_ALTERNATES)) {
    if (alts.includes(t)) return rarity as Rarity;
  }
  return 'Unknown';
}

// Многоязычные ключевые слова для быстро определённых секций статов
const KEY = {
  itemClass: /^(?:Item Class|Класс предмета|아이템 종류|物品種類|物品類別|物品类别|Gegenstandsklasse|Classe d'objet|アイテムクラス|Clase de objeto|Classe (?:do|de) [Ii]tem|ประเภทไอเท็ม|ประเภทไอเทม|ชนิดไอเท็ม|ชนิดไอเทม)/i,
  itemLevel: /^(?:Item Level|Уровень предмета|아이템 레벨|物品等級|物品等级|Gegenstandsstufe|Niveau de l'objet|アイテムレベル|Nivel (?:del? )?objeto|Nível do [Ii]tem|เลเวลไอเท็ม|เลเวลไอเทม)/i,
  rarity: /^(?:Rarity|Редкость|희귀도|稀有度|Seltenheit|Rareté|レアリティ|Rareza|Raridade|ความหายาก)/i,
  quality: /^(?:Quality|Качество|품질|品質|Qualität|Qualité|品質|Calidad|Qualidade|คุณภาพ|ความเสียหาย)/i,
  armour: /^(?:Armour|Броня|방어도|護甲|護甲|Rüstung|Armure|Armadura|Armadura|เกราะ)/i,
  evasion: /^(?:Evasion|Уклонение|회피|閃避|閃避|Ausweichen|Évasion|Evasión|Esquiva|หลบหลีก)/i,
  energyShield: /^(?:Energy Shield|Шкала энергии|에너지 보호막|能量護盾|能量護盾|Energieschild|Bouclier d'énergie|Escudo de energía|Escudo de Energia|โล่พลังงาน)/,
  blockChance: /^(?:Block Chance|Шанс блока|방어 확률|格擋機率|格挡机率|Blockchance|Chance de blocage|Probabilidad de bloqueo|Chance de Bloqueio|ความน่าจะเป็นในการบล็อก)/i,
  critChance: /^(?:Critical (?:Strike|Hit) Chance|Шанс крит(?:\.|ического) удара|치명타 확률|暴擊率|暴击率|Kritische Trefferchance|Chances de coup critique|クリティカル率|Probabilidad de impacto crítico|Chance de Acerto Crítico|โอกาสคริติคอล)/i,
  attackSpeed: /^(?:Attacks per Second|Атак в секунду|Время между атаками|초당 공격 횟수|每秒攻擊次數|每秒攻击次数|Angriffe pro Sekunde|Attaques par seconde|毎秒攻撃回数|Ataques por segundo|Ataques por Segundo|จำนวนครั้งการโจมตีต่อวินาที)/i,
  reloadTime: /^(?:Reload Time|Время перезарядки|재장전 시간|裝填時間|装填时间|Nachladezeit|Temps de rechargement|Tiempo de recarga|Tempo de Recarga|เวลารีโหลด)/i,
  physicalDamage: /^(?:Physical Damage|Физический урон|물리 피해|物理傷害|物理伤害|Physischer Schaden|Dégâts physiques|Daño físico|Dano Físico|ความเสียหายกายภาพ)/i,
  elementalDamage: /^(?:Elemental Damage|Стихийный урон|원소 피해|元素傷害|元素伤害|Elementarschaden|Dégâts élémentaires|Daño elemental|Dano Elemental|ความเสียหายธาตุ)/i,
  requirement: /^(?:Requires?|Требуется|요구|需求|需用|Benötigt|Requis|Requiere|Requer|ต้องการ)/i,
  weapons: /^(?:Weapons|Оружие|무기|武器|Waffen|Armes|Armas|Armas|อาวุธ)/i,
};

/** Разобрать число из строки с учётом маркера (augmented). */
function parseNumericStat(line: string): NumericStat | null {
  const augmented = /\(augmented\)/i.test(line);
  const match = line.match(/[+-]?(\d+(?:[.,]\d+)?)/);
  if (!match) return null;
  return { value: parseFloat(match[1]!.replace(',', '.')), augmented };
}

/** Разобрать диапазон урона "12-22". */
function parseDamageRange(line: string): DamageRange | null {
  const augmented = /\(augmented\)/i.test(line);
  const m = line.match(/(\d+)-(\d+)/);
  if (!m) return null;
  return { min: parseInt(m[1]!, 10), max: parseInt(m[2]!, 10), augmented };
}

/** Определить тип мода по маркеру в конце строки. */
function parseMod(line: string): ItemMod {
  let type: ModType = 'explicit';
  let text = line.trim();
  for (const [modType, re] of Object.entries(MOD_MARKERS)) {
    if (re.test(text)) {
      type = modType as ModType;
      text = text.replace(re, '').trim();
      break;
    }
  }
  return { text, type };
}

// ═══ Основной парсер ═════════════════════════════════════════════════════

/**
 * Разобрать клир-текст предмета из PoE2 во структурированный объект.
 * Поддерживает англ./рус. и другие локали редкости и меток статов.
 */
export function parseItemText(text: string): ParsedItem {
  const sections = splitSections(text);
  const header = sections[0] ?? [];

  // Шапка: Item Class / Rarity / Name / Base Type
  let itemClass = '';
  let rarity: Rarity = 'Unknown';
  let name: string | null = null;
  let baseType = '';
  for (let i = 0; i < header.length; i++) {
    const line = normalizeColons(header[i]!);
    if (ITEM_CLASS_PATTERN.test(line)) {
      itemClass = line.replace(ITEM_CLASS_PATTERN, '').trim();
    } else if (KEY.rarity.test(line)) {
      const rarityStr = line.replace(/^[^:]*[:：]/, '').trim();
      rarity = mapRarity(rarityStr);
      // Имя и базовый тип идут после строки редкости
      if (rarity === 'Normal' || rarity === 'Currency' || rarity === 'Gem') {
        baseType = header[i + 1]?.trim() ?? '';
      } else if (rarity === 'Magic') {
        const magicName = header[i + 1]?.trim() ?? '';
        const potentialBase = header[i + 2]?.trim();
        if (potentialBase && !KEY.itemClass.test(potentialBase)) {
          name = magicName;
          baseType = potentialBase;
        } else {
          baseType = magicName;
        }
      } else {
        // Rare / Unique: следующая строка — имя, затем базовый тип
        name = header[i + 1]?.trim() ?? null;
        baseType = header[i + 2]?.trim() ?? '';
      }
    }
  }

  // Статы / требования / моды по оставшимся секциям
  let itemLevel: number | null = null;
  let quality: NumericStat | null = null;
  const defences: DefensiveStats = {
    armour: null,
    evasion: null,
    energyShield: null,
    blockChance: null,
  };
  const offense: OffensiveStats = {
    physicalDamage: null,
    elementalDamage: [],
    critChance: null,
    attacksPerSecond: null,
    reloadTime: null,
  };
  const requirements: ItemRequirements = {
    level: null,
    strength: null,
    dexterity: null,
    intelligence: null,
  };
  const mods: ItemMod[] = [];

  // Сначала пробегаем ВСЕ секции в поиске Item Level (может быть в последней).
  for (const section of sections) {
    for (const line of section) {
      if (itemLevel == null && ITEM_LEVEL_PATTERN.test(line)) {
        const m = line.match(ITEM_LEVEL_PATTERN);
        if (m) itemLevel = parseInt(m[1]!, 10);
      }
    }
  }

  for (const section of sections) {
    for (const raw of section) {
      const line = normalizeColons(raw);
      // Защиты / нападение / требования — ключевые заголовки статов
      if (KEY.armour.test(line)) defences.armour = parseNumericStat(line);
      else if (KEY.evasion.test(line)) defences.evasion = parseNumericStat(line);
      else if (KEY.energyShield.test(line)) defences.energyShield = parseNumericStat(line);
      else if (KEY.blockChance.test(line)) defences.blockChance = parseNumericStat(line);
      else if (KEY.critChance.test(line)) offense.critChance = parseNumericStat(line);
      else if (KEY.attackSpeed.test(line)) offense.attacksPerSecond = parseNumericStat(line);
      else if (KEY.reloadTime.test(line)) offense.reloadTime = parseNumericStat(line);
      else if (KEY.quality.test(line)) quality = parseNumericStat(line);

      if (KEY.physicalDamage.test(line)) {
        const dr = parseDamageRange(line);
        if (dr) offense.physicalDamage = dr;
      }

      if (KEY.elementalDamage.test(line)) {
        const after = line.replace(KEY.elementalDamage, '').split(',');
        for (const part of after) {
          const rangeMatch = part.match(/(\d+)-(\d+)/);
          const typeMatch = part.match(/\(([^)]+)\)/);
          if (rangeMatch) {
            offense.elementalDamage.push({
              min: parseInt(rangeMatch[1]!, 10),
              max: parseInt(rangeMatch[2]!, 10),
              type: typeMatch ? typeMatch[1]! : 'Elemental',
              augmented: false,
            });
          }
        }
      }

      // Требования (inline и многострочный формат)
      if (KEY.requirement.test(line)) {
        const level = line.match(/Level[:：]?\s*(\d+)/i);
        if (level) requirements.level = parseInt(level[1]!, 10);
        // Внутристроковые стат-требования вида "Requires Level 35, 98 Int"
        const full = line.match(/(\d+)\s*(?:Inc?t|Str|Dex|Int)\b/gi);
        if (full) {
          for (const f of full) {
            const m = f.match(/(\d+)\s*(Inc?t|Str|Dex|Int)/i);
            if (!m) continue;
            const v = parseInt(m[1]!, 10);
            const s = m[2]!.toLowerCase();
            if (s.startsWith('str')) requirements.strength = v;
            else if (s.startsWith('dex')) requirements.dexterity = v;
            else if (s.startsWith('int')) requirements.intelligence = v;
          }
        }
        // Многострочный формат: "Level: 35", "Str: 98"
        const lvlM = line.match(/(?:^|[^A-Za-z])Level[:：]\s*(\d+)/i);
        if (lvlM) requirements.level = parseInt(lvlM[1]!, 10);
        const strM = line.match(/^Str(?:ength)?[:：]\s*(\d+)/i);
        if (strM) requirements.strength = parseInt(strM[1]!, 10);
        const dexM = line.match(/^Dex(?:terity)?[:：]\s*(\d+)/i);
        if (dexM) requirements.dexterity = parseInt(dexM[1]!, 10);
        const intM = line.match(/^Int(?:elligence)?[:：]\s*(\d+)/i);
        if (intM) requirements.intelligence = parseInt(intM[1]!, 10);
      }

      // Всё, что не является заголовком/явным статом и не имя/тип/класс и
      // не выглядит как ключевой лейбл — это мод.
      if (looksLikeMod(line, KEY)) {
        mods.push(parseMod(line));
      }
    }
  }

  return {
    rarity,
    name,
    baseType,
    itemClass,
    itemLevel,
    quality,
    defences,
    offense,
    requirements,
    mods,
    sections,
  };
}

interface KeySet {
  itemClass: RegExp;
  itemLevel: RegExp;
  rarity: RegExp;
  quality: RegExp;
  armour: RegExp;
  evasion: RegExp;
  energyShield: RegExp;
  blockChance: RegExp;
  critChance: RegExp;
  attackSpeed: RegExp;
  reloadTime: RegExp;
  physicalDamage: RegExp;
  elementalDamage: RegExp;
  requirement: RegExp;
  weapons: RegExp;
  [k: string]: RegExp;
}

/** Эвристика: является ли строка модом предмета. */
function looksLikeMod(line: string, keys: KeySet): boolean {
  if (!line) return false;
  if (keys.itemClass.test(line)) return false;
  if (keys.itemLevel.test(line)) return false;
  if (keys.rarity.test(line)) return false;
  if (keys.requirement.test(line)) return false;
  if (keys.weapons.test(line)) return false;
  // Секции-ярлыки отдельных статов сами по себе не моды, но строка-заголовок
  // "Armour: 42" захвачена выше. Здесь отсекаем только чисто заголовочные.
  if (/^[A-Za-zÀ-ÿ][^\n]*[:：]\s*\d/.test(line)) {
    // заголовок стата с числом — обработан выше, но если дошёл — это не мод
    return false;
  }
  return true;
}

/** Собрать человекочитаемое имя предмета для прайс-чека. */
export function itemDisplayName(item: ParsedItem): string {
  return item.name ?? item.baseType;
}