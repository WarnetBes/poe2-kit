# Reddit post draft — r/PathOfExile2 (EN)

> Готовый к публикации текст. Факты сверены с CHANGELOG 1.0.17 и кодом
> (win32.ts: три read-only user32-функции; main.ts: Client.txt, clipboard opt-in).
> Ссылки верифицированы анонимным curl 01.10.2026: GitHub zip качается
> анонимно (SHA совпадает с эталоном), страница репо/релизов 200.
> Перед постом: сверить rules r/PathOfExile2 в живом браузере (из этой
> сессии reddit отдаёт Cloudflare-блок; возможны требования к self-promo).

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

* Download (portable, ~37 MB zip): [GitHub Releases](https://github.com/WarnetBes/poe2-kit/releases/latest) →
  `poe2-kit-portable-1.0.17-win64.zip` — unzip → run `start-overlay.bat`
  (it downloads the Electron runtime once, ~110 MB, then works offline).
  No admin rights, no installer, no Node.js needed.
* Source: [github.com/WarnetBes/poe2-kit](https://github.com/WarnetBes/poe2-kit)
  — full source code and version history. I'm not asking anyone to trust a
  binary they can't read.
* Canonical repo (RU docs, development, issues):
  [sourcecraft.dev/volkovpartilaholin/poe2-kit](https://sourcecraft.dev/volkovpartilaholin/poe2-kit)

**Ask**: if you tried it — what's missing for your league start? I'm
specifically unsure whether the combo-import code PoB2 accepts cleanly on
all setups, and whether non-RU players want a full translation of the panel
UI (it's currently RU with EN item data). Bug reports and ideas → issues on
GitHub or SourceCraft. Thanks for reading!

## Publish checklist (r/PathOfExile2)

1. **Rules вживую**: открыть https://www.reddit.com/r/PathOfExile2/about/rules
   в браузере (из рабочей сессии reddit отдаёт Cloudflare-блок — правила
   не верифицированы). Если есть отдельные требования к self-promo / tool-постам
   (флейр «Tool», «Feedback», модератор-аппрув) — соблюсти их.
2. **Аккаунт**: постить с аккаунта с историей участия (не свежая регистрация);
   если аккаунт новый — сначала 2–3 недели обычных комментариев. В посте
   уже есть прозрачность («I built»), это и есть reddit-гигиена.
3. **Тип поста**: text-post (не link-post) — тело выше, ссылка внутри.
   Заголовок — вариант 1 или 3 (вариант 2 мягче, но длиннее 220 симв. —
   reddit режет; проверить лимит при вставке).
4. **Время**: постить в прайм NA/EU (18:00–21:00 UTC), не в выходной поток
   лутеров — иначе bury без чтения.
5. **После поста**: не отвечать на каждое сообщение шаблоном; отвечать по
   делу, критику про «RU panel» принимать как roadmap-факт.
6. **Не кросспостить** тот же текст в другие сабреддиты в один день —
   анти-спам-фильтр reddit помечает одинаковое содержимое как
   скоординированный спам.

