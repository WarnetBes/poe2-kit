// Живой MCP-зов poe2_known_issues {status:'unverified'} через stdio JSON-RPC (№265 проверка).
// Спавнит реальный сервер apps/mcp/dist/index.js как это делает MCP-клиент,
// дергает tools/call и проверяет: total, распределение статусов, ❓-пометки, пояснения unverified.
import { spawn } from 'node:child_process';

const PROC = 'node';
const ARGS = ['apps/mcp/dist/index.js'];
const child = spawn(PROC, ARGS, { stdio: ['pipe', 'pipe', 'pipe'] });

let buf = '';
let id = 0;
const pending = new Map();
function send(method, params) {
  return new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    const msg = JSON.stringify({ jsonrpc: '2.0', id: mid, method, params });
    child.stdin.write(msg + '\n');
  });
}
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

child.stdout.on('data', (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    }
  }
});
child.stderr.on('data', (d) => process.stderr.write('[server] ' + d));

let fails = 0;
function need(ok, msg) {
  console.log((ok ? 'OK  ' : 'FAIL ') + msg);
  if (!ok) fails++;
}

try {
  // init handshake
  const init = await send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'live-curl', version: '0.0.1' },
  });
  need(!!init && !!init.serverInfo, 'initialize: serverInfo получен (' + (init?.serverInfo?.name ?? '?') + ' ' + (init?.serverInfo?.version ?? '?') + ')');
  notify('notifications/initialized', {});

  const unv = await send('tools/call', { name: 'poe2_known_issues', arguments: { status: 'unverified' } });
  const sc = unv?.structuredContent ?? {};
  const issues = sc.issues ?? [];
  need(issues.length === 5, 'unverified total = 5 (факт: ' + issues.length + ')');
  need(issues.every((i) => typeof i.unverified === 'string' && i.unverified.length > 0), 'все unverified несут строковое пояснение');
  need(issues.every((i) => i.status === 'unverified'), 'фильтр честный: только unverified');
  const ids = issues.map((i) => i.id).sort();
  need(JSON.stringify(ids) === JSON.stringify(['atlas-orphan-node', 'breach-twin-bosses-hp', 'checkpoint-softlock-family', 'ghostdance-compressed-duration', 'spirit-reservation-checkbox']),
    'состав unverified: ' + ids.join(', '));
  const text = JSON.stringify(unv);
  need(text.includes('❓'), '❓-пометка присутствует в выводе');

  const live = await send('tools/call', { name: 'poe2_known_issues', arguments: { status: 'live' } });
  const liveIssues = live?.structuredContent?.issues ?? [];
  need(liveIssues.length === 12, 'live total = 12 (факт: ' + liveIssues.length + ')');
  need(liveIssues.some((i) => i.id === 'strongbox-unable-open' && (i.workaround ?? '').includes('ВЗОРВАТЬ')),
    'strongbox: вернулся в live с воркараундом «взорвать»');
  need(liveIssues.some((i) => i.id === 'vaal-ruins-waypoint' && (i.report_dates?.length ?? 0) === 7),
    'vaal-ruins: вернулся в live с 7 датами репортов');

  const spirit = await send('tools/call', { name: 'poe2_known_issues', arguments: { id: 'spirit-reservation-checkbox' } });
  need(JSON.stringify(spirit).includes('/board/poe/6317/39837'), 'spirit: URL исправлен на /board/poe/6317/39837');
} catch (e) {
  need(false, 'исключение: ' + e.message);
}

child.kill();
console.log(fails === 0 ? 'LIVE-MCP UNVERIFIED: ALL OK' : 'LIVE-MCP UNVERIFIED: ' + fails + ' FAIL');
process.exit(fails === 0 ? 0 : 1);
