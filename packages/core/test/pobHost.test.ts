/**
 * Тесты headless-PoB хоста (эпика «headless-оракул», Фаза 1).
 *
 * Покрывают:
 *  - resolvePobHostPaths: дефолты, оверрайды env, honest missing;
 *  - recomputeBuild: отказ-пути (нет входа, отключён, нет рантайма, движок упал,
 *    startup не пришёл) — ВСЕГДА RecomputeUnavailable, не исключение;
 *  - happy path через mock-spawn: парсинг startup-фрейма + load_build_xml,
 *    сериализация one-shot запросов, env CI/LUA_PATH/LUA_CPATH.
 *
 * Живой прогон реального движка — вне vitest (нужен клон PoB2 + luajit):
 * oracle/README + docs/pob_headless_epic.md.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recomputeBuild, resolvePobHostPaths, RECOMPUTE_TIMEOUT_MS } from '../src/pobHost.js';

const frame = (obj: unknown) => JSON.stringify(obj);

describe('resolvePobHostPaths', () => {
  it('репортит отсутствующий luajit и незаданный POB2_SRC', () => {
    const p = resolvePobHostPaths({ POE2K_LUAJIT: join(tmpdir(), 'нет-такого.exe') } as NodeJS.ProcessEnv);
    expect(p.missing.length).toBe(2);
    expect(p.missing[0]).toContain('нет-такого.exe');
    expect(p.pobSrc).toBe('');
  });

  it('принимает валидные пути из env без missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pobhost-'));
    const fakeLuajit = join(dir, 'luajit.exe');
    writeFileSync(fakeLuajit, 'stub');
    writeFileSync(join(dir, 'HeadlessWrapper.lua'), '-- stub');
    const p = resolvePobHostPaths({ POE2K_LUAJIT: fakeLuajit, POE2K_POB2_SRC: dir } as NodeJS.ProcessEnv);
    expect(p.missing).toEqual([]);
  });
});

describe('recomputeBuild — отказ-пути', () => {
  it('нет входа → available:false', () => {
    const r = recomputeBuild({}, {} as NodeJS.ProcessEnv);
    expect(r.available).toBe(false);
    expect((r as { reason: string }).reason).toContain('pobCode');
  });

  it('POE2K_RECOMPUTE=0 → отключён', () => {
    const r = recomputeBuild({ xml: '<PathOfBuilding/>' }, { POE2K_RECOMPUTE: '0' } as NodeJS.ProcessEnv);
    expect((r as { reason: string }).reason).toContain('отключён');
  });

  it('битый PoB-код → honest unavailable, не исключение', () => {
    const r = recomputeBuild({ pobCode: 'совсем-не-код-!?#' }, {} as NodeJS.ProcessEnv);
    expect(r.available).toBe(false);
    expect((r as { reason: string }).reason).toContain('не декодировался');
  });

  it('нет рантайма → setupHint + missing', () => {
    const r = recomputeBuild(
      { xml: '<PathOfBuilding/>' },
      { POE2K_LUAJIT: join(tmpdir(), 'нет-такого.exe') } as NodeJS.ProcessEnv,
    );
    expect(r.available).toBe(false);
    const u = r as { setupHint?: string; missing?: string[] };
    expect(u.setupHint).toContain('setup-headless');
    expect(u.missing!.length).toBeGreaterThan(0);
  });
});

describe('recomputeBuild — happy path (mock spawn)', () => {
  const makeRuntime = () => {
    const dir = mkdtempSync(join(tmpdir(), 'pobhost-'));
    writeFileSync(join(dir, 'luajit.exe'), 'stub');
    writeFileSync(join(dir, 'HeadlessWrapper.lua'), '-- stub');
    return dir;
  };
  const startup = frame({ ready: true, runtimeContract: 1, jit: 'LuaJIT 2.1.0-beta3' });

  it('парсит startup + load_build_xml и собирает результат', () => {
    const dir = makeRuntime();
    const loadResult = {
      mainSkill: 'Flicker Strike',
      characterLevel: 97,
      treeVersion: '0_5',
      skillGroups: [{ label: 'G1', main: 'Quarterstaff Strike L20', gems: ['Quarterstaff Strike L20', 'x'] }],
      stats: { Life: 1539, TotalDPS: 5992638.624404, TotalEHP: 31675.411565 },
    };
    const lines: string[] = [];
    const spawnImpl = ((_cmd: string, _args: string[], opts: Record<string, unknown>) => {
      lines.push(String(opts.input));
      return {
        status: 0,
        stdout: [startup, frame({ id: 1, ok: true, result: loadResult })].join('\n') + '\n',
        stderr: 'chatter→stderr\n',
      } as never;
    }) as never;
    const r = recomputeBuild(
      { xml: '<PathOfBuilding/Build level="97"/>', level: 95 },
      { POE2K_LUAJIT: join(dir, 'luajit.exe'), POE2K_POB2_SRC: dir } as NodeJS.ProcessEnv,
      spawnImpl,
    );
    expect(r.available).toBe(true);
    const ok = r as Extract<typeof r, { available: true }>;
    // finalId берётся из последнего запроса = set_level
    const reqs = lines[0].split('\n').map((l) => JSON.parse(l) as { id: number; method: string; params?: unknown });
    expect(reqs.map((q) => q.method)).toEqual(['load_build_xml', 'set_level']);
    expect((reqs[1]!.params as { level: number }).level).toBe(95);
    expect(ok.mainSkill).toBe('Flicker Strike');
    expect(ok.stats.TotalDPS).toBeGreaterThan(5_000_000);
    expect(ok.tookMs).toBeGreaterThanOrEqual(0);
  });

  it('передаёт env CI/LUA_PATH/LUA_CPATH и таймаут движку', () => {
    const dir = makeRuntime();
    let seenEnv: Record<string, string> = {} as never;
    let seenTimeout = 0;
    const spawnImpl = ((_c: string, _a: string[], o: Record<string, unknown>) => {
      seenEnv = (o as { env: Record<string, string> }).env;
      seenTimeout = (o as { timeout: number }).timeout;
      return { status: 0, stdout: startup + '\n' + frame({ id: 1, ok: true, result: { stats: {} } }) + '\n' } as never;
    }) as never;
    recomputeBuild(
      { xml: '<PathOfBuilding/>' },
      { POE2K_LUAJIT: join(dir, 'luajit.exe'), POE2K_POB2_SRC: dir } as NodeJS.ProcessEnv,
      spawnImpl,
    );
    expect(seenEnv.CI).toBe('true');
    expect(seenEnv.LUA_PATH).toContain('runtime/lua');
    expect(seenEnv.LUA_CPATH).toContain('runtime');
    expect(seenTimeout).toBe(RECOMPUTE_TIMEOUT_MS);
  });

  it('движок упал (exit 1) → available:false с хвостом stderr', () => {
    const dir = makeRuntime();
    const spawnImpl = (() => ({ status: 1, stdout: '', stderr: 'стр1\nстр2\nстр3\nстр4\n' })) as never;
    const r = recomputeBuild(
      { xml: '<PathOfBuilding/>' },
      { POE2K_LUAJIT: join(dir, 'luajit.exe'), POE2K_POB2_SRC: dir } as NodeJS.ProcessEnv,
      spawnImpl,
    );
    expect(r.available).toBe(false);
    expect((r as { reason: string }).reason).toContain('Движок упал');
  });

  it('startup-фрейм не пришёл → honest unavailable', () => {
    const dir = makeRuntime();
    const spawnImpl = (() => ({ status: 0, stdout: frame({ id: 1, ok: true, result: {} }) + '\n' })) as never;
    const r = recomputeBuild(
      { xml: '<PathOfBuilding/>' },
      { POE2K_LUAJIT: join(dir, 'luajit.exe'), POE2K_POB2_SRC: dir } as NodeJS.ProcessEnv,
      spawnImpl,
    );
    expect((r as { reason: string }).reason).toContain('startup');
  });

  it('ready:false от хоста (несовместимый контракт) → unavailable', () => {
    const dir = makeRuntime();
    const spawnImpl = (() => ({
      status: 0,
      stdout: frame({ ready: false, error: 'engine init failed' }) + '\n',
    })) as never;
    const r = recomputeBuild(
      { xml: '<PathOfBuilding/>' },
      { POE2K_LUAJIT: join(dir, 'luajit.exe'), POE2K_POB2_SRC: dir } as NodeJS.ProcessEnv,
      spawnImpl,
    );
    expect(r.available).toBe(false);
    expect((r as { reason: string }).reason).toContain('HeadlessWrapper');
  });
});
