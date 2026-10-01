# Reddit post draft — r/PathOfExile2 (EN)

> Готовый к публикации текст. Факты сверены с CHANGELOG 1.0.17 и кодом
> (win32.ts: три read-only user32-функции; main.ts: Client.txt, clipboard opt-in).
> Заголовков дано три — выбрать один. Не постить всё сразу после регистрации
> аккаунта: у reddita анти-спам к свежим аккаунтам с ссылками.
>
> ⚠️ Ссылки: SourceCraft-страницы видны анонимно, НО прямая скачка zip-ассета
> там требует логин (проверено 01.10.2026). Первичные ссылки в посте —
> GitHub-зеркало (scripts/mirror-github.mjs); после первого запуска зеркала
> заменить SourceCraft-Download-ссылки ниже на `github.com/<user>/poe2-kit/...`.
> SourceCraft оставить как canonical-исходник во втором упоминании.

## Title (варианты)

1. PoE2 Kit — a free overlay for SSF players: price check, boss timer, craft plans, PoB2 combo import (full Russian-client support)
2. I kept alt-tabbing to price-check my drops on the RU client — so I built a full-Russian overlay, and it does boss timers too
3. PoE2 Kit v1.0.17 — an external overlay (log-file only, no game memory access): prices, levelling, crafting, builds

## Body

Hey everyone! I've been playing SSF on the Russian client and got tired of
alt-tabbing between the game, poe.ninja and a spreadsheet — so over the last
weeks I built **PoE2 Kit**, a free companion overlay for Path of Exile 2.
Sharing it in case it helps someone, and I'd genuinely like feedback on what
to build next.

**What it does** (everything works from hotkeys, noisy bits are opt-in):

* **Price check** — hover an item → Ctrl+C → Ctrl+F1: median estimate in
  chaos-equivalents (live trade2 + poe.ninja + poe2scout, ~10 listings, per
  league).
* **Boss timer + boss cards** — it watches the game log for zone entry and
  starts a stopwatch at the boss door; «🏆 killed» / «💀 died» buttons track
  attempts and best times per league. Boss cards show their damage types,
  strengths and weaknesses (researched against current guides).
* **Levelling tracker** — reads zone-entry lines from the game log and marks
  campaign progress, permanently-rewardable zones and quest rewards.
* **Craft planner** — paste any item → a step-by-step crafting plan with an
  SSF-friendly estimate of the currency it needs.
* **Combo builder** — pick an active + compatible supports, get a
  ready-to-paste import code for PoB2.
* **Build import** — paste a PoB2 share code: slots, tree progress, DPS
  estimate, and per-slot price estimates.
* Currency rates, endgame ("pinnacle") checklists, a crafting-recipe
  catalogue, and a jargon dictionary for newer players.

**Full Russian-client support** — this was the whole reason I started: RU
item names, RU gem names, RU zone names all resolve to their English trade
counterparts (a 2,300-entry dictionary built from community data), so price
checking works out of the box on a Russian client. English clients work too.

**Safety / legality, stated plainly** (because I'd want to see this in any
tool post):

* The kit **never reads game memory, never injects anything, never simulates
  input** — no automation of any kind. This is an entirely external tool,
  the category GGG's policy allows ("It's okay to run things that are
  entirely external to the game").
* Its only two data sources are: the standard game log file
  `logs\LatestClient.txt` (zone-entry lines — the same file every levelling
  overlay reads) and the clipboard, when you press Ctrl+C on an item.
* The overlay window calls exactly three **read-only** Win32 functions to
  stay on top of the game window (`EnumWindows`, `GetWindowRect`,
  `GetForegroundWindow`). If you want zero of those: one checkbox in
  settings disables even that.
* Clipboard watching is opt-in and off by default. No data about you is sent
  anywhere — network calls go to public APIs only (trade2, poe.ninja,
  poe2scout).
* Standard disclaimer: third-party tools are use-at-your-own-risk; GGG does
  not endorse this project.

**Install (portable, ~37 MB zip)**: unzip → run `start-overlay.bat` (it
downloads the Electron runtime once, ~110 MB, then works offline). No admin
rights, no installer, no Node.js needed. Source code and full version history
are in the repository — I'm not asking anyone to trust a binary they can't
read.

* Download: [Releases](https://sourcecraft.dev/volkovpartilaholin/poe2-kit/releases) →
  `poe2-kit-portable-1.0.17-win64.zip`
* Source: [sourcecraft.dev/volkovpartilaholin/poe2-kit](https://sourcecraft.dev/volkovpartilaholin/poe2-kit)
* Changelog with per-feature detail: [CHANGELOG.md](https://sourcecraft.dev/volkovpartilaholin/poe2-kit/blob/main/CHANGELOG.md)

**Ask**: if you tried it — what's missing for your league start? I'm
specifically unsure whether the combo-import code PoB2 accepts cleanly on
all setups, and whether non-RU players want a full translation of the panel
UI (it's currently RU with EN item data). Bug reports and ideas → issues on
SourceCraft. Thanks for reading!
