// 좌표 계층 — 코드워드를 정확한 정사각형 2D 공간에 배치한다
//
// 기획서 7장. 004에서 검증된 대수를 계승한다. 새로 발명하지 않는다.
//
//   축 크기 N = 2^axisBits
//   high = J * y        mod N
//   low  = J * (x + y)  mod N
//   code = high << axisBits | low
//
// J가 홀수이고 N이 2의 거듭제곱이므로 J의 모듈러 역원이 반드시 존재한다.
// 따라서 좌표에서 코드로, 코드에서 좌표로 가는 변환이 둘 다 정확하다.
// 검색도, 테이블도, 실패 가능성도 없다.

// 점프 값은 축 폭에 비례해야 하므로 고정 목록이 아니라 단계에서 계산한다.
// 이유는 scramble.mjs 머리말 참조. 짧은 고정 점프는 원점 근방을 퇴화시킨다.
import { saltFor } from './scramble.mjs';

export { LOCALITY_LEVELS, DEFAULT_LOCALITY, localityMix, localityWidth } from './scramble.mjs';

/** 축 크기 N = 2^axisBits */
export function axisSize(axisBits) {
  return 1n << BigInt(axisBits);
}

/** 하위 axisBits 비트만 남기는 마스크. */
export function axisMask(axisBits) {
  return (1n << BigInt(axisBits)) - 1n;
}

/**
 * 2의 거듭제곱 모듈러스에서 값을 감싼다.
 *
 * BigInt의 비트 AND는 음수를 무한 2의 보수로 취급하므로
 * 음수 입력에도 올바른 나머지를 준다. (예: (-1n) & 3n === 3n)
 */
export function wrap(value, axisBits) {
  return value & axisMask(axisBits);
}

const inverseCache = new Map();

/**
 * 2^bits를 법으로 하는 홀수의 모듈러 역원.
 *
 * Hensel 올림(Newton 반복)을 쓴다.
 * a*inv ≡ 1 (mod 2^p) 이면 inv' = inv*(2 - a*inv)는 a*inv' ≡ 1 (mod 2^2p)를 만족한다.
 * a가 홀수이므로 inv = 1에서 시작하면 이미 mod 2에서 성립한다.
 */
export function modInverseOdd(a, bits) {
  if (typeof a !== 'bigint') throw new TypeError('a는 BigInt여야 한다');
  if ((a & 1n) === 0n) throw new RangeError('점프 값은 홀수여야 한다');

  const key = `${a}:${bits}`;
  const cached = inverseCache.get(key);
  if (cached !== undefined) return cached;

  const mask = (1n << BigInt(bits)) - 1n;
  let inv = 1n;
  let precision = 1;
  while (precision < bits) {
    inv = (inv * (2n - a * inv)) & mask;
    precision *= 2;
  }
  inv &= mask;

  // 값싼 자기 검증. 이것은 "유효성 검사"가 아니라 수학적 사후조건 확인이다.
  if (((a * inv) & mask) !== 1n) {
    throw new Error(`모듈러 역원 계산 실패: a=${a}, bits=${bits}`);
  }

  inverseCache.set(key, inv);
  return inv;
}

/** 점프 값이 사용 가능한지 확인한다. 홀수여야 한다. */
export function isValidJump(jump) {
  return typeof jump === 'bigint' && jump > 0n && (jump & 1n) === 1n;
}

/**
 * 혼합 계수가 전단사를 보장하는지 확인한다.
 *
 * 행렬식이 -jx*jy이므로 jx와 jy가 홀수면 충분하다.
 * jz는 어떤 값이어도 무관하다.
 */
export function isValidMix(mix) {
  return (
    mix != null &&
    isValidJump(mix.jx) &&
    isValidJump(mix.jy) &&
    typeof mix.jz === 'bigint' &&
    mix.jz !== mix.jx // 불변 방향이 생기지 않는지 확인
  );
}

/**
 * 좌표 → 코드워드.
 *
 * 모든 (x, y)가 정확히 하나의 코드워드로 간다. 예외 없음.
 *
 * 마지막에 고정 소금을 XOR한다. 그래야 좌표가 작아도(원점 포함)
 * 상위 자리인 헤더와 mode/dc 평면이 0으로 남지 않는다.
 * XOR은 대합이라 전단사가 유지된다.
 */
export function coordinatesToCode(x, y, mix, axisBits) {
  const bits = BigInt(axisBits);
  const mask = (1n << bits) - 1n;
  const wx = x & mask;
  const wy = y & mask;
  const high = (mix.jy * wy) & mask;
  const low = (mix.jx * wx + mix.jz * wy) & mask;
  return ((high << bits) | low) ^ saltFor(axisBits * 2);
}

/**
 * 코드워드 → 좌표.
 *
 * coordinatesToCode의 정확한 역함수.
 * jx와 jy가 홀수이므로 두 역원이 항상 존재한다.
 */
export function codeToCoordinates(code, mix, axisBits) {
  const bits = BigInt(axisBits);
  const mask = (1n << bits) - 1n;
  const unsalted = code ^ saltFor(axisBits * 2);
  const high = (unsalted >> bits) & mask;
  const low = unsalted & mask;

  const y = (modInverseOdd(mix.jy, axisBits) * high) & mask;
  const x = (modInverseOdd(mix.jx, axisBits) * ((low - mix.jz * y) & mask)) & mask;
  return [x, y];
}

/** 좌표를 (dx, dy)만큼 옮긴다. 감싸기 포함. */
export function step(x, y, dx, dy, axisBits) {
  const mask = axisMask(axisBits);
  return [(x + BigInt(dx)) & mask, (y + BigInt(dy)) & mask];
}

/**
 * 축 하나에서 균일 난수 좌표를 뽑는다.
 *
 * 축 크기가 2의 거듭제곱이므로 무작위 비트열을 마스킹하면 편향이 없다.
 * 재시도도, 실패도 없다. 이것이 전체성의 살아 있는 증거다.
 */
export function randomAxisValue(axisBits, getRandomValues = defaultRandom) {
  const byteCount = Math.ceil(axisBits / 8);
  const bytes = new Uint8Array(byteCount);
  getRandomValues(bytes);
  let v = 0n;
  for (let i = 0; i < byteCount; i++) v = (v << 8n) | BigInt(bytes[i]);
  return v & axisMask(axisBits);
}

/** 무작위 좌표 한 쌍. */
export function randomCoordinate(axisBits, getRandomValues = defaultRandom) {
  return [randomAxisValue(axisBits, getRandomValues), randomAxisValue(axisBits, getRandomValues)];
}

function defaultRandom(bytes) {
  // 브라우저와 Node 19+ 모두 globalThis.crypto를 제공한다.
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/** 사람이 읽기 좋게 큰 수를 줄인다. 표시용이며 계산에 쓰지 않는다. */
export function shortenNumber(value, head = 8, tail = 6) {
  const text = String(value);
  if (text.length <= head + tail + 1) return text;
  return `${text.slice(0, head)}…${text.slice(-tail)}`;
}
