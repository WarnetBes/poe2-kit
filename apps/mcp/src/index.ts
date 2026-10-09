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
import { registerBuildGuideTools } from './tools/buildGuide.js';
import { registerDbTools } from './tools/db.js';
import { registerAiTools } from './tools/ai.js';
import { registerLogTools } from './tools/log.js';
import { registerWikiTools } from './tools/wiki.js';
import { registerTradeQueryTools } from './tools/tradeQuery.js';
import { registerDatasetTools } from './tools/dataset.js';
import { registerPoe2dbTools } from './tools/poe2db.js';
import { registerZoneNotesTools } from './tools/zoneNotes.js';
import { registerLadderTools } from './tools/ladder.js';
import { registerCalculatorTools } from './tools/calculators.js';
import { registerOauthTools } from './tools/oauth.js';
import { registerOptimizeTools } from './tools/optimize.js';
import { registerSourcesTools } from './tools/sources.js';
import { registerOverlayStateTools } from './tools/overlayState.js';
import { registerOverlayBridgeTools } from './tools/overlayBridge.js';
import { registerRuneTools } from './tools/runes.js';
import { registerKeybindTools } from './tools/keybinds.js';
import { registerMapPrepTools } from './tools/mapPrep.js';
import { registerSimulacrumTools } from './tools/simulacrum.js';
export function buildServer(): number {
  const server = new McpServer({
    name: 'poe2-kit-mcp',
    version: '0.1.0',
  });

  let count = 0;
  // Собираем имена тулов при регистрации (для smoke-листинга).
  const registered: string[] = [];
  const origRegister = server.registerTool.bind(server) as unknown as
    (name: string, config: never, cb?: unknown) => unknown;
  (server as unknown as { registerTool: (name: string, ...rest: [unknown, unknown?]) => unknown }).registerTool = (
    name: string,
    ...rest: [unknown, unknown?]
  ) => {
    registered.push(name);
    return origRegister(name, rest[0] as never, rest[1] as never);
  };
  (globalThis as any).__poe2Registered = registered;
  count += registerCurrencyTools(server);
  count += registerItemTools(server);
  count += registerLevelingTools(server);
  count += registerBuildTools(server);
  count += registerBuildGuideTools(server);
  count += registerDbTools(server);
  count += registerAiTools(server);
  count += registerLogTools(server);
  count += registerWikiTools(server);
  count += registerTradeQueryTools(server);
  count += registerDatasetTools(server);
  count += registerPoe2dbTools(server);
  count += registerZoneNotesTools(server);
  count += registerLadderTools(server);
  count += registerCalculatorTools(server);
  count += registerOauthTools(server);
  count += registerOptimizeTools(server);
  count += registerSourcesTools(server);
  count += registerOverlayStateTools(server);
  count += registerOverlayBridgeTools(server);
  count += registerRuneTools(server);
  count += registerKeybindTools(server);
  count += registerMapPrepTools(server);
  count += registerSimulacrumTools(server);

  // Запомним сервер для подключения
  (globalThis as any).__poe2Server = server;
  return count;
}

/** Точка входа: подключение по stdio. */
async function main(): Promise<void> {
  // Режим самопроверки: зарегистрировать инструменты и выйти.
  // Метка источника для opt-in журнала обучения (overlay/mcp/…).
  if (!process.env['POE2K_LEARN_SOURCE']) process.env['POE2K_LEARN_SOURCE'] = 'mcp';
  if (process.argv.includes('--smoke')) {
    const count = buildServer();
    console.error(`[smoke] Registered tools: ${count}`);
    const listed: string[] = (globalThis as any).__poe2Registered ?? [];
    for (const name of listed) console.error(`  - ${name}`);
    process.exit(listed.length === count ? 0 : 1);
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