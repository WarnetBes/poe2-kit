#!/usr/bin/env node
// install-agent.mjs — интеграция экосистемы агентов PoE2 Kit в OpenCode.
//
// Что делает:
//   1. Копирует агентов (poe2-kit.md / poe2-builder.md / poe2-trader.md) из
//      integrations/opencode/agents/ этого репозитория в ~/.config/opencode/agents/
//      (или в папку проекта --project → <cwd>/.opencode/agents/).
//   2. Кладёт тонкий скилл-шорткат poe2-kit (SKILL.md со ссылкой на живые
//      агенты-источники) в skills-папку — для вызова из любой сессии.
//   3. (--with-mcp) Проверит/добавит MCP-запись "poe2-kit" в opencode.json
//      (глобальный конфиг), если её там нет. Существовавший конфиг
//      перезаписи не видит: бэкап opencode.json.bak-<stamp> + только допись
//      ключа mcp["poe2-kit"].
//
// Идемпотентно: повторный запуск = обновление файлов (переустановка агентов
// после правок). Чужие одноимённые файлы НЕ трогает без --force.
//
// Usage:
//   node integrations/opencode/install-agent.mjs            # глобально (user)
//   node integrations/opencode/install-agent.mjs --project  # в текущий проект
//   node integrations/opencode/install-agent.mjs --with-mcp # + MCP-запись
//   node integrations/opencode/install-agent.mjs --dry-run  # только план
//   node integrations/opencode/install-agent.mjs --force    # перезаписать чужие
//
// --force перезаписывает файлы-конфликты; их содержимое печатается в отчёте,
// чтобы потерю кастомных правок можно было восстановить руками.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, copyFileSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')
const SRC_AGENTS = join(HERE, 'agents')
const SRC_SKILL = join(HERE, 'skill', 'SKILL.md')

const AGENT_FILES = ['poe2-kit.md', 'poe2-builder.md', 'poe2-trader.md']
const SKILL_NAME = 'poe2-kit'
const MARKER = '<!-- poe2-kit:managed -->'

const args = process.argv.slice(2)
const flags = {
  project: args.includes('--project'),
  withMcp: args.includes('--with-mcp'),
  dryRun: args.includes('--dry-run'),
  force: args.includes('--force'),
}

function configRoot() {
  return flags.project ? join(process.cwd(), '.opencode') : join(homedir(), '.config', 'opencode')
}

function readUtf8(p) {
  return readFileSync(p, 'utf8').replace(/^\uFEFF/, '')
}

function isManaged(content) {
  return content.includes(MARKER)
}

// Вставка маркера сразу после YAML-frontmatter (или в начало, если его нет).
// Формат markdown-комментария: безвреден для парсера frontmatter.
function withMarker(text) {
  const m = /^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/.exec(text)
  const note = MARKER + '\n'
  if (!m) return note + text
  const nl = m[1] && m[1].startsWith('\r\n') ? '\r\n' : '\n'
  return m[0] + note + text.slice(m[0].length)
}

function stamp() {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
}

const plan = []   // {file, action: 'create'|'update'|'skip'|'conflict', reason}
const report = []

function planCopy(src, dest) {
  if (!existsSync(src)) {
    plan.push({ file: dest, action: 'skip', reason: `нет источника ${src}` })
    return
  }
  const srcTextRaw = readUtf8(src)
  const srcText = withMarker(srcTextRaw) // идемпотентно: повторный вызов не удваивает
  if (!existsSync(dest)) {
    plan.push({ file: dest, action: 'create', src, srcText })
  } else {
    const cur = readUtf8(dest)
    if (cur === srcText) {
      plan.push({ file: dest, action: 'skip', reason: 'уже актуально' })
    } else if (isManaged(cur)) {
      plan.push({ file: dest, action: 'update', src, srcText })
    } else {
      plan.push({ file: dest, action: 'conflict', src, srcText, curText: cur })
    }
  }
}

function applyCopy(item) {
  mkdirSync(dirname(item.file), { recursive: true })
  writeFileSync(item.file, item.srcText, 'utf8')
}

// ── 1. Агенты ────────────────────────────────────────────────────────────────
const root = configRoot()
const agentsDest = join(root, 'agents')
const skillDest = join(root, 'skills', SKILL_NAME, 'SKILL.md')

for (const f of AGENT_FILES) planCopy(join(SRC_AGENTS, f), join(agentsDest, f))
planCopy(SRC_SKILL, skillDest)

// ── 2. MCP-запись (опция) ────────────────────────────────────────────────────
let mcpPlan = null
if (flags.withMcp) {
  const cfgPath = flags.project ? join(process.cwd(), 'opencode.json') : join(root, 'opencode.json')
  const entry = {
    type: 'local',
    command: ['node', 'dist/index.js'],
    cwd: join(REPO_ROOT, 'apps', 'mcp').replace(/\\/g, '/'),
    enabled: true,
  }
  if (!existsSync(cfgPath)) {
    mcpPlan = { cfgPath, action: 'create', entry }
  } else {
    let cfg
    try {
      cfg = JSON.parse(readUtf8(cfgPath))
    } catch (e) {
      mcpPlan = { cfgPath, action: 'error', reason: `opencode.json не парсится (${e.message}) — не трогаем, добавьте mcp.poe2-kit руками` }
    }
    if (cfg) {
      const cur = cfg.mcp && cfg.mcp['poe2-kit']
      if (cur && JSON.stringify(cur) === JSON.stringify(entry)) {
        mcpPlan = { cfgPath, action: 'skip', reason: 'MCP poe2-kit уже на месте' }
      } else if (cur && typeof cur.command === 'object' && cur.command.join(' ') === entry.command.join(' ')) {
        // Совпадает команда — значит сервер подключён, а cwd/прочее отличается
        // лишь вариантом написания пути (слэши/регистр). Не конфликт.
        mcpPlan = { cfgPath, action: 'skip', reason: 'MCP poe2-kit уже подключён (отличается написание пути — не трогаем)' }
      } else if (cur) {
        mcpPlan = { cfgPath, action: 'conflict-mcp', cur, entry }
      } else {
        mcpPlan = { cfgPath, action: 'add', cfg, entry }
      }
    }
  }
}

// ── Отчёт плана / применение ─────────────────────────────────────────────────
const conflictsPlanned = plan.filter((it) => it.action === 'conflict').length
function describe(it) {
  switch (it.action) {
    case 'create': return `+ создам   ${it.file}`
    case 'update': return `~ обновлю  ${it.file}`
    case 'skip': return `= без изменений  ${it.file} (${it.reason})`
    case 'conflict': return `! КОНФЛИКТ ${it.file} — чужой файл (не наш); --force перезапишет`
    default: return `? ${it.action} ${it.file}`
  }
}

console.log('PoE2 Kit → OpenCode: установка агентов')
console.log(`  репозиторий: ${REPO_ROOT}`)
console.log(`  цель:        ${root}${flags.project ? '  (проект)' : '  (глобально)'}`)
if (flags.dryRun) console.log('  режим:       --dry-run (ничего не пишем)')
console.log('')
for (const it of plan) console.log('  ' + describe(it))
if (mcpPlan) console.log(`  mcp: ${mcpPlan.action} → ${mcpPlan.cfgPath}${mcpPlan.reason ? ' (' + mcpPlan.reason + ')' : ''}`)

if (flags.dryRun) {
  console.log('\ndry-run завершён.')
  process.exit(0)
}

let changed = 0
let conflictsLeft = 0
for (const it of plan) {
  if (it.action === 'create' || it.action === 'update' || (it.action === 'conflict' && flags.force)) {
    if (it.action === 'conflict') {
      console.log(`\n[!] перезаписываю чужой файл ${it.file}; его предыдущее содержимое (первые 40 строк):`)
      console.log(it.curText.split(/\r?\n/).slice(0, 40).map((l) => '    | ' + l).join('\n'))
    }
    applyCopy(it)
    changed++
    report.push(it.file)
  } else if (it.action === 'conflict') {
    conflictsLeft++
  }
}

// MCP: допись ключа (существующий конфиг — только допись + бэкап)
if (mcpPlan && (mcpPlan.action === 'create' || mcpPlan.action === 'add')) {
  mkdirSync(dirname(mcpPlan.cfgPath), { recursive: true })
  let out
  if (mcpPlan.action === 'create') {
    out = { $schema: 'https://opencode.ai/config.json', mcp: { 'poe2-kit': mcpPlan.entry } }
  } else {
    const cfg = mcpPlan.cfg
    if (typeof cfg.$schema === 'string' && !cfg.$schema) delete cfg.$schema
    cfg.mcp = cfg.mcp || {}
    cfg.mcp['poe2-kit'] = mcpPlan.entry
    out = cfg
    const bak = `${mcpPlan.cfgPath}.bak-${stamp()}`
    renameSync(mcpPlan.cfgPath, bak)
    console.log(`\n  backup: ${bak}`)
  }
  writeFileSync(mcpPlan.cfgPath, JSON.stringify(out, null, 2) + '\n', 'utf8')
  console.log(`  mcp.poe2-kit записан в ${mcpPlan.cfgPath}`)
  changed++
} else if (mcpPlan && mcpPlan.action === 'conflict-mcp') {
  console.log('\n[!] MCP poe2-kit уже существует с другим содержимым — НЕ трогаю:')
  console.log('    текущее: ' + JSON.stringify(mcpPlan.cur))
  console.log('    желаемое: ' + JSON.stringify(mcpPlan.entry))
} else if (mcpPlan && mcpPlan.action === 'error') {
  console.log('\n[!] ' + mcpPlan.reason)
}

console.log('')
if (changed > 0) console.log(`Готово: обновлено ${changed}. OpenCode подхватывает файлы без рестарта (hot-reload; форс — /reload).`)
else console.log('Ничего не изменилось (всё актуально).')
if (conflictsLeft > 0) {
  console.log(`Внимание: конфликтов ${conflictsLeft} — чужие файлы не перезаписаны (см. выше), для замены нужен --force.`)
  process.exit(2)
}
console.log('')
console.log('Проверка: opencode agent list | должен показать poe2-kit (primary), poe2-builder, poe2-trader.')
