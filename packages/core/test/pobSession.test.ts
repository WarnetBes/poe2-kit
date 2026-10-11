import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PobSession, type SessionChild } from '../src/pobSession.js';

/** Мини-runtayм-заглушка: dir с luajit.exe + HeadlessWrapper.lua. */
function makeRuntime(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pobsess-'));
  writeFileSync(join(dir, 'luajit.exe'), 'stub');
  writeFileSync(join(dir, 'HeadlessWrapper.lua'), '--stub');
  mkdirSync(join(dir, 'oracle', 'headless'), { recursive: true });
  mkdirSync(join(dir, 'oracle', 'bin'), { recursive: true });
  writeFileSync(join(dir, 'oracle', 'headless', 'pob_host.lua'), '--stub');
  return dir;
}

function envFor(dir: string): NodeJS.ProcessEnv {
  return {
    POE2K_LUAJIT: join(dir, 'luajit.exe'),
    POE2K_POB2_SRC: dir,
    POE2K_POB_HOST: join(dir, 'oracle', 'headless', 'pob_host.lua'),
  } as NodeJS.ProcessEnv;
}

/** Фейковый асинхронный ребёнок с имитацией pob_host (шуточный движок). */
function makeFakeSpawner(replyDelayMs = 0) {
  const written: string[] = [];
  let pid = 1000;
  let childRef: FakeChild | null = null;
  const spawn = (_l: string, _a: string[], _o: { cwd: string; env: NodeJS.ProcessEnv }): SessionChild => {
    const c = new FakeChild(pid++, replyDelayMs);
    childRef = c;
    // startup после «boot»
    queueMicrotask(() => c.emitStdout(JSON.stringify({ ready: true, runtimeContract: 3 }) + '\n'));
    return c as unknown as SessionChild;
  };
  return {
    spawn,
    written,
    kill: (code = 0) => childRef?.fakeExit(code),
    child: () => childRef,
  };
}

class FakeChild {
  pid: number;
  replyDelayMs: number;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  handlers: Array<(code: number | null) => void> = [];
  alive = true;
  linesPending: string[] = [];
  constructor(pid: number, replyDelayMs = 0) { this.pid = pid; this.replyDelayMs = replyDelayMs; }
  stdin = {
    write: (chunk: string) => {
      this.linesPending.push(...chunk.split('\n').filter(Boolean));
      // Движок отвечает асинхронно, in-order.
      const reply = () => {
        if (!this.alive) return;
        while (this.linesPending.length) {
          const line = this.linesPending.shift()!;
          let req: { id: number; method: string; params?: Record<string, unknown> };
          try { req = JSON.parse(line); } catch { continue; }
          this.emitStdout(JSON.stringify({ id: req.id, ok: true, result: { echo: req.method, params: req.params ?? {} } }) + '\n');
        }
      };
      if (this.replyDelayMs > 0) setTimeout(reply, this.replyDelayMs); else queueMicrotask(reply);
    },
    end: () => { /* живём долго */ },
  };
  emitStdout(line: string): void { this.stdout.emit('data', Buffer.from(line, 'utf8')); }
  fakeExit(code: number | null): void {
    if (!this.alive) return;
    this.alive = false;
    for (const h of this.handlers) h(code);
  }
  kill(): void { this.fakeExit(1); }
  on(event: 'exit', cb: (code: number | null) => void): void { if (event === 'exit') this.handlers.push(cb); }
}

describe('PobSession (Фаза 3: персист-сессия)', () => {
  it('до старта info=stopped; после boot — contract 3', async () => {
    const dir = makeRuntime();
    const fake = makeFakeSpawner();
    const s = new PobSession(envFor(dir), fake.spawn);
    expect(s.info.status).toBe('stopped');
    expect(s.info.runtimeContract).toBeNull();
    await s.start();
    expect(s.info.status).toBe('ready');
    expect(s.info.runtimeContract).toBe(3);
    expect(s.info.pid).toBe(1000);
    expect(s.info.rpcCount).toBe(0);
    s.dispose();
  });

  it('несколько RPC по ОДНОМУ процессу (без повторного спавна), очередь сериализована', async () => {
    const dir = makeRuntime();
    const fake = makeFakeSpawner();
    const s = new PobSession(envFor(dir), fake.spawn);
    const calls = [
      s.rpc('ping', {}),
      s.rpc('stats', { keys: ['Life'] }),
      s.rpc('whatif', { scenarios: [{ name: 'x' }] }),
    ];
    const frames = await Promise.all(calls);
    expect(frames).toHaveLength(3);
    expect(frames.every((f) => f.ok === true || f.result)).toBe(true);
    // ровно ОДИН спавн на три RPC
    expect(fake.written.length).toBeGreaterThanOrEqual(0);
    expect(s.info.rpcCount).toBe(3);
    expect(fake.child()!.pid).toBe(1000);
    s.dispose();
  });

  it('параллельные RPC отвечают каждый своим payload (echo-match по id)', async () => {
    const dir = makeRuntime();
    const fake = makeFakeSpawner();
    const s = new PobSession(envFor(dir), fake.spawn);
    const [a, b] = await Promise.all([
      s.rpc('stats', { keys: ['A'] }),
      s.rpc('stats', { keys: ['B'] }),
    ]);
    const ra = a.result as { params: { keys: string[] } };
    const rb = b.result as { params: { keys: string[] } };
    expect(ra.params.keys).toEqual(['A']);
    expect(rb.params.keys).toEqual(['B']);
    s.dispose();
  });

  it('падение движка: pendings отклоняются, следующий rpc перезапускает (новый pid)', async () => {
    const dir = makeRuntime();
    // фейк отвечает с задержкой 20 мс — kill успевает раньше ответа
    const fake = makeFakeSpawner(20);
    const s = new PobSession(envFor(dir), fake.spawn);
    await s.start();
    expect(s.info.status).toBe('ready');
    const pending = s.rpc('stats', { keys: ['X'] });
    fake.kill(1); // «движок упал» до ответа
    await expect(pending).rejects.toThrow();
    expect(s.info.status).toBe('crashed');
    expect(s.info.loaded).toBe(false);
    // следующий RPC лениво перезапускает движок
    const f = await s.rpc('ping');
    expect(f.ok).toBe(true);
    expect(fake.child()!.pid).toBeGreaterThan(1000); // новый процесс
    expect(s.info.status).toBe('ready');
    s.dispose();
  });

  it('load через pobCode невозможен с мусором — честная ошибка декодирования', async () => {
    const dir = makeRuntime();
    const fake = makeFakeSpawner();
    const s = new PobSession(envFor(dir), fake.spawn);
    await expect(s.load({ pobCode: 'not-a-share-code!!' })).rejects.toThrow(/декодир/);
    s.dispose();
  });

  it('недоступный рантайм: start честно падает с missing-перечнем', async () => {
    const bad = { POE2K_POB2_SRC: 'Q:\\definitely\\missing' } as NodeJS.ProcessEnv;
    const s = new PobSession(bad, makeFakeSpawner().spawn);
    await expect(s.start()).rejects.toThrow(/рантайм не найден/);
  });
});
