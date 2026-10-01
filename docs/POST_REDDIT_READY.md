# PoE2 Kit — ГОТОВЫЙ ФАЙЛ ДЛЯ ПУБЛИКАЦИИ НА REDDIT

> Этот файл = всё, что нужно для поста на https://www.reddit.com/r/PathOfExile2/
> Копируешь блоки между маркерами «>>> НАЧАЛО» и «>>> КОНЕЦ» — целиком, включая звёздочки и скобки ссылок.
> НЕ копируй сами строки-маркеры и НЕ копируй строки, начинающиеся с «#» — это служебные заголовки.
> Канон-черновик (для истории): `docs/POST_REDDIT_EN.md`.

---

## БЛОК 1 — ЗАГОЛОВОК ПОСТА (одна строка)

>>> НАЧАЛО ЗАГОЛОВКА

PoE2 Kit — a free companion overlay I built as a genre newcomer to survive Path of Exile 2: price check, boss timers, craft plans, PoB2 import (full RU-client support)

>>> КОНЕЦ ЗАГОЛОВКА

---

## БЛОК 2 — ТЕЛО ПОСТА (всё между маркерами, один раз Ctrl+A → Ctrl+C)

>>> НАЧАЛО ТЕЛА ПОСТА

Hey everyone! I came to Path of Exile 2 as a complete newcomer to this genre — no PoE1 muscle memory, none of the knowledge that guides seem to assume you already have. Honestly, the first couple of weeks nearly broke me:

* I'd pick up a rare, alt-tab to a price-check site, paste the item, get nothing useful, alt-tab back — and I'd be dead.
* Every guide said "just import it into PoB" — which turned out to be a whole second program with its own arcane share codes.
* Crafting advice assumed I already knew what an essence, an omen or a soul core does. I did not.
* Global chat spoke pure jargon — I had to google "waystone" to understand what I was even supposed to be farming.

I got tired of playing the game in one window and the wiki in four others, so over the last few weeks I built **PoE2 Kit** — a free companion overlay for Path of Exile 2. Sharing it in case it helps other new players survive their first league, and I'd genuinely like feedback on what to build next.

Screenshots (overlay over the game): [build shopping list](https://github.com/WarnetBes/poe2-kit/raw/main/docs/screenshots/overlay-build.png) · [price check with the raw market table](https://github.com/WarnetBes/poe2-kit/raw/main/docs/screenshots/overlay-price.png) — note the RU item resolving to its English name for pricing. Panel UI is Russian-first for now; EN data everywhere, full EN UI is on the roadmap.

**What it does** (everything works from hotkeys, noisy bits are opt-in):

* **Price check** — hover an item → Ctrl+C → Ctrl+F1: median estimate in chaos-equivalents (live trade2 + poe.ninja + poe2scout, ~10 listings, per league).
* **Boss timer + boss cards** — it watches the game log for zone entry and starts a stopwatch at the boss door; "🏆 killed" / "💀 died" buttons track attempts and best times per league. Boss cards show their damage types, strengths and weaknesses (researched against current guides).
* **Levelling tracker** — reads zone-entry lines from the game log and marks campaign progress, permanently-rewardable zones and quest rewards.
* **Craft planner** — paste any item → a step-by-step crafting plan with an SSF-friendly estimate of the currency it needs.
* **Combo builder** — pick an active + compatible supports, get a ready-to-paste import code for PoB2.
* **Build import** — paste a PoB2 share code: slots, tree progress, DPS estimate, and per-slot price estimates.
* Currency rates, endgame ("pinnacle") checklists, a crafting-recipe catalogue, and a jargon dictionary for newer players.

**Full Russian-client support** — this was the whole reason I started: RU item names, RU gem names, RU zone names all resolve to their English trade counterparts (a 2,300-entry dictionary built from community data), so price checking works out of the box on a Russian client. English clients work too.

**Safety / legality, stated plainly** (because I'd want to see this in any tool post):

* The kit **never reads game memory, never injects anything, never simulates input** — no automation of any kind. This is an entirely external tool, the category GGG's policy allows ("It's okay to run things that are entirely external to the game").
* Its only two data sources are: the standard game log file `logs\LatestClient.txt` (zone-entry lines — the same file every levelling overlay reads) and the clipboard, when you press Ctrl+C on an item.
* The overlay window calls exactly three **read-only** Win32 functions to stay on top of the game window (`EnumWindows`, `GetWindowRect`, `GetForegroundWindow`). If you want zero of those: one checkbox in settings disables even that.
* Clipboard watching is opt-in and off by default. No data about you is sent anywhere — network calls go to public APIs only (trade2, poe.ninja, poe2scout).
* Standard disclaimer: third-party tools are use-at-your-own-risk; GGG does not endorse this project.

* **Download** (portable, ~37 MB zip): [GitHub Releases](https://github.com/WarnetBes/poe2-kit/releases/latest) → `poe2-kit-portable-1.0.17-win64.zip` — unzip → run `start-overlay.bat` (it downloads the Electron runtime once, ~110 MB, then works offline). No admin rights, no installer, no Node.js needed.
* **Source:** [github.com/WarnetBes/poe2-kit](https://github.com/WarnetBes/poe2-kit) — full source code and version history. I'm not asking anyone to trust a binary they can't read.
* **Canonical repo** (RU docs, development, issues): [sourcecraft.dev/volkovpartilaholin/poe2-kit](https://sourcecraft.dev/volkovpartilaholin/poe2-kit)

**Ask**: if you tried it — what's missing for your league start? I'm specifically unsure whether the combo-import code PoB2 accepts cleanly on all setups, and whether non-RU players want a full translation of the panel UI (it's currently RU with EN item data). Bug reports and ideas → issues on GitHub or SourceCraft. Thanks for reading!

The project is completely free. If you find it useful, there's an entirely optional support link at the bottom of the README — no pressure either way.
P.S. I'm getting married on October 22 — so that support link is, let's say, seasonally relevant this month 🙂

>>> КОНЕЦ ТЕЛА ПОСТА

---

## БЛОК 3 — ПЕРВЫЙ КОММЕНТ (сразу после публикации, текст)

>>> НАЧАЛО КОММЕНТАРИЯ

Screenshots for those who don't want to click through to GitHub:

(the two PNG images from this folder go here — see step 8 of the instructions)

>>> КОНЕЦ КОММЕНТАРИЯ

---

## ИНСТРУКЦИЯ ПО ОФОРМЛЕНИЮ (RU, пошагово, для первого раза)

1. **Аккаунт.** Заходишь на reddit под своим аккаунтом. Если аккаунт свежий (мало комментов) — сначала 2–3 недели просто оставляй осмысленные комментарии в r/PathOfExile2, иначе автоматика пометит пост как спам. Правило сабреддита: до 2 промо-постов в неделю и ~10 комментариев участия на каждый промо-пост.
2. **Открываешь** https://www.reddit.com/r/PathOfExile2/
3. Справа вверху — кнопка **«Create Post»** (или «Создать запись»). Нажимаешь.
4. **Тип поста: обязательно «Text»** (вкладка «Text» / «Текст» — вторая сверху). НЕ выбирай «Link» и «Image» — иначе не вставится текст, и пост никто не прочитает.
5. **Поле «Title» (Заголовок):** вставляешь БЛОК 1 (одна строка).
6. **Большое текстовое поле:** вставляешь БЛОК 2 целиком. Звёздочки (`*`, `**`), стрелки `→` и скобки `[текст](ссылка)` оставляй как есть — reddit сам превратит их в жирный шрифт и кликабельные ссылки. Ничего вручную не правь: каждая ссылка уже в тексте (GitHub Releases, исходники, SourceCraft, два скриншота).
7. Нажимаешь **«Post»**. Пост опубликован.
8. **Первый комментарий (обязательно, в течение пары минут):** открой свой пост → поле «Add a comment» → вставь БЛОК 3 → под полем нажми иконку **«Image»** → выбери файлы по очереди:
   - `C:\Users\mezhavikiserj\BildPOE2\poe2-kit\docs\screenshots\overlay-build.png`
   - `C:\Users\mezhavikiserj\BildPOE2\poe2-kit\docs\screenshots\overlay-price.png`
   → «Comment». Внутри текстового поста картинки не показываются превью — поэтому скрины едут первым комментом.
9. **Флейр:** на своём посту нажми «…» (меню) → **«Add flair» / «Изменить метку»** → выбери **Tool** (если списка нет — пропусти шаг, не критично).
10. **Когда постить:** будний день, 18:00–21:00 UTC (по Москве это 21:00–00:00). Не в день старта лиги — утонет в потоке.

## ПОСЛЕ ПУБЛИКАЦИИ

- Отвечай на комменты по делу, без шаблонных ответов. Критику «панель на русском» принимай спокойно — в посте это честно озвучено, EN-интерфейс в планах.
- НЕ копируй этот же текст в другие сабреддиты в тот же день — фильтр reddit считает это спамом.
- 22.10 (свадьба) — новый инфоповод для второго поста, но помни: максимум 2 промо-поста в неделю.

## ПЕРЕД ПУБЛИКАЦИЕЙ — ПРОВЕРИТЬ (30 секунд)

- [ ] Ссылка https://github.com/WarnetBes/poe2-kit/releases/latest открывается в режиме инкогнито (без логина) — если да, чужие люди тоже её скачают.
- [ ] Аккаунт имеет историю комментов (правило 10:1).
- [ ] Локально существуют оба файла скринов из шага 8.
