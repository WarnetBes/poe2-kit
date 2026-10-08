/**
 * MCP-тул `poe2_keybind_advisor` (№221): советчик раскладки навыков PoE2.
 *
 * Вход — PoB-код/XML билда (обяз.), платформа (xbox | playstation | keyboard),
 * режим движения (wasd | click — только для клавиатуры), пины ролей.
 * Выход — markdown: таблица раскладки с обоснованием, Spirit-блок, бюджет
 * слотов, пошаговая инструкция установки в игре, unverified-пометки.
 *
 * Спецификация: docs/SPEC_KEYBIND_ADVISOR.md. Ядро: core.keybinds (№221).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core, type KeybindPlatform, type KeybindMovementMode, type KeybindRole } from '@poe2-kit/core';

/** Регистрация тула `poe2_keybind_advisor`. Возвращает число добавленных инструментов (1). */
export function registerKeybindTools(server: McpServer): number {
  server.registerTool(
    'poe2_keybind_advisor',
    {
      title: 'PoE2 Keybind Advisor',
      description: `Советчик раскладки навыков PoE2 под геймпад (Xbox / PlayStation) и клавиатуру по билду PoB. Геймпад PoE2: 22 бинд-слота (11 кнопок + второй сет при удержании L2-модификатора), ~5 системных; эргономика по рекомендациям GGG (primary → R1, dodge → L1, фляги → D-pad, редкое → L2+face). Клавиатура: LMB/RMB/MMB + Q W E R T, режимы клик-мув/WASD. Ауры, херальды и persistent-скиллы (HasReservation: Ghost Dance, Wind Dancer, Cast on Critical и т.п.) в хотбар НЕ биндятся — выводятся Spirit-блоком (каст раз). Каждый слот — с обоснованием; эвристики без живой сверки помечены unverified. Генерирует ИНСТРУКЦИЮ для ручной установки (игра не экспортирует бинды файлом).

Аргументы:
  - code (string, обяз.): PoB share-код ИЛИ готовый XML PathOfBuilding.
  - platform (string, опц.): 'xbox' (по умолчанию) | 'playstation' | 'keyboard'.
  - movement_mode (string, опц.): 'wasd' (по умолчанию) | 'click' — режим движения игры (для клавиатуры).
  - overrides (object, опц.): пины ролей {имя камня: primary|secondary|burst|movement|buff|curse|aura}.

Примеры:
  - "Подбери раскладку под PS5-геймпад" → code + platform=playstation
  - "Раскладка для клавиатуры, я играю клик-мувом" → code + platform=keyboard, movement_mode=click
`,
      inputSchema: {
        code: z.string().min(5).describe('PoB share-код или XML'),
        platform: z.enum(['xbox', 'playstation', 'keyboard']).optional().describe('Платформа (default xbox)'),
        movement_mode: z.enum(['wasd', 'click']).optional().describe('Режим движения (для клавиатуры, default wasd)'),
        overrides: z.record(z.string(), z.enum(['primary', 'secondary', 'burst', 'movement', 'buff', 'curse', 'aura'])).optional().describe('Пины ролей: имя камня → роль'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ code, platform, movement_mode, overrides }) => {
      try {
        const xml = code.includes('<PathOfBuilding') ? code : core.build.decodeShareCode(code);
        const b = await core.build.importBuild(xml);
        if (!b.skillGroups?.length) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'В билде не найдено групп навыков (<Skill>): раскладку строить не из чего. Нужен PoB2-экспорт со скиллами.',
              },
            ],
          };
        }
        const advice = core.keybinds.adviseKeybinds(b, {
          platform: (platform ?? 'xbox') as KeybindPlatform,
          movement_mode: movement_mode as KeybindMovementMode | undefined,
          overrides: overrides as Partial<Record<string, KeybindRole>> | undefined,
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: `Билд: ${b.class ?? '?'}${b.ascendancy ? ` / ${b.ascendancy}` : ''} (ур. ${b.level ?? '?'})\n\n` +
                core.keybinds.keybindsToMarkdown(advice),
            },
          ],
        };
      } catch (e) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Ошибка: ${e instanceof Error ? e.message : String(e)}\nПроверь share-код (poe.ninja/pobb.in-ссылки тоже принимаются).`,
            },
          ],
        };
      }
    },
  );
  return 1;
}
