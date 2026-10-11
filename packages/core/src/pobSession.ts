/**
 * PobSession — ДОЛГОЖИВУЩИЙ headless-PoB хост (Фаза 3 эпики, персист-сессия web).
 *
 * Отличие от recomputeBuild (one-shot): процесс luajit+pob_host.lua живёт между
 * запросами — boot движка (~11 с живьём) платится ОДИН раз, дальше каждый RPC —
 * миллисекунды. Это и есть «долгоживущий персист-хост»: web-сервер держит
 * сессию, SPA/клиенты шлют RPC поверх неё.
 *
 * Контракт host = 3 (whatif). ВАЖНО (сквозной факт №460): хост однопоточный и
 * обрабатывает строки stdin последовательно, ответы приходят в порядке
 * запросов; тем не менее матчим по id и сериализуем очередь на TS-стороне,
 * чтобы клиентам не требовалось знать о внутреннем конвейере.
 *
 * Отказоустойчивость: падение процесса → все pendings отклоняются, следующий
 * rpc() рестартует движок (лениво, boot заново). Билд после рестарта НЕ
 * восстановлен — вызывающий обязан перезагрузить (load()); сессия честно
 * возвращает meta.loaded=false после рестарта.
 */

import { type ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { join } from 'node:path';
import { resolvePobHostPaths } from './pobHost.js';
import { decodeShareCode } from './pobcode.js';

export const SESSION_START_TIMEOUT_MS = 60_000;
export const SESSION_RPC_TIMEOUT_MS = 120_000;

export interface SessionChild {
  stdin: { write(chunk: string): void; end(): void };
  stdout: NodeJS.EventEmitter;
  stderr: NodeJS.EventEmitter;
  pid?: number;
  kill(): void;
  on(event: 'exit', cb: (code: number | null) => void): void;
}
export type SpawnChildFn = (
  luajit: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv },
) => SessionChild;

const defaultSpawn: SpawnChildFn = (luajit, args, opts) =>
  nodeSpawn(luajit, args, { cwd: opts.cwd, env: opts.env, stdio: ['pipe', 'pipe', 'pipe'] }) as unknown as SessionChild;

export interface RpcFrame {
  id?: number;
  ok?: boolean;
  error?: string;
  result?: unknown;
  ready?: boolean;
}

export type SessionStatus =
  | 'stopped'
  | 'starting'
  | 'ready'
  | 'crashed';

export interface PobSessionInfo {
  status: SessionStatus;
  runtimeContract: number | null;
  pid: number | null;
  startedAt: number | null;
  rpcCount: number;
  lastError: string | null;
  loaded: boolean;
}

export interface PobLoadInput {
  pobCode?: string;
  xml?: string;
}

export class PobSession {
  private env: NodeJS.ProcessEnv;
  private spawnFn: SpawnChildFn;
  private child: SessionChild | null = null;
  private buf = '';
  private nextId = 1;
  private pendings = new Map<number, { resolve: (f: RpcFrame) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private chain: Promise<unknown> = Promise.resolve();
  private runtimeContract: number | null = null;
  private startedAt: number | null = null;
  private rpcCount = 0;
  private lastError: string | null = null;
  private loaded = false;
  private startPromise: Promise<void> | null = null;

  constructor(env: NodeJS.ProcessEnv = process.env, spawnFn: SpawnChildFn = defaultSpawn) {
    this.env = env;
    this.spawnFn = spawnFn;
  }

  get info(): PobSessionInfo {
    return {
      status: this.child ? (this.runtimeContract == null ? 'starting' : 'ready') : this.startedAt ? 'crashed' : 'stopped',
      runtimeContract: this.runtimeContract,
      pid: this.child?.pid ?? null,
      startedAt: this.startedAt,
      rpcCount: this.rpcCount,
      lastError: this.lastError,
      loaded: this.loaded,
    };
  }

  private throwUnavailable(missing: string[]): never {
    throw new Error(
      `Headless-PoB рантайм не найден: ${missing.join('; ')}. ` +
      'Сетап: node oracle/setup-headless.mjs + клон PathOfBuilding-PoE2 + POE2K_POB2_SRC.',
    );
  }

  /** Boot движка; идемпотентно (повторный вызов при ready — no-op). */
  async start(): Promise<void> {
    if (this.child && this.runtimeContract != null) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.boot();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private async boot(): Promise<void> {
    const paths = resolvePobHostPaths(this.env);
    if (paths.missing.length > 0) this.throwUnavailable(paths.missing);
    if (this.env.POE2K_RECOMPUTE === '0') throw new Error('Headless-PoB отключён (POE2K_RECOMPUTE=0).');
    this.disposeSync();
    const child = this.spawnFn(paths.luajit, [paths.hostLua], {
      cwd: paths.pobSrc,
      env: {
        ...this.env,
        CI: 'true',
        LUA_PATH: '?.lua;?\\init.lua;../runtime/lua/?.lua;../runtime/lua/?/init.lua',
        LUA_CPATH: join(paths.pobSrc.replace(/[\\/]+$/, ''), '..', 'runtime') + '\\?.dll',
      },
    });
    this.child = child;
    this.buf = '';
    this.runtimeContract = null;
    this.loaded = false;
    this.startedAt = Date.now();
    child.stdout!.on('data', (c: string | Buffer) => this.onStdout(c));
    child.stderr!.on('data', () => { /* chatter хоста → мимо протокола */ });
    child.on('exit', (code) => this.onExit(code));

    // Ждём startup-фрейм {ready:true, runtimeContract}.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.onStartup = null;
        reject(new Error(`Движок не поднялся за ${SESSION_START_TIMEOUT_MS} мс (нет startup-фрейма).`));
      }, SESSION_START_TIMEOUT_MS);
      this.onStartup = (ok, err) => {
        clearTimeout(timer);
        if (ok) resolve();
        else reject(err);
      };
    }).catch((err) => {
      this.lastError = String(err);
      this.disposeSync();
      throw err;
    });
  }

  private onStartup: ((ok: boolean, err: Error) => void) | null = null;

  private onStdout(chunk: string | Buffer): void {
    this.buf += chunk.toString('utf8');
    let idx: number;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line.startsWith('{')) continue;
      let frame: RpcFrame;
      try {
        frame = JSON.parse(line) as RpcFrame;
      } catch {
        continue; // не-JSON мусор игнорируем, кадр потерян быть не может (id-матчинг ниже)
      }
      if (frame.ready === true && frame.id == null) {
        // Startup-фрейм несёт runtimeContract (договор хоста).
        const rc = (frame as RpcFrame & { runtimeContract?: number }).runtimeContract ?? null;
        this.runtimeContract = rc;
        this.lastError = null;
        this.onStartup?.(true, null!);
        this.onStartup = null;
        continue;
      }
      if (frame.ready === false) {
        const err = new Error(`HeadlessWrapper не поднялся: ${String(frame.error ?? '')}`);
        this.lastError = err.message;
        this.onStartup?.(false, err);
        this.onStartup = null;
        continue;
      }
      const p = frame.id != null ? this.pendings.get(frame.id) : undefined;
      if (p) {
        this.pendings.delete(frame.id!);
        clearTimeout(p.timer);
        p.resolve(frame);
      }
    }
  }

  private onExit(code: number | null): void {
    this.child = null;
    this.runtimeContract = null;
    this.loaded = false;
    this.lastError = `движок завершился (exit ${code ?? 'n/a'}); следующий rpc перезапустит`;
    for (const [, p] of this.pendings) {
      clearTimeout(p.timer);
      p.reject(new Error('Движок упал до ответа.'));
    }
    this.pendings.clear();
  }

  private disposeSync(): void {
    if (this.child) {
      try { this.child.kill(); } catch { /* уже мёртв */ }
      this.child = null;
    }
    for (const [, p] of this.pendings) {
      clearTimeout(p.timer);
      p.reject(new Error('Сессия перезапускается.'));
    }
    this.pendings.clear();
    this.runtimeContract = null;
    this.onStartup = null;
  }

  /** Один RPC: сериализация через цепочку (FIFO), рестарт при падении. */
  rpc(method: string, params?: Record<string, unknown>): Promise<RpcFrame> {
    // Двигатель, живой на момент постановки в очередь. Если он умрёт ДО
    // исполнения запроса — отказ (stateful-контекст потерян; вызывающий
    // перезагрузит билд). Мёртвый на входе (новый запрос после краша) —
    // лениво поднимается заново rpcOnce → start().
    const wasAlive = !!(this.child && this.runtimeContract != null);
    const run = () => {
      if (wasAlive && !(this.child && this.runtimeContract != null)) {
        return Promise.reject(new Error('Движок упал до исполнения запроса.'));
      }
      return this.rpcOnce(method, params);
    };
    // очередь: старт движка тоже в цепочке, чтобы boot не гонялся параллельно
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next as Promise<RpcFrame>;
  }

  private async rpcOnce(method: string, params?: Record<string, unknown>): Promise<RpcFrame> {
    if (!this.child || this.runtimeContract == null) {
      await this.start();
    }
    const child = this.child;
    if (!child) throw new Error('Движок не поднялся (spawn неудачен).');
    const id = this.nextId++;
    this.rpcCount++;
    const frame = await new Promise<RpcFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendings.delete(id);
        reject(new Error(`RPC ${method} превысил ${SESSION_RPC_TIMEOUT_MS} мс.`));
      }, SESSION_RPC_TIMEOUT_MS);
      this.pendings.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, method, params: params ?? {} }) + '\n');
    });
    if (frame.ok === false) return frame; // бизнес-отказ пробрасываем кадром
    return frame;
  }

  /** RPC с разворотом ok:false → исключение (для методов-команд). */
  async call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    const f = await this.rpc(method, params);
    if (f.ok === false) throw new Error(`RPC ${method} отклонён: ${String(f.error)}`);
    return f.result as T;
  }

  /** Загрузить билд в сессию (idempotent: перезагружает при повторе). */
  async load(input: PobLoadInput): Promise<Record<string, unknown>> {
    if (!input.pobCode && !input.xml) throw new Error('load: нужен pobCode или xml.');
    let xml = input.xml ?? '';
    if (input.pobCode) {
      try {
        xml = decodeShareCode(input.pobCode);
      } catch (e) {
        throw new Error(`PoB-код не декодировался: ${(e as Error).message}`);
      }
    }
    const res = await this.call<Record<string, unknown>>('load_build_xml', { xml });
    this.loaded = true;
    return res;
  }

  dispose(): void {
    this.disposeSync();
    this.startedAt = null;
    this.lastError = null;
  }
}
