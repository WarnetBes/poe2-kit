/**
 * MCP-инструменты: разбор предмета и прайс-чек.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core } from '@poe2-kit/core';

function fmtDef(def: { armour?: unknown; evasion?: unknown; energyShield?: unknown; blockChance?: unknown }): string {
  const parts: string[] = [];
  if (def.armour) parts.push(`Armour ${(def.armour as any)?.value}`);
  if (def.evasion) parts.push(`Evasion ${(def.evasion as any)?.value}`);
  if (def.energyShield) parts.push(`ES ${(def.energyShield as any)?.value}`);
  if (def.blockChance) parts.push(`Block ${(def.blockChance as any)?.value}`);
  return parts.join(', ') || '—';
}

export function registerItemTools(server: McpServer): number {
  server.registerTool(
    'poe2_parse_item',
    {
      title: 'PoE2 Parse Item',
      description: `Разобрать клир-текст предмета PoE2 (Ctrl+C в игре) в структурированный объект.

Аргументы:
  - item_text (string): полный текст предмета из игры, включая строки "Rarity:", "--------", моды.

Возвращает: редкость, имя, базовый тип, Item Class, Item Level, качество, защиты,
нападение (для оружия), требования и список модов с типами (explicit/implicit/rune/...).

Пример входных данных:
Rarity: Rare
Storm Warden
Leather Gloves
--------
Quality: +20%
Armour: 42
--------
Item Level: 68
--------
+45 to Strength (implicit)
Adds 3 to 8 Cold Damage
`,
      inputSchema: {
        item_text: z.string().min(5).describe('Клир-текст предмета из игры'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ item_text }) => {
      try {
        const item = core.parse.parseItemText(item_text);
        const mods = item.mods.map((m) => `- [${m.type}] ${m.text}`).join('\n');
        const req = item.requirements;
        const text = [
          '## Разбор предмета',
          `- **Редкость:** ${item.rarity}`,
          `- **Имя:** ${item.name ?? '—'}`,
          `- **Базовый тип:** ${item.baseType || '—'}`,
          `- **Item Class:** ${item.itemClass || '—'}`,
          `- **Item Level:** ${item.itemLevel ?? '—'}`,
          `- **Качество:** ${item.quality?.value != null ? item.quality.value + '%' : '—'}`,
          `- **Защита:** ${fmtDef(item.defences)}`,
          item.offense.physicalDamage
            ? `- **Физ. урон:** ${item.offense.physicalDamage.min}-${item.offense.physicalDamage.max}`
            : null,
          item.offense.attacksPerSecond
            ? `- **Атак/сек:** ${item.offense.attacksPerSecond.value}`
            : null,
          `- **Требования:** L${req.level ?? '?'}${req.strength ? `, ${req.strength} Str` : ''}${req.dexterity ? `, ${req.dexterity} Dex` : ''}${req.intelligence ? `, ${req.intelligence} Int` : ''}`,
          '',
          '### Моды',
          mods || '(нет модов)',
        ];
        return { content: [{ type: 'text', text: text.filter(Boolean).join('\n') }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка разбора: ${msg}` }] };
      }
    },
  );

  server.registerTool(
    'poe2_price_check',
    {
      title: 'PoE2 Price Check',
      description: `Прайс-чек предмета PoE2 по клир-тексту. Использует бесплатные API (poe2scout, poe.ninja, официальный trade2).

Аргументы:
  - item_text (string): клир-текст предмета из игры.

Возвращает оценку цены (для уникальных — из poe2scout, для валют — poe.ninja,
для прочего — из объявлений trade2) и список листингов.

Примеры:
  - "Сколько стоит мой предмет?" → вставь Ctrl+C текст предмета
  - "Ценность стула Doryani" → текст уникального
`,
      inputSchema: {
        item_text: z.string().min(5).describe('Клир-текст предмета из игры'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ item_text }) => {
      try {
        core.trade.setLeague('Runes of Aldur');
        const res = await core.trade.priceCheck(item_text);
        const lines = [
          `## Прайс-чек: ${res.itemName}`,
          `- **Редкость:** ${res.rarity}`,
        ];
        if (res.estimate) {
          lines.push(
            `- **Оценка:** ${res.estimate.median} chaos (доверие: ${res.estimate.confidence}, диапазон ${res.estimate.min}-${res.estimate.max})`,
          );
        } else {
          lines.push('- **Оценка:** нет данных (предмет не найден в бесплатных источниках)');
        }
        if (res.listings.length) {
          lines.push('', '### Листинги (trade2)');
          for (const l of res.listings.slice(0, 10)) {
            lines.push(`- **${l.price}** ${l.currency}`);
          }
        }
        const srcs = res.sources.length ? res.sources.join(', ') : '—';
        lines.push('', `Источники: ${srcs}`);
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка прайс-чека: ${msg}` }] };
      }
    },
  );

  return 2;
}