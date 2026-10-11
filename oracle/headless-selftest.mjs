// Headless-хост selftest (Фаза 4: CI-job oracle-headless, Linux/Windows).
// One-shot: все RPC пишутся в stdin ДО старта движка (принцип №460),
// ответы читаются построчно. Билд НЕ нужен — new_build() даёт дефолтный.
//
// Запуск:
//   node oracle/headless-selftest.mjs <pob2>/src [luajit]
//   (luajit по умолчанию: oracle/bin/luajit.exe, если есть, иначе PATH — CI-куб)
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pobSrc = process.argv[2];
const defaultWin = join(here, 'bin', 'luajit.exe');
const luajit = process.argv[3] ?? (existsSync(defaultWin) ? defaultWin : 'luajit');
if (!pobSrc || !existsSync(pobSrc)) {
  console.error('[selftest] укажи каталог src клона PathOfBuilding-PoE2: node oracle/headless-selftest.mjs <pob2>/src');
  process.exit(2);
}
const hostLua = join(here, 'headless', 'pob_host.lua');

const requests = [
  { id: 1, method: 'ping', params: {} },
  { id: 2, method: 'new_build', params: { keys: ['Life', 'TotalDPS', 'Level'] } },
  {
    id: 3, method: 'whatif', params: {
      keys: ['Life', 'TotalDPS'],
      scenarios: [
        { name: 'lvl50', level: 50 },
        { name: 'chaos75', config: { enemyChaosResist: 75 } },
        { name: 'badenum', config: { enemyIsBoss: 'NotABoss' } },
      ],
    },
  },
  { id: 4, method: 'stats', params: { keys: ['Life', 'TotalDPS'] } },
];

const child = spawn(luajit, [hostLua], {
  cwd: pobSrc,
  env: {
    ...process.env,
    CI: 'true',
    LUA_PATH: './?.lua;./?/init.lua;../runtime/lua/?.lua;../runtime/lua/?/init.lua',
    LUA_CPATH: join(pobSrc, '..', 'runtime') + '/?.dll',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});
let stderrTail = '';
child.stderr.on('data', (c) => { stderrTail = (stderrTail + String(c)).slice(-400); });
let buf = '';
const frames = new Map();
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line.startsWith('{')) continue;
    try {
      const f = JSON.parse(line);
      if (f.id != null) frames.set(f.id, f);
      else frames.set('startup', f);
    } catch { /* мусор мимо протокола */ }
  }
});

// one-shot (принцип №460): весь пакет пишется ДО старта движка, stdin закрывается
child.stdin.write(requests.map((q) => JSON.stringify(q)).join('\n') + '\n');
child.stdin.end();

const exitCode = await new Promise((resolve) => child.on('exit', resolve));
console.log(`[selftest] luajit exit=${exitCode} (движок отработал one-shot и завершился — это норма)`);if (exitCode !== 0) {
  console.error('[selftest] FAIL: движок упал:', stderrTail.trim());
  process.exit(1);
}

const startup = frames.get('startup');
const ping = frames.get(1);
const nb = frames.get(2);
const wi = frames.get(3);
const st = frames.get(4);

const fails = [];
const expect = (cond, what) => { if (!cond) fails.push(what); };

expect(startup?.ready === true, 'startup-фрейм {ready:true}');
expect(startup?.runtimeContract === 4, `runtimeContract=4 (получено ${startup?.runtimeContract})`);
expect(ping?.ok === true && ping.result?.pong === true, 'ping → pong');
expect(nb?.ok === true, 'new_build ok');
expect(typeof nb?.result?.stats?.Life === 'number', `new_build Life число (${nb?.result?.stats?.Life})`);
expect(wi?.ok === true, 'whatif ok');
const scenarios = wi?.result?.scenarios ?? [];
expect(scenarios.length === 3, `whatif 3 сценария (${scenarios.length})`);
expect(scenarios[0]?.ok === true && typeof scenarios[0]?.stats?.Life === 'number', 'whatif lvl50 ok');
expect(scenarios[1]?.ok === true, 'whatif chaos75 ok');
expect(scenarios[2]?.ok === false && scenarios[2]?.errorCode === 'invalid_config_value', 'whatif badenum отклонён');
expect(st?.ok === true && typeof st?.result?.stats?.Life === 'number', 'stats после whatif ok');
// CAS: после whatif движок = baseline (new_build Life == stats Life)
expect(nb?.result?.stats?.Life === st?.result?.stats?.Life, `CAS-откат: Life до (${nb?.result?.stats?.Life}) == после (${st?.result?.stats?.Life})`);

if (fails.length > 0) {
  console.error('[selftest] FAIL:\n  - ' + fails.join('\n  - '));
  process.exit(1);
}
console.log('[selftest] OK: contract 4, ping/new_build/whatif(3)/CAS — всё зелёное');
console.log(`[selftest] baseline: Life=${nb.result.stats.Life} DPS=${nb.result.stats.TotalDPS ?? '—'}`);
