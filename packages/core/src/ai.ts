/**
 * AI-слой с авто-детекцией доступной модели.
 * Порядок попыток:
 *   1) Внешний OpenAI-совместимый эндпоинт (настроен через переменные окружения:
 *      POE2KIT_AI_BASE, POE2KIT_AI_KEY, POE2KIT_AI_MODEL) — сюда подключаются
 *      модели OpenCode вида eliza-glm/glm-5-3, eliza-qwen/..., eliza-deepseek/...
 *   2) Локальная модель через Ollama/OpenAI-совместимый endpoint
 *      (POE2KIT_OLLAMA_URL, по умолчанию http://localhost:11434/v1, модель
 *      POE2KIT_OLLAMA_MODEL).
 *   3) Fallback-ответ «нет доступной модели» — только в том случае, если
 *      ничего не сконфигурировано.
 */

import type { AIProviderInfo, AIRequest, AIResponse } from './types.js';
import {
  getClassLevelingHint,
  getClassLevelingTips,
  resolveLevelingClass,
  CLASS_LEVELING_GUIDES,
} from './leveling.js';

export interface OpenAICompatibleChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAICompatibleRequest {
  model: string;
  messages: OpenAICompatibleChatMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface CompletionsPayload {
  choices?: Array<{ message?: { content?: string } }>;
  error?: unknown;
}

const MAX_TOKENS = 2048;

/** Собрать системный промпт-помощника PoE2. */
export function systemPrompt(): string {
  return `Ты — PoE2 Kit, ИИ-помощник по Path of Exile 2 (бесплатный фан-проект, не связан с Grinding Gear Games).
Ты помогаешь игроку: собирать билды, оценивать снаряжение, давать советы по прокачке и торговле.
Ты честен: если ты не уверен в каком-то числе или механике — говори об этом и советуй свериться с актуальными источниками (poe2wiki, poe.ninja), так как патчи часто меняют игру.
Отвечай по-русски, кратко и по делу. Если игрок дал данные билда — учитывай их.`;
}

function buildMessages(prompt: string, context?: Record<string, unknown>): OpenAICompatibleChatMessage[] {
  const messages: OpenAICompatibleChatMessage[] = [{ role: 'system', content: systemPrompt() }];
  if (context && Object.keys(context).length) {
    messages.push({ role: 'system', content: `Контекст игрока:\n${JSON.stringify(context, null, 2)}` });
  }
  messages.push({ role: 'user', content: prompt });
  return messages;
}

/** Низкоуровневый вызов OpenAI-совместимого чат-эндпоинта. */
export async function callChatEndpoint(
  base: string,
  apiKey: string | undefined,
  model: string,
  prompt: string,
  context?: Record<string, unknown>,
): Promise<string> {
  const body: OpenAICompatibleRequest = {
    model,
    messages: buildMessages(prompt, context),
    temperature: 0.4,
    max_tokens: MAX_TOKENS,
  };
  const url = base.replace(/\/+$/, '') + '/chat/completions';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Chat endpoint returned HTTP ${res.status}`);
  }
  const data = (await res.json()) as CompletionsPayload;
  if (data.error) {
    throw new Error(`Chat endpoint error: ${JSON.stringify(data.error)}`);
  }
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Empty response from chat endpoint');
  return text;
}

/** Перечислить доступные AI-провайдеры на основе окружения. */
export function listAIProviders(): AIProviderInfo[] {
  const providers: AIProviderInfo[] = [];
  const base = process.env.POE2KIT_AI_BASE;
  const model = process.env.POE2KIT_AI_MODEL;
  if (base && model) {
    providers.push({
      id: 'opencode',
      label: `OpenCode: ${model}`,
      available: true,
      kind: 'opencode',
    });
  }
  const ollamaUrl = process.env.POE2KIT_OLLAMA_URL ?? 'http://localhost:11434/v1';
  const ollamaModel = process.env.POE2KIT_OLLAMA_MODEL;
  if (ollamaModel) {
    providers.push({
      id: 'local',
      label: `Локальная (${ollamaModel})`,
      available: false, // будет проверено при вызове
      kind: 'local',
      message: `Проверяется на ${ollamaUrl}`,
    });
  }
  if (!providers.length) {
    providers.push({
      id: 'none',
      label: 'Нет настроенных AI-моделей',
      available: false,
      kind: 'none',
      message: 'Задайте POE2KIT_AI_BASE / POE2KIT_AI_MODEL (OpenCode-модели) или POE2KIT_OLLAMA_MODEL (локально).',
    });
  }
  return providers;
}

/**
 * Rule-based советы по прокачке — доступны даже без live-модели.
 * Универсально: класс берётся из context.className/ascendancy ('Warrior',
 * 'Invoker', 'Sorceress', 'Lich', ...), по умолчанию Monk (совместимость).
 */
export function iceStrikeMonkAdvice(context?: Record<string, unknown>): string {
  return classLevelingAdvice(context);
}

/** Советы по прокачке для любого класса/асценданси из context. */
export function classLevelingAdvice(context?: Record<string, unknown>): string {
  const lvl =
    typeof context?.level === 'number'
      ? context.level
      : typeof context?.playerLevel === 'number'
        ? context.playerLevel
        : undefined;
  const query =
    (typeof context?.ascendancy === 'string' && context.ascendancy) ||
    (typeof context?.className === 'string' && context.className) ||
    undefined;
  const guide = resolveLevelingClass(query) ?? CLASS_LEVELING_GUIDES.monk!;

  const tips = getClassLevelingTips(query || guide.baseClass, lvl);
  const lines: string[] = [`${guide.baseClass} — советы по прокачке`, `_${guide.tagline}_`];
  if (guide.damage?.length) lines.push(`Урон: ${guide.damage.join('; ')}`);
  if (guide.defense?.length) lines.push(`Защита: ${guide.defense.join('; ')}`);
  for (const t of tips) {
    const range = t.toLevel == null ? `${t.fromLevel}+` : `${t.fromLevel}–${t.toLevel}`;
    lines.push(`\n**Уровни ${range}**:`);
    if (t.gems?.length) lines.push(`  • Камни: ${t.gems.join(', ')}`);
    if (t.gear?.length) {
      lines.push(`  • Экипировка: ${t.gear.join('; ')}`);
    }
    if (t.notes?.length) {
      for (const n of t.notes) lines.push(`  • ${n}`);
    }
  }
  if (!tips.length) {
    lines.push(`\n  • ${getClassLevelingHint(query || guide.baseClass, lvl)}`);
  }
  return lines.join('\n');
}

/**
 * Авто-детекция и вызов: пробуем внешний эндпоинт (OpenCode-модель),
 * затем локальную Ollama, иначе возвращаем fallback.
 */
export async function askAI(req: AIRequest): Promise<AIResponse> {
  const base = process.env.POE2KIT_AI_BASE;
  const key = process.env.POE2KIT_AI_KEY;
  const model = process.env.POE2KIT_AI_MODEL;

  if (base && model) {
    try {
      const text = await callChatEndpoint(base, key, model, req.prompt, req.context);
      return { text, provider: model, source: 'opencode' };
    } catch {
      // fallthrough to local
    }
  }

  const ollamaUrl = process.env.POE2KIT_OLLAMA_URL ?? 'http://localhost:11434/v1';
  const ollamaModel = process.env.POE2KIT_OLLAMA_MODEL;
  if (ollamaModel) {
    try {
      const text = await callChatEndpoint(ollamaUrl, undefined, ollamaModel, req.prompt, req.context);
      return { text, provider: `${ollamaModel} (локальная)`, source: 'local' };
    } catch {
      // fallthrough
    }
  }

  // Нет доступной модели — даём полезный fallback: советы по классу из контекста.
  const level = typeof req.context?.level === 'number' ? req.context.level : undefined;
  const query =
    (typeof req.context?.ascendancy === 'string' && req.context.ascendancy) ||
    (typeof req.context?.className === 'string' && req.context.className) ||
    undefined;
  const hint = getClassLevelingHint(query, level);
  return {
    text:
      `Нет доступной AI-модели (настройте POE2KIT_AI_BASE/POE2KIT_AI_MODEL, напр. eliza-deepseek/deepseek-v4-flash, или POE2KIT_OLLAMA_MODEL).\n\n` +
      `Пока могу предоставить заложенные советы по вашему билду:\n${classLevelingAdvice(req.context)}\n\n` +
      `Быстрый совет: ${hint}`,
    provider: 'none',
    source: 'none',
  };
}