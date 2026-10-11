// Shared-константа числа MCP-тулов (пред-работа-1 волны-3, мастер-план §3.1).
// ЕДИНЫЙ источник правды для смоков n236/n239/n256: при добавлении/удалении
// тула меняем ЗДЕСЬ (и списки README.md + apps/mcp/ASSISTANT_GUIDE.md —
// текстовые, не asserted; теперь их ведёт только человек по release-чеклисту).
// Формат выхода: "[smoke] Registered tools: <N>" (apps/mcp/src/index.ts:98).

/** Ожидаемое число зарегистрированных poe2_* тулов в apps/mcp. */
export const EXPECTED_TOOL_COUNT = 75;

/** Готовая regex-проверка строки "[smoke] Registered tools: <N>". */
export function toolCountReassert(out) {
  return new RegExp(`\\[smoke\\] Registered tools: ${EXPECTED_TOOL_COUNT}\\b`).test(out);
}
