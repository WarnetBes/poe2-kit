/**
 * Стартовые билды для новичков (проход сюжета, Акты 1–4): по одному на каждый
 * из 8 базовых классов. Основа — проверенные гайды прокачки CLASS_LEVELING_GUIDES
 * (leveling.ts, имена камней провалидированы по датасету); имена баз предметов
 * берутся ТОЛЬКО из офлайн-датасета base_items.json (ничего не выдумано).
 *
 * Слот = настоящий white-base типа → trade2-прайс-чек по типу работает.
 * Задача — не эталонный PoB-билд, а живой шопинг-лист: что искать на каждом
 * слоте и какие камни качать по диапазонам уровней.
 */

import { getBaseItems } from './dataset.js';
import { CLASS_LEVELING_GUIDES, resolveLevelingClass } from './leveling.js';
import type { ClassLevelingGuide } from './leveling.js';

/** Оружие/оффхенд класса: значения = item_class_name из base_items.json (проверено). */
const CLASS_WEAPON: Record<string, { weapon: string; offhand?: string }> = {
  Monk: { weapon: 'Quarterstaves' },
  Warrior: { weapon: 'Two Hand Maces' },
  Sorceress: { weapon: 'Wands', offhand: 'Foci' },
  Ranger: { weapon: 'Bows', offhand: 'Quivers' },
  Mercenary: { weapon: 'Crossbows' },
  Witch: { weapon: 'Wands', offhand: 'Foci' },
  Druid: { weapon: 'Two Hand Maces' },
  Huntress: { weapon: 'Spears' },
};

/** Самый «простой» white-base класса: кратчайшее реальное имя из датасета. */
function plainBase(itemClassName: string): string | null {
  const list = getBaseItems().filter(
    (b) => b.itemClassName === itemClassName || b.itemClass === itemClassName,
  );
  if (!list.length) return null;
  const sorted = [...list].sort((a, b) => a.name.length - b.name.length);
  return sorted[0]!.name;
}

export interface StarterSlot {
  /** PoB-слот (Weapon 1, Helm, BodyArmour, Belt, …) — как у импорта PoB. */
  slot: string;
  /** EN-имя white-base из датасета. */
  base: string;
  /** Кликр-текст предмета для parseItemText/priceCheck. */
  itemText: string;
  /** Что искать на слоте (из гайда класса). */
  note: string;
}

export interface StarterBuild {
  className: string;
  tagline: string;
  damage: string[];
  defense: string[];
  slots: StarterSlot[];
  /** Группы камней по диапазонам уровней (из гайда класса). */
  gemRanges: Array<{ range: string; gems: string[] }>;
}

/** Слоты шопинг-листа: (slot, itemClassName, note) — note из гайда класса по смыслу. */
function buildSlots(guide: ClassLevelingGuide, weaponClass: string, offhandClass?: string): StarterSlot[] {
  const gearNotes = guide.tips.flatMap((t) => t.gear ?? []);
  const slots: StarterSlot[] = [];
  const push = (slot: string, cls: string, note: string): void => {
    const base = plainBase(cls);
    if (!base) return; // класса нет в датасете — слот не добавляем, а не выдумываем
    slots.push({
      slot,
      base,
      itemText: `Item Class: ${cls}\nRarity: Normal\n${base}`,
      note,
    });
  };
  push('Weapon 1', weaponClass, gearNotes[0] ?? 'Оружие класса — см. вкладку «📈 Прокачка»');
  if (offhandClass) push('Weapon 2', offhandClass, 'Оффхенд под оружие класса (дальность/бафф)');
  push('Helm', 'Helmets', gearNotes[1] ?? 'Базовый слот: приоритеты защиты класса');
  push('BodyArmour', 'Body Armours', 'Броня: приоритет защиты класса');
  push('Gloves', 'Gloves', 'Перчатки: урон/скорость атаки или каста');
  push('Boots', 'Boots', 'Обувь: движение + защита');
  push('Belt', 'Belts', 'Пояс: жизнь + резисты');
  push('Amulet', 'Amulets', 'Амулет: ключевые статы класса');
  push('Ring 1', 'Rings', 'Кольцо: flat-урон или резисты');
  push('Ring 2', 'Rings', 'Кольцо: flat-урон или резисты');
  push('Flask 1', 'Life Flasks', 'Фляга жизни (не торгуется на trade)');
  return slots;
}

/** Стартовый билд класса (или асценданси — резолвится в базовый класс). */
export function makeStarterBuild(classQuery: string): StarterBuild | null {
  const guide = resolveLevelingClass(classQuery);
  if (!guide) return null;
  const weapon = CLASS_WEAPON[guide.baseClass];
  if (!weapon) return null; // класс без маппинга оружия — не выдумываем
  return {
    className: guide.baseClass,
    tagline: guide.tagline,
    damage: guide.damage,
    defense: guide.defense,
    slots: buildSlots(guide, weapon.weapon, weapon.offhand),
    gemRanges: guide.tips.map((t) => ({
      range: t.toLevel == null ? `${t.fromLevel}+` : `${t.fromLevel}–${t.toLevel}`,
      gems: t.gems ?? [],
    })),
  };
}

/** Список доступных стартовых билдов (8 классов). */
export function listStarterBuilds(): Array<{ className: string; tagline: string }> {
  return Object.values(CLASS_LEVELING_GUIDES).map((g) => ({
    className: g.baseClass,
    tagline: g.tagline,
  }));
}

export { CLASS_WEAPON };
