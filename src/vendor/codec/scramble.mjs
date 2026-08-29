// 고정 상수 — 소금(salt)과 확산자(spread)
//
// 왜 필요한가
//   축 하나가 812비트(티어 8)인데 사람이 걸어서 도달하는 좌표는 기껏 60비트다.
//   그래서 J를 곱해도 상위 700비트 이상이 0으로 남는다.
//   상위 자리는 헤더와 mode/dc 평면이므로 quant=0, baseLuma=0, mode 전부 DC가 되어
//   원점 근방 전체가 균일한 단색 화면이 된다. 실제로 그렇게 나왔다.
//
//   즉 "모든 주소가 유효하다"는 성립하지만
//   "사람이 갈 수 있는 곳이 전부 퇴화된 구석"이었다.
//
// 해결
//   1. salt  — 코드워드에 고정 상수를 XOR한다. 원점도 풍부한 필드값을 갖게 된다.
//   2. spread — 점프 값을 축 폭에 비례해 넓힌다. 한 걸음이 얼마나 바뀌는지 조절한다.
//
// 왜 이것이 해시가 아닌가 (기획서 금지 1)
//   salt와 spread는 주소에 의존하지 않는 고정 상수다. 입력을 섞는 함수가 아니다.
//   XOR은 대합(involution)이라 완벽히 가역이고, 홀수 곱은 모듈러 역원이 있다.
//   따라서 전단사가 그대로 유지된다.
//
// 왜 런타임 생성이 안전한가 (기획서 금지 3)
//   xorshift32는 정수 비트 연산만 쓴다. 모든 JS 엔진에서 비트 단위로 동일하다.
//   Math.cos와 달리 플랫폼 차이가 없으므로 테이블로 굳히지 않아도 결정적이다.

/** 정수 전용 xorshift32. 부동소수점을 쓰지 않으므로 어디서나 같은 값이 나온다. */
function xorshift32(seed) {
  let s = seed | 0;
  if (s === 0) s = 0x9e3779b9 | 0;
  return () => {
    s ^= s << 13;
    s |= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s |= 0;
    return s >>> 0;
  };
}

const SALT_SEED = 0x5ab1e901;
const SPREAD_SEED = 0x9e3779b9;
const SPREAD_ALT_SEED = 0x85ebca6b;

function buildBigInt(seed, byteCount) {
  const next = xorshift32(seed);
  let v = 0n;
  for (let i = 0; i < byteCount; i++) v = (v << 8n) | BigInt(next() & 0xff);
  return v;
}

const saltCache = new Map();

/**
 * 코드워드 폭에 맞는 소금 상수.
 *
 * 이 값을 XOR하면 좌표가 작아도 헤더와 상위 평면이 0이 아니게 된다.
 * XOR은 자기 자신이 역함수이므로 되돌리는 데 추가 계산이 없다.
 */
export function saltFor(totalBits) {
  const cached = saltCache.get(totalBits);
  if (cached !== undefined) return cached;
  const mask = (1n << BigInt(totalBits)) - 1n;
  const salt = buildBigInt(SALT_SEED, Math.ceil(totalBits / 8)) & mask;
  saltCache.set(totalBits, salt);
  return salt;
}

const spreadCache = new Map();

/** 축 폭 전체를 채우는 고정 확산 상수. 점프 값을 잘라내는 원본이다. */
export function spreadFor(axisBits) {
  const cached = spreadCache.get(axisBits);
  if (cached !== undefined) return cached;
  const mask = (1n << BigInt(axisBits)) - 1n;
  const spread = buildBigInt(SPREAD_SEED, Math.ceil(axisBits / 8)) & mask;
  spreadCache.set(axisBits, spread);
  return spread;
}

/**
 * 국소성 단계.
 *
 * 자리값 순서가 평면 우선(cr → cb → amp → basis → dc → mode → 헤더)이므로
 * 점프 값의 비트 폭이 "한 걸음에 어느 평면까지 바뀌는지"를 직접 결정한다.
 * 이것이 이 프로젝트의 국소성 슬라이더다.
 *
 * width는 축 비트 수에 대한 비율로 준다. 티어가 달라도 체감이 비슷해진다.
 */
// 자리값 순서가 블록 우선이므로 점프 폭은 "한 걸음에 몇 개의 블록이
// 통째로 새로 칠해지는지"를 정한다. 라벨은 그 체감을 그대로 적었다.
export const LOCALITY_LEVELS = [
  { label: '색조만', ratio: 0 },
  { label: '아주 조금', ratio: 1 / 16 },
  { label: '조금', ratio: 1 / 8 },
  { label: '보통', ratio: 1 / 4 },
  { label: '많이', ratio: 3 / 8 },
  { label: '아주 많이', ratio: 1 / 2 },
  { label: '거의 전부', ratio: 3 / 4 },
  { label: '전부', ratio: 1 },
];

export const DEFAULT_LOCALITY = 4;

/** 국소성 단계의 점프 비트 폭. */
export function localityWidth(level, axisBits) {
  const ratio = LOCALITY_LEVELS[level].ratio;
  if (ratio === 0) return 1;
  const width = Math.floor(axisBits * ratio);
  return width < 1 ? 1 : width > axisBits ? axisBits : width;
}

const spreadAltCache = new Map();

/** 두 번째 확산 상수. 두 축이 서로 다른 방식으로 섞이게 만든다. */
export function spreadAltFor(axisBits) {
  const cached = spreadAltCache.get(axisBits);
  if (cached !== undefined) return cached;
  const mask = (1n << BigInt(axisBits)) - 1n;
  const spread = buildBigInt(SPREAD_ALT_SEED, Math.ceil(axisBits / 8)) & mask;
  spreadAltCache.set(axisBits, spread);
  return spread;
}

const mixCache = new Map();

/**
 * 국소성 단계에 해당하는 좌표 혼합 계수.
 *
 *   high = (jy * y)            mod N
 *   low  = (jx * x + jz * y)   mod N
 *
 * 왜 계수가 세 개인가:
 *   처음에는 004를 따라 high = J*y, low = J*(x+y)를 썼다. 그러자 (x+1, y-1)로
 *   움직여도 x+y가 그대로여서 팔레트와 하위 블록이 불변이었다.
 *   결과적으로 반대각선마다 똑같은 작품이 반복되는 벽지 무늬가 나왔다.
 *   x와 y에 서로 다른 계수를 주면 그 불변 방향이 사라진다.
 *
 * 전단사 조건:
 *   변환 행렬은 [[0, jy], [jx, jz]]이고 행렬식은 -jx*jy다.
 *   jx와 jy가 모두 홀수이므로 행렬식은 홀수이고, 2의 거듭제곱 모듈러스에서
 *   홀수는 반드시 역원을 가진다. 따라서 어떤 단계에서도 전단사가 유지된다.
 *
 *   jz는 아무 값이어도 된다(짝수 허용). jz = jx ^ jy로 두면
 *   jy가 홀수이므로 jz != jx가 항상 보장되어 불변 방향이 생기지 않는다.
 */
export function localityMix(level, axisBits) {
  const key = `${level}:${axisBits}`;
  const cached = mixCache.get(key);
  if (cached !== undefined) return cached;

  if (!Number.isInteger(level) || level < 0 || level >= LOCALITY_LEVELS.length) {
    throw new RangeError(`국소성 단계 ${level}이(가) 범위를 벗어났다`);
  }

  const width = localityWidth(level, axisBits);
  const mask = (1n << BigInt(width)) - 1n;
  const jx = (spreadFor(axisBits) & mask) | 1n;
  const jy = (spreadAltFor(axisBits) & mask) | 1n;
  const jz = jx ^ jy; // 짝수. jy가 홀수라 항상 jz != jx.

  const mix = Object.freeze({ level, width, jx, jy, jz, axisBits });
  mixCache.set(key, mix);
  return mix;
}
