# PoE2 Kit — агенты OpenCode (канон + установщик)

Канонические определения агентов PoE2 Kit для OpenCode. Агент-диспетчер
`poe2-kit` **не нужен** (решение владельца, №641): builder и trader вызываются
@-упоминанием напрямую или маршрутизируются основным primary-агентом сессии.

```
integrations/opencode/
├── agents/
│   ├── poe2-builder.md  # subagent: сборка/верификация билдов (PoB-оракул)
│   └── poe2-trader.md   # subagent: цены/продажа/валюты (рынок trade2)
├── install-agent.mjs    # установщик (idempotent, защита чужих файлов)
└── README.md            # этот файл
```

## Архитектура (почему кит не ломается)

| Слой | Что даёт | Где живёт |
|---|---|---|
| MCP-сервер `poe2-kit` | 79 тулов `poe2_*` (данные) | `apps/mcp`, конфиг `mcp.poe2-kit` |
| Агенты (эта папка) | поведение/дисциплина | `~/.config/opencode/agents/` или `<проект>/.opencode/agents/` |

Агенты — только markdown-конфиг OpenCode: не трогают ни код, ни dist, ни
датасеты кита. «Встроить агента в кит» = опубликовать его определение в
репозитории и доставить в конфиг OpenCode установщиком. Для проектной
встройки (пример владельца — BildPOE2) агент кладётся в
`<проект>/.opencode/agents/` и работает только в сессиях этого проекта.

## Встройка агента в конкретный проект

Пример: трейдер внутри проекта `C:\...\BildPOE2`:

```bash
cd C:\...\BildPOE2
node <путь-к-репо-poe2-kit>\integrations\opencode\install-agent.mjs --project
# или точечно, только trader: скопировать agents/poe2-trader.md
# в <проект>\.opencode\agents\poe2-trader.md
```

Проектный `.opencode/agents/` подхватывается OpenCode автоматически;
@-упоминание `@poe2-trader` доступно в сессиях этого проекта.

## Установка (глобально / проект)

```bash
node integrations/opencode/install-agent.mjs            # ~/.config/opencode/agents/
node integrations/opencode/install-agent.mjs --project  # <cwd>/.opencode/agents/
node integrations/opencode/install-agent.mjs --with-mcp  # + mcp.poe2-kit в opencode.json
node integrations/opencode/install-agent.mjs --dry-run   # план без записи
```

Поведение установщика (проверено sandbox-прогонами, 27.10.2026):

- **Идемпотентен**: повторный запуск обновляет только изменившиеся файлы, иначе
  «уже актуально», exit 0.
- **Не разрушает чужое**: файл цели без маркера `poe2-kit:managed` считается
  чужим → не перезаписывается, exit 2 (`--force` печатает прежнее содержимое
  и перезаписывает).
- **MCP-конфиг бережёт**: существующий `opencode.json` не переписывает целиком —
  бэкап `opencode.json.bak-<stamp>` + допись только `mcp["poe2-kit"]`;
  уже подключённый сервер не трогает.
- **Hot-reload**: OpenCode V2 подхватывает агентов без рестарта (форс `/reload`).

## Правки и обновления

1. Правьте файлы этой папки (канон), коммитьте.
2. Раскатка: `node integrations/opencode/install-agent.mjs` (глобально) или
   `--project` из папки целевого проекта.
3. Кастомные правки в целевых копиях перед перезаписью сохраняйте сами —
   установщик покажет содержимое лишь при `--force`.

## Известные границы

- Проектный агент виден только в сессиях своего проекта (это и есть цель
  встройки «в проект», не глобально).
- Frontmatter канона — `permission:` (документированный формат markdown-агентов,
  работает у живых агентов владельца). Battle-tested V2-вариант `permissions:`
  trader'а хранится в истории `~/.config/opencode/agents.bak-20261027/`.
- Агенты требуют подключённый MCP-сервер кита; без него честно сообщают
  «дефект среды» вместо имитации тулов.
