// URL 직렬화와 파싱
//
// 기획서 8장.
//   #v1.<티어>.<국소성 단계>.<x를 36진수로>.<y를 36진수로>
//
// 이미지 데이터는 넣지 않는다. 좌표만 넣는다.
// 좌표에서 코드워드를 계산할 수 있으므로 그것으로 충분하고, 훨씬 짧다.

import { TIERS, DEFAULT_TIER } from './spec.mjs';
import { LOCALITY_LEVELS, DEFAULT_LOCALITY } from './scramble.mjs';

export const URL_VERSION = 'v1';

const PATTERN = /^#?v1\.(\d+)\.(\d+)\.([0-9a-z]+)\.([0-9a-z]+)$/;

/** BigInt를 36진수 문자열로. 소문자만 쓴다. */
export function toBase36(value) {
  return value.toString(36);
}

/**
 * 36진수 문자열을 BigInt로.
 *
 * BigInt에는 기수를 받는 생성자가 없으므로 직접 자리별로 누적한다.
 */
export function fromBase36(text) {
  if (!/^[0-9a-z]+$/.test(text)) throw new SyntaxError(`36진수가 아니다: ${text}`);
  let value = 0n;
  for (const ch of text) {
    const digit = ch <= '9' ? ch.charCodeAt(0) - 48 : ch.charCodeAt(0) - 87;
    value = value * 36n + BigInt(digit);
  }
  return value;
}

/** 상태를 URL 해시로 만든다. */
export function formatHash({ tier, locality, x, y }) {
  return `#${URL_VERSION}.${tier}.${locality}.${toBase36(x)}.${toBase36(y)}`;
}

/**
 * URL 해시를 상태로 되돌린다.
 *
 * 형식이 어긋나거나 범위를 넘으면 throw한다.
 * 호출한 쪽이 사용자에게 알리고 원점으로 복구할 책임을 진다.
 * 조용히 실패해서는 안 된다.
 */
export function parseHash(hash, axisBitsForTier) {
  const match = PATTERN.exec(hash ?? '');
  if (!match) throw new SyntaxError('좌표 형식이 아니다');

  const tier = Number(match[1]);
  if (!TIERS.includes(tier)) throw new RangeError(`지원하지 않는 층: ${tier}`);

  const locality = Number(match[2]);
  if (!Number.isInteger(locality) || locality < 0 || locality >= LOCALITY_LEVELS.length) {
    throw new RangeError(`지원하지 않는 국소성 단계: ${locality}`);
  }

  const x = fromBase36(match[3]);
  const y = fromBase36(match[4]);

  const axisBits = axisBitsForTier(tier);
  const size = 1n << BigInt(axisBits);
  if (x >= size || y >= size) throw new RangeError('좌표가 이 미술관 밖이다');

  return { tier, locality, x, y };
}

/** 기본 상태. 해시가 없을 때 쓴다. */
export function defaultState() {
  return { tier: DEFAULT_TIER, locality: DEFAULT_LOCALITY, x: 0n, y: 0n };
}
