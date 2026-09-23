#!/usr/bin/env node
/**
 * PoE2 Kit — MCP-сервер.
 * Предоставляет инструменты poe2_* поверх единого ядра @poe2-kit/core
 * для ИИ-ассистентов (OpenCode, Claude Desktop и др.).
 *
 * Все данные — только бесплатные публичные API и локальная база RePoE.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { registerCurrencyTools } from './tools/currency.js';
import { registerItemTools } from './tools/item.js';
import { registerLevelingTools } from './tools/leveling.js';
import { registerBuildTools } from './tools/build.js';
import { registerDbTools } from './tools/db.js';
import { registerAiTools } from './tools/ai.js';
import { registerLogTools } from './tools/log.js';
import { registerWikiTools } from './tools/wiki.js';
import { registerTradeQueryTools } from './tools/tradeQuery.js';
import { registerDatasetTools } from './tools/dataset.js';

export function buildServer(): number {
  const server = new McpServer({
    name: 'poe2-kit-mcp',
    version: '0.1.0',
  });

  let count = 0;
  count += registerCurrencyTools(server);
  count += registerItemTools(server);
  count += registerLevelingTools(server);
  count += registerBuildTools(server);
  count += registerDbTools(server);
  count += registerAiTools(server);
  count += registerLogTools(server);
  count += registerWikiTools(server);
  count += registerTradeQueryTools(server);
  count += registerDatasetTools(server);

  // Запомним сервер для подключения
  (globalThis as any).__poe2Server = server;
  return count;
}

/** Точка входа: подключение по stdio. */
async function main(): Promise<void> {
  // Режим самопроверки: зарегистрировать инструменты и выйти.
  if (process.argv.includes('--smoke')) {
    const count = buildServer();
    console.error(`[smoke] Зарегистрировано инструментов: ${count}`);
    console.error('  - poe2_currency_prices');
    console.error('  - poe2_currency_check');
    console.error('  - poe2_parse_item');
    console.error('  - poe2_price_check');
    console.error('  - poe2_leveling_plan');
    console.error('  - poe2_build_decode');
    console.error('  - poe2_build_summary');
    console.error('  - poe2_build_price');
    console.error('  - poe2_items_db');
    console.error('  - poe2_mod_tier');
    console.error('  - poe2_ai_ask');
    console.error('  - poe2_log_state');
    console.error('  - poe2_wiki_lookup');
    console.error('  - poe2_build_estimate');
    console.error('  - poe2_trade_search');
    console.error('  - poe2_dataset_info');
    console.error('  - poe2_gems_lookup');
    console.error('  - poe2_tree_search');
    process.exit(0);
  }

  const count = buildServer();
  const server = (globalThis as any).__poe2Server as McpServer;
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout занят JSON-RPC, логи — в stderr
  console.error(`poe2-kit-mcp started (stdio transport), ${count} tools`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});