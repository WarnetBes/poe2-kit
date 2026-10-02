import { describe, it, expect, beforeEach } from 'vitest';
import {
  encodeShareCode,
  decodeShareCode,
  clearPobCodeCache,
  PobCodeError,
} from '../src/pobcode.js';

/** Минимально валидный XML билда: '<' в начале + маркер PathOfBuilding. */
const MINIMAL_BUILD_XML =
  '<PathOfBuilding><Build level="27" className="Monk" ascendClassName="Invoker"/></PathOfBuilding>';

/** Реалистичный билд-подобный XML (по структуре реальных снапшотов). */
const REALISTIC_XML = `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="30" className="Monk" ascendClassName="Invoker" mainActiveSkill="Ice Strike">
    <PlayerStat stat="Life" value="517"/>
    <PlayerStat stat="EnergyShield" value="0"/>
  </Build>
  <Calcs>
    <Input name="specA" number="1.0"/>
  </Calcs>
  <Tree>
    <Spec>
      <URL>https://www.pathofexile.com/passive-skill-tree/AAAABgMB</URL>
    </Spec>
  </Tree>
  <Items>Some item data here for realism</Items>
  <Import lastUpdate="2026-10-01"/>
</PathOfBuilding>`;

beforeEach(() => clearPobCodeCache());

describe('pobcode: encodeShareCode → decodeShareCode roundtrip', () => {
  it('минимальный XML билда проходит кодирование и раскодирование без потерь', () => {
    const code = encodeShareCode(MINIMAL_BUILD_XML);
    expect(code).not.toHaveLength(0);
    // urlsafe: без '+' и '/'
    expect(code).not.toMatch(/[+/=]/);
    expect(decodeShareCode(code)).toBe(MINIMAL_BUILD_XML);
  });

  it('реалистичный XML с кириллицей/спецсимволами roundtrip без потерь', () => {
    const code = encodeShareCode(REALISTIC_XML);
    const decoded = decodeShareCode(code);
    expect(decoded).toBe(REALISTIC_XML);
    expect(decoded).toContain('PathOfBuilding');
    expect(decoded).toContain('Ice Strike');
  });

  it('decode принимает код с обёрткой (кавычки/пробелы) как из чата', () => {
    const code = encodeShareCode(REALISTIC_XML);
    expect(decodeShareCode(`  "${code}" `)).toBe(REALISTIC_XML);
  });

  it('двойной roundtrip: decode(encode(decoded)) стабилен (idempotent)', () => {
    const once = decodeShareCode(encodeShareCode(REALISTIC_XML));
    const twice = decodeShareCode(encodeShareCode(once));
    expect(twice).toBe(once);
  });
});

describe('pobcode: диагностика ошибок', () => {
  it('пустой код → PobCodeError', () => {
    expect(() => decodeShareCode('')).toThrow(PobCodeError);
    expect(() => decodeShareCode('   ')).toThrow(PobCodeError);
  });

  it('мусор (не base64) → PobCodeError, не молчаливый null', () => {
    expect(() => decodeShareCode('это вообще не код !!!')).toThrow(PobCodeError);
  });

  it('обрезанный код (потеря хвоста) → PobCodeError', () => {
    const code = encodeShareCode(REALISTIC_XML);
    const truncated = code.slice(0, Math.floor(code.length / 2));
    expect(() => decodeShareCode(truncated)).toThrow(PobCodeError);
  });
});
