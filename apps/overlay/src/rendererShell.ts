/**
 * PoE2 Kit overlay — статический HTML-каркас (этап S1 разноса rendererHtml.ts):
 * <body>: панель, колонка вкладок, idle, слои вкладок, настройки, футер —
 * до <script>. Извлечён дословно из монолита 02.10.2026; вычислений и
 * интерполяций в каркасе нет (probe: ${ / бэктики отсутствуют), поэтому
 * это константа, а не функция. У panel-разметки (DOM-canvas для скрипта)
 * и каркаса разные скорости изменения — потому CSS и каркас в ОТДЕЛЬНЫХ
 * модулях (rendererCss.ts / rendererShell.ts), по паттерну rendererData.ts.
 *
 * ПРАВИЛО ФАЙЛА: только разметка-константа. Динамический контент вкладок
 * рендерит скрипт в rendererHtml.ts (innerHTML по id).
 */

export const OVERLAY_SHELL = `<body>
  <div id="panel">
    <div class="tabrow" id="tabRow">
      <button data-tab="price" title="Прайс предмета из буфера (Ctrl+F1)">💰 Прайс</button>
      <button data-tab="build" title="Панель билда (Ctrl+F2)">🛒 Билд</button>
      <button data-tab="gems" title="Камни навыков билда: сетапы и чек-лист">💎 Камни</button>
      <button data-tab="import" title="Импорт PoB-кода из буфера (Ctrl+F3)">📥 Импорт</button>
      <button data-tab="level" title="Прокачка: контекст уровня (Ctrl+F4)">📈 Прокачка</button>
      <button data-tab="maps" title="Крафт плиток смотрителя (Waystones): рецепты и таблица">🧭 Плитки</button>
      <button data-tab="slang" title="Словарь игрового слэнга PoE2: сокращения и жаргон — по-человечески">📖 Слэнг</button>
      <button data-tab="craft" title="Окно крафта: план по предмету (Ctrl+C в игре), все рецепты 0.5.5, эссенции и омены">⚒ Крафт</button>
      <button data-tab="rates" title="Курсы валют по лигам: сколько стоит валюта в chaos (poe2scout + poe.ninja)">💱 Курс</button>
      <button data-tab="gen" title="Генератор билдов: живые билды топ-игроков poe.ninja по всем классам — скиллы, узлы, DPS/EHP">🧬 Билды</button>
      <button data-tab="pinnacle" title="Чекап перед пиннаклом: резисты/EHP/стан (Ctrl+F7)">🛡 Пиннакл</button>
      <button data-tab="settings" title="Настройки (Ctrl+F6)">⚙</button>
      <button class="info-btn" id="tabInfoBtn" title="Что делает активная вкладка — окно с описанием функции и хоткеями">ℹ ?</button>
    </div>
    <div id="content">
    <div id="infoWin" class="hide"></div>
    <div id="grab" class="hide">
      ⠿ Тащи меня мышью · <span class="reset" id="resetOffset">сброс</span> · Ctrl+F5 — закрепить
    </div>
    <div id="idle">
      Готово. Нажми <b>Ctrl+F1</b> — прайс предмета из буфера.<br/>
      <b>Ctrl+F3</b> — импорт билда из PoB-кода,<br/>
      <b>Ctrl+F2</b> — шопинг-лист билда.<br/>
      <span style="color:#9aa4b0;font-size:11px">Ссылка на персонажа poe.ninja + Ctrl+F3 — автосинхронизация эквипа.</span>
    </div>
    <div id="body" class="hide">
      <div class="head" id="priceHead">
        <div class="item-name" id="itemName"></div>
      </div>
      <div id="est" class="est hide"></div>
      <div id="augLine" class="meta hide"></div>
      <div id="buildNote" class="hide"></div>
      <div id="busy" class="status-busy hide">Оценка цены…</div>
      <div id="err" class="err-box hide"></div>
      <div id="meta" class="meta hide"></div>
      <div id="priceBatchWrap" class="hide">
        <div id="priceBatchHead"></div>
        <div id="priceBatchList"></div>
      </div>
      <div id="watchBtnWrap" class="hide">
        <button id="watchBtn" class="watch-btn">👁 Следить за ценой</button>
      </div>
      <div id="toast" class="toast hide"></div>
      <div id="listWrap" class="hide">
        <table class="list" id="list"></table>
      </div>
      <div id="lvlWrap" class="hide">
        <div class="lvl-zone" id="lvlZone"></div>
        <div id="campWrap"></div>
        <div id="lvlHints"></div>
      </div>
      <div id="gemsWrap" class="hide">
        <div id="gemsContent"></div>
      </div>
      <div id="mapsWrap" class="hide">
        <div id="mapsContent"></div>
      </div>
      <div id="slangWrap" class="hide">
        <div id="slangContent"></div>
      </div>
      <div id="craftWrap" class="hide">
        <div id="craftContent"></div>
      </div>
      <div id="ratesWrap" class="hide">
        <div id="ratesContent"></div>
      </div>
      <div id="genWrap" class="hide">
        <div id="genContent"></div>
      </div>
      <div id="pinnacleWrap" class="hide">
        <div id="pinnacleContent"></div>
      </div>
      <div id="scrollCtl">
        <button id="scrlUp" title="Прокрутить панель вверх (замена колеса мыши, если оно над оверлеем не работает)">▲</button>
        <button id="scrlDn" title="Прокрутить панель вниз">▼</button>
      </div>
      <div id="buildWrap" class="hide">
        <div id="buildHead"></div>
        <div id="buildBudget"></div>
        <div id="buildSlots"></div>
        <div id="buildTree"></div>
        <div id="buildSum"></div>
        <div id="buildErr" class="hide"></div>
      </div>
      <div id="importWrap" class="hide">
        <div id="importContent"></div>
      </div>
      <div id="hint">Прайс: Ctrl+F1 · Билд: Ctrl+F2 · Импорт: Ctrl+F3 · Прокачка: Ctrl+F4 · Двигать: Ctrl+F5 · Настройки: Ctrl+F6 · Пиннакл: Ctrl+F7</div>
    </div>
    <div id="settingsPanel" class="hide">
      <h3>⚙ Настройки
        <button class="close" id="settingsClose" title="Закрыть (Ctrl+F6)">✕</button>
      </h3>

      <div class="set-row">
        <div class="lbl"><span>Прозрачность фона</span><var id="setOpacityVal">—</var></div>
        <input type="range" id="setOpacity" min="25" max="100" step="1" value="86" />
      </div>

      <div class="set-row">
        <div class="lbl"><span>Масштаб текста</span><var id="setScaleVal">—</var></div>
        <input type="range" id="setScale" min="70" max="140" step="5" value="100" />
      </div>

      <div class="set-row">
        <div class="lbl"><span>Ширина оверлея</span><var id="setWidthVal">—</var></div>
        <input type="range" id="setWidth" min="280" max="640" step="10" value="420" />
      </div>

      <div class="set-row">
        <div class="lbl"><span>Высота оверлея</span><var id="setHeightVal">—</var></div>
        <input type="range" id="setHeight" min="140" max="1000" step="10" value="480" />
      </div>

      <div class="set-row" id="autoHeightSection">
        <div class="lbl">
          <span>Автоподбор высоты <small>— окно само растёт под контент и меняет размер при переключении панелей</small></span>
          <label style="display:flex;align-items:center;gap:6px;font-weight:400;cursor:pointer;margin-top:4px">
            <input type="checkbox" id="setAutoHeight" style="width:auto" />
            <span style="font-size:10px;color:var(--dim)">Включить (окно будет «прыгать»)</span>
          </label>
        </div>
        <div class="tip">Выключено (по умолчанию): высота — по слайдеру выше, длинный билд/списки прокручиваются внутри окна. Включите, если хотите, чтобы окно всегда вмещало весь контент целиком (в пределах экрана).</div>
      </div>

      <div class="set-row">
        <span>Угол прикрепления</span>
        <div class="corner-row" id="cornerRow">
          <button data-corner="top-left">В·л</button>
          <button data-corner="top-right">В·п</button>
          <button data-corner="bottom-left">Н·л</button>
          <button data-corner="bottom-right">Н·п</button>
        </div>
      </div>

      <div class="set-row" id="tabsSection">
        <div class="lbl">
          <span>Вкладки панели <small>— скрыть неиспользуемые кнопки из боковой колонки</small></span>
          <div class="tabs-grid" id="tabsGrid"></div>
        </div>
        <div class="tip">Как у аналогов: отмечено = кнопка видна, снято = скрыта (сама функция остаётся доступной по хоткею). «⚙ Настройки» скрыть нельзя — иначе теряется управление.</div>
      </div>

      <div class="set-row">
        <span>Лига (для цен и курсов)</span>
        <select id="setLeague"></select>
        <div class="tip">Список — из poe2scout (✦ = актуальная челлендж-лига). Применяется сразу и сохраняется — цены пересчитаются под выбранную лигу.</div>
      </div>

      <div class="set-row">
        <div class="lbl"><span>🎨 Цвета <small>— доступность: дальтонизм, контраст</small></span></div>
        <div class="corner-row" id="themeRow">
          <button data-theme="default" title="Стандартная тема kit">Обычная</button>
          <button data-theme="contrast" title="Чёрный фон, белый текст — максимальный контраст">Контраст</button>
          <button data-theme="cb" title="Палитра Okabe-Ito: безопасна при красно-зелёной и сине-жёлтой слепоте (статусы различимы и по светлоте)">Дальтонизм</button>
          <button data-theme="custom" title="Свои цвета — пипетки ниже">Свои</button>
        </div>
        <div class="color-row">
          <label>Фон <input type="color" id="setColBg" value="#0d1117" /></label>
          <label>Текст <input type="color" id="setColFg" value="#f0e6d2" /></label>
          <label>Второстеп. <input type="color" id="setColDim" value="#a89a83" /></label>
          <label>Акцент <input type="color" id="setColAccent" value="#c69a52" /></label>
          <button id="setColReset" title="Вернуть стандартную тему">↺ Сброс</button>
        </div>
        <div class="tip">Применяется сразу. При проблемах восприятия цвета пробуйте «Дальтонизм» (универсальная палитра Okabe-Ito) или «Контраст». «Свои» — точечная настройка фона/текста пипетками; статусы (✅/⚠/✕) меняет только тема.</div>
      </div>

      <div class="set-row">
        <span>Горячие клавиши (Ctrl+F1…F6)</span>
        <div class="hk-grid" id="hkGrid"></div>
        <div class="tip">Формат: <b>Control+F1</b>, <b>Alt+Shift+Q</b>. Пустое поле = стандарт.</div>
      </div>

      <div id="watchlistSection" class="set-row">
        <div class="lbl">
          <span>Watchlist <small>— следить за ценой, алерт при падении</small></span>
        </div>
        <div id="watchList" class="watch-list"></div>
        <div class="watch-actions">
          <button id="watchAddBuffer">➕ Из буфера</button>
          <button id="watchCheckNow">Проверить</button>
        </div>
        <div class="tip">Нажмите <b>Ctrl+C</b> на предмете в игре → «➕ Из буфера», либо кнопкой «👁 Следить» в прайс-токе. Проверка каждые 5 мин, алерт «цена упала с X до Y».</div>
      </div>

      <div class="set-row" id="bindSection">
        <div class="lbl">
          <span>Привязка к окну игры <small>— «осторожный режим»: без Win32-вызовов, позиция по углу экрана</small></span>
          <label style="display:flex;align-items:center;gap:6px;font-weight:400;cursor:pointer;margin-top:4px">
            <input type="checkbox" id="setBindWindow" style="width:auto" />
            <span style="font-size:10px;color:var(--dim)">Включена (читает позицию окна игры)</span>
          </label>
        </div>
        <div class="tip">Выключите, чтобы kit не обращался к user32.dll вовсе: оверлей встанет в угол экрана (двигается Ctrl+F5), не будет следовать за окном игры и прятаться при alt-tab.</div>
      </div>

      <div class="set-row" id="uiLangSection">
        <div class="lbl">
          <span>Язык панели <small>— подписи/хинты UI; Auto — язык Windows</small></span>
          <div style="display:flex;gap:4px;margin-top:4px">
            <button id="uiLangRu" style="font-size:10px">RU</button>
            <button id="uiLangAuto" style="font-size:10px">Auto</button>
            <button id="uiLangEn" style="font-size:10px">EN</button>
          </div>
        </div>
        <div class="tip">Panel language: RU original / EN translation. Item and gem names from your game client are not translated — trade lookups resolve them to English automatically.</div>
      </div>

      <div class="set-row" id="gemLangSection">
        <div class="lbl">
          <span>Язык имён камней <small>— имена в панели билда и рекомендациях саппортов</small></span>
          <div style="display:flex;gap:4px;margin-top:4px">
            <button id="gemLangRu" style="font-size:10px">RU</button>
            <button id="gemLangEn" style="font-size:10px">EN</button>
          </div>
        </div>
        <div class="tip">RU — имена как в русском клиенте игры (перевод из офлайн-словаря poe2db). EN — как в PoB.</div>
      </div>

      <div class="set-row" id="autoClipSection">
        <div class="lbl">
          <span>Автопрайс-чек из буфера <small>— проверять новые предметы без Ctrl+F1</small></span>
          <label style="display:flex;align-items:center;gap:6px;font-weight:400;cursor:pointer;margin-top:4px">
            <input type="checkbox" id="setAutoClip" style="width:auto" />
            <span style="font-size:10px;color:var(--dim)">Слежение 500мс (opt-in)</span>
          </label>
        </div>
        <div class="tip">Выключено по умолчанию (приватность): пока включено — kit читает буфер обмена каждые 500мс. Реагирует только на клир-текст предметов («Rarity:»), прочие копипасты игнорируются.</div>
      </div>

      <div class="set-row" id="learnSection">
        <div class="lbl">
          <span>Журнал обучения <small>— запоминать структуру предметов (локально)</small></span>
          <label style="display:flex;align-items:center;gap:6px;font-weight:400;cursor:pointer;margin-top:4px">
            <input type="checkbox" id="setLearn" style="width:auto" />
            <span id="learnRecords" style="font-size:10px;color:var(--dim)">Включить (opt-in)</span>
          </label>
        </div>
        <div class="diag-actions">
          <button id="learnShareBtn">📤 Поделиться предметами</button>
        </div>
        <div id="learnOut" class="diag-out"></div>
        <div class="tip">Выключено по умолчанию. Пишется только структура предмета (редкость/база/моды), без персонажа и аккаунта, в файл на вашем диске. «Поделиться» копирует готовый текст для issue на SourceCraft — одной вставкой.</div>
      </div>

      <div class="set-row" id="diagSection">
        <div class="lbl"><span>Диагностика</span></div>
        <div class="diag-actions">
          <button id="diagBtn">📋 Отправить диагностику</button>
        </div>
        <div id="diagOut" class="diag-out"></div>
        <div class="tip">Соберёт хвост <b>overlay.log</b> + конфиг машины, скопирует всё в буфер обмена и сохранит файл в userData — готово для вставки в отчёт/issue, файлы искать вручную не нужно.</div>
      </div>

      <div class="set-row">
        <div class="tip">⚠ Сторонний инструмент. GGG не гарантирует безопасность сторонних тулов. Kit ничего не делает за вас в игре: читает буфер и публичные API цен — каждое действие в игре делаете сами вы. Использование — на ваш риск.</div>
        <div class="tip" style="color:var(--dim)">This product isn't affiliated with or endorsed by Grinding Gear Games in any way.</div>
      </div>

      <div class="set-actions">
        <button id="settingsResetHK">Сбросить клавиши</button>
        <button id="settingsSave">Сохранить</button>
      </div>
    </div>
    </div><!-- /#content №113 -->
  </div>
`;
