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
      <nav class="tabs">
        <button data-tab="currency" class="tab active">Курсы валют</button>
        <button data-tab="price" class="tab">Прайс-чек</button>
        <button data-tab="leveling" class="tab">Прокачка</button>
        <button data-tab="checklist" class="tab">Чек-лист</button>
        <button data-tab="build" class="tab">Импорт билда</button>
        <button data-tab="keybinds" class="tab">🎮 Раскладка</button>
        <button data-tab="compare" class="tab">Сравнение</button>
        <button data-tab="tree" class="tab">Дерево</button>
        <button data-tab="atlas" class="tab">Атлас</button>
        <button data-tab="map" class="tab">Карта</button>
        <button data-tab="hideout" class="tab">Хайдоуты</button>
        <button data-tab="ai" class="tab">AI-чат</button>
        <span class="tab league-wrap">
          <label class="league-label" for="league-select">Лига</label>
          <select id="league-select" class="league-select" title="Актуальные лиги (из poe2scout)"></select>
          <button id="btn-refresh-leagues" class="ghost mini" title="Обновить список лиг и кэш данных">⟳</button>
        </span>
      </nav>
    </header>
    <main class="content">
      <section id="pane-currency" class="pane active">
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
        </div>
        <div id="out-build" class="out"></div>
        <div id="out-build-price" class="out"></div>
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
        </div>
        <div id="out-compare" class="out"></div>
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

      <section id="pane-atlas" class="pane">
        <h2>Карта Атласа <small>40 очков · ветки механик</small></h2>
        <p class="hint">Древо атласа (atlas skills): клик по узлу берёт/снимает очко (только рядом со стартом или взятым узлом — как в игре, с refund), счётчик в тулбаре. Панорамирование (перетаскивание), масштаб (колесо), поиск по имени/статах, ссылка с планом (#a=) и авто-сохранение в браузере.</p>
        <div id="out-atlas" class="out"></div>
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
        <p class="about-date">Актуально по состоянию на 28.09.2026 (релиз v1.0.6). Текст может обновляться.</p>
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
tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab!;
    tabs.forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll<HTMLElement>('.pane').forEach((p) => {
      p.classList.toggle('active', p.id === `pane-${target}`);
    });
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

// ── Раскладка (№221) ─────────────────────────────────────
document.querySelector('#btn-keybinds')!.addEventListener('click', () => keybindsFromInputs());
document.querySelector('#btn-keybinds-last')!.addEventListener('click', () => keybindsFromLastBuild());

document.querySelector('#btn-compare')!.addEventListener('click', () =>
  void showBuildCompare(
    (document.querySelector('#compare-input') as HTMLTextAreaElement).value,
    (document.querySelector('#compare-slug') as HTMLInputElement).value || DEFAULT_LADDER_SLUG,
  ),
);

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