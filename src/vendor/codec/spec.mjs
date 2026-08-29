// BSC-1 명세 — 필드 정의, 진법 표, 티어 파라미터
//
// 이 파일의 수치는 기획서 6장의 "참조값"이다.
// 표의 크기(진법 값)를 유지하는 한 나머지 수치는 미감을 위해 자유롭게 조정해도
// 전단사가 깨지지 않는다. 진법 값을 바꾸면 주소 공간의 크기가 바뀌므로
// URL 버전을 올려야 한다.

export const VERSION = 'v1';

/** 출력 해상도. 정사각형. */
export const CANVAS = 256;

/** 기저 패턴 해상도. 8x8 고정. */
export const BASIS_SIZE = 8;

/** 기저 테이블이 정수로 스케일링된 비트 수. 값 = 실수 * (1 << 6) */
export const BASIS_SHIFT = 6;

/** 허용 티어(블록 그리드 한 변). 미술관의 층에 해당한다. */
export const TIERS = [4, 8, 16];

export const DEFAULT_TIER = 8;

// 전역 색조/세기 필드. 주소의 가장 낮은 자리에 둔다.
//
// 왜 최상위가 아니라 최하위인가:
//   처음에는 헤더를 최상위에 뒀다. 그러자 걸어서 도달하는 좌표는 헤더 자리를
//   건드리지 못해 이웃 전체가 한 색조(초록)에 갇혔다. 실제로 그렇게 나왔다.
//   전역 파라미터는 오히려 가장 자주 바뀌어야 이웃마다 팔레트가 달라진다.
export const HEADER_LOW_FIELDS = [
  { name: 'quant', radix: 16 }, // 양자화 스텝. 한 걸음의 가장 미세한 변화.
  { name: 'baseCr', radix: 16 }, // 기준 Cr
  { name: 'baseCb', radix: 16 }, // 기준 Cb
  { name: 'baseLuma', radix: 64 }, // 첫 행/열 예측에 쓰이는 기준 밝기
];

// 거의 바뀌지 않아야 하는 필드. 주소의 가장 높은 자리에 둔다.
export const HEADER_HIGH_FIELDS = [
  { name: 'profile', radix: 4 }, // 예측 모드 집합 변형. v1은 0만 구현.
  { name: 'reserved', radix: 16 }, // v1에서는 해석하지 않는다. 주소 공간에는 포함된다.
];

/** 검증과 순회용 전체 헤더 목록. */
export const HEADER_FIELDS = [...HEADER_LOW_FIELDS, ...HEADER_HIGH_FIELDS];

// 블록당 필드.
//
// 블록 우선(block-major)으로 묶는다. 평면 우선이 아니다.
//
// 왜 블록 우선인가:
//   평면 우선으로 두면 각 평면이 연속된 큰 비트 구간을 차지한다. 그러면 점프 폭이
//   좁을 때 크로마 평면만 바뀌고 무늬와 구조는 절대 바뀌지 않는다.
//   블록 우선이면 점프 폭이 "몇 개의 블록이 통째로 새로 칠해지는지"를 정한다.
//   한 걸음마다 그림의 일부 영역이 완전히 다시 그려지고 나머지는 남는다.
//   이것이 "옆 칸은 옆 그림"을 눈에 보이게 만든다.
export const BLOCK_FIELDS = [
  { name: 'cr', radix: 16 },
  { name: 'cb', radix: 16 },
  { name: 'amp', radix: 8 },
  { name: 'basis', radix: 64 },
  { name: 'dc', radix: 32 },
  { name: 'mode', radix: 8 },
];

/** 예측 모드 이름. 인덱스가 곧 mode 필드 값이다. */
export const MODE_NAMES = [
  'DC',
  'VERTICAL',
  'HORIZONTAL',
  'DIAG_45',
  'DIAG_135',
  'SMOOTH',
  'SMOOTH_V',
  'SMOOTH_H',
];

// ── 양자화 표 ────────────────────────────────────────────────────────────
// 모두 quant(0..15)로 색인한다. 값은 미감 조절용이며 크기(16)만 고정이다.

/** amp 인덱스 → 부호 있는 배수. 인덱스 0은 AC 성분 없음. */
export const AMP_MULT = [0, 1, -1, 2, -2, 4, -4, 8];

// 아래 세 표의 최댓값이 미감을 지배한다.
// 너무 크면 모든 값이 0 또는 255로 포화되어 원색 노이즈가 되고,
// 너무 작으면 004처럼 뿌옇고 밋밋해진다.
// dc는 (dc-16) 범위가 [-16,15], amp는 최대 8배, 크로마는 (c-8) 범위가 [-8,7]이므로
// 최댓값을 각각 12 / 16 / 14로 두면 대체로 0..255 안에서 움직이면서
// 일부만 포화되어 "심하게 압축된" 느낌이 남는다.

/** dc 보정 = (dc - 16) * LUMA_DC_STEP[quant] */
export const LUMA_DC_STEP = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 9, 10, 12];

/** AC 기여 = (AMP_MULT[amp] * AC_STEP[quant] * basisValue) >> BASIS_SHIFT */
export const AC_STEP = [1, 1, 2, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16];

/** 크로마 보정 = (cb - 8) * CHROMA_STEP[quant] */
export const CHROMA_STEP = [1, 1, 2, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

/** dc 필드의 중앙값. (dc - DC_BIAS)가 부호 있는 보정이 된다. */
export const DC_BIAS = 16;

/** cb/cr 필드의 중앙값. */
export const CHROMA_BIAS = 8;

// ── 스펙 빌더 ────────────────────────────────────────────────────────────

function bitsOf(radix) {
  const bits = Math.log2(radix);
  return Number.isInteger(bits) ? bits : null;
}

/**
 * 진법 목록을 만든다. 순서가 곧 자리값 순서(LSB → MSB)다.
 *
 * 실제 결과물을 보고 확정한 순서다. (기획서 6.4를 개정)
 *   1. 전역 색조/세기      quant → baseCr → baseCb → baseLuma
 *   2. 블록 우선, 역래스터  우하단 블록부터 [cr, cb, amp, basis, dc, mode]
 *   3. 거의 안 바뀔 필드    profile → reserved
 *
 * 이 순서 덕분에
 *   - 가장 작은 한 걸음은 양자화만 바꾼다 (아주 미세)
 *   - 걸음이 커지면 우하단부터 블록이 통째로 새로 칠해진다
 *   - 팔레트가 이웃마다 달라진다 (헤더가 낮은 자리라서)
 *
 * 순서를 바꿔도 전단사는 절대 깨지지 않는다. 미감 조절용 손잡이다.
 */
function buildDigitPlan(blockCount, headerLow, blockFields, headerHigh) {
  const digits = [];

  for (const field of headerLow) {
    digits.push({ kind: 'header', field: field.name, radix: field.radix });
  }

  for (let block = blockCount - 1; block >= 0; block--) {
    for (const field of blockFields) {
      digits.push({ kind: 'block', plane: field.name, block, radix: field.radix });
    }
  }

  for (const field of headerHigh) {
    digits.push({ kind: 'header', field: field.name, radix: field.radix });
  }

  return digits;
}

/**
 * 티어 하나의 완전한 명세를 만든다.
 *
 * 모든 진법이 2의 거듭제곱이므로 전체 공간이 정확히 2^totalBits가 되고,
 * 그 결과 바이트 정렬 · 축 분할 · 홀수 곱 역원이 모두 자동으로 맞는다.
 * (기획서 6.2 참조)
 */
export function buildSpec({
  tier,
  headerLow = HEADER_LOW_FIELDS,
  headerHigh = HEADER_HIGH_FIELDS,
  blockFields = BLOCK_FIELDS,
  label = null,
} = {}) {
  const blockCount = tier * tier;
  const digits = buildDigitPlan(blockCount, headerLow, blockFields, headerHigh);

  const radices = digits.map(d => d.radix);
  const widths = digits.map(d => {
    const bits = bitsOf(d.radix);
    if (bits === null) {
      throw new Error(`진법 ${d.radix}은(는) 2의 거듭제곱이 아니다. v1은 이 제약을 유지한다.`);
    }
    return bits;
  });

  const totalBits = widths.reduce((a, b) => a + b, 0);
  // 8의 배수여야 바이트열로 정확히 담을 수 있다. 8의 배수면 짝수이므로
  // 두 축으로 균등 분할하는 조건도 자동으로 만족한다.
  // 축 비트(totalBits / 2)는 바이트 정렬될 필요가 없다. BigInt 비트 연산으로 다룬다.
  if (totalBits % 8 !== 0) {
    throw new Error(`티어 ${tier}의 전체 비트 ${totalBits}이(가) 8의 배수가 아니다.`);
  }

  const blockPx = CANVAS / tier;
  if (!Number.isInteger(blockPx)) throw new Error(`티어 ${tier}는 ${CANVAS}를 나누지 못한다.`);
  const basisScale = blockPx / BASIS_SIZE;
  if (!Number.isInteger(basisScale)) throw new Error(`티어 ${tier}의 기저 확대 배율이 정수가 아니다.`);

  return {
    label: label ?? `tier-${tier}`,
    tier,
    blockCount,
    blockPx,
    logBlockPx: Math.log2(blockPx),
    basisScale,
    logBasisScale: Math.log2(basisScale),
    chromaBlockPx: blockPx / 2,
    digits,
    radices,
    widths,
    totalBits,
    byteLength: totalBits / 8,
    axisBits: totalBits / 2,
    headerLow,
    headerHigh,
    blockFields,
    bitsPerBlock: blockFields.reduce((sum, f) => sum + bitsOf(f.radix), 0),
  };
}

const specCache = new Map();

/** 티어 하나의 명세를 얻는다. 결과는 캐시되며 불변으로 취급한다. */
export function tierSpec(tier) {
  if (!TIERS.includes(tier)) throw new RangeError(`지원하지 않는 티어: ${tier}`);
  let spec = specCache.get(tier);
  if (!spec) {
    spec = buildSpec({ tier });
    specCache.set(tier, spec);
  }
  return spec;
}

/**
 * 테스트용 축소 명세. 전 공간 전수검사가 가능한 크기다.
 *
 * 실제 티어와 같은 자리값 순서 로직을 쓰지만 진법을 아주 작게 줄였다.
 * 바이트 정렬은 요구하지 않으므로 buildSpec을 우회한다.
 */
export function miniSpec() {
  const headerLow = [{ name: 'quant', radix: 2 }];
  const headerHigh = [{ name: 'reserved', radix: 2 }];
  const blockFields = [
    { name: 'cr', radix: 2 },
    { name: 'mode', radix: 2 },
  ];
  const blockCount = 2;
  const digits = buildDigitPlan(blockCount, headerLow, blockFields, headerHigh);
  const radices = digits.map(d => d.radix);
  const widths = digits.map(d => bitsOf(d.radix));
  const totalBits = widths.reduce((a, b) => a + b, 0);
  return {
    label: 'mini',
    tier: null,
    blockCount,
    digits,
    radices,
    widths,
    totalBits,
    byteLength: Math.ceil(totalBits / 8),
    axisBits: totalBits / 2,
    headerLow,
    headerHigh,
    blockFields,
  };
}
