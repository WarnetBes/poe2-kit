<div align="center">

# poe2-kit

**A transparent overlay and AI toolkit for Path of Exile 2 (Windows).**

Price-check an item on a hotkey, track your build shopping list, follow the
leveling guide, watch currency rates — and drive all of it from your AI
assistant. Reads only what the game writes to disk and what you copy
yourself. No automation, no memory reading.

[Download the latest release »](https://github.com/WarnetBes/poe2-kit/releases/latest)

[![GitHub Release](https://img.shields.io/github/v/release/WarnetBes/poe2-kit)](https://github.com/WarnetBes/poe2-kit/releases)
[![GitHub Downloads (latest release)](https://img.shields.io/github/downloads/WarnetBes/poe2-kit/latest/total)](https://github.com/WarnetBes/poe2-kit/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Ru readme](https://img.shields.io/badge/README-Русский-blue)](README.md)

<a href="docs/screenshots/overlay-build.png"><img src="docs/screenshots/overlay-build.png" height="420" alt="poe2-kit overlay: build shopping list over the game"></a>
<a href="docs/screenshots/overlay-price.png"><img src="docs/screenshots/overlay-price.png" height="420" alt="poe2-kit overlay: item price check with market table"></a>

*Left: build shopping list — target items with live prices and “you are
wearing” hints, synced from your character page. Right: price check — an
RU-client item is translated to its English name and priced across
poe2scout, poe.ninja and trade2.*

</div>

---

## What it does

- **💰 Price check on a hotkey** — hover an item → Ctrl+C → Ctrl+F1: price
  estimate with confidence and the raw market table from free public APIs
  ([poe.ninja](https://poe.ninja), [poe2scout](https://poe2scout.com), the
  official Path of Exile 2 `trade2` API). No API keys required.
- **🛒 Build shopping list** — paste a PoB2 share-code (Ctrl+F3): target gear
  per slot with live prices, “bought” checkmarks synced from your public
  character page, total budget.
- **💎 Gem setups** — which support gems go into which item, checked off as
  you socket them.
- **📈 Leveling guide** — step-by-step campaign hints that follow your actual
  zone (read from the standard game log).
- **+ more tabs**: waypoint/tilestone recipes, boss-timer, RU⇄EN item/gem
  dictionaries, crafting recipes (essences, omens), currency rates, a
  “pinnacle readiness” checklist, live top-builds from poe.ninja.
- **🤖 MCP server** — 59 poe2_* tools, so your AI assistant (OpenCode,
  Claude Desktop, …) can price items, decode PoB codes, pull ladders,
  rates and dataset info for you.
- **🌐 Web dashboard** — the same core in the browser: rates, price check,
  build import.

One core (**`@poe2-kit/core`**) powers all three frontends:

| Frontend | Package | What it is |
|---|---|---|
| 🖥️ Windows overlay | `apps/overlay` | Transparent window over the game: hotkey pricing, build/gems/leveling tabs, watchlist alerts |
| 🧠 MCP server for AI | `apps/mcp` | 59 `poe2_*` tools for AI assistants (stdio) |
| 🌐 Web app | `apps/web` | Browser dashboard: currency rates, price check, leveling guide, build import |

> **Note**: the overlay UI is currently Russian-first (it grew out of an
> SSF campaign on the RU client); all price/lookup data is English, and the
> built-in RU⇄EN dictionaries translate items and gems on the fly. Full EN
> localization is on the roadmap. The screenshots above are real usage
> data — an English item name price-checked from a Russian client.

## Quick start (non-programmer)

There is no .exe installer — the kit ships as a zip, but launching is automated.

1. **Download**: [GitHub Releases](https://github.com/WarnetBes/poe2-kit/releases/latest) →
   the latest release:
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

## Hotkeys (overlay)

| Hotkey | Action |
|---|---|
| Ctrl+F1 | Price check (item from clipboard) |
| Ctrl+F3 | Import PoB2 share-code → build shopping list |
| Ctrl+F2 | Build panel |
| Ctrl+F4 | Leveling context |
| Ctrl+F5 / Ctrl+Shift+F5 | Move / pin the overlay |
| Ctrl+F6 | Settings |
| Ctrl+F7 | Pinnacle readiness checklist |

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

## Privacy & community learning (opt-in)

- The kit **never sends data about you** anywhere: the only network endpoints
  are public price APIs (poe.ninja, poe2scout, trade2).
- **Opt-in learn log**: if you enable it (overlay → Ctrl+F6 → “Learn log”
  checkbox), each price check stores the item’s **structure only**
  (rarity, base, mods, stat ids) **locally** — no character or account names.
- **Contributing items**: Ctrl+F6 → “📤 Share items” copies a ready-to-paste
  text block. Open an issue and paste it — that is all.
  Only the maintainer merges contributions, via a strict validator
  (`merge-contributions.mjs`): user contributions are data, never code —
  see [SECURITY.md](SECURITY.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

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

## Links

- Canonical repo & issue tracker: [SourceCraft](https://sourcecraft.dev/volkovpartilaholin/poe2-kit)
  (this GitHub repo mirrors releases and accepts issues here too)
- Version history: [CHANGELOG.md](CHANGELOG.md)
- Roadmap & build diary: [WORK_LOG.md](WORK_LOG.md) (Russian)

## ☕ Support

The kit is free and will stay free — no ads, no premium, no telemetry.
Support is entirely optional; a thank-you in the issues is already great.

<details>
<summary>☕ Optional support (RU payment rails)</summary>

Developer’s calendar: October 22, 2026 — wedding in Saint Petersburg
(Wedding Palace No. 1). If the support links below happen to get a bit
busier that month, organizing the celebration becomes slightly easier 🙂
Still entirely optional — the kit stays free either way.

- **SBP / Russian bank transfer (Alfa-Bank / Rosselkhozbank)** — by phone
  `+7 981 760-60-27` (any Russian banking app: “SBP transfer” → phone → pick bank).
- **WebMoney** (WMID `649044135447`) — purses:
  - `Z235374758440` (USD) · `E248778175899` (EUR)
  - `T958910155976` · `Q495876683152` · `M672735954801` · `F873704704436` · `H177756398822` · `X190692638474` · `L890511223722`

</details>
