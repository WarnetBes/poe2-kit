/**
 * MCP-инструмент: прямой запрос к настроенной LLM.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core } from '@poe2-kit/core';

export function registerAiTools(server: McpServer): number {
  server.registerTool(
    'poe2_ai_ask',
    {
      title: 'PoE2 Ask AI',
      description: `Прямой запрос к настроенной LLM-модели (внешний эндпоинт/OpenCode-модель или локальная Ollama).

Работает через переменные окружения:
  - POE2KIT_AI_BASE, POE2KIT_AI_MODEL, POE2KIT_AI_KEY (внешний OpenAI-совместимый эндпоинт)
  - POE2KIT_OLLAMA_MODEL (локальная модель)

Аргументы:
  - prompt (string): вопрос игроку для LLM.
  - context (object, опц.): доп. данные (билд, предметы и т.п.).

Возвращает текст ответа модели и какой провайдер сработал.
`,
      inputSchema: {
        prompt: z.string().min(3).describe('Запрос к LLM'),
        context: z.record(z.unknown()).optional().describe('Контекст (билд, предметы...)'),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ prompt, context }) => {
      const res = await core.ai.askAI({ prompt, context });
      if (res.source === 'none') {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `${res.text}\n\nДоступные провайдеры: ${JSON.stringify(core.ai.listAIProviders(), null, 2)}`,
            },
          ],
        };
      }
      return {
        content: [{ type: 'text', text: `**${res.provider}**\n\n${res.text}` }],
      };
    },
  );

  return 1;
}