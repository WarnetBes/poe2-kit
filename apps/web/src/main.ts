import './style.css';
import {
  core,
  loadLeagueList,
  selectLeague,
  getActiveLeague,
  initActiveLeague,
  refreshLeagueData,
  showCurrencyRates,
  showPriceCheck,
  showLevelingPlan,
  showBuildImport,
  showBuildPrice,
  decantToBuildPlanner,
  decantSupported,
  showBuildTreeFromText,
  showBuildTreeFromLast,
  showAIChat,
  sendAIMessage,
  clearAIChat,
  currentBuildContext,
  setStatus,
} from './ui';
import { showChecklist } from './checklist';
import { showBuildCompare, DEFAULT_LADDER_SLUG } from './compare';
import { pasteFromClipboard } from './clipboard';
import { renderFullMap } from './fullMap';
import { showHideout, copyHideoutShare, copyHideoutMarkdown, initHideoutTab } from './hideout';
import { initAtlasTab } from './atlasMap';
import { keybindsFromInputs, keybindsFromLastBuild } from './keybinds';
import { initMapPrepTab } from './mapPrep';
import { initSimulacrumTab } from './simulacrum';
import { initRadarTab } from './radar';
import { initLandingTab } from './landing';
import { initCraftTab } from './craftGuide';
import { initPinnacleTab } from './pinnacle';
import { initSlangTab } from './slang';
import { initPobOracleTab } from './pobOracle';
import { initStarterBuildsTab } from './starterBuilds';
import { initPoeguidesTab } from './poeguides';
import { initPlannerTab } from './planner';

// Определяем глобальный API для элементов интерфейса
declare global {
  interface Window {
    poe2k: {
      currencies: () => void;
      priceCheck: () => void;
      leveling: () => void;
      build: () => void;
      chat: (text?: string) => void;
      clearChat: () => void;
    };
  }
}

function escAttr(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="layout">
    <header class="topbar">
      <div class="brand"><span class="brand-orn" aria-hidden="true"></span>PoE2 <b>Kit</b></div>
      <div class="navwrap">
        <nav class="tabgroups" aria-label="Разделы">
          <button data-group="now" class="tg active" title="Сводка: что делать сейчас">Сейчас</button>
          <button data-group="level" class="tg" title="Акты 1–4, чек-лист, хайдоуты">📈 Прокачка</button>
          <button data-group="build" class="tg" title="Импорт, раскладка, сравнение, дерево">🛠 Билд</button>
          <button data-group="endgame" class="tg" title="Атлас, карты, Simulacrum, радар">⚔ Эндгейм</button>
          <button data-group="econ" class="tg" title="Курсы, прайс-чек, AI">💰 Экономика</button>
        </nav>
        <nav class="tabs" aria-label="Вкладки раздела">
          <button data-tab="leveling" data-group="level" class="tab">Прокачка</button>
          <button data-tab="checklist" data-group="level" class="tab">Чек-лист</button>
          <button data-tab="hideout" data-group="level" class="tab">Хайдоуты</button>
          <button data-tab="slang" data-group="level" class="tab">📖 Слэнг</button>
          <button data-tab="build" data-group="build" class="tab">Импорт билда</button>
          <button data-tab="keybinds" data-group="build" class="tab">🎮 Раскладка</button>
          <button data-tab="compare" data-group="build" class="tab">Сравнение</button>
          <button data-tab="poboracle" data-group="build" class="tab" title="Живой движок PoB2: персист-сессия, матрица what-if">🧮 PoB-оракул</button>
          <button data-tab="tree" data-group="build" class="tab">Дерево (мои узлы)</button>
          <button data-tab="map" data-group="build" class="tab">Дерево (полное)</button>
          <button data-tab="craft" data-group="build" class="tab">🔨 Крафт</button>
          <button data-tab="starterbuilds" data-group="build" class="tab" title="Курируемые стартовые билды 0.5.5: стадии, цены, уники, PoB">🧬 Билды</button>
          <button data-tab="poeguides" data-group="build" class="tab" title="База билд-гайдов poeshop.ru: тир-лист S/A/B/C, связки скиллов, 298 карточек">📚 Гайды</button>
          <button data-tab="planner" data-group="build" class="tab" title="Сборка билда: скилл-группы (гем + до 5 саппортов) и слоты гира с подсказками уников">🛠 Планнер</button>
          <button data-tab="atlas" data-group="endgame" class="tab">Атлас</button>
          <button data-tab="mapprep" data-group="endgame" class="tab">🗺 Карты</button>
          <button data-tab="simulacrum" data-group="endgame" class="tab">🌀 Simulacrum</button>
          <button data-tab="radar" data-group="endgame" class="tab">🛡 Радар</button>
          <button data-tab="pinnacle" data-group="endgame" class="tab">👑 Пиннакл</button>
          <button data-tab="currency" data-group="econ" class="tab">Курсы валют</button>
          <button data-tab="price" data-group="econ" class="tab">Прайс-чек</button>
          <button data-tab="ai" data-group="econ" class="tab">AI-чат</button>
        </nav>
      </div>
      <div class="league-zone" title="Лига влияет на цены, чек-лист и лестницу">
        <label class="league-label" for="league-select">Лига</label>
        <select id="league-select" class="league-select" title="Актуальные лиги (из poe2scout)"></select>
        <button id="btn-refresh-leagues" class="ghost mini" title="Обновить список лиг и кэш данных">⟳</button>
      </div>
    </header>
    <main class="content">
      <section id="pane-now" class="pane active">
        <h2>Сейчас <small>сводка: где я · что дальше · что сломано в игре</small></h2>
        <p class="hint">Дашборд из твоих данных: чек-лист прокачки, последний разобранный билд и live-баги текущего патча. Появитcя смысл — после первого чек-листа/импорта билда. Полные списки — в группах разделов сверху.</p>
        <div id="out-now" class="out"></div>
      </section>

      <section id="pane-currency" class="pane">
        <h2>Курсы валют <small>(poe.ninja)</small></h2>
        <button id="btn-currencies" class="primary">Показать курсы</button>
        <div id="out-currency" class="out"></div>
      </section>

      <section id="pane-price" class="pane">
        <h2>Прайс-чек предмета</h2>
        <p class="hint">Вставь текст предмета из игры (Ctrl+C). Цены: poe2scout / poe.ninja / trade2. Или нажми «Из буфера», чтобы прочитать его прямо из клипборда.</p>
        <textarea id="price-input" rows="10" placeholder="Rarity: Unique&#10;Brutal Grenaade&#10;Mace&#10;--------&#10;..."></textarea>
        <div class="aitools">
          <button id="btn-price" class="primary">Оценить цену</button>
          <button id="btn-price-paste" class="ghost">📋 Из буфера и оценить</button>
        </div>
        <div id="out-price" class="out"></div>
      </section>

      <section id="pane-leveling" class="pane">
        <h2>Гид по прокачке <small>Акты 1–4</small></h2>
        <p class="hint">Советы под класс/асценданси: камни ⚔, механика 💡, экипировка 🛠 — в каждой зоне.</p>
        <div class="lvset">
          <select id="leveling-class">
            <option value="">Общий план (без класса)</option>
            <option value="Monk">Monk</option>
            <option value="Warrior">Warrior</option>
            <option value="Sorceress">Sorceress</option>
            <option value="Ranger">Ranger</option>
            <option value="Mercenary">Mercenary</option>
            <option value="Witch">Witch</option>
            <option value="Druid">Druid</option>
            <option value="Huntress">Huntress</option>
          </select>
          <input id="leveling-asc" type="text" placeholder="или асценданси: Invoker, Lich, Titan, Deadeye…" />
        </div>
        <button id="btn-leveling" class="primary">Показать план</button>
        <div id="out-leveling" class="out"></div>
      </section>

      <section id="pane-checklist" class="pane">
        <h2>Чек-лист прокачки <small>зоны · награды · покупки</small></h2>
        <p class="hint">Отмечай пройденные зоны, полученные награды и купленное. Сохраняется в браузере под текущей лигой; «Сбросить для новой лиги» — начать заново на старте сезона.</p>
        <div id="out-checklist" class="out"></div>
      </section>

      <section id="pane-build" class="pane">
        <h2>Импорт билда <small>(PoB share-код)</small></h2>
        <p class="hint">Декодирует PoB2 share-код (AA...) в сводку по билду и умеет оценить всё снаряжение по живым ценам.</p>
        <textarea id="build-input" rows="6" placeholder="Вставь share-код PoB..."></textarea>
        <div class="aitools">
          <button id="btn-build" class="primary">Разобрать</button>
          <button id="btn-build-price" class="ghost">Оценить снаряжение</button>
          <button id="btn-build-paste" class="ghost" title="Вставить PoB-код из системного буфера и разобрать">📋 Из буфера</button>
          <button id="btn-build-decant" class="ghost" hidden title="Конвертировать в официальный *.build и записать в папку Build Planner игры (нужен браузер с File System Access)">Перелить в игру (.build)</button>
        </div>
        <div id="out-build" class="out"></div>
        <div id="out-supports" class="out"></div>
        <div id="out-build-price" class="out"></div>
        <div id="out-build-decant" class="out"></div>
      </section>

      <section id="pane-keybinds" class="pane">
        <h2>🎮 Раскладка навыков <small>геймпад Xbox / PS · клавиатура</small></h2>
        <p class="hint">Строит раскладку биндов по билду PoB: 22 слота геймпада PoE2 (11 кнопок + сет при удержании L2-модификатора) с эргономикой по рекомендациям GGG, или хотбар LMB/RMB/Q-W-E-R-T. Ауры/херальды/persistent-скиллы (Ghost Dance, Wind Dancer…) не биндятся — выводятся Spirit-блоком. Файлом бинды не применяются: генерируется инструкция для ручной установки в игре.</p>
        <textarea id="keybinds-input" rows="6" placeholder="Вставь share-код PoB..."></textarea>
        <div class="lvset">
          <select id="keybinds-platform" title="Платформа">
            <option value="xbox">🎮 Xbox</option>
            <option value="playstation">🎮 PlayStation</option>
            <option value="keyboard">⌨ Клавиатура</option>
          </select>
          <select id="keybinds-mode" title="Режим движения (для клавиатуры)">
            <option value="wasd">WASD</option>
            <option value="click">клик-мув</option>
          </select>
          <button id="btn-keybinds" class="primary">Подобрать раскладку</button>
          <button id="btn-keybinds-last" class="ghost">Из поля «Импорт билда»</button>
          <button id="btn-keybinds-paste" class="ghost" title="Вставить PoB-код из буфера и подобрать раскладку">📋 Из буфера</button>
        </div>
        <div id="out-keybinds" class="out"></div>
      </section>

      <section id="pane-compare" class="pane">
        <h2>Сравнение с топ-лестницей класса</h2>
        <p class="hint">Декодирует PoB share-код, качает пул билдов того же класса с poe.ninja и сверяет DPS/EHP (медиана/топ + перцентиль). Поле «слаг лиги» — снапшот-лига poe.ninja (по умолчанию Forbidden Rites), не путать с активной лигой в шапке.</p>
        <textarea id="compare-input" rows="6" placeholder="Вставь share-код PoB..."></textarea>
        <div class="lvset">
          <input id="compare-slug" type="text" value="forbiddenrites" placeholder="слаг снапшот-лиги poe.ninja" title="Например: forbiddenrites, wraeclast-hardcore, ssf-… (см. poe2_ladder_leagues)" />
          <button id="btn-compare" class="primary">Сравнить</button>
          <button id="btn-compare-last" class="ghost" title="Взять PoB-код из поля «Импорт билда»">Из поля «Импорт билда»</button>
          <button id="btn-compare-paste" class="ghost" title="Вставить PoB-код из буфера и сравнить">📋 Из буфера</button>
        </div>
        <div id="out-compare" class="out"></div>
      </section>

      <section id="pane-poboracle" class="pane">
        <h2>🧮 PoB-оракул <small>живой движок PoB2 в персист-сессии сервера</small></h2>
        <p class="hint">Расчёты делает настоящий движок PathOfBuilding-PoE2 (headless, припаян к серверу): загрузи билд раз — дальше пересчёты за миллисекунды. Что-если-матрица: боссы/пиннаклы/уровни поверх baseline, сценарии изолированы (CAS-откат в хосте, контракт 4). Нужен полный сетап сервера: @poe2-kit/core + oracle-рантайм + POE2K_POB2_SRC (см. oracle/README.md).</p>
        <div class="pob-statusbar" id="pob-status">Проверяю состояние сессии…</div>
        <div class="aitools">
          <button id="btn-pob-status" class="ghost">⟳ Состояние</button>
          <button id="btn-pob-load" class="primary">Загрузить билд</button>
          <button id="btn-pob-load-last" class="ghost" title="Взять PoB-код из поля «Импорт билда»">Из поля «Импорт билда»</button>
          <button id="btn-pob-paste" class="ghost" title="Вставить PoB-код из буфера и загрузить в оракул">📋 Из буфера</button>
        </div>
        <textarea id="pob-code-input" rows="6" placeholder="Вставь share-код PoB (AA…) — или XML билда…"></textarea>
        <div id="out-pob" class="out"></div>
        <fieldset class="pob-presets">
          <legend>Сценарии what-if</legend>
          <!-- чекбоксы рендерятся из PRESETS в pobOracle.ts чтобы не дублировать список -->
          <div id="pob-presets-box"></div>
          <div class="lvset">
            <input id="pob-level" type="number" min="1" max="100" placeholder="свой уровень 1–100" style="width:12em" />
            <button id="btn-pob-whatif" class="primary">Прогнать матрицу</button>
          </div>
        </fieldset>
        <div id="out-pob-whatif" class="out"></div>
      </section>

      <section id="pane-tree" class="pane">
        <h2>Карта дерева пассивок <small>взятые узлы</small></h2>
        <p class="hint">ID узлов (как в PoB: числа через запятую/пробел) — или бери узлы последнего разобранного билда. Клик по узлу на карте — статы; перетаскивание — смещение, колесо — масштаб.</p>
        <textarea id="tree-input" rows="4" placeholder="12876, 11672, 48773, …"></textarea>
        <div class="aitools">
          <button id="btn-tree" class="primary">Показать дерево</button>
          <button id="btn-tree-last" class="ghost">Из последнего билда</button>
        </div>
        <div id="out-tree" class="out"></div>
      </section>

      <section id="pane-craft" class="pane">
        <h2>🔨 Крафт <small>план по предмету · каталог рецептов 0.5.5</small></h2>
        <p class="hint">Персональный план: Ctrl+C по предмету в игре → «Из буфера». Или вставь текст предмета (Rarity/моды) — craftPlan построит шаги методологии «двух якорей» (waystone — по своей методологии №130). Ниже — полный каталог: рецепты, эссенции, сплавы, омены.</p>
        <textarea id="craft-item-input" rows="4" placeholder="Rarity: Rare&#10;Unnamed Amulet&#10;--------&#10;…"></textarea>
        <div class="aitools">
          <button id="btn-craft-plan" class="primary">План по предмету</button>
          <button id="btn-craft-clipboard" class="ghost">Из буфера</button>
        </div>
        <div id="out-craft" class="out"></div>
      </section>

      <section id="pane-starterbuilds" class="pane">
        <h2>🧬 Билды <small>стартовые билды 0.5.5 · стадии · цены гайдов · PoB</small></h2>
        <p class="hint">Курируемые стартовые билды PoE2 0.5.x (ресёрч-волны №471-№477: lootkeeper/maxroll/poe.ninja): что покупать на старте/миде/мейне/максе, ключевые уники, порядок узлов асценденси. Цены — срез гайдов, не Live-курс. ⚠-карточки — фейк-связки/предостережения, ❓ — данные не сверены. Неопубликованные цены честно пустые.</p>
        <div class="lvset"><input id="starterbuilds-filter" type="text" placeholder="поиск: класс, асценденси, скилл, id…" /></div>
        <div id="starterbuilds-class-chips" class="pg-chips" title="Классы"></div>
        <div id="starterbuilds-price-chips" class="pg-chips" title="Наличие цен"></div>
        <div id="out-starterbuilds" class="out"></div>
      </section>

      <section id="pane-poeguides" class="pane">
        <h2>📚 Гайды <small>база билд-гайдов poeshop.ru: тир-лист · связки скиллов · 298 карточек</small></h2>
        <p class="hint">Все PoE2-билд-гайды poeshop.ru как фактура: класс, асценданси, тир S/A/B/C, связки скиллов с уровнями/качеством, уники. Прозаические тексты и ассеты poeshop не копируются — полная статья по ссылке «оригинал гайда» на каждой карточке. Датасет офлайн (запечён в билд), срез указан в шапке.</p>
        <div class="lvset">
          <input id="poeguides-search" type="text" placeholder="поиск: скилл, уник, асценданси…" />
        </div>
        <div id="poeguides-tier-chips" class="pg-chips" title="Тир-лист"></div>
        <div id="poeguides-class-chips" class="pg-chips" title="Классы"></div>
        <div id="out-poeguides" class="out"></div>
      </section>

      <section id="pane-planner" class="pane">
        <h2>🛠 Планнер <small>клик по ячейке → выбор гема/саппорта · слоты гира · офлайн</small></h2>
        <p class="hint">Сборка билда в раскладке poeshop-планнера на наших датасетах: 3 скилл-группы (большая ячейка главного гема + 6 круглых), клик по пустой ячейке → пикер с поиском (рекомендованные саппорты сверху: мета-эталон, затем base-ранги), клик по заполненной — замена, ✕ на hover — удалить. Слоты экипировки/фляг с подсказками 433 уников. Активные гемы EN (poe2db-слаги), саппорты RU. План живёт локально и в URL: «🔗 Поделиться планом» копирует ссылку, открывшуюся с этим билдом (план в ссылке приоритетнее локального). Дерево пассивок — во вкладке «Древо».</p>
        <div id="out-planner" class="out"></div>
      </section>

      <section id="pane-atlas" class="pane">
        <h2>Карта Атласа <small>40 очков · ветки механик</small></h2>
        <p class="hint">Древо атласа (atlas skills): клик по узлу берёт/снимает очко (только рядом со стартом или взятым узлом — как в игре, с refund), счётчик в тулбаре. Панорамирование (перетаскивание), масштаб (колесо), поиск по имени/статах, ссылка с планом (#a=) и авто-сохранение в браузере.</p>
        <div id="out-atlas" class="out"></div>
      </section>

      <section id="pane-mapprep" class="pane">
        <h2>🗺 Карты <small>waystone-вердикт: моды · оборона · что взять</small></h2>
        <p class="hint">Выбери карту, задай тир камня и вставь моды (каждый с новой строки) — вердикт покажет опасные моды, нехватку резистов/EHP и что взять с собой. Резисты подтягиваются из импортированного билда (вкладка «Импорт билда»); без билда — заполни 4 поля вручную. Пороги maxroll помечены «unverified» — проверяй в игре.</p>
        <div class="lvset">
          <input id="mapprep-map" list="mapprep-maps" placeholder="Карта: Rustbowl…" autocomplete="off" title="Начни печатать — подсказки по 135 картам" />
          <datalist id="mapprep-maps"></datalist>
          <select id="mapprep-tier" title="Тир waystone (задаёт area level 65–80)">
            <option value="">тир: по карте</option>
            <option value="1">T1</option><option value="2">T2</option><option value="3">T3</option>
            <option value="4">T4</option><option value="5">T5</option><option value="6">T6</option>
            <option value="7">T7</option><option value="8">T8</option><option value="9">T9</option>
            <option value="10">T10</option><option value="11">T11</option><option value="12">T12</option>
            <option value="13">T13</option><option value="14">T14</option><option value="15">T15</option>
            <option value="16">T16</option>
          </select>
        </div>
        <textarea id="mapprep-mods" rows="4" placeholder="Моды камня — каждый с новой строки:&#10;Players have -(7-8)% to all maximum Resistances&#10;+30% Monster Elemental Resistances"></textarea>
        <div class="lvset">
          <label class="dim">fire %</label><input id="mapprep-res-fire" type="number" placeholder="fire" />
          <label class="dim">cold %</label><input id="mapprep-res-cold" type="number" placeholder="cold" />
          <label class="dim">light %</label><input id="mapprep-res-lightning" type="number" placeholder="light" />
          <label class="dim">chaos %</label><input id="mapprep-res-chaos" type="number" placeholder="chaos" />
          <button id="btn-mapprep" class="primary">Вердикт</button>
        </div>
        <div id="out-mapprep" class="out"></div>
      </section>

      <section id="pane-pinnacle" class="pane">
        <h2>👑 Пиннакл <small>чекап готовности: EHP · резисты · чек-лист</small></h2>
        <p class="hint">Тот же чекап, что Ctrl+F7 в оверлее (№111): estimateBuild по PoB-коду → чек-лист против табличных статов пиннакл-боссов. «unknown» — данных в билде нет (честная частичность). Считается локально, без сети.</p>
        <div class="aitools">
          <button id="btn-pinnacle-last" class="primary">По последнему билду</button>
          <button id="btn-pinnacle-build" class="ghost">Из поля «Импорт билда»</button>
        </div>
        <div id="out-pinnacle" class="out"></div>
      </section>

      <section id="pane-simulacrum" class="pane">
        <h2>🌀 Simulacrum <small>Delirium 0.5.x · доступ · волны · боссы · лут</small></h2>
        <p class="hint">Энциклопедия + гайд: цепочка доступа (Mirror → Grand Mirror → Fog Bank → Simulacrum → Tang'Mazu), 7 волн и выбор шардов, телеграфы боссов, дроп-таблица с честной экономикой, атлас-ноды Delirium и чек-лист готовности. Гайд офлайн; спорные факты помечены «unverified» — патч GGG может поменять цифры.</p>
        <div id="out-simulacrum" class="out"></div>
      </section>

      <section id="pane-slang" class="pane">
        <h2>📖 Слэнг <small>игровой жаргон PoE2 — по-человечески</small></h2>
        <p class="hint">Сокращения и термины, которыми общаются игроки: гайды, трейд-чаты, форумы. Тот же словарь, что во вкладке оверлея (единый источник — ядро poe2-kit).</p>
        <div id="out-slang" class="out"></div>
      </section>

      <section id="pane-radar" class="pane">
        <h2>🛡 Радар <small>патч-таймлайн · живые баги · воркараунды · хитрости</small></h2>
        <p class="hint">Что изменилось в игре и что сейчас сломано: таймлайн патчей, живые баги с механизмами и воркараундами, исправленное (в каком патче), фичи-не-баги и легальные хитрости для соло и пати. Срез ручной курации (ресёрч-волны); ❓-пункты — единичные репорты, не факт: сверяйся с игрой.</p>
        <div id="out-radar" class="out"></div>
      </section>

      <section id="pane-map" class="pane">
        <h2>Полная карта дерева пассивок <small>все классы и асценданси</small></h2>
        <p class="hint">Всё общее дерево + деревья асценданси всех классов «как в игре»: тумблер «Игровой вид» — WebGL-рендер на PixiJS по официальному экспорту GGG (данные патча, 5153 узла); обычный режим — лёгкий SVG. Панорамирование (перетаскивание), масштаб (колесо), фильтр по классу, клик по узлу — статы.</p>
        <div id="out-map" class="out"></div>
      </section>

      <section id="pane-hideout" class="pane">
        <h2>Хайдоуты <small>.hideout → разбор декора, офлайн</small></h2>
        <p class="hint">Перетащи файл .hideout (или выбери его) — разбор без сервера: база, полный список декора до импорта (как обещает POH), MTX-часть, лимит 750, мини-карта размещения. Принимает и share-код PoE2 Kit (начинается не с «{»). Отметь галочками свой MTX — увидишь, соберёшь ли хайдоут.</p>
        <div id="hideout-drop" class="hdrop">Перетащи .hideout сюда или
          <label class="link">выбери файл <input id="hideout-file" type="file" accept=".hideout,.json,application/json" hidden /></label>
        </div>
        <textarea id="hideout-input" rows="6" placeholder='{"version":1, "hideout_name":"…", "doodads":{…}} — или share-код PoE2 Kit'></textarea>
        <div class="aitools">
          <button id="btn-hideout" class="primary">Разобрать</button>
          <button id="btn-hideout-copy" class="ghost">⇄ Копировать share-код</button>
          <button id="btn-hideout-md" class="ghost">📋 Markdown для форума</button>
        </div>
        <div class="lvset">
          <input id="hideout-filter" type="text" placeholder="фильтр по имени декора…" />
          <label class="hd-toggle"><input id="hideout-owned-only" type="checkbox" /> скрыть доступное (free/купленное)</label>
        </div>
        <div id="out-hideout" class="out"></div>
      </section>

      <section id="pane-ai" class="pane">
        <h2>AI-чат <small>(over core.ai)</small></h2>
        <p class="hint">Подключи OpenAI-совместимый эндпоинт (OpenCode-модель или локальную Ollama) — поля сохраняются в браузере. Контекст разобранного билда подставится автоматически.</p>
        <div class="aiset">
          <label>Base URL <input id="ai-base" type="text" placeholder="https://…/v1" /></label>
          <label>API Key <input id="ai-key" type="password" placeholder="sk-… (или пусто)" /></label>
          <label>Модель <input id="ai-model" type="text" placeholder="glm-5-3 / deepseek-v4-flash…" /></label>
        </div>
        <div class="aitools">
          <button id="ai-send-ctx" class="primary">Отправить с контекстом билда</button>
          <button id="ai-clear" class="ghost">Очистить чат</button>
        </div>
        <div id="out-ai" class="out"></div>
      </section>

      <footer class="status" id="status">
        <span>Готово. <span id="status-text"></span></span>
        <button id="btn-about" class="about-link" type="button">О проекте · Дисклеймер</button>
      </footer>
    </main>
  </div>

  <div id="modal-about" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="about-title">
    <div class="modal-box">
      <button id="about-close" class="modal-x" type="button" aria-label="Закрыть">✕</button>
      <h2 id="about-title">О проекте PoE2 Kit — дисклеймер</h2>
      <div class="about-body">
        <p class="about-date">Актуально по состоянию на 11.10.2026 (релиз v1.0.31). Текст может обновляться.</p>
        <p><strong>Неофициальный инструмент.</strong> PoE2 Kit — независимый помощник для игры <em>Path of Exile 2</em>. Мы не аффилированы с GGG (Grinding Gear Games / GGG) и не поддерживаемся ими. Все названия игры, предметов и терминология принадлежат их владельцам и используются в информационных целях.</p>
        <h3>Данные и цены</h3>
        <p>Цены, курсы и лиги берутся из <strong>публичных сторонних источников</strong> (poe.ninja, poe2scout, официальное API торговли). Это <strong>оценки и справочные данные</strong>, а не реальные сделки. Цены меняются быстро и могут быть неточными/устаревшими; не гарантируется их полнота и корректность в конкретный момент.</p>
        <p>Никакой реальной денежной стоимости: отображаемые «цены» — это игровые курсы (chaos/divine и т.п.) внутри Path of Exile, а не деньги.</p>
        <h3>Карта дерева пассивок</h3>
        <p>Карта на вкладке «Карта» — <strong>оффлайн-справочник</strong>, построенный на открытом экспорте разметки дерева (сверяется с PathOfBuilding-PoE2 / официальными данными GGG): координаты узлов и связи, без интерактивного планирования. Для онлайн-планирования билда на игровой карте используйте кнопку «poe2db-планировщик» (внешний независимый сайт, мы за него не отвечаем).</p>
        <h3>Аналитика и ИИ</h3>
        <p>Советы, разбор билдов и ответы ИИ носят <strong>информационный характер</strong> и не заменяют решения игрока. Мы не даём финансовых или юридических консультаций.</p>
        <h3>Использование в игре</h3>
        <p>Инструмент не автоматизирует действия персонажа, не читает память игры и не обходит её правила. Ответственность за использование любых сторонних программ/сервисов несёт пользователь.</p>
        <h3>PoB-оракул (headless-движок)</h3>
        <p>Вкладка «🧮 PoB-оракул» считает статы билда <strong>настоящим движком Path of Building (PoE2)</strong> в отдельном локальном процессе на вашем ПК (offline): вы сами скачиваете непатченный клон PoB2 с официального репозитория сообщества и указываете путь к нему. Кит не патчит и не изменяет движок; настройки и вычисления происходят локально, никуда не отправляясь. Если клон не указан, вкладка честно сообщает об этом и не работает — без молчаливых фолбэков.</p>
        <h3>MCP-инструментарий (OpenCode и др.)</h3>
        <p>В комплект входит <strong>MCP-сервер</strong> (Model Context Protocol, 77 инструментов), который вы можете подключить к поддерживающим MCP-клиентам (например, OpenCode). Сервер — обычный локальный процесс: команды запускаются вами, запросы идут к тем же публичным API, что и веб-интерфейс. Ни одна функция MCP не затрагивает клиент игры: log-инструменты читают только стандартный игровой лог, оракул — локальный движок PoB2 (см. выше).</p>
        <h3>Работа без установленной игры</h3>
        <p>Большая часть кита (билды, PoB-оракул, экономика, прокачка, дерево, крафт, карты) работает <strong>без установленной игры</strong> — достаточно Node.js и интернета. Разделы, требующие игры (live-лог, радар, оверлей поверх окна), честно сообщают об отсутствии игрового лога и не «изобретают» данные.</p>
        <h3>Portable-версия</h3>
        <p>Релизы распространяются в том числе как <strong>portable-архив</strong> (zip): распаковал — запустил <code>start-web.bat</code>, без установки и правок системы (первый запуск оверлея один раз докачивает Electron). Portable идентичен репозиторной сборке, ничего дополнительного не собирает и никуда не пишет, кроме своей папки.</p>
        <h3>Данные и приватность</h3>
        <p>Мы <strong>не запрашиваем и не храним</strong> данные вашей учётной записи игры. Настройки (например, для AI-эндпоинта) сохраняются локально в вашем браузере (localStorage) и никуда не передаются. Запросы к сторонним API (в т.ч. AI) выполняются напрямую — ознакомьтесь с их политиками конфиденциальности.</p>
        <h3>Официальные ссылки</h3>
        <p>Path of Exile 2 и все связанные товарные знаки © Grinding Gear Games. Официальный сайт: <a href="https://www.pathofexile.com" target="_blank" rel="noopener noreferrer">pathofexile.com</a>, en: <a href="https://poe2.com" target="_blank" rel="noopener noreferrer">poe2.com</a>.</p>
        <h3>Поддержка проекта</h3>
        <p>Kit бесплатный и останется бесплатным: без рекламы, премиум-функций и телеметрии. Поддержка — целиком по желанию. P.S. У разработчика 22.10.2026 свадьба (Санкт-Петербург, Дворец бракосочетания №1) — если поддержка в этом месяце пойдёт повеселее, праздник организовать будет проще 🙂</p>
        <p><strong>СБП (Альфа-Банк / Россельхозбанк)</strong> — по номеру телефона <code>+7 981 760-60-27</code> (перевод в приложении любого банка: «Перевод по СБП» → номер → выбрать банк получателя).</p>
        <p><strong>WebMoney</strong> (WMID <code>649044135447</code>): <code>Z235374758440</code> (USD) · <code>E248778175899</code> (EUR) · <code>T958910155976</code> · <code>Q495876683152</code> · <code>M672735954801</code> · <code>F873704704436</code> · <code>H177756398822</code> · <code>X190692638474</code> · <code>L890511223722</code>.</p>
        <p class="about-foot">Используя инструмент, вы соглашаетесь с тем, что используете его на свой страх и риск («AS IS», без каких-либо гарантий).</p>
      </div>
    </div>
  </div>
`;

// ── Табы ───────────────────────────────────────────────
const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.tab'));
const tabBtn = (name: string) => document.querySelector<HTMLButtonElement>(`[data-tab="${name}"]`);

/** Синхронизировать hash-сегмент t=<вкладка>, сохраняя чужие сегменты (a=, pl=). */
function syncTabHash(tabName: string | null): void {
  try {
    const segs = location.hash.replace(/^#/, '').split('&').filter((x) => x && !x.startsWith('t='));
    if (tabName) segs.unshift(`t=${tabName}`);
    const base = location.pathname + location.search;
    history.replaceState(null, '', segs.length ? `${base}#${segs.join('&')}` : base);
  } catch { /* file:// — молча */ }
}

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab!;
    tabs.forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll<HTMLElement>('.pane').forEach((p) => {
      p.classList.toggle('active', p.id === `pane-${target}`);
    });
    syncTabHash(target);
  });
});

// ── Группы навигации (№262, Этап 0): «Сейчас» + 4 раздела ──
// Анти-паттерн дизайнера №1: группы обязаны реально переключать DOM-видимость
// подстроки вкладок, а не быть «ещё одним рядом кнопок».
const groupBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('.tg'));
/** Последняя активная вкладка внутри группы — чтобы возврат в группу возвращал туда же. */
const LS_TABS_KEY = 'poe2kit_last_tabs';
function loadLastTabs(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(LS_TABS_KEY) ?? '{}') as Record<string, string>; }
  catch { return {}; }
}
let lastTabInGroup: Record<string, string> = loadLastTabs();

function saveLastTabs(): void {
  try { localStorage.setItem(LS_TABS_KEY, JSON.stringify(lastTabInGroup)); } catch { /* quota */ }
}

function showTabsOfGroup(group: string): void {
  tabs.forEach((t) => {
    t.classList.toggle('grp-hidden', t.dataset.group !== group);
    t.classList.toggle('active', false);
  });
  document.querySelectorAll<HTMLElement>('.pane').forEach((p) => {
    p.classList.toggle('active', p.id === 'pane-now');
  });
}

function selectGroup(group: string): void {
  groupBtns.forEach((b) => b.classList.toggle('active', b.dataset.group === group));
  if (group === 'now') {
    // Лендинг: подстрока пустая, панель — pane-now.
    syncTabHash(null);
    tabs.forEach((t) => t.classList.add('grp-hidden'));
    document.querySelectorAll<HTMLElement>('.pane').forEach((p) => {
      p.classList.toggle('active', p.id === 'pane-now');
    });
    return;
  }
  showTabsOfGroup(group);
  const target =
    lastTabInGroup[group] ?? tabs.find((t) => t.dataset.group === group)?.dataset.tab ?? '';
  if (target) {
    const btn = document.querySelector<HTMLButtonElement>(`[data-tab="${target}"]`);
    btn?.click();
  }
}

groupBtns.forEach((btn) => {
  btn.addEventListener('click', () => selectGroup(btn.dataset.group!));
});

// Запоминаем последнюю вкладку группы при её выборе (для возврата; между сессиями — в LS).
tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const g = tab.dataset.group;
    if (g) {
      if (lastTabInGroup[g] !== tab.dataset.tab) {
        lastTabInGroup[g] = tab.dataset.tab!;
        saveLastTabs();
      }
    }
  });
});

// ── Выбор лиги ─────────────────────────────────────────
async function initLeagueSelector(): Promise<void> {
  const sel = document.querySelector<HTMLSelectElement>('#league-select');
  if (!sel) return;
  try {
    const list = await loadLeagueList();
    const cur = getActiveLeague();
    sel.innerHTML =
      `<option value="">— выбрать лигу —</option>` +
      list
        .map((l) => {
          const label = l.isCurrent ? `${l.name} ✦` : l.name;
          return `<option value="${escAttr(l.name)}"${l.name === cur ? ' selected' : ''}>${label}</option>`;
        })
        .join('');
    sel.addEventListener('change', () => {
      selectLeague(sel.value ? sel.value : null);
      setStatus(`Выбрана лига: ${sel.value || 'не задана (используется по умолчанию)'}.`);
    });
  } catch (e) {
    setStatus(`Не удалось загрузить лиги: ${e instanceof Error ? e.message : String(e)}`);
  }
}

document.querySelector('#btn-refresh-leagues')!.addEventListener('click', () => {
  refreshLeagueData();
  void initLeagueSelector();
  setStatus('Обновление списка лиг и данных…');
});

void initActiveLeague();
void initLeagueSelector();

// ── Обработчики ────────────────────────────────────────
document.querySelector('#btn-currencies')!.addEventListener('click', () => showCurrencyRates());
document.querySelector('#btn-price')!.addEventListener('click', () =>
  showPriceCheck((document.querySelector('#price-input') as HTMLTextAreaElement).value),
);
document.querySelector('#btn-price-paste')!.addEventListener('click', () => void pasteFromClipboard());
document.querySelector('#btn-leveling')!.addEventListener('click', () => showLevelingPlan());
document.querySelector('#btn-build')!.addEventListener('click', () =>
  showBuildImport((document.querySelector('#build-input') as HTMLTextAreaElement).value),
);
document.querySelector('#btn-build-price')!.addEventListener('click', () =>
  showBuildPrice((document.querySelector('#build-input') as HTMLTextAreaElement).value),
);
// E4 «Decant»: кнопка видна только в браузерах с File System Access;
// запись *.build в папку Build Planner с валидацией ДО записи.
if (decantSupported()) {
  document.querySelector<HTMLButtonElement>('#btn-build-decant')!.hidden = false;
  document.querySelector('#btn-build-decant')!.addEventListener('click', () =>
    void decantToBuildPlanner((document.querySelector('#build-input') as HTMLTextAreaElement).value),
  );
}
document.querySelector('#btn-tree')!.addEventListener('click', () =>
  showBuildTreeFromText((document.querySelector('#tree-input') as HTMLTextAreaElement).value),
);
document.querySelector('#btn-tree-last')!.addEventListener('click', () => showBuildTreeFromLast());

// ── Хайдоуты ───────────────────────────────────────────
document.querySelector('#btn-hideout')!.addEventListener('click', () =>
  void showHideout((document.querySelector('#hideout-input') as HTMLTextAreaElement).value),
);
document.querySelector('#btn-hideout-copy')!.addEventListener('click', () => copyHideoutShare());
document.querySelector('#btn-hideout-md')!.addEventListener('click', () => copyHideoutMarkdown());
initHideoutTab();
initAtlasTab();
initMapPrepTab();
initSimulacrumTab();
initRadarTab();
initLandingTab();
initCraftTab();
initPinnacleTab();
initSlangTab();
initPobOracleTab();
initStarterBuildsTab();
initPoeguidesTab();
initPlannerTab();

// ── Раскладка (№221) ─────────────────────────────────────
document.querySelector('#btn-keybinds')!.addEventListener('click', () => keybindsFromInputs());
document.querySelector('#btn-keybinds-last')!.addEventListener('click', () => keybindsFromLastBuild());

document.querySelector('#btn-compare')!.addEventListener('click', () =>
  void showBuildCompare(
    (document.querySelector('#compare-input') as HTMLTextAreaElement).value,
    (document.querySelector('#compare-slug') as HTMLInputElement).value || DEFAULT_LADDER_SLUG,
  ),
);

// №262: сравнение с полем «Импорт билда» — дедублирует вставку PoB-кода.
document.querySelector('#btn-compare-last')!.addEventListener('click', () => {
  const code = (document.querySelector('#build-input') as HTMLTextAreaElement).value;
  if (!code.trim()) {
    setStatus('Поле «Импорт билда» пусто: вставь там PoB share-код.');
    return;
  }
  void showBuildCompare(code, (document.querySelector('#compare-slug') as HTMLInputElement).value || DEFAULT_LADDER_SLUG);
});

// Чек-лист прокачки: открытие вкладки рендерит список (состояние из localStorage)
document.querySelector('[data-tab="checklist"]')!.addEventListener('click', () => showChecklist());

// Полная карта дерева: рендер лениво (только при открытии вкладки)
let mapRendered = false;
document.querySelector('[data-tab="map"]')!.addEventListener('click', () => {
  if (mapRendered) return;
  mapRendered = true;
  void renderFullMap(document.querySelector<HTMLDivElement>('#out-map')!);
});

// ── AI-чат ─────────────────────────────────────────────
showAIChat();
document.querySelector('#ai-send-ctx')!.addEventListener('click', () => {
  void sendAIMessage(
    'Разбери мой билд и предложи улучшения, актуальные для PoE2.',
    currentBuildContext() ? { build: currentBuildContext() } : undefined,
  );
});
document.querySelector('#ai-clear')!.addEventListener('click', () => clearAIChat());

// ── Вставка PoB-кода из буфера в поле + запуск основного действия ──
async function pasteIntoBuildField(fieldSel: string, actionBtnSel: string | null): Promise<void> {
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) throw new Error('буфер пуст');
    const field = document.querySelector<HTMLTextAreaElement>(fieldSel);
    if (!field) return;
    field.value = text;
    setStatus('Вставлено из буфера.');
    if (actionBtnSel) document.querySelector<HTMLButtonElement>(actionBtnSel)?.click();
  } catch (e) {
    setStatus(`Не удалось прочитать буфер: ${e instanceof Error ? e.message : String(e)} — вставь вручную (Ctrl+V).`);
  }
}
document.querySelector('#btn-build-paste')?.addEventListener('click', () =>
  void pasteIntoBuildField('#build-input', '#btn-build'));
document.querySelector('#btn-keybinds-paste')?.addEventListener('click', () =>
  void pasteIntoBuildField('#keybinds-input', '#btn-keybinds'));
document.querySelector('#btn-compare-paste')?.addEventListener('click', () =>
  void pasteIntoBuildField('#compare-input', '#btn-compare'));
document.querySelector('#btn-pob-paste')?.addEventListener('click', () =>
  void pasteIntoBuildField('#pob-code-input', '#btn-pob-load'));

// Глобализация для возможного внешнего расширения
window.poe2k = {
  currencies: showCurrencyRates,
  priceCheck: () =>
    showPriceCheck((document.querySelector('#price-input') as HTMLTextAreaElement).value),
  leveling: showLevelingPlan,
  build: () => showBuildImport((document.querySelector('#build-input') as HTMLTextAreaElement).value),
  chat: (text) =>
    void sendAIMessage(
      text ?? '',
      currentBuildContext() ? { build: currentBuildContext() } : undefined,
    ),
  clearChat: clearAIChat,
};

setStatus('Загружено. Выбери раздел.');

// ── Deep-link #t=<вкладка>: применяем ПОСЛЕ init-обработчиков ленивых вкладок ──
(function restoreTabFromHash(): void {
  const m = /(?:^|[#&])t=([a-z]+)/.exec(location.hash);
  const name = m?.[1] ?? '';
  const btn = name ? tabBtn(name) : null;
  if (!btn) return;
  const g = btn.dataset.group;
  groupBtns.forEach((b) => b.classList.toggle('active', b.dataset.group === g));
  btn.click(); // откроет вкладку; ленивые init-хендлеры уже навешаны выше
})();

// ── Дисклеймер (модалка) ─────────────────────────────
const modalAbout = document.querySelector<HTMLElement>('#modal-about');
const btnAbout = document.querySelector<HTMLButtonElement>('#btn-about');
const aboutClose = document.querySelector<HTMLButtonElement>('#about-close');
function closeAbout(): void {
  modalAbout?.classList.add('hidden');
}
btnAbout?.addEventListener('click', () => modalAbout?.classList.remove('hidden'));
aboutClose?.addEventListener('click', closeAbout);
modalAbout?.addEventListener('click', (e) => {
  if (e.target === modalAbout) closeAbout();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeAbout();
});

// Импорт core-ядро для подтверждения связки (необходимо, т.к. ui.ts импортирует отдельно)
void core;