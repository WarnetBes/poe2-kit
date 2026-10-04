/**
 * MCP-инструменты: билды (декод PoB, сводка).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core } from '@poe2-kit/core';
import type { BuildImport, BuildEstimate, BuildAdvice, LadderRow, BuildGearItem } from '@poe2-kit/core';

/** Человекочитаемая расширенная сводка билда (использует новые поля парсера). */
function formatBuild(b: BuildImport): string {
  const lines: (string | null)[] = [
    '## Билд (PoB)',
    `- **Класс:** ${b.class ?? '—'}`,
    `- **Аскандаси:** ${b.ascendancy ?? '—'}`,
    `- **Уровень:** ${b.level ?? '—'}`,
    b.passiveNodes.length ? `- **Узлы пассивок:** ${b.passiveNodes.length}` : null,
  ];
  // Авто-детект рассинхрона версий: treeVersion билда vs патч датасета (P0-2).
  const version = versionSection(b);
  if (version) lines.push(...version);
  // Резолв ID узлов дерева в имена (keystone/notable — с описаниями, остальные счётчиком).
  const tree = treeSection(b.passiveNodes);
  if (tree) lines.push(tree);
  // Группы камней: главная — с уровнями, остальные списком
  if (b.skillGroups?.length) {
    const main = b.skillGroups.find((g) => g.main);
    if (main) {
      lines.push(`- **Главная связка (${main.label || 'без подписи'}):** ${main.gems.map((g) => `${g.name}${g.level != null ? ` L${g.level}` : ''}${g.quality ? ` q${g.quality}` : ''}`).join(' · ')}`);
    }
    const others = b.skillGroups.filter((g) => g !== main && g.enabled);
    if (others.length) {
      lines.push(`- **Прочие группы (${others.length}):** ${others
        .map((g) => {
          const names = g.gems.map((x) => `${x.name}${x.level != null ? ` L${x.level}` : ''}`).join(' · ');
          return `${g.label || g.gems[0]?.name || '?'}: ${names}`;
        })
        .join(';\n  ')}`);
    }
  } else if (b.skills.length) {
    lines.push(`- **Скиллы:** ${b.skills.join(', ')}`);
  }
  if (b.buffs && (b.buffs.buffList.length || b.buffs.curseList.length)) {
    const parts = [
      b.buffs.buffList.length ? `бафы: ${b.buffs.buffList.join(', ')}` : null,
      b.buffs.curseList.length ? `проклятия: ${b.buffs.curseList.join(', ')}` : null,
    ].filter(Boolean);
    lines.push(`- **Активные эффекты:** ${parts.join(' | ')}`);
  }
  if (b.fullDps?.length) {
    lines.push(`- **FullDPS раскладка:** ${b.fullDps.map((s) => `${s.stat} = ${Math.round(s.value)}`).join(', ')}`);
  }
  if (b.config) {
    const cfg = b.config;
    const parts = [
      cfg.enemyIsBoss ? `босс: ${cfg.enemyIsBoss}` : null,
      cfg.enemyLevel ? `уровень врага: ${cfg.enemyLevel}` : null,
    ].filter(Boolean);
    const rest = Object.keys(cfg).filter((k) => k !== 'enemyIsBoss' && k !== 'enemyLevel');
    if (rest.length) parts.push(`ещё: ${rest.map((k) => `${k}=${cfg[k]}`).join(', ')}`);
    if (parts.length) lines.push(`- **Конфиг боя:** ${parts.join(' | ')}`);
  }
  if (b.gear && Object.keys(b.gear).length) {
    lines.push(`- **Снаряжение:** ${Object.entries(b.gear).filter(([, v]) => v).map(([slot, v]) => `${slot}: ${v}`).join('; ')}`);
  }
  if (b.notes) {
    lines.push('', '### Заметки билда', b.notes.length >= 2000 ? `${b.notes}…` : b.notes);
  }
  return lines.filter((l): l is string => l !== null).join('\n');
}

/** Сверка версии дерева билда с патчем датасета: строка treeVersion + предупреждение при рассинхроне. */
function versionSection(b: BuildImport): string[] | null {
  const check = core.dataset.checkTreeVersion(b.treeVersion);
  if (check.status === 'missing') return null;
  if (check.status === 'current') {
    return [`- **Версия дерева (treeVersion):** ${check.treeVersion} — актуальна (патч датасета ${check.datasetPatch})`];
  }
  return [`- **Версия дерева (treeVersion):** ${check.treeVersion}`, `- ${check.message}`];
}

/** Дерево пассивок билда: ID → имена; keystone/notable — с полными статами, остальные счётчиком. */
function treeSection(ids: string[]): string | null {
  if (!ids.length) return null;
  const report = core.dataset.resolvePassiveNodes(ids);
  const all = report.resolved;
  const keystones = all.filter((n) => n.isKeystone);
  const notables = all.filter((n) => n.isNotable && !n.isKeystone);
  const small = all.length - keystones.length - notables.length;
  const out = [
    '',
    '### Дерево пассивок',
    `- Узлов: **${report.requested}** (распознано ${all.length}: keystone ${keystones.length} · notable ${notables.length} · малых ${small})`,
  ];
  if (!all.length) {
    out.push('_Узлы не найдены в офлайн-датасете (возможно, другая версия дерева — сверить в Path of Building)._');
  }
  for (const n of [...keystones, ...notables]) {
    const src = n.source === 'ascendancy' && n.ascendancy ? ` (${n.ascendancy})` : '';
    out.push(`- ${n.isKeystone ? '🔑' : '★'} **${n.name}**${src}: ${n.stats.join('; ')}`);
  }
  if (report.missing.length) {
    out.push(`- ⚠ Не распознано (${report.missing.length}): ${report.missing.slice(0, 20).join(', ')}${report.missing.length > 20 ? '…' : ''}`);
    if (report.missingNumeric.length === report.missing.length) {
      out.push('  _Это числовые ID обычного дерева — датасет хранит его по символьным ключам PoB (числовая карта появится с обновлением данных; асценданси по числовым ID распознаются)._');
    } else {
      out.push('  _Вероятно, другая версия дерева (treeVersion ≠ актуальному патчу) — сверить в Path of Building._');
    }
  }
  return out.join('\n');
}

/** Преобразовать gear-карту (slot→text) в массив BuildGearItem[]. */
function gearAsItems(gear: Record<string, string>): BuildGearItem[] {
  return Object.entries(gear).map(([slot, itemText]) => ({ slot, name: '', itemText }));
}

/**
 * Разбивка «откуда цифра» (P1 #7): что даёт каждый слот снаряжения по защите,
 * источникам «% increased» и оружию (DPS). Честно: плоские вклады по слотам;
 * компаунд «% increased» показывается отдельно (он глобальный). Вклад узлов
 * дерева и гемов в DPS движком PoE2 офлайн не разложить — это отмечено.
 */
function damageBreakdownSection(b: BuildImport): string | null {
  if (!b.gear || Object.keys(b.gear).length === 0) return null;
  const items = gearAsItems(b.gear);
  const slots = core.estimate.defenseBreakdownBySlot(items).filter((s) => !s.empty);

  const out: string[] = ['', '### Разбивка «откуда цифра» (по слотам, геар)'];
  if (slots.length) {
    out.push(
      '| Слот | Жизнь | ES | Броня | Уклонение | Fire | Cold | Light | Chaos | Блок |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    );
    for (const s of slots) {
      const nm = s.slot || s.name || '?';
      const cell = (v: number) => (v ? String(Math.round(v)) : '—');
      out.push(
        `| ${nm} | ${cell(s.life)} | ${cell(s.energyShield)} | ${cell(s.armour)} | ${cell(s.evasion)} | ${cell(s.fireRes)} | ${cell(s.coldRes)} | ${cell(s.lightningRes)} | ${cell(s.chaosRes)} | ${s.blockChance ? `${s.blockChance}%` : '—'} |`,
      );
    }
  }
  // % increased источники.
  const pct = core.estimate.percentModsBySlot(items);
  if (pct.length) {
    out.push('', '**Источники «% increased» (применяются к суммарному пулу):**');
    for (const p of pct) out.push(`- ${p.slot || '?'} → +${p.value}% ${p.type}`);
  }
  // Оружие: единственный честный «слой» DPS, который можно разложить без движка.
  const w = core.estimate.estimateWeaponDps(items);
  if (w.weapon) {
    out.push(
      '',
      `**DPS по слоям (оружие):** ${w.weapon} — pDPS ${w.physDps}, eDPS ${w.elementalDps} ≈ **${w.totalDps} DPS**, ${w.attacksPerSecond != null ? `${w.attacksPerSecond.toFixed(2)} aps` : 'aps —'}`,
    );
  }
  out.push(
    '',
    '_Честно: здесь раскладывается только геар (плоские вклады + оружие). Вклад узлов дерева и гемов в DPS/ES как множители офлайн не разложить — для этого нужен движок Path of Building (см. poe2_build_estimate/summary с PlayerStat)._',
  );
  return out.join('\n');
}

export function registerBuildTools(server: McpServer): number {
  server.registerTool(
    'poe2_build_decode',
    {
      title: 'PoE2 Decode Build (PoB)',
      description: `Декодировать share-код билда PoB (Path of Building PoE2) в XML и структуру.

Аргументы:
  - code (string): share-код (обычно начинается с "AA...").
  - as_xml (boolean, опц.): если true — вернуть сырой XML (по умолчанию false).

Возвращает декодированный XML (или структуру BuildImport: класс, уровень, скиллы,
узлы дерева, снаряжение) со сверкой версии дерева против патча датасета (treeVersion).

Примеры:
  - "Разбери мой билд" → вставь share-код
`,
      inputSchema: {
        code: z.string().min(5).describe('PoB share-код'),
        as_xml: z.boolean().optional().describe('Вернуть сырой XML'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ code, as_xml }) => {
      try {
        const xml = core.build.decodeShareCode(code);
        if (as_xml) {
          return { content: [{ type: 'text', text: xml }] };
        }
        const imported = await core.build.importBuild(xml);
        return { content: [{ type: 'text', text: formatBuild(imported) }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка декода: ${msg}` }] };
      }
    },
  );

  server.registerTool(
    'poe2_build_summary',
    {
      title: 'PoE2 Build Summary',
      description: `Краткая человекочитаемая сводка по XML билда PoB.

Аргументы:
  - xml (string): декодированный XML-контент PathOfBuilding.

Возвращает компактный обзор: класс/аскандаси, уровень, основные скиллы, узлы и снаряжение.
Предупреждает о рассинхроне версий: treeVersion билда vs патч датасета (если билд собран на более старом дереве).
`,
      inputSchema: {
        xml: z.string().min(20).describe('XML PathOfBuilding'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ xml }) => {
      try {
        const imported = await core.build.importBuild(xml);
        const parts: string[] = [formatBuild(imported)];
        const breakdown = damageBreakdownSection(imported);
        if (breakdown) parts.push(breakdown);
        parts.push('', '_Формат XML — docs/POB2_XML_REFERENCE.md._');
        return { content: [{ type: 'text', text: parts.join('\n') }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка: ${msg}` }] };
      }
    },
  );

  server.registerTool(
    'poe2_build_price',
    {
      title: 'PoE2 Price Whole Build',
      description: `Оценить цену всего снаряжения билда разом (прайс-чек каждого предмета из импортированного билда PoB).

Аргументы:
  - code (string): share-код билда PoB (или ссылка pobb.in/pastebin, или сырой XML).
  - league (string, опц.): лига (по умолчанию — текущая активная).
  - mode (string, опц.): "trade" (по умолчанию — цена) | "ssf" (без сети: SSF-план
    крафта по каждому слоту, вместо цены).

В режиме trade возвращает отчёт по каждому предмету снаряжения: слот, имя, редкость, медианная цена,
оценка min/max, источники и число найденных объявлений, а также суммарную нижнюю
границу стоимости и число предметов с известной ценой.

В режиме ssf — бесплатный эвристический SSF-разбор каждого слота (фрактуред-моды,
план крафта, зона дропа базы; для уников — «добыча дропом, не крафтится»). Без лиги и без сети.

Примеры:
  - "Сколько стоит собрать этот билд?" → вставь share-код
  - "Оцени всё снаряжение моего билда по живым ценам"
  - "Дай SSF-план крафта для этого билда" → mode=ssf
`,
      inputSchema: {
        code: z.string().min(5).describe('PoB share-код / ссылка / XML билда'),
        league: z.string().optional().describe('Лига (по умолчанию активная)'),
        mode: z.enum(['trade', 'ssf']).optional().describe('Режим: trade (цена) | ssf (план крафта, без сети)'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ code, league, mode }) => {
      try {
        if (mode === 'ssf') {
          const imp = await core.build.importBuild(code);
          const rep = core.ssf.ssfBuildReport(imp.gear);
          const lines = [
            '## SSF-план крафта билда',
            '> Эвристические рекомендации для SSF (не игровые данные). Без сети и лиги.',
            `- **Слотов в отчёте:** ${rep.length}`,
            '',
          ];
          for (const r of rep) {
            lines.push(`### ${r.slot || '?'}`);
            lines.push(r.assessment.displayName ? `*${r.assessment.displayName}*` : '*Неизвестный предмет*');
            const plan = r.assessment.crafting.map((c) => `- **${c.step}** — ${c.detail}`).join('\n');
            lines.push(plan);
            if (r.assessment.fractured.length) {
              lines.push('Фрактуред-моды:');
              for (const f of r.assessment.fractured) {
                lines.push(`- ${f.keep ? '✅' : '⚠️'} ${f.text}`);
              }
            }
            if (r.assessment.dropZone) lines.push(`Зона дропа базы: ${r.assessment.dropZone}`);
            lines.push('');
          }
          return { content: [{ type: 'text', text: lines.join('\n') }] };
        }
        const report = await core.trade.priceBuild(code, { league });
        const lines: string[] = [
          `## Прайс-чек билда`,
          `- **Лига:** ${report.league ?? '—'}`,
          `- **Предметов обработано:** ${report.totalItems}`,
          `- **Оценено цен:** ${report.pricedCount}`,
          `- **Суммарно (min–max):** ${report.totalMin.toFixed(2)}–${(report.totalMax ?? 0).toFixed(2)} ${report.totalCurrency ?? 'chaos'}`,
          `- **Суммарная медиана:** ${report.totalMedian != null ? report.totalMedian.toFixed(2) : '—'} ${report.totalCurrency ?? 'chaos'}`,
          `- **Время:** ${report.elapsedMs} мс`,
          ``,
          `| Слот | Имя | Редкость | Медиана | Оценка (min–max) | Объявл. | Примечание |`,
          `| --- | --- | --- | --- | --- | --- | --- |`,
        ];
        for (const it of report.items) {
          const median = it.estimate?.median;
          const range = it.estimate
            ? `${it.estimate.min.toFixed(2)}–${it.estimate.max.toFixed(2)}`
            : '—';
          lines.push(
            `| ${it.slot || '—'} | ${it.name || '—'} | ${it.rarity} | ${median != null ? median.toFixed(2) : '—'} | ${range} | ${it.listingsCount} | ${it.note ?? ''} |`,
          );
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка прайс-чека билда: ${msg}` }] };
      }
    },
  );

  // ── Приближённая оценка билда (EHP/DPS) без PoB-движка ──
  server.registerTool(
    'poe2_build_estimate',
    {
      title: 'PoE2 Build Estimate (EHP/DPS)',
      description: `Приближённая оценка билда PoE2: EHP по слоям защиты (броня/уклонение/блок/резисты — формулы PoE2), слабые места защиты с рекомендациями, DPS оружия. Работает по PoB share-коду или XML — PoB-движок НЕ нужен.

Если в коде есть PlayerStat (игрок открывал билд в PoB) — они тоже возвращаются и они точнее геар-оценки.

Аргументы:
  - code (string, обяз.): PoB share-код ИЛИ готовый XML PathOfBuilding.
  - hit_size (number, опц.): ожидаемый урон за удар для расчёта брони (по умолчанию 1000).
  - accuracy (number, опц.): точность атакующего для уклонения (по умолчанию 2000).

Ограничения: учитывается только снаряжение; дерево пассивок, гемы и ауры НЕ входят — реальные числа выше.

Примеры:
  - "Оцени мой билд" → вставь share-код
  - "Хватит ли мне брони против боссов?" → hit_size=5000
`,
      inputSchema: {
        code: z.string().min(5).describe('PoB share-код или XML'),
        hit_size: z.number().int().positive().optional().describe('Ожидаемый удар (для брони)'),
        accuracy: z.number().int().positive().optional().describe('Точность атакующего'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ code, hit_size, accuracy }) => {
      try {
        const est = await core.estimate.estimateBuild(code, {
          expectedHitSize: hit_size ?? 1000,
          attackerAccuracy: accuracy ?? 2000,
        });
        const lines: string[] = ['## Оценка билда (приближённая, без PoB-движка)', ''];
        lines.push(`- Источник чисел: ${est.source === 'pob+gear' ? 'гир + PlayerStat из PoB' : 'только гир'}`);
        if (est.characterLevel || est.className) {
          lines.push(`- Персонаж: **${est.className ?? '?'}${est.ascendancy ? ` / ${est.ascendancy}` : ''}**, уровень ${est.characterLevel ?? '?'}`);
        }
        const d = est.defenses;
        lines.push(
          `- Защиты из гира: жизнь **${Math.round(d.life)}**, ES ${Math.round(d.energyShield)}, броня ${Math.round(d.armour)}, уклонение ${Math.round(d.evasion)}, блок ${d.blockChance}%`,
        );
        lines.push(`  - Резисты: fire ${d.fireRes}% / cold ${d.coldRes}% / lightning ${d.lightningRes}% / chaos ${d.chaosRes}%`);
        lines.push('', '### EHP по типам урона');
        for (const t of Object.keys(est.ehp) as Array<keyof typeof est.ehp>) {
          const e = est.ehp[t];
          lines.push(`- ${t}: **${e.effectiveHp === Infinity ? '∞' : Math.round(e.effectiveHp)}** (митигация ${(e.totalMitigation * 100).toFixed(1)}%)`);
        }
        if (est.worstEhp) {
          lines.push('', `⚠️ Слабейший слой: **${est.worstEhp.damageType}** (${Math.round(est.worstEhp.effectiveHp)} EHP)`);
        }
        if (est.weapon.weapon) {
          lines.push(
            '',
            `### Оружие: ${est.weapon.weapon} — pDPS ${est.weapon.physDps} + eDPS ${est.weapon.elementalDps} ≈ **${est.weapon.totalDps} DPS** (только предмет)`,
          );
        }
        if (Object.keys(est.pobStats).length) {
          lines.push('', '### PlayerStat из PoB (точные)');
          for (const [k, v] of Object.entries(est.pobStats)) lines.push(`- ${k}: ${v}`);
        }
        if (est.gaps.length) {
          lines.push('', '### Слабые места');
          for (const g of est.gaps) {
            lines.push(`- **[${g.severity.toFixed(1)}/10] ${g.type}** — ${g.description}`);
            lines.push(`  - Fix: ${g.recommendation}`);
          }
        }
        lines.push('', '_Примечания:_');
        for (const n of est.notes) lines.push(`- ${n}`);
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка оценки билда: ${msg}` }] };
      }
    },
  );

  // ── «Следующий апгрейд»: приоритизированный список «чини → потом» (P0-3) ──
  server.registerTool(
    'poe2_build_advice',
    {
      title: 'PoE2 Build Advice (следующий апгрейд)',
      description: `«Что чинить первым» по оценке билда. Объединяет слабые места защиты (резисты, CI-ES-пул), бюджет Spirit, DPS оружия и позицию билда по DPS/EHP относительно лeстницы того же класса. Возвращает УПОРЯДОЧЕННЫЙ список приоритетов «чини X → потом Y» с пояснением и действием для каждого пункта.

Работает по PoB share-коду или XML (PoB-движок НЕ нужен). Референс меты качается с poe.ninja live (текущая лига — forbiddenrites, если не указана).

Аргументы:
  - code (string, обяз.): PoB share-код ИЛИ готовый XML PathOfBuilding.
  - league (string, опц.): снапшот-лига для референса меты (по умолчанию forbiddenrites).
  - hit_size (number, опц.): урон за удар для брони (по умолчанию 1000).
  - accuracy (number, опц.): точность атакующего (по умолчанию 2000).

Примеры:
  - "Что апгрейдить в моём билде в первую очередь?" → вставь share-код
  - "Я CI, у меня отрицательные резисты и ES низкий" → вернёт блокеры до прокачки
`,
      inputSchema: {
        code: z.string().min(5).describe('PoB share-код или XML'),
        league: z.string().optional().describe('Снапшот-лига референса (default forbiddenrites)'),
        hit_size: z.number().int().positive().optional().describe('Ожидаемый удар (для брони)'),
        accuracy: z.number().int().positive().optional().describe('Точность атакующего'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ code, league, hit_size, accuracy }) => {
      try {
        const leagueSlug = league?.trim() ? league.trim() : 'forbiddenrites';
        const est = await core.estimate.estimateBuild(code, {
          expectedHitSize: hit_size ?? 1000,
          attackerAccuracy: accuracy ?? 2000,
        });
        const className = est.ascendancy ?? est.className;
        // Референс меты: пул лeстницы того же класса (по DPS).
        let rows: Awaited<ReturnType<typeof core.ladder.topLadderBuilds>> = [];
        if (className) {
          try {
            rows = await core.ladder.topLadderBuilds(leagueSlug, { className, sort: 'dps', limit: 100 });
          } catch {
            rows = [];
          }
        }
        const advice = core.advice.adviseBuild(est, { rows });
        return { content: [{ type: 'text', text: formatAdvice(est, advice, rows, className) }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка совета по билду: ${msg}` }] };
      }
    },
  );

  // ── Свой билд vs топ-лестница того же класса (P1) ─────────────────────────
  server.registerTool(
    'poe2_build_compare',
    {
      title: 'PoE2 Build Compare (свой билд vs топ класса)',
      description: `Сравнивает ваш билд с топ-лестницей poe.ninja того же класса в один вызов: декодирует PoB → тот же класс/асцeнданси → разница по DPS и EHP (медиана/топ пула + перцентиль пользователя), плюс скорость атаки и резисты как диагностика.

Работает по PoB share-коду или XML (PoB-движок НЕ нужен). Референс меты качается с poe.ninja live (текущая лига — forbiddenrites, если не указана).

ЧЕСТНАЯ ОГОВОРКА: DPS/EHP из poe.ninja — суммарные числа движка PoB; ваши цифры берутся из PlayerStat (если билд открывался в PoB), иначе — из приближённой геар-оценки (оружие/слои защиты). Сравнение корректно как «порядок величины», не как точный прогон.

Аргументы:
  - code (string, обяз.): PoB share-код ИЛИ готовый XML PathOfBuilding.
  - league (string, опц.): снапшот-лига референса (по умолчанию forbiddenrites).
  - hit_size (number, опц.): урон за удар для брони (по умолчанию 1000).
  - accuracy (number, опц.): точность атакующего (по умолчанию 2000).

Примеры:
  - "Сравни мой Invoker с топом класса" → вставь share-код
  - "Насколько я отстал по DPS/EHP от лучших?" → вставь share-код
`,
      inputSchema: {
        code: z.string().min(5).describe('PoB share-код или XML'),
        league: z.string().optional().describe('Снапшот-лига референса (default forbiddenrites)'),
        hit_size: z.number().int().positive().optional().describe('Ожидаемый удар (для брони)'),
        accuracy: z.number().int().positive().optional().describe('Точность атакующего'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ code, league, hit_size, accuracy }) => {
      try {
        const leagueSlug = league?.trim() ? league.trim() : 'forbiddenrites';
        const est = await core.estimate.estimateBuild(code, {
          expectedHitSize: hit_size ?? 1000,
          attackerAccuracy: accuracy ?? 2000,
        });
        const className = est.ascendancy ?? est.className;
        if (!className) {
          return {
            isError: true,
            content: [{ type: 'text', text: 'Не удалось определить класс/асцeнданси билда — сравнение с лестницей невозможно.' }],
          };
        }
        let rows: Awaited<ReturnType<typeof core.ladder.topLadderBuilds>> = [];
        try {
          rows = await core.ladder.topLadderBuilds(leagueSlug, { className, sort: 'dps', limit: 100 });
        } catch {
          rows = [];
        }
        // DPS/EHP пользователя: PlayerStat PoB точнее ⇢ fallback на геар-оценку.
        const userDps = est.pobStats.TotalDPS ?? (est.weapon.totalDps > 0 ? est.weapon.totalDps : null);
        const userEhp = est.pobStats.TotalEHP ?? (est.worstEhp ? est.worstEhp.effectiveHp : null);
        const ref = core.advice.buildReferenceFromRows(rows, {
          level: est.characterLevel ?? undefined,
          dps: userDps,
          ehp: userEhp,
          className,
        });
        return { content: [{ type: 'text', text: formatCompare(est, ref, className, leagueSlug, rows.length) }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка сравнения билда: ${msg}` }] };
      }
    },
  );

  // ── Экспорт в официальный Build Planner (*.build, schema v1) ─────────────
  server.registerTool(
    'poe2_export_build_planner',
    {
      title: 'PoE2 Export Build Planner (*.build)',
      description: `Конвертировать билд PoB в официальный формат Build Planner PoE2 (*.build, JSON schema v1) — файл можно импортировать прямо в игру (Настройки → Импорт билда).

Аргументы:
  - code (string): PoB share-код ИЛИ ссылка (pobb.in, poe.ninja/poe2/pob/...).
  - name (string, опц.): имя билда (по умолчанию «Класс — Асценданси»; игра режет ~40 символов).
  - author (string, опц.): автор.
  - link (string, опц.): ссылка-источник (попадает в link билда).
  - description (string, опц.): заметка/описание.

Возвращает: JSON-содержимое *.build в код-блоке, имя файла и предупреждения конвертации
(что НЕ попало: неизвестные скиллы/узлы, гир без клир-текста). Гир экспортируется
только из полных item-текстов (уники — по имени, рарники — additional_text).
`,
      inputSchema: {
        code: z.string().min(5).describe('PoB share-код или ссылка'),
        name: z.string().optional().describe('Имя билда'),
        author: z.string().optional().describe('Автор'),
        link: z.string().optional().describe('Ссылка-источник'),
        description: z.string().optional().describe('Описание'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ code, name, author, link, description }) => {
      try {
        const [imported, gearItems] = await Promise.all([
          core.build.importBuild(code),
          core.build.buildCodeToGear(code).catch(() => []),
        ]);
        const res = core.buildPlanner.toBuildPlanner(imported, {
          ...(name ? { name } : {}),
          ...(author ? { author } : {}),
          ...(link ? { link } : {}),
          ...(description ? { description } : {}),
          ...(gearItems.length ? { gearItems } : {}),
        });
        const lines = [
          `## *.build экспорт — ${res.filename}`,
          '',
          ...res.warnings.map((w) => `- ⚠ ${w}`),
          ...(res.warnings.length ? [''] : []),
          '```json',
          res.json,
          '```',
          '',
          `_Сохранить как «${res.filename}» (UTF-8) и импортировать в игре. Формат: pathofexile.com/developer/docs/game#buildplanner._`,
        ];
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка экспорта: ${msg}` }] };
      }
    },
  );

  return 7;
}

/** Отформатировать сравнение с топ-лестницей класса (P1) в читаемый markdown. */
function formatCompare(
  est: BuildEstimate,
  ref: Awaited<ReturnType<typeof core.advice.buildReferenceFromRows>>,
  className: string,
  leagueSlug: string,
  poolSize: number,
): string {
  const d = est.defenses;
  const out: (string | null)[] = [
    `## Сравнение с топ-лестницей класса: **${className}**`,
    `- Референс: **${leagueSlug}**, ${poolSize} строк ${className} (сортировка по DPS).`,
    '',
    `### Ваш билд (${est.source === 'pob+gear' ? 'гир + PlayerStat PoB' : 'только гир'})`,
    `- Персонаж: **${est.className ?? '?'}${est.ascendancy ? ` / ${est.ascendancy}` : ''}**, уровень ${est.characterLevel ?? '?'}`,
  ];

  // DPS / EHP с пометкой источника.
  const userDps = est.pobStats.TotalDPS ?? (est.weapon.totalDps > 0 ? est.weapon.totalDps : null);
  const dpsSrc = est.pobStats.TotalDPS !== undefined ? 'движок PoB' : 'геар-оценка (только оружие)';
  const userEhp = est.pobStats.TotalEHP ?? (est.worstEhp ? est.worstEhp.effectiveHp : null);
  const ehpSrc = est.pobStats.TotalEHP !== undefined ? 'движок PoB' : 'геар-оценка (слабейший тип)';
  out.push(`- **DPS:** ${userDps != null ? core.advice.fmtSuffix(userDps) : '—'} (${dpsSrc})`);
  out.push(`- **EHP:** ${userEhp != null ? core.advice.fmtSuffix(userEhp) : '—'} (${ehpSrc})`);
  out.push(
    `- **Скорость атаки:** ${est.weapon.attacksPerSecond ? `${est.weapon.attacksPerSecond.toFixed(2)} aps` : '—'} (${est.weapon.weapon ?? 'оружие не распознано'})`,
  );
  out.push(
    `- **Резисты:** fire ${d.fireRes}% / cold ${d.coldRes}% / lightning ${d.lightningRes}% / chaos ${d.chaosRes}% (кап 75%)`,
  );

  out.push('', '### Позиция на лестнице (перцентиль, vs медиана/топ)');
  if (ref.dpsPercentile != null && userDps != null) {
    out.push(`- DPS ${core.advice.fmtSuffix(userDps)} → **~${ref.dpsPercentile.toFixed(0)}-й перцентиль** (медиана ${core.advice.fmtSuffix(ref.medianDps)}, топ ${core.advice.fmtSuffix(ref.topDps)})`);
  } else {
    out.push('- DPS: пул лестницы или оценка недоступны.');
  }
  if (ref.ehpPercentile != null && userEhp != null) {
    out.push(`- EHP ${core.advice.fmtSuffix(userEhp)} → **~${ref.ehpPercentile.toFixed(0)}-й перцентиль** (медиана ${core.advice.fmtSuffix(ref.medianEhp)}, топ ${core.advice.fmtSuffix(ref.topEhp)})`);
  } else {
    out.push('- EHP: пул лестницы или оценка недоступны.');
  }

  out.push('', '### Сводка против меты');
  // DPS-вердикт.
  if (userDps != null && ref.topDps != null && ref.topDps > 0) {
    const ratio = userDps / ref.topDps;
    out.push(
      ratio >= 0.9
        ? `- **DPS:** ваш урон (${
            core.advice.fmtSuffix(userDps)
          }) ≈ уровень топ-1 класса → ${ratio >= 1 ? 'впереди/на уровне топа' : 'почти вплотную к топу'}.`
        : `- **DPS:** ваш урон (${core.advice.fmtSuffix(userDps)}) в **${(ref.topDps / userDps).toFixed(1)}× ниже** топ-1 (${core.advice.fmtSuffix(ref.topDps)}).`,
    );
  } else if (userDps != null) {
    out.push(`- **DPS:** ${core.advice.fmtSuffix(userDps)} (оценка без пула меты).`);
  }
  // EHP-вердикт.
  if (userEhp != null && ref.topEhp != null && ref.topEhp > 0) {
    const ratio = userEhp / ref.topEhp;
    out.push(
      ratio >= 0.9
        ? `- **EHP:** ваша защита (${core.advice.fmtSuffix(userEhp)}) на уровне топ-1 класса.`
        : `- **EHP:** ваша защита (${core.advice.fmtSuffix(userEhp)}) в **${(ref.topEhp / userEhp).toFixed(1)}× ниже** топ-1 (${core.advice.fmtSuffix(ref.topEhp)}).`,
    );
  } else if (userEhp != null) {
    out.push(`- **EHP:** ${core.advice.fmtSuffix(userEhp)} (оценка без пула меты).`);
  }
  // Резисты-вердикт.
  const minRes = Math.min(d.fireRes, d.coldRes, d.lightningRes, d.chaosRes);
  out.push(
    d.fireRes < 75 || d.coldRes < 75 || d.lightningRes < 75
      ? `- **Резисты:** есть ниже капа 75% (хуже всего ${minRes.toFixed(0)}%) — чинить в первую очередь.`
      : `- **Резисты:** все ≥ 75% (кап) — ок.`,
  );

  out.push(
    '',
    '_Сравнение «порядка величины»: poe.ninja даёт суммарные числа движка, ваши — как указано выше (PlayerStat точнее геар-оценки). Для точных перцентилей лучше открыть билд в PoB._',
  );
  return out.filter((l): l is string => l != null).join('\n');
}

/** Отформатировать совет P0-3 в читаемый markdown. */
function formatAdvice(
  est: BuildEstimate,
  advice: BuildAdvice,
  rows: LadderRow[],
  className: string | null,
): string {
  const out: (string | null)[] = ['## «Следующий апгрейд» — приоритеты', ''];
  out.push(`- Персонаж: **${est.className ?? '?'}${est.ascendancy ? ` / ${est.ascendancy}` : ''}**, уровень ${est.characterLevel ?? '?'}, источник: ${est.source === 'pob+gear' ? 'гир + PlayerStat PoB' : 'только гир'}`);
  out.push(`- **Диагноз:** ${advice.classification}`);
  out.push(`- **Итог:** ${advice.summary}`);
  if (rows.length && className) {
    const ref = core.advice.buildReferenceFromRows(rows, {
      dps: est.pobStats.TotalDPS ?? undefined,
      ehp: est.pobStats.TotalEHP ?? undefined,
      className,
    });
    out.push(
      `- Референс меты: **${ref.poolSize}** строк ${className} (медиана DPS ${core.advice.fmtSuffix(ref.medianDps)}, топ ${core.advice.fmtSuffix(ref.topDps)}; EHP ${core.advice.fmtSuffix(ref.medianEhp)}/${core.advice.fmtSuffix(ref.topEhp)})`,
    );
  }
  if (!advice.priorities.length) {
    out.push('', 'Серьёзных проблем не найдено — осталась полировка.', '');
  } else {
    out.push('', '### Порядок «чини → потом»');
    for (let i = 0; i < advice.priorities.length; i++) {
      const p = advice.priorities[i]!;
      out.push(
        `**${i + 1}. [${p.priority}] ${p.title}** — ${p.detail}`,
        `   - Почему: ${p.reason}`,
        `   - Что делать: ${p.action}`,
        p.reference ? `   - Сравнение: ${p.reference}` : null,
      );
    }
    out.push('', '_Чини блокеры → потом высокий → средний → низкий приоритет._');
  }
  return out.filter((l): l is string => l != null).join('\n');
}