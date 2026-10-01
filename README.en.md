# poe2-kit

[![Русский](https://img.shields.io/badge/README-Русский-blue)](README.md)

A complete helper for **Path of Exile 2**: leveling guide, AI advice, universal
trading, build analysis and item price checking.

One core (**`@poe2-kit/core`**) powers three frontends:

| Frontend | Package | What it is |
|---|---|---|
| 🌐 Web app | `apps/web` | Dashboard: currency rates, price check, leveling guide, build import |
| 🖥️ Windows overlay | `apps/overlay` | Transparent window over the game: price check on a hotkey, panel tabs (build, 💎 gems, leveling, settings), clipboard auto-pricing, watchlist alerts |
| 🧠 MCP server for AI | `apps/mcp` | 55 `poe2_*` tools for AI assistants (OpenCode, Claude Desktop, …) |

Prices and trade data come **only from free public APIs**: [poe.ninja](https://poe.ninja),
[poe2scout](https://poe2scout.com), the official Path of Exile 2 `trade2` API and
open RePoE data. No API keys required.

## Quick start (non-programmer)

There is no .exe installer — the kit ships as a zip, but launching is automated.

1. **Download**: [GitHub Releases](https://github.com/WarnetBes/poe2-kit/releases/latest) →
   the latest release (v1.0.17):
   - **`poe2-kit-portable-…-win64.zip`** (36 MB) — recommended: unzip → run
     `start-overlay.bat`. No Node.js, no npm: on first run the script
     downloads the Electron runtime (~110 MB) once, then works offline.
   - (Or **“Source code (zip)”** — the “build it yourself” route: needs
     Node.js ≥ 20 and internet on first launch.)
2. For the “Source code” route only: if Node.js is missing, run
   `install-tools-minimal.bat` once (it installs Node.js for you).
3. **Launch what you need**:
   - **`start-overlay.bat`** — overlay over the game (Windows). In game: hover
     an item → Ctrl+C → **Ctrl+F1** — price. Ctrl+F3 — build import;
     Ctrl+F6 — settings. Log: `%APPDATA%\@poe2-kit\overlay\overlay.log`.
   - **`start-web.bat`** — dashboard in the browser: http://localhost:5173
   - **`start-mcp.bat`** — MCP server for AI assistants (stdio).

Feedback, bugs and ideas → issues on
[SourceCraft](https://sourcecraft.dev/volkovpartilaholin/poe2-kit/issues).
Version history: [CHANGELOG.md](CHANGELOG.md).

## Privacy & community learning (opt-in)

- The kit **never sends data about you** anywhere: the only network endpoints
  are public price APIs (poe.ninja, poe2scout, trade2).
- **Opt-in learn log**: if you enable it (overlay → Ctrl+F6 → “Learn log”
  checkbox), each price check stores the item’s **structure only**
  (rarity, base, mods, stat ids) **locally** — no character or account names.
- **Contributing items**: Ctrl+F6 → “📤 Share items” copies a ready-to-paste
  text block. Open an issue on SourceCraft and paste it — that is all.
  Only the maintainer merges contributions, via a strict validator
  (`merge-contributions.mjs`): user contributions are data, never code —
  see [SECURITY.md](SECURITY.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Rules & disclaimer

- **No automation.** The kit only reads and shows: hotkey → read clipboard →
  public API request. It never presses anything in the game — one keystroke
  by the user = one action. No auto-flasks, no macros, no input simulation.
- **No game-client access.** The kit never reads game memory, injects code
  or hooks its output. It reads exactly two things the game writes to disk
  or you copy yourself: the standard **game log**
  (`…\Path of Exile 2\logs\LatestClient.txt` — the same file every
  levelling overlay reads: zone entry lines drive levelling progress and
  the boss-timer stopwatch) and the **clipboard** when you press Ctrl+C on
  an item (same as any trade tool). That's the entire “contact” surface.
- **Overlay window tracking.** To sit on top of the game, the Windows overlay
  calls exactly three **read-only** Win32 functions via FFI (`koffi`,
  `user32.dll`): `EnumWindows` (find window), `GetWindowRect` (position),
  `GetForegroundWindow` (is it active). Nothing is written to the game
  process; no hooks; no input. Prefer zero user32 calls at all? Overlay →
  **Ctrl+F6** → untick “Bind to game window”: the overlay pins to a screen
  corner and learns nothing about the game window (“cautious mode”).
- **Disclaimer.** Use of third-party tools is **at your own risk**.
  Grinding Gear Games does not guarantee the safety of third-party tools and
  has not officially endorsed this project. The kit follows the same pattern
  as common trade tools (Awakened PoE Trade etc.): read-only, no automation,
  no hidden information — but the decision to use it is yours.

## For developers

Requires **Node.js ≥ 20**.

```bash
npm install          # install dependencies (npm workspaces)
npm run build        # build the core
npm run build -w @poe2-kit/web   # tsc + vite build
npm run dev    -w @poe2-kit/web  # dev server (localhost:5173)
npm run portable     # build the portable zip release asset
```

- MCP server for clients: `command: node`,
  `args: ["<repo>\\apps\\mcp\\dist\\index.js"]` (stdio).
- Full tool list: [README.md](README.md) (Russian),
  assistant prompt: `apps/mcp/ASSISTANT_GUIDE.md`.
- License: MIT.
