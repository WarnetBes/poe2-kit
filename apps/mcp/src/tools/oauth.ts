/**
 * MCP-инструменты: OAuth-доступ к аккаунтным данным PoE2 через официальный
 * API GGG (api.pathofexile.com, realm poe2).
 *
 * Что это даёт: список персонажей и полный снапшот выбранного (экипировка,
 * инвентарь, пассивки) без копипасты из игры — легальный путь GGG OAuth 2.1.
 * Стэш-API для PoE2 у GGG нет (PoE1 only), поэтому стэш-инструментов здесь нет.
 *
 * Предварительное условие: env POE2K_GGG_CLIENT_ID (регистрация приложения
 * GGG, pathofexile.com/developer либо oauth@grindinggear.com).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core } from '@poe2-kit/core';

const o = core.oauth;

/** Единовременный вход: параллельный логин отменяет предыдущий. */
let activeLogin: ReturnType<typeof o.beginOAuthLogin> | null = null;

function fmtCharacterListItem(c: { name: string; level?: number; class?: string; league?: string | null }): string {
  const league = c.league ? `, лига ${c.league}` : '';
  return `- **${c.name}** — ${c.class ?? '?'} ${c.level ?? '?'} ур.${league}`;
}

/** Компактный список предметов секции персонажа (экипировка/инвентарь). */
function fmtItems(items: unknown): string[] {
  const out: string[] = [];
  let n = 0;
  for (const itRaw of Array.isArray(items) ? items : []) {
    const it = (itRaw ?? {}) as Record<string, unknown>;
    if (typeof it !== 'object') continue;
    const base = String(it['typeLine'] ?? it['baseType'] ?? it['name'] ?? '?');
    const name = typeof it['name'] === 'string' && it['name'] ? `${it['name']} ` : '';
    const ilvl = typeof it['ilvl'] === 'number' ? `, ilvl ${it['ilvl']}` : '';
    const rarity = typeof it['rarity'] === 'string' ? `${it['rarity']} ` : '';
    out.push(`  - ${rarity}${name}${base}${ilvl}`);
    if (++n >= 60) {
      out.push('  - … (сокращено; полный JSON ниже/включите include_raw)');
      break;
    }
  }
  return out;
}

export function registerOauthTools(server: McpServer): number {
  let count = 0;

  server.registerTool(
    'poe2_oauth_status',
    {
      title: 'GGG OAuth Status',
      description: `Состояние OAuth-входа GGG: зарегистрирован ли client_id (env POE2K_GGG_CLIENT_ID), выполнен ли вход, когда истекает access-токен, есть ли refresh. Используйте перед poe2_characters / poe2_character_get.

Примеры:
  - "я авторизован?" → просто вызовите без аргументов
`,
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      const s = o.oauthStatus();
      const lines = [
        '## GGG OAuth (PoE2, official API)',
        `- OAuth-приложение (client_id): ${s.clientIdConfigured ? '✅ POE2K_GGG_CLIENT_ID задан' : '❌ не задан — live-вход невозможен (pathofexile.com/developer → oauth@grindinggear.com)'}`,
        `- Вход выполнен: ${s.authorized ? '✅ да' : '❌ нет (poe2_oauth_login)'}`,
      ];
      if (s.authorized) {
        lines.push(
          `- Аккаунт: ${s.username ?? '—'}`,
          `- Access-токен действует: ${s.accessTokenValid ? '✅' : `❌ истёк ${new Date(s.expiresAt ?? 0).toISOString()}`}`,
          `- Refresh доступен: ${s.refreshable ? '✅ (токен обновится сам)' : '❌ (нужен повторный вход)'}`,
          `- Scopes: \`${s.scope ?? '—'}\``,
        );
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );
  count++;

  server.registerTool(
    'poe2_oauth_login',
    {
      title: 'GGG OAuth Login',
      description: `Вход через OAuth 2.1 GGG (PKCE, официальный API): возвращает URL — откройте его в браузере, подтвердите доступ, и инструмент дождётся callback и завершит вход. Токены сохраняются локально (~/.poe2-kit/ggg-oauth.json, режим 0600). Один вызов = один вход; повторный вызов отменяет предыдущее ожидание.

Аргументы:
  - wait_s (number, опц.): сколько секунд ждать подтверждения (по умолчанию 180, макс 600).
  - port (number, опц.): порт локального callback, должен совпадать с зарегистрированным redirect URI (по умолчанию 8080).
  - open (boolean, опц.): попытаться открыть браузер автоматически (start <url> на Windows; default false).

Требует env POE2K_GGG_CLIENT_ID.
`,
      inputSchema: {
        wait_s: z.number().int().min(10).max(600).optional().describe('Секунд ждать подтверждения в браузере'),
        port: z.number().int().min(1024).max(65535).optional().describe('Порт callback (как в redirect URI)'),
        open: z.boolean().optional().describe('Открыть браузер автоматически'),
      },
      annotations: { idempotentHint: false, openWorldHint: true },
    },
    async ({ wait_s, port, open }) => {
      try {
        if (activeLogin) {
          activeLogin.cancel('начат новый вход');
          activeLogin = null;
        }
        const handle = o.beginOAuthLogin(port ?? undefined);
        activeLogin = handle;
        const waitMs = (wait_s ?? 180) * 1000;
        const timer = setTimeout(() => handle.cancel(`истекло ${wait_s ?? 180} с ожидания`), waitMs);
        if (open) {
          // best-effort: без throw, если платформа не открыла
          const cmd =
            process.platform === 'win32'
              ? `start "" "${handle.authorizeUrl}"`
              : process.platform === 'darwin'
                ? `open "${handle.authorizeUrl}"`
                : null;
          if (cmd) {
            const { exec } = await import('node:child_process');
            exec(cmd, () => undefined);
          }
        }
        try {
          const res = await handle.complete;
          return {
            content: [
              {
                type: 'text',
                text: `## Вход выполнен ✅\n- Аккаунт: ${res.username ?? '—'}\n- Scopes: \`${res.scope}\`\n\nТеперь доступны poe2_characters и poe2_character_get.`,
              },
            ],
          };
        } finally {
          clearTimeout(timer);
          activeLogin = null;
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Вход не выполнен: ${msg}` }] };
      }
    },
  );
  count++;

  server.registerTool(
    'poe2_oauth_logout',
    {
      title: 'GGG OAuth Logout',
      description: `Забыть локальные OAuth-токены GGG (удаление файла ~/.poe2-kit/ggg-oauth.json). Серверный revoke требует scope oauth:revoke и не запрашивается; отозвать доступ для приложения можно в профиле GGG → applications.
`,
      inputSchema: {},
    },
    async () => {
      o.clearOAuthToken();
      return { content: [{ type: 'text', text: 'Локальные токены GGG удалены. Доступ приложения можно отозвать в профиле pathofexile.com → applications.' }] };
    },
  );
  count++;

  server.registerTool(
    'poe2_characters',
    {
      title: 'PoE2 Account Characters',
      description: `Список персонажей PoE2 вашего аккаунта через официальный API GGG (realm poe2): имя, класс, уровень, лига, опыт.

Требует выполненного входа (poe2_oauth_login).
`,
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const chars = await o.listPoe2Characters();
        if (!chars.length) {
          return { content: [{ type: 'text', text: 'Персонажей PoE2 на аккаунте нет (или вход выполнен не для того аккаунта).' }] };
        }
        const lines = [`## Персонажи PoE2 (${chars.length})`, ''];
        for (const c of chars) lines.push(fmtCharacterListItem(c));
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Не удалось получить персонажей: ${msg}` }] };
      }
    },
  );
  count++;

  server.registerTool(
    'poe2_character_get',
    {
      title: 'PoE2 Character Snapshot',
      description: `Полный снапшот персонажа PoE2 из официального API GGG: имя/класс/уровень/лига, экипировка, инвентарь, пассивки (сырой JSON GGG). Без копипасты из игры.

Аргументы:
  - name (string, обяз.): имя персонажа (список — poe2_characters).
  - include_raw (boolean, опц.): вернуть полный сырой JSON (default true; при большом ответе — с усечением).
  - section (string, опц.): только одна секция сырого ответа: "equipment" | "inventory" | имена секций зависят от схемы GGG (передайте ключ верхнего уровня объекта character).

Требует выполненного входа (poe2_oauth_login).
`,
      inputSchema: {
        name: z.string().min(1).max(64).describe('Имя персонажа'),
        include_raw: z.boolean().optional().describe('Вернуть полный JSON'),
        section: z.string().min(2).max(32).optional().describe('Только эта секция ответа (ключ в character)'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ name, include_raw, section }) => {
      try {
        const { character } = await o.getPoe2Character(name);
        if (!character) {
          return { isError: true, content: [{ type: 'text', text: `Персонаж «${name}» не найден на аккаунте (realm poe2).` }] };
        }
        const lines: string[] = [];
        lines.push(`## ${character.name} — ${character.class ?? '?'} ${character.level ?? '?'} ур., лига ${character.league ?? '—'}`, '');
        // Секции с предметами — компактный список; ключи не документированы GGG
        // жёстко, поэтому перебираем типичные и любые массивы предметов.
        const knownSections = ['equipment', 'inventory'];
        for (const key of knownSections) {
          const v = character[key];
          if (Array.isArray(v) && v.length) {
            lines.push(`### ${key} (${v.length})`);
            lines.push(...fmtItems(v));
            lines.push('');
          }
        }
        if (section) {
          const v = (character as Record<string, unknown>)[section];
          const text = JSON.stringify(v, null, 2) ?? 'null';
          lines.push(`### секция «${section}»`, '```json', text.slice(0, 50_000), '```');
          return { content: [{ type: 'text', text: lines.join('\n') }] };
        }
        if (include_raw !== false) {
          let raw = JSON.stringify(character, null, 2);
          let truncated = false;
          if (raw.length > 80_000) {
            raw = raw.slice(0, 80_000);
            truncated = true;
          }
          lines.push('### Сырой JSON (снапшот GGG)', '```json', raw, '```');
          if (truncated) lines.push('_(ответ усечён до 80 000 символов; попросите section=… для конкретной секции)_');
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Не удалось получить персонажа: ${msg}` }] };
      }
    },
  );
  count++;

  return count;
}
