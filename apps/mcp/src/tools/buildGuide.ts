/**
 * MCP-инструмент: `poe2_build_guide` — заготовка (скелет) гайда по шаблону
 * для конкретного билда. Заполняет проверяемые данные (класс/асценданси,
 * карточка DPS/EHP, сокеты-линки, защиты/EHP-слои, оружие, мета-позиция,
 * приоритеты `poe2_build_advice`), остальные секции оставляет как заглушки
 * «< … >» для ручной правки. Эталон секций — `docs/guide_ice_strike_invoker_ci.md`;
 * формулы — `docs/POB2_CALC_FORMULAS.md`.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { core } from '@poe2-kit/core';
import type { BuildImport, BuildEstimate, LadderRow, BuildSkillGroup } from '@poe2-kit/core';

/** Гем «Имя Lxx q20». */
function gemLabel(g: { name: string; level: number | null; quality: number | null }): string {
  const lvl = g.level != null ? ` L${g.level}` : '';
  const q = g.quality ? ` q${g.quality}` : '';
  return `${g.name}${lvl}${q}`;
}

/** Карточка билда (секция 1). */
function cardRows(b: BuildImport, est: BuildEstimate, crit: string): string[] {
  const rows: string[] = [];
  rows.push(`| Класс / Аскендация | **${b.class ?? '?'}${b.ascendancy ? ` / ${b.ascendancy}` : ''}** |`);
  const mainGroup = b.skillGroups?.find((g) => g.main) ?? b.skillGroups?.[0];
  rows.push(
    `| Основной скилл | **${mainGroup?.gems[0]?.name ?? b.skills[0] ?? '—'}**` +
      (mainGroup && mainGroup.gems.length > 1 ? ` + ${mainGroup.gems.length - 1} саппорт(а)` : '') +
      ' |',
  );
  rows.push(`| Уровень | ${est.characterLevel ?? b.level ?? '—'} (экспорт) |`);

  const totalDps = est.pobStats.TotalDPS ?? (est.weapon.totalDps > 0 ? est.weapon.totalDps : null);
  const totalEhp = est.pobStats.TotalEHP ?? est.worstEhp?.effectiveHp ?? null;
  const dpsSrc = est.pobStats.TotalDPS !== undefined ? 'движок PoB' : 'геар-оценка';
  const ehpSrc = est.pobStats.TotalEHP !== undefined ? 'движок PoB' : 'оценка (слабейший тип)';
  rows.push(`| Total DPS | **${totalDps != null ? core.advice.fmtSuffix(totalDps) : '—'}** (${dpsSrc}) |`);
  rows.push(`| Total EHP | **${totalEhp != null ? core.advice.fmtSuffix(totalEhp) : '—'}** (${ehpSrc}) |`);
  if (crit) rows.push(`| Крит | ${crit} |`);
  rows.push(`| Дерево | treeVersion \`${b.treeVersion ?? '?'}\` |`);
  return rows;
}

/** Секция 3: сокеты — все включённые группы <Skill>. */
function socketsSection(groups: BuildSkillGroup[]): string {
  if (!groups.length) {
    return '> Группы камней в декоде не распознаны. Укажи связки вручную.';
  }
  const out: string[] = ['| Роль | Гемы (уровень) | Поддержки |', '|---|---|---|'];
  for (const g of groups) {
    const [active, ...sup] = g.gems;
    const role = g.main
      ? 'Основной урон'
      : g.source?.startsWith('Tree:') || g.source === 'Default Attack'
        ? g.label || g.source
        : `${g.label || '—'}${g.source && !/^Item:/i.test(g.source) ? ` (${g.source})` : ''}` || '—';
    out.push(
      `| **${role}** | ${active ? gemLabel(active) : '—'} | ${sup.length ? sup.map(gemLabel).join(', ') : '—'} |`,
    );
  }
  return out.join('\n');
}

/** Собрать скелет гайда (9 секций). */
function formatGuide(
  b: BuildImport,
  est: BuildEstimate,
  className: string | null,
  leagueSlug: string,
  advice: Awaited<ReturnType<typeof core.advice.adviseBuild>>,
  ref: Awaited<ReturnType<typeof core.advice.buildReferenceFromRows>> | null,
): string {
  const d = est.defenses;
  const groups = b.skillGroups?.filter((g) => g.enabled) ?? [];
  const mainSkill = groups.find((g) => g.main)?.gems[0]?.name ?? b.skills[0] ?? 'основной скилл';
  const title = b.ascendancy ?? b.class ?? 'PoE2 билд';

  let crit = '';
  if (est.pobStats.CritChance != null || est.pobStats.CritMultiplier != null) {
    crit = [
      est.pobStats.CritChance != null ? `шанс **${est.pobStats.CritChance}%**` : null,
      est.pobStats.CritMultiplier != null ? `мультипликатор **×${est.pobStats.CritMultiplier}**` : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  const out: (string | null)[] = [
    `# ${mainSkill} (${title}) — гайд`,
    '',
    `> **Скелет гайда**, сгенерирован \`poe2_build_guide\`. Проверяемые данные подставлены из билда,`,
    `> лeстницы \`${leagueSlug}\` и \`poe2_build_advice\`; фрагменты в **«< … >»** — для ручной правки и проверки фактов.`,
    `> Формулы — \`docs/POB2_CALC_FORMULAS.md\`. Проверка варианта: \`poe2_build_advice\`, \`poe2_build_estimate\`, \`poe2_skill_meta\`, \`poe2_spirit\`, \`poe2_ehp\`.`,
    '',
    '---',
    '',
    '## 1. Обзор и карточка билда',
    '',
    '| Параметр | Значение |',
    '|---|---|',
    ...cardRows(b, est, crit),
  ];

  if (ref && (ref.dpsPercentile != null || ref.ehpPercentile != null)) {
    out.push(
      '',
      '**Мета-позиция** (пул ' + `${ref.poolSize} ${className}, лига \`${leagueSlug}\`):`,
      '',
      '| Метрика | Твой билд | Медиана пула | Топ пула | Перцентиль |',
      '|---|---|---|---|---|',
    );
    const userDps = est.pobStats.TotalDPS ?? (est.weapon.totalDps > 0 ? est.weapon.totalDps : null);
    const userEhp = est.pobStats.TotalEHP ?? est.worstEhp?.effectiveHp ?? null;
    out.push(
      `| DPS | ${core.advice.fmtSuffix(userDps)} | ${core.advice.fmtSuffix(ref.medianDps)} | ${core.advice.fmtSuffix(ref.topDps)} | ${ref.dpsPercentile != null ? `**${ref.dpsPercentile.toFixed(0)}-й**` : '—'} |`,
      `| EHP | ${core.advice.fmtSuffix(userEhp)} | ${core.advice.fmtSuffix(ref.medianEhp)} | ${core.advice.fmtSuffix(ref.topEhp)} | ${ref.ehpPercentile != null ? `**${ref.ehpPercentile.toFixed(0)}-й**` : '—'} |`,
    );
  }

  const buffLine = b.buffs && (b.buffs.buffList.length || b.buffs.curseList.length)
    ? `Бафы: ${b.buffs.buffList.join(', ') || '—'} · Проклятия: ${b.buffs.curseList.join(', ') || '—'}`
    : '(нет данных о бафах/проклятиях в декоде)';

  out.push(
    '',
    '---',
    '',
    `## 2. Механика ${mainSkill} и комбо`,
    '',
    '> **< Ручная правка >** Опиши конверсии/характер скилла (напр. «конвертирует ~X% физики в холод»),',
    '> третий удар/АоЕ, комбо-бёрсты, ауры/проклятия из §3. Факты сверяй через `poe2_wiki_lookup` / `poe2_poe2db_lookup`.',
    '',
    `> ${buffLine}`,
    '',
    '---',
    '',
    '## 3. Сокеты: полный набор гемов',
    '',
    `Связки из декода (${groups.length} групп). Главная — **${mainSkill}**:`,
    '',
    socketsSection(groups),
    '',
    '> **< Ручная правка >** Обозначь приоритет апгрейда линков (главная связка + бёрст-камни).',
    '',
    '---',
    '',
    '## 4. Дерево пассивок и ключевые переходы',
    '',
  );

  // Версия дерева + сверка патча.
  const vchk = core.dataset.checkTreeVersion(b.treeVersion);
  if (vchk.status === 'current') {
    out.push(`- **Версия дерева (treeVersion):** ${vchk.treeVersion} — актуальна (патч датасета ${vchk.datasetPatch}).`, '');
  } else if (vchk.status !== 'missing') {
    out.push(`- **Версия дерева (treeVersion):** ${vchk.treeVersion}`, `- ${vchk.message}`, '');
  }
  // Узлы: keystone/notable с именами.
  if (b.passiveNodes.length) {
    const report = core.dataset.resolvePassiveNodes(b.passiveNodes);
    const all = report.resolved;
    const keystones = all.filter((n) => n.isKeystone);
    const notables = all.filter((n) => n.isNotable && !n.isKeystone);
    out.push(`- Узлов: **${report.requested}** (распознано ${all.length}: keystone ${keystones.length} · notable ${notables.length} · малых ${all.length - keystones.length - notables.length})`, '');
    for (const n of [...keystones, ...notables]) {
      const src = n.source === 'ascendancy' && n.ascendancy ? ` (${n.ascendancy})` : '';
      out.push(`- ${n.isKeystone ? '🔑' : '★'} **${n.name}**${src}: ${n.stats.join('; ')}`);
    }
    if (report.missing.length) {
      out.push(`- ⚠ Не распознано (${report.missing.length}): ${report.missing.slice(0, 20).join(', ')}${report.missing.length > 20 ? '…' : ''}`);
    }
  }
  out.push(
    '',
    '> **< Ручная правка >** Опиши ветки дерева (ядро/мультикласс), порог, когда включать CI или иной переход.',
    '',
    '---',
    '',
    '## 5. Ключевые статы: жизнь / энергосщит и пороги',
    '',
    `- Защиты из гира: жизнь **${Math.round(d.life)}**, ES ${Math.round(d.energyShield)}, броня ${Math.round(d.armour)}, уклонение ${Math.round(d.evasion)}, блок ${d.blockChance}%.`,
    `- Резисты: fire **${d.fireRes}%** / cold **${d.coldRes}%** / lightning **${d.lightningRes}%** / chaos **${d.chaosRes}%** (кап 75%).`,
    '',
    '> **< Ручная правка >** Укажи целевые пороги (напр. для CI — комфортный ES-пул к началу карт; для обычного билда — минимум жизни).',
    '',
    '---',
    '',
    '## 6. Spirit: резервация и бюджет',
    '',
    '> **< Ручная правка >** Данные резервации Spirit в декоде PoB отсутствуют.',
    '> Проверь бюджет через `poe2_spirit`: подставь источники Spirit (гир/дерево) и резервирующие ауры/проклятия из §3;',
    '> цель — держать `SpiritUnreserved ≥ 0`, в идеале с буфером (≥ 25).',
    '',
    '---',
    '',
    '## 7. Защита и EHP: слои',
    '',
  );

  const ehpTypes = Object.keys(est.ehp) as Array<keyof typeof est.ehp>;
  for (const t of ehpTypes) {
    const e = est.ehp[t];
    out.push(`- ${t}: **${e.effectiveHp === Infinity ? '∞' : Math.round(e.effectiveHp)}** (митигация ${(e.totalMitigation * 100).toFixed(1)}%)`);
  }
  if (est.worstEhp) {
    out.push('', `⚠️ Слабейший слой: **${est.worstEhp.damageType}** (${Math.round(est.worstEhp.effectiveHp)} EHP).`);
  }
  out.push(
    '',
    '> **< Ручная правка >** Опиши слои: сколько фактических слоёв защиты, чем закрыть слабейший.',
    '> Мнемоника PoE2: слои *перемножаются* (\`docs/POB2_CALC_FORMULAS.md\` §1).',
    '',
    '---',
    '',
    '## 8. Урон: крит, оружие, линки',
    '',
  );
  if (est.weapon.weapon) {
    out.push(
      `- **Оружие:** ${est.weapon.weapon} — pDPS ${est.weapon.physDps} + eDPS ${est.weapon.elementalDps} ≈ **${est.weapon.totalDps} DPS**${est.weapon.attacksPerSecond != null ? `, ${est.weapon.attacksPerSecond.toFixed(2)} aps` : ''} (только предмет).`,
    );
  } else {
    out.push('- **Оружие:** не распознано (укажи pDPS/eDPS вручную).');
  }
  out.push(
    crit ? `- **Крит:** ${crit}.` : '- **Крит:** **< Ручная правка >** (нет PlayerStat; проверь в PoB или оцени по гиру).',
    '- Линки: главная связка и бёрст-камни — см. §3.',
    '',
    '> **< Ручная правка >** Приоритет апгрейда урона: оружие (pDPS ориентир), качество/уровни гемов, крит-мультипликатор.',
    '',
    '---',
    '',
    '## 9. Мета-позиция и план «что апгрейдить»',
    '',
    `**Диагноз:** ${advice.classification}.`,
    `**Итог:** ${advice.summary}.`,
    '',
  );

  if (advice.priorities.length) {
    out.push('**Порядок «чини → потом»:**');
    for (let i = 0; i < advice.priorities.length; i++) {
      const p = advice.priorities[i]!;
      out.push(
        `${i + 1}. **[${p.priority}] ${p.title}** — ${p.detail}`,
        `   - Почему: ${p.reason}`,
        `   - Что делать: ${p.action}`,
        p.reference ? `   - Сравнение: ${p.reference}` : null,
      );
    }
    out.push('', '_Чини блокеры → потом высокий → средний → низкий приоритет._');
  } else {
    out.push('Серьёзных проблем не найдено — осталась полировка.');
  }
  if (ref && ref.poolSize) {
    out.push(
      '',
      `Фон меты (пул ${ref.poolSize} ${className}): перцентиль DPS ` +
        `${ref.dpsPercentile != null ? `**~${ref.dpsPercentile.toFixed(0)}-й**` : '—'} / EHP ` +
        `${ref.ehpPercentile != null ? `**~${ref.ehpPercentile.toFixed(0)}-й**` : '—'}. ` +
        'Чтобы уйти в топ класса — см. §8 (урон) и §7 (слои защиты).',
    );
  }
  out.push(
    '',
    '**Чек-лист «под ключ»**',
    '> **< Ручная правка >** Перенеси из §6/§7/§8 конкретные actionable-пункты и отметь выполненные.',
    '',
    '---',
    '',
    `*Скелет сгенерирован \`poe2_build_guide\` (${leagueSlug}). Проверяй свой вариант \`poe2_build_estimate\` / \`poe2_build_advice\` / \`poe2_ladder_top\`.*`,
  );

  return out.filter((l): l is string => l !== null && l !== undefined).join('\n');
}

/** Регистрация тула `poe2_build_guide`. Возвращает число добавленных инструментов (1). */
export function registerBuildGuideTools(server: McpServer): number {
  server.registerTool(
    'poe2_build_guide',
    {
      title: 'PoE2 Build Guide (skeleton)',
      description: `Скелет гайда по билду PoE2 по шаблону (9 секций) из проверенных данных: карточка (класс/аскендация, осн. скилл, уровень, TotalDPS/TotalEHP, крит, treeVersion), мета-позиция vs лестница класса, полный набор гемов-связок, дерево пассивок, защиты/EHP по типам, слабое место, оружие/DPS, приоритеты «что апгрейдить». Секции-повествование (механика, комбо, переход, пороги, Spirit) — заглушки «< … >» для ручной правки.

Аргументы:
  - code (string, обяз.): PoB share-код ИЛИ готовый XML PathOfBuilding.
  - league (string, опц.): снапшот-лига poe.ninja для мета-референса (по умолчанию forbiddenrites).
  - hit_size (number, опц.): урон за удар для брони (по умолчанию 1000).
  - accuracy (number, опц.): точность атакующего (по умолчанию 2000).

Примеры:
  - "Сгенерируй скелет гайда по моему билду" → вставь share-код
  - "Заготовка гайда для моего Invoker" → вставь код + league=forbiddenrites
`,
      inputSchema: {
        code: z.string().min(5).describe('PoB share-код или XML'),
        league: z.string().optional().describe('Снапшот-лига poe.ninja (default forbiddenrites)'),
        hit_size: z.number().int().positive().optional().describe('Ожидаемый удар (для брони)'),
        accuracy: z.number().int().positive().optional().describe('Точность атакующего'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ code, league, hit_size, accuracy }) => {
      try {
        // Декодируем билд (share-код → XML → структура) для гемов/дерева.
        const xml = code.includes('<PathOfBuilding') ? code : core.build.decodeShareCode(code);
        const b = await core.build.importBuild(xml);
        // Оценка EHP/DPS/защит/оружия (без PoB-движка).
        const est = await core.estimate.estimateBuild(code, {
          expectedHitSize: hit_size ?? 1000,
          attackerAccuracy: accuracy ?? 2000,
        });
        const className = est.ascendancy ?? est.className;
        const leagueSlug = league?.trim() ? league.trim() : 'forbiddenrites';
        // Референс меты: пул лестницы того же класса (по DPS).
        let rows: LadderRow[] = [];
        if (className) {
          try {
            rows = await core.ladder.topLadderBuilds(leagueSlug, { className, sort: 'dps', limit: 100 });
          } catch {
            rows = [];
          }
        }
        const advice = core.advice.adviseBuild(est, { rows });
        const ref = className
          ? core.advice.buildReferenceFromRows(rows, {
              level: est.characterLevel ?? undefined,
              dps: est.pobStats.TotalDPS ?? undefined,
              ehp: est.pobStats.TotalEHP ?? undefined,
              className,
            })
          : null;
        const text = formatGuide(b, est, className, leagueSlug, advice, ref);
        return { content: [{ type: 'text', text }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Ошибка генерации гайда: ${msg}` }] };
      }
    },
  );

  return 1;
}