#!/usr/bin/env node
/**
 * PoE2 Kit вЂ” MCP-СЃРµСЂРІРµСЂ.
 * РџСЂРµРґРѕСЃС‚Р°РІР»СЏРµС‚ РёРЅСЃС‚СЂСѓРјРµРЅС‚С‹ poe2_* РїРѕРІРµСЂС… РµРґРёРЅРѕРіРѕ СЏРґСЂР° @poe2-kit/core
 * РґР»СЏ РР-Р°СЃСЃРёСЃС‚РµРЅС‚РѕРІ (OpenCode, Claude Desktop Рё РґСЂ.).
 *
 * Р’СЃРµ РґР°РЅРЅС‹Рµ вЂ” С‚РѕР»СЊРєРѕ Р±РµСЃРїР»Р°С‚РЅС‹Рµ РїСѓР±Р»РёС‡РЅС‹Рµ API Рё Р»РѕРєР°Р»СЊРЅР°СЏ Р±Р°Р·Р° RePoE.
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

  // Р—Р°РїРѕРјРЅРёРј СЃРµСЂРІРµСЂ РґР»СЏ РїРѕРґРєР»СЋС‡РµРЅРёСЏ
  (globalThis as any).__poe2Server = server;
  return count;
}

/** РўРѕС‡РєР° РІС…РѕРґР°: РїРѕРґРєР»СЋС‡РµРЅРёРµ РїРѕ stdio. */
async function main(): Promise<void> {
  // Р РµР¶РёРј СЃР°РјРѕРїСЂРѕРІРµСЂРєРё: Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°С‚СЊ РёРЅСЃС‚СЂСѓРјРµРЅС‚С‹ Рё РІС‹Р№С‚Рё.
  // Метка источника для opt-in журнала обучения (overlay/mcp/…).
  if (!process.env['POE2K_LEARN_SOURCE']) process.env['POE2K_LEARN_SOURCE'] = 'mcp';
  if (process.argv.includes('--smoke')) {
    const count = buildServer();
    console.error(`[smoke] Р—Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°РЅРѕ РёРЅСЃС‚СЂСѓРјРµРЅС‚РѕРІ: ${count}`);
    const listed: string[] = (globalThis as any).__poe2Registered ?? [];
    for (const name of listed) console.error(`  - ${name}`);
    process.exit(listed.length === count ? 0 : 1);
  }

  const count = buildServer();
  const server = (globalThis as any).__poe2Server as McpServer;
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout Р·Р°РЅСЏС‚ JSON-RPC, Р»РѕРіРё вЂ” РІ stderr
  console.error(`poe2-kit-mcp started (stdio transport), ${count} tools`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});