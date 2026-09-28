// Пер-класс фоны дерева — официальный экспорт GGG (poe2-skilltree-export).
// 8 листов; полные имена классов совпадают с ключами metadata.classBgs.
import druid from '../../../packages/core/data/game/passive_tree/assets/background-druid.webp?url';
import huntress from '../../../packages/core/data/game/passive_tree/assets/background-huntress.webp?url';
import mercenary from '../../../packages/core/data/game/passive_tree/assets/background-mercenary.webp?url';
import monk from '../../../packages/core/data/game/passive_tree/assets/background-monk.webp?url';
import ranger from '../../../packages/core/data/game/passive_tree/assets/background-ranger.webp?url';
import sorceress from '../../../packages/core/data/game/passive_tree/assets/background-sorceress.webp?url';
import warrior from '../../../packages/core/data/game/passive_tree/assets/background-warrior.webp?url';
import witch from '../../../packages/core/data/game/passive_tree/assets/background-witch.webp?url';

const classBgAssets: Record<string, string> = {
  Druid: druid,
  Huntress: huntress,
  Mercenary: mercenary,
  Monk: monk,
  Ranger: ranger,
  Sorceress: sorceress,
  Warrior: warrior,
  Witch: witch,
};

export const classBgUrls = (className: string): string | undefined =>
  classBgAssets[className] ?? classBgAssets[className.toLowerCase()];
export default classBgAssets;
