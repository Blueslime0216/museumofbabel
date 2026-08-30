// URL 직렬화와 파싱
//
// 기획서 8장.
//   #v2.<층>.<국소성 단계>.<x를 36진수로>.<y를 36진수로>
//
// 이미지 데이터는 넣지 않는다. 좌표만 넣는다.
// 좌표에서 코드워드를 계산할 수 있으므로 그것으로 충분하고, 훨씬 짧다.
//
// ── 왜 v1에서 v2로 올렸는가 ──────────────────────────────────────────────
//
// 이 프로젝트의 유일한 약속은 "한 주소는 언제나 같은 그림"이다.
// v2에서 그 약속을 지킬 수 없는 변경을 했다.
//
//   - profile / reserved 헤더를 실제로 해석한다. v1은 두 필드를 무시했으므로
//     같은 주소가 다른 그림을 낸다.
//   - AMP_MULT 표와 양자화 표를 고쳤다.
//   - 층 32를 추가했다.
//
// 그래서 조용히 바꾸는 대신 버전을 올린다. 옛 v1 링크는 parseHash에서
// SyntaxError가 되고, 앱이 알림을 띄운 뒤 무작위 위치로 복구한다.
// v1과 v2를 동시에 지원하지는 않는다. 코덱을 두 벌 유지할 만큼
// v1이 널리 공유된 적이 없다(정식 출시 전이다).
//
// basis.mjs의 주석이 이미 이 규칙을 프로젝트 규약으로 못박아 두었다.

import { TIERS, DEFAULT_TIER } from './spec.mjs';
import { LOCALITY_LEVELS, DEFAULT_LOCALITY } from './scramble.mjs';

export const URL_VERSION = 'v2';

const PATTERN = /^#?v2\.(\d+)\.(\d+)\.([0-9a-z]+)\.([0-9a-z]+)$/;

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
