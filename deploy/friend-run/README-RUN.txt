# PoE2 Kit на игровом ПК — запуск (волна №239–№248, commit 163648c)

## 1. Web (вкладки: Гайды / Карты / 🌀 Simulacrum)
1. Папка `web` — открытие `index.html` двойным кликом НЕ работает (fetch по file:// заблокирован браузером).
2. Запуск: двойной клик `START-WEB.bat` → откроется http://localhost:4173.
3. Требование: Node.js LTS (`winget install OpenJS.NodeJS.LTS`, если нет).

## 2. MCP (63 тула: prices, maps, simulacrum, freshness и т.д.)
MCP-сервер — stdio. Подключение в OpenCode (на другом ПК — правишь хост на IP этой машины):

```json
{
  "mcp": {
    "poe2-kit": {
      "type": "local",
      "command": ["node", "F:\\OpenCodeProjects\\poe2-kit\\mcp\\dist\\index.js"]
    }
  }
}
```

Проверка руками (покажет список тулов и выйдет):
```
node F:\OpenCodeProjects\poe2-kit\mcp\dist\index.js --smoke
```

## 3. Что в этой папке
- `web\` — статика веб-приложения (dist)
- `mcp\dist\` — MCP-сервер (63 тула, данные на борту)
- `START-WEB.bat`, `server.mjs` — запуск web
- `core\dist`, `core\data` — ядро и датасеты (для обновления своими скриптами)

## 4. Обновление
Владелец деплоит с основной машины: `deploy-share.mjs --all`. Локально ничего не собирать.
