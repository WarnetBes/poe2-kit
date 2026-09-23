import './style.css';
import { core, showCurrencyRates, showPriceCheck, showLevelingPlan, showBuildImport, setStatus } from './ui';

// Определяем глобальный API для элементов интерфейса
declare global {
  interface Window {
    poe2k: {
      currencies: () => void;
      priceCheck: () => void;
      leveling: () => void;
      build: () => void;
    };
  }
}

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="layout">
    <header class="topbar">
      <div class="brand">⛏ PoE2 <b>Kit</b></div>
      <nav class="tabs">
        <button data-tab="currency" class="tab active">Курсы валют</button>
        <button data-tab="price" class="tab">Прайс-чек</button>
        <button data-tab="leveling" class="tab">Прокачка</button>
        <button data-tab="build" class="tab">Импорт билда</button>
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
        <p class="hint">Вставь текст предмета из игры (Ctrl+C). Цены: poe2scout / poe.ninja / trade2.</p>
        <textarea id="price-input" rows="10" placeholder="Rarity: Unique&#10;Brutal Grenaade&#10;Mace&#10;--------&#10;..."></textarea>
        <button id="btn-price" class="primary">Оценить цену</button>
        <div id="out-price" class="out"></div>
      </section>

      <section id="pane-leveling" class="pane">
        <h2>Гид по прокачке <small>Акты 1–4</small></h2>
        <button id="btn-leveling" class="primary">Показать план</button>
        <div id="out-leveling" class="out"></div>
      </section>

      <section id="pane-build" class="pane">
        <h2>Импорт билда <small>(PoB share-код)</small></h2>
        <p class="hint">Декодирует PoB2 share-код (AA...) в сводку по билду.</p>
        <textarea id="build-input" rows="6" placeholder="Вставь share-код PoB..."></textarea>
        <button id="btn-build" class="primary">Разобрать</button>
        <div id="out-build" class="out"></div>
      </section>

      <footer class="status" id="status">Готово. <span id="status-text"></span></footer>
    </main>
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

// ── Обработчики ────────────────────────────────────────
document.querySelector('#btn-currencies')!.addEventListener('click', () => showCurrencyRates());
document.querySelector('#btn-price')!.addEventListener('click', () =>
  showPriceCheck((document.querySelector('#price-input') as HTMLTextAreaElement).value),
);
document.querySelector('#btn-leveling')!.addEventListener('click', () => showLevelingPlan());
document.querySelector('#btn-build')!.addEventListener('click', () =>
  showBuildImport((document.querySelector('#build-input') as HTMLTextAreaElement).value),
);

// Глобальизация для возможного внешнего расширения
window.poe2k = {
  currencies: showCurrencyRates,
  priceCheck: () =>
    showPriceCheck((document.querySelector('#price-input') as HTMLTextAreaElement).value),
  leveling: showLevelingPlan,
  build: () => showBuildImport((document.querySelector('#build-input') as HTMLTextAreaElement).value),
};

setStatus('Загружено. Выбери раздел.');

// Импорт core-ядро для подтверждения связки (необходимо, т.к. ui.ts импортирует отдельно)
void core;