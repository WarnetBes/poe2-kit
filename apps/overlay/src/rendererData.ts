/**
 * PoE2 Kit overlay — статичные данные рендерера (этап S1 разноса rendererHtml.ts).
 * Извлечены дословно из монолита 02.10.2026: ключи/порядок/комментарии не менялись.
 * rendererHtml.ts вставляет их в emitted-script через JSON.stringify(...) —
 * рантайм-поведение идентично прежним литералам (T_KEYS сортируется по длине ключа
 * при загрузке, порядок ключей T_DICT сохранён в JSON.stringify как в исходнике).
 *
 * ПРАВИЛО ФАЙЛА: только данные. Никакой логики, никакого импорта (кроме типов).
 */

export const T_DICT: Record<string, string> = {
    // — каркас: табы, хинты, настройки —
    '💰 Прайс': '💰 Price', '🛒 Билд': '🛒 Build', '💎 Камни': '💎 Gems',
    '📥 Импорт': '📥 Import', '📈 Прокачка': '📈 Leveling', '🧭 Плитки': '🧭 Waystones',
    '📖 Слэнг': '📖 Slang', '⚒ Крафт': '⚒ Craft', '💱 Курс': '💱 Rates',
    '🧬 Билды': '🧬 Builds', '🛡 Пиннакл': '🛡 Pinnacle', '⚙ Настройки': '⚙ Settings',
    '🛡 Радар': '🛡 Radar',
    '🛡 Радар патча': '🛡 Patch radar',
    'Live-баги патча': 'Live patch bugs', 'Хитрости (трюки)': 'Tricks',
    'Воркараунд:': 'Workaround:', 'Как:': 'How:', 'Механизм:': 'Mechanism:',
    '🎮 Раскладка по билду': '🎮 Keybinds for build',
    'Билд не импортирован — сначала Ctrl+F3.': 'Build not imported — press Ctrl+F3 first.',
    'Прайс': 'Price', 'Прокачка': 'Leveling', 'Перемещение': 'Move',
    'Импорт билда': 'Import build', 'Панель билда': 'Build panel',
    'Чекап перед пиннаклом': 'Pre-pinnacle checklist', 'Настройки': 'Settings',
    'Прайс: Ctrl+F1 · Билд: Ctrl+F2 · Импорт: Ctrl+F3 · Прокачка: Ctrl+F4 · Двигать: Ctrl+F5 · Настройки: Ctrl+F6 · Пиннакл: Ctrl+F7':
      'Price: Ctrl+F1 · Build: Ctrl+F2 · Import: Ctrl+F3 · Leveling: Ctrl+F4 · Move: Ctrl+F5 · Settings: Ctrl+F6 · Pinnacle: Ctrl+F7',
    'Закрыть (Ctrl+F6)': 'Close (Ctrl+F6)',
    'Прозрачность фона': 'Background opacity', 'Масштаб текста': 'Text scale',
    'Ширина оверлея': 'Overlay width', 'Высота оверлея': 'Overlay height',
    'Автоподбор высоты': 'Auto height', 'Включить (окно будет «прыгать»)': 'Enable (window will jump)',
    'Угол прикрепления': 'Attach corner', 'В·л': 'T·L', 'В·п': 'T·R', 'Н·л': 'B·L', 'Н·п': 'B·R',
    'Вкладки панели': 'Panel tabs', 'Лига (для цен и курсов)': 'League (prices & rates)',
    'Горячие клавиши (Ctrl+F1…F6)': 'Hotkeys (Ctrl+F1…F6)', 'Формат:': 'Format:',
    'Цвета': 'Colors', 'Обычная': 'Default', 'Контраст': 'Contrast', 'Дальтонизм': 'Colorblind',
    'Свои': 'Custom', 'Фон': 'Background', 'Текст': 'Text', 'Акцент': 'Accent',
    'Второстеп.': 'Secondary', '↺ Сброс': '↺ Reset',
    // — статусы/подсказки каркаса —
    'Загрузка списка лиг…': 'Loading league list…',
    'Проверяю буфер…': 'Checking clipboard…', 'Копирую предмет…': 'Fetching item…',
    'Список пуст': 'List is empty',
    'Побед: ': 'Wins: ', 'провалов: ': 'deaths: ', 'лучшее: ': 'best: ', 'прошлое: ': 'last: ',
    'Акт ': 'Act ', 'Интерлюдия ': 'Interlude ', 'Триалы асценданси': 'Ascendancy trials',
    'Пиннакл (эндгейм)': 'Pinnacle (endgame)', 'Эндгейм': 'Endgame',
    // — волна 2: titles табов и скролл —
    'Прайс предмета из буфера (Ctrl+F1)': 'Item price from clipboard (Ctrl+F1)',
    'Панель билда (Ctrl+F2)': 'Build panel (Ctrl+F2)',
    'Камни навыков билда: сетапы и чек-лист': 'Build skill gems: setups and checklist',
    'Импорт PoB-кода из буфера (Ctrl+F3)': 'Import PoB code from clipboard (Ctrl+F3)',
    'Прокачка: контекст уровня (Ctrl+F4)': 'Leveling: level context (Ctrl+F4)',
    'Крафт плиток смотрителя (Waystones): рецепты и таблица': 'Waystone crafting: recipes and table',
    'Словарь игрового слэнга PoE2: сокращения и жаргон — по-человечески': 'PoE2 slang dictionary: abbreviations and jargon, explained',
    'Окно крафта: план по предмету (Ctrl+C в игре), все рецепты 0.5.5, эссенции и омены': 'Crafting window: plan for an item (in-game Ctrl+C), all 0.5.5 recipes, essences and omens',
    'Курсы валют по лигам: сколько стоит валюта в chaos (poe2scout + poe.ninja)': 'Currency rates by league: value in chaos (poe2scout + poe.ninja)',
    'Генератор билдов: живые билды топ-игроков poe.ninja по всем классам — скиллы, узлы, DPS/EHP': 'Build generator: live poe.ninja builds of top players for every class — skills, nodes, DPS/EHP',
    'Чекап перед пиннаклом: резисты/EHP/стан (Ctrl+F7)': 'Pre-pinnacle check: resists/EHP/stun (Ctrl+F7)',
    'Что делает активная вкладка — окно с описанием функции и хоткеями': 'What the active tab does — a window with the feature description and hotkeys',
    'Прокрутить панель вверх (замена колеса мыши, если оно над оверлеем не работает)': 'Scroll panel up (mouse wheel substitute when the wheel does not work over the overlay)',
    'Прокрутить панель вниз': 'Scroll panel down',
    // — волна 2: grab/idle/busy/watch-хром —
    '⠿ Тащи меня мышью · ': '⠿ Drag me with the mouse · ',
    'сброс': 'reset', ' · Ctrl+F5 — закрепить': ' · Ctrl+F5 — pin',
    'Готово. Нажми ': 'Done. Press ', ' — прайс предмета из буфера.': ' — item price from clipboard.',
    ' — импорт билда из PoB-кода,': ' — import a build from PoB code,',
    ' — шопинг-лист билда.': ' — build shopping list.',
    'Ссылка на персонажа poe.ninja + Ctrl+F3 — автосинхронизация эквипа.': 'poe.ninja character link + Ctrl+F3 — auto-sync of equipment.',
    'Оценка цены…': 'Estimating price…', '👁 Следить за ценой': '👁 Watch price',
    // — волна 2: настройки (строки/tips) —
    '— окно само растёт под контент и меняет размер при переключении панелей': '— the window grows to fit content and resizes when switching panels',
    'Выключено (по умолчанию): высота — по слайдеру выше, длинный билд/списки прокручиваются внутри окна. Включите, если хотите, чтобы окно всегда вмещало весь контент целиком (в пределах экрана).':
      'Off (default): height follows the slider above; long builds/lists scroll inside the window. Enable if you want the window to always fit all content (within the screen).',
    '— скрыть неиспользуемые кнопки из боковой колонки': '— hide unused buttons from the side column',
    'Как у аналогов: отмечено = кнопка видна, снято = скрыта (сама функция остаётся доступной по хоткею). «⚙ Настройки» скрыть нельзя — иначе теряется управление.':
      'Like similar tools: checked = button visible, unchecked = hidden (the feature stays on its hotkey). ⚙ Settings cannot be hidden — otherwise you lose control.',
    'Список — из poe2scout (✦ = актуальная челлендж-лига). Применяется сразу и сохраняется — цены пересчитаются под выбранную лигу.':
      'The list comes from poe2scout (✦ = current challenge league). Applies immediately and is saved — prices recalculate for the selected league.',
    '— доступность: дальтонизм, контраст': '— accessibility: colorblind, contrast',
    'Стандартная тема kit': 'Default kit theme',
    'Чёрный фон, белый текст — максимальный контраст': 'Black background, white text — maximum contrast',
    'Палитра Okabe-Ito: безопасна при красно-зелёной и сине-жёлтой слепоте (статусы различимы и по светлоте)':
      'Okabe-Ito palette: safe for red-green and blue-yellow color blindness (statuses also differ by lightness)',
    'Свои цвета — пипетки ниже': 'Custom colors — pickers below',
    'Вернуть стандартную тему': 'Restore default theme',
    'Применяется сразу. При проблемах восприятия цвета пробуйте «Дальтонизм» (универсальная палитра Okabe-Ito) или «Контраст». «Свои» — точечная настройка фона/текста пипетками; статусы (✅/⚠/✕) меняет только тема.':
      'Applies immediately. If you struggle with colors, try "Colorblind" (universal Okabe-Ito palette) or "Contrast". "Custom" fine-tunes background/text with pickers; statuses (✅/⚠/✕) change only with the theme.',
    'Пустое поле = стандарт.': 'Empty field = default.',
    '— следить за ценой, алерт при падении': '— watch a price, alert when it drops',
    '➕ Из буфера': '➕ From clipboard', 'Проверить': 'Check now',
    'Нажмите ': 'Press ',
    ' на предмете в игре → «➕ Из буфера», либо кнопкой «👁 Следить» в прайс-токе. Проверка каждые 5 мин, алерт «цена упала с X до Y».':
      ' on an item in game → "➕ From clipboard", or the "👁 Watch" button in price-check. Checks every 5 min, alert "price dropped from X to Y".',
    'Привязка к окну игры': 'Game window binding',
    '— «осторожный режим»: без Win32-вызовов, позиция по углу экрана': '— "safe mode": no Win32 calls, position pinned to a screen corner',
    'Включена (читает позицию окна игры)': 'Enabled (reads game window position)',
    'Выключите, чтобы kit не обращался к user32.dll вовсе: оверлей встанет в угол экрана (двигается Ctrl+F5), не будет следовать за окном игры и прятаться при alt-tab.':
      'Turn off so kit never touches user32.dll: the overlay sits in a screen corner (move via Ctrl+F5), will not follow the game window and will not hide on alt-tab.',
    'Язык панели': 'Panel language',
    '— подписи/хинты UI; Auto — язык Windows': '— UI labels/hints; Auto = Windows language',
    'Язык имён камней': 'Gem name language',
    '— имена в панели билда и рекомендациях саппортов': '— names in the build panel and support recommendations',
    'RU — имена как в русском клиенте игры (перевод из офлайн-словаря poe2db). EN — как в PoB.':
      'RU — names as in the Russian game client (offline poe2db dictionary). EN — as in PoB.',
    'Автопрайс-чек из буфера': 'Auto price-check from clipboard',
    '— проверять новые предметы без Ctrl+F1': '— check new items without Ctrl+F1',
    'Слежение 500мс (opt-in)': '500ms watching (opt-in)',
    'Выключено по умолчанию (приватность): пока включено — kit читает буфер обмена каждые 500мс. Реагирует только на клир-текст предметов («Rarity:»), прочие копипасты игнорируются.':
      'Off by default (privacy): while enabled, kit reads the clipboard every 500ms. It reacts only to item clear-text ("Rarity:") — other copy-pastes are ignored.',
    'Журнал обучения': 'Learning journal',
    '— запоминать структуру предметов (локально)': '— remember item structure (locally)',
    'Включить (opt-in)': 'Enable (opt-in)', '📤 Поделиться предметами': '📤 Share items',
    'Выключено по умолчанию. Пишется только структура предмета (редкость/база/моды), без персонажа и аккаунта, в файл на вашем диске. «Поделиться» копирует готовый текст для issue на SourceCraft — одной вставкой.':
      'Off by default. Only item structure is stored (rarity/base/mods) — no character or account — in a file on your disk. "Share" copies ready text for a SourceCraft issue, in one paste.',
    'Диагностика': 'Diagnostics', '📋 Отправить диагностику': '📋 Send diagnostics',
    'Соберёт хвост ': 'Collects the tail of ',
    ' + конфиг машины, скопирует всё в буфер обмена и сохранит файл в userData — готово для вставки в отчёт/issue, файлы искать вручную не нужно.':
      ' + machine config, copies everything to the clipboard and saves a file in userData — ready to paste into a report/issue, no need to hunt for files manually.',
    '⚠ Сторонний инструмент. GGG не гарантирует безопасность сторонних тулов. Kit ничего не делает за вас в игре: читает буфер и публичные API цен — каждое действие в игре делаете сами вы. Использование — на ваш риск.':
      '⚠ Third-party tool. GGG does not guarantee third-party tool safety. Kit does nothing for you in game: it reads the clipboard and public price APIs — every in-game action is yours alone. Use at your own risk.',
    'Сбросить клавиши': 'Reset hotkeys', 'Сохранить': 'Save',
    // — волна 3 (этап 2, хром-онли): контент вкладок — заголовки/статусы/подписи.
    // Гайд-контент (босс-советы, слэнг, крафт-рецепты, советы саппортов) остаётся RU by design.
    // Правило: ключи — точные оригиналы исходника (dict-хит до сегментов = без манглинга).
    'Не предмет': 'Not an item', 'Зона неизвестна': 'Zone unknown', 'персонаж неизвестен': 'character unknown',
    '🔄 Сброс': '🔄 Reset',
    '🛒 Шопинг-лист билда': '🛒 Build shopping list', '💎 Камни билда': '💎 Build gems',
    'Куда вставлять. Ctrl+C по камню в игре отметит его ✅.': 'Where to socket. Ctrl+C a gem in game to mark it ✅.',
    'Ctrl+F1 на купленном предмете — отметит слот ✔': 'Ctrl+F1 on a purchased item — marks the slot ✔',
    '📖 Словарь слэнга PoE2': '📖 PoE2 slang dictionary',
    '🧭 Крафт плиток смотрителя': '🧭 Waystone tile crafting',
    '💱 Курсы валют по лигам': '💱 Currency rates by league', 'Лига:': 'League:',
    'свежие данные': 'fresh data', ' источник: ': ' source: ',
    '🧬 Генератор билдов (ладдер poe.ninja)': '🧬 Build generator (poe.ninja ladder)',
    '🏆 Мета ладдера': '🏆 Ladder meta', '🔗 Конструктор связок': '🔗 Link builder',
    'Выборка: ': 'Sample: ', ' билдов ': ' builds ',
    'Выбери класс чипсом выше — покажу, что играют топы: скиллы, узлы, DPS/EHP.':
      'Pick a class with the chips above — I will show what the top players run: skills, nodes, DPS/EHP.',
    'ур. ': 'lvl. ',
    '🌱 Стартовый билд новичка:': '🌱 Newcomer starter build:',
    '🌳 Дерево билда: ': '🌳 Build tree: ', ' нод': ' nodes',
    'нераспознанных: ': 'unrecognized: ', 'Нотабли (': 'Notables (', 'показать все ': 'show all ',
    'Кейнстоуны:': 'Keystones:',
    'Поиск узлов: имя или стат (напр. cold damage)': 'Search nodes: name or stat (e.g. cold damage)',
    'Показать узлы: ': 'Show nodes: ', 'Найдено: ': 'Found: ', 'ничего не найдено': 'nothing found',
    'резисты': 'resists', 'жизнь': 'life', 'эн. щит': 'ES',
    'Оружие': 'Weapon', 'Броня': 'Body Armour', 'Перчатки': 'Gloves', 'Обувь': 'Boots',
    'Амулет': 'Amulet', 'Кольцо 1': 'Ring 1', 'Кольцо 2': 'Ring 2', 'Ремень': 'Belt',
    'Флакон 1': 'Flask 1', 'Флакон 2': 'Flask 2',
    '↑ носите: ': '↑ wearing: ',
    'Надето сейчас (poe.ninja)': 'Currently equipped (poe.ninja)',
    'Слабейший EHP:': 'Weakest EHP:', 'Диагноз:': 'Diagnosis:',
    'Бюджет: ': 'Budget: ', 'доступно проверок: ': 'checks available: ',
    'Модель врага: ': 'Enemy model: ', ' · режим ': ' · mode ', 'пенетрация элем-резистов ': 'elemental resist penetration ',
    ' собрано · ': ' collected · ', ' оценяется ': ' assessed ', ' оценивается ': ' assessed ',
    'Этаж ': 'Floor ',
    '💪 Сильные стороны:': '💪 Strengths:', '🎯 Как бить:': '🎯 How to fight:',
    '🪙 Что фармится / зачем идут:': '🪙 What is farmed / why players run it:',
    'не подтверждено': 'unverified',
    '🎖 Неполученные квесты': '🎖 Unclaimed quests',
    'Все важные награды собраны или отмечены «забрал».': 'All important rewards are collected or marked as claimed.',
    '⚠ упущено · ': '⚠ missed · ', '◻ впереди · ': '◻ ahead · ',
    'Ваш худший элем. резист ': 'Your worst elemental resist ',
    '% (меньше 75%) — награда очень желательна': '% (below 75%) — the reward is highly desirable',
    'Резист сейчас ': 'Resist now ', '% (меньше 75%) — взять в первую очередь': '% (below 75%) — grab this first',
    '✔ забрал': '✔ claimed',
    'Отметить награду полученной — уйдёт из чек-листа навсегда': 'Mark the reward as claimed — it leaves the checklist for good',
    'В зоне есть вайпоинт (быстрый телепорт)': 'The zone has a waypoint (fast teleport)',
    '⚒ Крафт: план и рецепты': '⚒ Craft: plan and recipes',
    '🎯 План': '🎯 Plan', '📋 Рецепты': '📋 Recipes', '💧 Эссенции': '💧 Essences', '🔮 Омены': '🔮 Omens',
    'Наведи на предмет в игре →': 'Hover over an item in game →',
    '📋 План по предмету (буфер обмена)': '📋 Item plan (clipboard)',
    'Порядок: Ctrl+C по предмету в игре → кнопка. План обновится под этот предмет.':
      'Order: Ctrl+C the item in game → the button. The plan will then update for that item.',
    '📥 Импорт билда из буфера обмена': '📥 Import build from clipboard',
    'Скопируйте': 'Copy', 'PoB share-код': 'PoB share code',
    ', ссылку профиля poe.ninja или .build JSON и нажмите кнопку ниже (или ':
      ', a poe.ninja profile link or .build JSON, then press the button below (or ',
    '📥 Импортировать из буфера (Ctrl+F3)': '📥 Import from clipboard (Ctrl+F3)',
    'Импорт из буфера…': 'Import from clipboard…', '✅ Импортировано: ': '✅ Imported: ',
    'Текущий билд: ': 'Current build: ', ' слотов — будет заменён новым импортом.': ' slots — will be replaced by the new import.',
    'Панель слотов — во вкладке «🛒 Билд» (Ctrl+F2).': 'The slots panel is in the "🛒 Build" tab (Ctrl+F2).',
    'из буфера обмена': 'from clipboard',
    'В буфере не текст предмета. Наведите на предмет в игре и нажмите Ctrl+C, затем Ctrl+F1 (прайс). PoB-код билда — Ctrl+F3':
      'Clipboard has no item text. Hover an item in game and press Ctrl+C, then Ctrl+F1 (price). PoB build code — Ctrl+F3',
    'свежо': 'fresh', ' мин)': ' min)',
    ' (импорт)': ' (import)',
    '«—» = данных для проверки нет (импортируйте билд Ctrl+F3). ⚠ Оценки из гира — перед пиннаклом сверьтесь в игре.':
      '«—» = no data to verify (import the build via Ctrl+F3). ⚠ Gear-based estimates — double-check in game before the pinnacle.',
    'Квестовые награды кампании (акты 1–4) по данным гайдов прокачки кита: Spirit, resists, очки пассивок, асценданси. Интерлюдии и полный список всех квестов игры не покрывает.':
      'Campaign quest rewards (acts 1–4) from the kit leveling guides: Spirit, resists, passive points, ascendancy. Does not cover intermissions or the full list of all quests.',
    'Новый персонаж в этой лиге? Сбросит пройденные зоны и «забранные» награды — статусы соберутся заново по логу.':
      'New character in this league? It resets cleared zones and "claimed" rewards — statuses rebuild from the log.',
    'Источник: вычислено по правилу': 'Source: computed by rule',
    'Плитки смотрителя (Waystones)': 'Custodian tiles (Waystones)', '(лестница)': '(ladder)',
    'асценданси': 'ascendancy', '(1 средний)': '(1 average)',
    '⚔ Боссы': '⚔ Bosses',
    '💒 Trial of the Sekhemas на вашем уровне: этажей до финала — ':
      '💒 Trial of the Sekhemas at your level — floors to the final: ',
    ' (лестница боссов — раздел «⚔ Боссы» выше).': ' (the boss ladder is in the "⚔ Bosses" section above).',
    'Квестовые награды кампании (акты 1–4) по данным гайдов прокачки кита: ':
      'Campaign quest rewards (acts 1–4) per the kit leveling guides: ',
    'очки пассивок': 'passive points', 'Интерлюдии и полный список всех квестов игры не покрывает.':
      'Does not cover intermissions or the full list of all quests.',
    '🎯 Персональный план: скопируйте Waystone-плитку в игре (Ctrl+C) и нажмите Ctrl+F1 — ':
      '🎯 Personal plan: copy a Waystone in game (Ctrl+C) and press Ctrl+F1 — ',
    'кит покажет крафт-план под её тир (3:1 перековка / коррупция Т15→Т16 омены/качество).':
      'the kit will show a craft plan for its tier (3:1 recombo / Т15→Т16 corruption omens/quality).',
    'Источник: poe2wiki.net «Waystone» (проверено 30.09.2026). ':
      'Source: poe2wiki.net "Waystone" (verified 30.09.2026). ',
    'Механики меняются патчами — панель обновляется в ките.':
      'Mechanics change with patches — the panel is updated in the kit.',
    // №167: промахи EN-этапа 2, видимые в прайс-вью (проверено живым CDP-рендером при lang=en).
    'Рынок (по возрастанию цены):': 'Market (cheapest first):',
    'Источники:': 'Sources:',
    '(приблизительно)': '(approx.)',
    '(точно)': '(exact)',
    '(грубо)': '(rough)',
    'предложений:': 'listings:',
    'медиана:': 'median:',
    '⇗ эффект:': '⇗ effect:',
  };



export const CRAFT_SYSTEMS: ReadonlyArray<readonly [string, string]> = [
    ['all', 'Все'],
    ['currency', 'Валюта'],
    ['essence', 'Эссенции'],
    ['omen', 'Омены'],
    ['rune', 'Руны/сокеты'],
    ['quality', 'Качество'],
    ['bench', 'Верстаки'],
    ['desecration', 'Дезекрация'],
    ['special', 'Спец'],
    ['waystone', 'Плитки'],
  ];

export const TAB_INFO: Record<string, { t: string; h: string; b: string[] }> = {
    price: { t: '💰 Прайс', h: 'Ctrl+F1', b: [
      'Копируешь предмет в игре (Ctrl+C) — жмёшь <span class="hk">Ctrl+F1</span>: оверлей покажет оценку по его клир-тексту.',
      'Показывает группы листингов с медианами (в хаосе, если известен курс), линк на торговый сайт.',
      'SSF-режим: вместо цены — план: сохранить ли фрактуред-мод, целевой крафт «двух якорей» (эссенции/омены/руны), зоны дропа базы.',
      'Watchlist: мониторинг ваших позиций, алерт при падении цены ≥10%.' ] },
    build: { t: '🛒 Билд', h: 'Ctrl+F2', b: [
      'Шопинг-лист эталонного билда: что искать на каждом слоте, дефициты (жизнь/резисты/ЭС) на основе импортированного PoB.',
      'Поиск по дереву (поле «поиск нод» + чипсы под ним: резисты/жизнь/урон — мышью без клавиатуры): ключевые камни и заметные ноды с их эффектами.',
      '⚔ DPS по гиру — расчётный (PoB-оценка оружия: физ+элем×скорость), НЕ живой замер: игра не отдаёт урон внешним тулам. Живой замер — тайминг убийства манекена в убежище.',
      'Уровневые метки: что капать на текущем уровне кампаньи.' ] },
    gems: { t: '💎 Камни', h: '—', b: [
      'Чек-лист камней сетапов билда: имя, уровень требований, ссылки для покупки/поиска.',
      'Привязка к наборам оружия: бейдж «⚔ набор I/II» — как игра это видит и как чинить «нельзя использовать».' ] },
    suppadv: { t: '🧩 Саппорты', h: '—', b: [
      'Советчик камней поддержки: найди активный навык (поиск по RU/EN или чипс вида) — покажет саппорты по приоритету.',
      'Порядок: ★ эталон меты (Maxroll-белые билды 0.5.5) → ранги poe2db Recommended Support Gems → без рекомендаций только attack/spell.',
      '✅ — саппорт уже в твоём импортированном билде. Работает офлайн, отдельно от конструктора связок (🧬 → «Конструктор»).' ] },
    import: { t: '📥 Импорт', h: 'Ctrl+F3', b: [
      'Импорт билда из PoB-кода (Path of Building 2): вставил код в буфер → <span class="hk">Ctrl+F3</span>.',
      'Ссылка профиля poe.ninja + Ctrl+F3 — автосинхронизация реального гира персонажа со слотами билда.' ] },
    level: { t: '📈 Прокачка', h: 'Ctrl+F4', b: [
      'Маршрут текущего акта: зоны, что в них искать, квестовые награды (✔ забрал — персист), вэйпоинты.',
      'Бестиарий боссов: сюжет, триалы, пиннакл — ключи и награды.',
      'Эндгейм-механики (карты/лиги) и чек-лист резистов до 75%.' ] },
    maps: { t: '🧭 Плитки', h: '—', b: [
      'Рецепты крафта Waystone (плитки смотрителя): таблица тиры/рецепты/ингредиенты.' ] },
    slang: { t: '📖 Слэнг', h: '—', b: [
      'Словарь жаргона и сокращений PoE2 по-человечески: CI, EHP, слэм, якорь, WTS и т.д.',
      'Разделы переключаются чипсами мышью (клавиатура не нужна).' ] },
    craft: { t: '⚒ Крафт', h: '—', b: [
      '<b>План</b>: Ctrl+C по предмету в игре → кнопка «План по предмету» — пошаговый крафт «двух якорей» под этот слот (эссенции/омены/руны).',
      '<b>Рецепты</b>: все системы 0.5.5 (валюта, эссенции, омены, руны, качество, верстаки, Дезекрация, плитки) — фильтр чипсами.',
      '<b>Эссенции/Омены</b>: таблицы с гарантированными модами и поведением.' ] },
    rates: { t: '💱 Курс', h: '—', b: [
      'Курсы валют по лигам: сколько стоит каждая валюта в chaos-эквиваленте.',
      'Лига выбирается чипсами (✦ — актуальная); тренд ▲/▼ — движение цены за окно poe.ninja.',
      'Источник: poe2scout + poe.ninja; кэш 10 минут, чтобы не спамить API.' ] },
    gen: { t: '🧬 Билды', h: '—', b: [
      '<b>Генератор билдов</b>: живые билды топ-игроков poe.ninja по всем классам выбранной лиги.',
      'По каждому классу: самые частые скиллы и ключевые узлы, медианные DPS/EHP, топ-3 примера.',
      'Выборка — ладдер (первые по уровню); кэш 30 минут. Класс и лига — чипсами.' ] },
    pinnacle: { t: '🛡 Пиннакл', h: 'Ctrl+F7', b: [
      'Чекап перед боссом-пиннаклом: резисты, EHP, стан-порог — честные «—» при неизвестных данных.',
      'Что фармить до попытки: weakest-звенья билда по эталону.' ] },
    settings: { t: '⚙ Настройки', h: 'Ctrl+F6', b: [
      'Лига (список действующих), прозрачность, тема (вкл. палитра для дальтоников).',
      'Видимость вкладок панели: скрыть ненужные (функция остаётся на хоткеях).',
      'Диагностика пишется в overlay.log в userData.' ] },
    radar: { t: '🛡 Радар', h: '—', b: [
      'Live-баги текущего патча: что в игре сломано сейчас + воркараунды (те же данные, что web-вкладка «Радар»).',
      'Хитрости (трюки) механик 0.5.x: как использовать, рискованность.',
      'Работает офлайн: данные запечены в панель из ядра при сборке.' ] }
  };

