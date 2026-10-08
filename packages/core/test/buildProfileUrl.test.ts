import { describe, it, expect } from 'vitest';
import {
  parseProfileCharacterUrl,
  profileCharacterModelUrl,
} from '../src/build.js';

/** Живые кейсы 08–09.10.2026: корейские аккаунты/имена, слаг #→- в URL. */
describe('parseProfileCharacterUrl', () => {
  it('разбирает профиль-ссылку с латиницей', () => {
    const ref = parseProfileCharacterUrl(
      'https://poe.ninja/poe2/profile/GrafDeepRover-0618/forbiddenrites/character/PandarenDeepRover',
    );
    expect(ref).toEqual({
      account: 'GrafDeepRover-0618',
      league: 'forbiddenrites',
      character: 'PandarenDeepRover',
    });
  });

  it('разбирает URL-encoded корейский аккаунт и имя', () => {
    // 동궈-6797 / standard / 레츠고맨 — байты из живой ссылки пользователя.
    // %EA%B6%88 = U+AD88 '궈' (консоль PS5 ранее отображала как похожий слог '굴' —
    // литералы не набираем руками, эталон строим из percent-последовательностей).
    const acc = decodeURIComponent('%EB%8F%99%EA%B6%88') + '-6797';
    const chr = decodeURIComponent('%EB%A0%88%EC%B8%A0%EA%B3%A0%EB%A7%A8');
    const ref = parseProfileCharacterUrl(
      'https://poe.ninja/poe2/profile/%EB%8F%99%EA%B6%88-6797/standard/character/%EB%A0%88%EC%B8%A0%EA%B3%A0%EB%A7%A8',
    );
    expect(ref).toEqual({ account: acc, league: 'standard', character: chr });
    // кодпоинты проверены независимо 08.10 (b3d9 ad88)
    expect([...acc].map((c) => c.codePointAt(0)!.toString(16))).toEqual(['b3d9', 'ad88', '2d', '36', '37', '39', '37']);
  });

  it('возвращает null на чужие ссылки', () => {
    expect(parseProfileCharacterUrl('https://pobb.in/abcdef/')).toBeNull();
    expect(parseProfileCharacterUrl('https://poe.ninja/poe2/builds')).toBeNull();
    expect(parseProfileCharacterUrl('')).toBeNull();
  });
});

describe('profileCharacterModelUrl', () => {
  it('percent-encodes каждый сегмент (кириллица/корейский)', () => {
    const u = profileCharacterModelUrl({
      account: '동굴-6797',
      league: 'vaal',
      character: '지하철',
    });
    expect(u).toBe(
      'https://poe.ninja/poe2/api/profile/characters/' +
        encodeURIComponent('동굴-6797') +
        '/vaal/' +
        encodeURIComponent('지하철') +
        '/model/0',
    );
    // определяющий регресс-кейс: raw-корейский давал 404, encoded — 200 (08.10)
    expect(u).not.toContain('동굴');
  });

  it('версия управляется параметром', () => {
    const base = {
      account: 'a',
      league: 'b',
      character: 'c',
    };
    expect(profileCharacterModelUrl(base, 2).endsWith('/model/2')).toBe(true);
    expect(profileCharacterModelUrl(base).endsWith('/model/0')).toBe(true);
  });
});
