# Reddit post — FINAL (EN) — r/PathOfExile2

> Готовый к копипасте текст. Факты сверены с README.en.md, README.md, CHANGELOG 1.0.19, apps/overlay/src/main.ts (12 вкладок), git remote (WarnetBes/poe2-kit). Дата подготовки: 02.10.2026.
> Секции ниже «КОНЕЦ ТЕЛА ПОСТА» — служебные (план крест-постинга, шаблоны ответов), в reddit НЕ копировать.
> существующие черновики: POST_REDDIT_EN.md (ранний драфт с длинным заголовком) и POST_REDDIT_READY.md (старая версия) — оставлены для истории, этот файл — финал.

---

## TITLE (одна строка, 78 символов — лимит reddit ~300, цель ≤90)

```
PoE2 Kit — free open-source overlay + 59-tool MCP server for Path of Exile 2
```

Альтернатива (если хочется личного угла, 79 симв.):

```
I built a free open-source PoE2 companion: overlay, web dashboard, 59 AI tools
```

---

## BODY (текстовый пост, ~350 слов; markdown-friendly)

>>> НАЧАЛО ТЕЛА ПОСТА

Hey r/PathOfExile2! I've been building **PoE2 Kit** — a free, open-source (MIT) companion for Path of Exile 2. One core, three frontends, data from free public APIs only — no keys, no telemetry:

- **Windows overlay** that sits over the game: 12 tabs of helper panels, all driven by hotkeys;
- **Browser dashboard**: currency rates, price check, build import;
- **MCP server** — 59 `poe2_*` tools, so your AI assistant (OpenCode, Claude Desktop, …) can price items, decode PoB2 share codes, pull ladders, and compute EHP/Spirit using the PoB2 formulas.

**What the overlay does:**

- **Price check on a hotkey** — hover an item → Ctrl+C → Ctrl+F1: a median estimate with a confidence label and the raw market table, from trade2 + poe.ninja + poe2scout.
- **Build shopping list** — paste a PoB2 share code (Ctrl+F3): per-slot target gear with live prices, tree progress, DPS estimate.
- **Gem setups** — which support gem goes where, checked off as you socket them.
- **Leveling guide** that follows your actual zone (reads the standard game log), **boss timer**, **craft planner** with a recipe catalogue, **currency rates**, **pinnacle readiness checklist** (Ctrl+F7).

**Safety, stated plainly** — because I'd want to see this in any tool post:

- It never reads game memory, never injects anything, never simulates input. No automation of any kind.
- It reads exactly two things: the standard game log the game itself writes to disk, and the clipboard when you press Ctrl+C on an item.
- Staying on top of the game window uses exactly three read-only Win32 calls (`EnumWindows`, `GetWindowRect`, `GetForegroundWindow`). One checkbox in settings disables even that.
- Standard disclaimer: third-party tools are use at your own risk; this project is not affiliated with or endorsed by GGG.

The **Russian client works out of the box** — built-in RU⇄EN dictionaries translate item and gem names on the fly — and since v1.0.18 the panel UI itself is switchable to English (.EN translation of the guide content inside panels is a known WIP).

[SCREENSHOT 1: приложить в первом комментарии docs/screenshots/overlay-price-en.png — прайс-чек поверх игры; свежий EN-скрин v1.0.19 приветствуется]

[SCREENSHOT 2: приложить в первом комментарии docs/screenshots/overlay-build-en.png — шопинг-лист билда]

- **Download** (portable zip, ~37 MB — unzip, run `start-overlay.bat`; no installer, no admin rights): [GitHub Releases](https://github.com/WarnetBes/poe2-kit/releases/latest)
- **Source code** (MIT): [github.com/WarnetBes/poe2-kit](https://github.com/WarnetBes/poe2-kit) — full source, I'm not asking anyone to trust a binary they can't read
- **Canonical repo & issue tracker**: [sourcecraft.dev/volkovpartilaholin/poe2-kit](https://sourcecraft.dev/volkovpartilaholin/poe2-kit)

It's a young solo project — not perfect, and item-stat mappings occasionally lag a GGG patch. Bug reports, ideas and contributions are genuinely welcome (see CONTRIBUTING.md / SECURITY.md — code changes are reviewed manually before merging). If you try it: what's missing for your league start?

>>> КОНЕЦ ТЕЛА ПОСТА

---

## ПЛАН КРЕСТ-ПОСТИНГА (служебное, не постить)

### 1. r/PathOfExile2 — главный сабреддит

- Тип: **text-post** (не Link, не Image), флейр **Tool** (меню «…» → Add flair; если нет списка — пропустить).
- Первый комментарий сразу после публикации: скриншоты (reddit не показывает превью картинок внутри текстового поста — см. placeholder выше).
- Аккаунт: обязательна история участия (~10 осмысленных комментов на 1 промо-пост, максимум 2 промо-поста в неделю — правило сабреддита, текст правил сверен владельцем 01.10). Свежая регистрация = автомод пометит как спам.

### 2. r/pathofexile — ТОЛЬКО ПОСЛЕ ПРОВЕРКИ ПРАВИЛ (риск)

- ⚠️ **Риск Rule 9 (self-promo)**: из этой среды reddit недоступен (403/Cloudflare), актуальный текст правил r/pathofexile НЕ проверен. Владелец обязан открыть правила сабреддита вживую перед постом.
- Если правила допускают tool-showcase — постить **не ранее чем через 2–3 дня** после поста в r/PathOfExile2 и **другим текстом/углом** (иначе анти-спам фильтр reddit помечает дубликат как координированный спам, ср. урок из старого драфта).
- Если правила жёсткие — альтернатива: не пост, а осмысленный комментарий под чьим-то «help me price-check» тредом со ссылкой на kit. Это не нарушает 9-ку и прогревает аккаунт.

### 3. Тайминг (по патчному циклу 0.5.5)

- Патч 0.5.5 «Forbidden Rites» живёт с 04.09.2026 → сейчас **середина лиги** — окно «контентного затишья», лучший момент: аудитория свободна, конкурентные тулы чинят данные.
- **НЕ постить**: в день старта следующей лиги/патча (утонет в потоке; плюс наш stat-id-маппинг традиционно ломается на каждом патче GGG — сначала прогнать live-smoke, убедиться, что прайсы живые).
- День: будний, **18:00–21:00 UTC** (прайм NA+EU).
- Второй инфоповод (если нужен): 22.10 — свадьба, «seasonal» P.S. уже есть в теле опционально; помнить лимит 2 промо-поста/неделю.

### 4. Ответ-шаблоны на предсказуемые вопросы (первые 5)

**Q1. «Is this bannable?»**
> Read-only by design. It never touches game memory, never injects code, never simulates input. It reads exactly two channels the game/user produces: the standard log file (the same one every levelling overlay reads — GGG's developer policy explicitly says reading the game's log files is okay as long as the user is aware) and the clipboard when you Ctrl+C an item yourself. The window-binding uses three read-only user32 calls, and even that can be turned off in settings. That said, standard disclaimer: third-party tools are use-at-your-own-risk, and this project is not affiliated with or endorsed by GGG — the final decision is yours.

**Q2. «How is this different from Exiled Exchange 2 / Sidekick?»**
> EE2 is a great dedicated price-checker — if you only need hotkey pricing, use it. The kit adds the build side: PoB2 share-code import with per-slot prices, gem setup tracking, a leveling guide that follows your zone, a craft planner, a browser dashboard, an MCP server to drive all of it from an AI assistant, and full RU-client support. Different focus, not a replacement.

**Q3. «Why a zip with .bat files instead of an installer?**»**
> No installer, no admin rights, nothing in the registry. Unzip → run `start-overlay.bat`; on first run it downloads the Electron runtime (~110 MB) once, then works offline. Source-code route (Node.js ≥ 20) is also available if you prefer to build it yourself.

**Q4. «Does it work with a non-English client?»**
> Russian client is fully supported out of the box — RU⇄EN dictionaries translate item/gem names on the fly (that's how the project started). Since v1.0.18 the panel UI is switchable RU/Auto/EN; the guide content inside panels (boss tips, route notes, recipes) is still being translated — honest known limitation.

**Q5. «Why should I trust a zip from a random dev?»**
> Full source is on GitHub (MIT) — read it, or build from source yourself. The only network endpoints are public price APIs (trade2, poe.ninja, poe2scout); there's no telemetry and nothing is uploaded about you. Releases are mirrored on GitHub so anyone can download anonymously.

### 5. Чек-лист перед постом (30 секунд, руками владельца)

- [ ] https://github.com/WarnetBes/poe2-kit/releases/latest открывается в инкогнито.
- [ ] Скриншоты существуют/свежи (docs/screenshots/overlay-*-en.png) — вставить в первый комментарий.
- [ ] Аккаунт прогрет (10:1 комменты/промо).
- [ ] Название portable-zip НЕ вписывать дословно в текст (автолинкер reddit делает из него фейковый URL — урок из старого драфта).
