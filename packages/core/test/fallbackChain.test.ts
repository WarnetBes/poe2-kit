/**
 * Гейт целостности офлайн-fallback-датасетов (portable-устойчивость).
 *
 * Паттерн Sidekick (TradeApiClient.cs:32-75): «живой fetch → локальный файл
 * из релиза» — при патче GGG / лежащей сети функциональность релиза держится
 * на packaged-слоях фолбэка. Если файл-носитель сломан/пуст/обрезан — ядро
 * честно отрабатывает пустыми картами, и деградация проходит МОЛЧА. Этот
 * тест — ранний сигнал «датасет сломан» ДО сборки portable: каждый файл
 * списка обязан существовать и парситься с минимальной структурной проверкой.
 *
 * Полный список (включая web dist-датасеты и zip-режим) проверяет
 * scripts/verify-fallback-datasets.mjs — тот же реестр источников.
 * Сеть запрещена: тест только факты на диске.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'game');

function readJson(rel: string): unknown {
  const raw = fs.readFileSync(path.join(dataDir, ...rel.split('/')), 'utf8');
  return JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw); // BOM-грабли №224
}

describe('fallback-датасеты: ядро (core trade/stat/RU-слои)', () => {
  it('base_items.json — читается, >1000 баз (RePoE-фолбэк resolveTradeBaseType)', () => {
    const raw = readJson('base_items.json') as { base_items?: Record<string, unknown> };
    expect(Object.keys(raw.base_items ?? {}).length).toBeGreaterThan(1000);
  });

  it('trade/trade_stats.json — дамп каталога trade2: >1000 записей, trade2-формы id', () => {
    const raw = readJson('trade/trade_stats.json') as {
      result?: Array<{ entries?: Array<{ id?: string; text?: string }> }>;
    };
    const entries = (raw.result ?? []).flatMap((g) => g.entries ?? []);
    expect(entries.length).toBeGreaterThan(1000);
    expect(raw.result!.length).toBeGreaterThanOrEqual(5); // группы (explicit/implicit/pseudo/…)
    const ids = entries.filter((e) => typeof e.id === 'string').map((e) => e.id as string);
    expect(ids.length).toBeGreaterThan(1000);
    expect(ids.some((id) => id.startsWith('explicit.'))).toBe(true);
    expect(ids.every((id) => /^(explicit|implicit|pseudo|crafted|fractured|enchant|rune|desecrated|sanctum|skill|utility|monster|armour|weapon)\./.test(id))).toBe(true);
  });

  it('learned/stat_text_map.json — learn-библиотека: entries-объект с # шаблонами', () => {
    const raw = readJson('learned/stat_text_map.json') as {
      version?: number;
      entries?: Record<string, string>;
    };
    expect(typeof raw.version).toBe('number');
    expect(Object.keys(raw.entries ?? {}).length).toBeGreaterThan(0);
    for (const [id, text] of Object.entries(raw.entries!).slice(0, 50)) {
      expect(id).toMatch(/^[\w.-]+$/);
      expect(text).toContain('#');
    }
  });

  it('repoe/base_items.json и repoe/mods.json — срезы парсятся, _meta.fetchedAt на месте', () => {
    const bases = readJson('repoe/base_items.json') as Record<string, unknown> & { _meta?: { fetchedAt?: string } };
    expect(Object.keys(bases).length).toBeGreaterThan(500);
    expect(typeof bases._meta?.fetchedAt).toBe('string');
    const mods = readJson('repoe/mods.json') as Record<string, unknown> & { _meta?: { fetchedAt?: string } };
    expect(Object.keys(mods).length).toBeGreaterThan(500);
    expect(typeof mods._meta?.fetchedAt).toBe('string');
  });

  it('trade/vendor_regex.json — >50 паттернов локального поиска', () => {
    const raw = readJson('trade/vendor_regex.json') as { items?: unknown[] };
    expect((raw.items ?? []).length).toBeGreaterThan(50);
  });
});

describe('fallback-датасеты: RU-словари (ruLocale)', () => {
  it('i18n/items_ru.json — >100 записей по всем категориям имён', () => {
    const raw = readJson('i18n/items_ru.json') as {
      names?: { item?: unknown[][]; unique?: unknown[][]; gem?: unknown[][] };
    };
    const total = (raw.names?.item?.length ?? 0)
      + (raw.names?.unique?.length ?? 0)
      + (raw.names?.gem?.length ?? 0);
    expect(total).toBeGreaterThan(100);
    for (const row of [...(raw.names?.item ?? []).slice(0, 20), ...(raw.names?.unique ?? []).slice(0, 20)]) {
      expect(Array.isArray(row)).toBe(true);
      expect(row.length).toBeGreaterThanOrEqual(2);
      expect(typeof row[0]).toBe('string');
      expect(typeof row[1]).toBe('string');
    }
  });

  it('i18n/mods_ru.json — RU-моды парсятся, >100 записей', () => {
    const raw = readJson('i18n/mods_ru.json') as { mods?: unknown[] };
    expect((raw.mods ?? []).length).toBeGreaterThan(100);
  });

  it('i18n/item_classes_ru.json — RU itemClass-канон парруется, >10 классов', () => {
    const raw = readJson('i18n/item_classes_ru.json') as { classes?: unknown[] };
    expect((raw.classes ?? []).length).toBeGreaterThan(10);
  });

  it('i18n/aliases.json — локализационные алиасы парсятся, есть _meta', () => {
    const raw = readJson('i18n/aliases.json') as Record<string, unknown> & { _meta?: unknown };
    expect(raw._meta).toBeTruthy();
  });
});
