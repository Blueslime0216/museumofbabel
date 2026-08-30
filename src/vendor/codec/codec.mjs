// BSC-1 디코더 — 주소를 픽셀로 해석한다
//
// 기획서 6.5. 이 파일에는 다음이 없다.
//   - 유효성 검사와 재시도 (무효를 표현할 수 없으므로 검사할 것이 없다)
//   - 해시와 난수 (주소는 해석하는 것이지 생성하는 것이 아니다)
//   - 부동소수점 (같은 주소가 어디서든 같은 픽셀을 내야 한다)
//
// 미감의 원천은 두 가지다.
//   1. 폐루프 인트라 예측. 예측이 "재구성된" 이웃을 참조하므로
//      한 블록의 변화가 우하단으로 계속 번진다.
//   2. 최근접 크로마 업샘플. 색이 밝기와 어긋나 블록 단위로 번진다.

import {
  CANVAS,
  tierSpec,
  AMP_MULT,
  QUANT_PROFILES,
  decodeReserved,
  DC_BIAS,
  CHROMA_BIAS,
} from './spec.mjs';
import { BASIS, BASIS_SIZE, BASIS_SHIFT } from './basis.mjs';
import { codeToBytes, decomposeBytes, composeBytes, bytesToCode } from './radix.mjs';

/** 크로마 평면 해상도. 4:2:0이므로 루마의 절반. */
export const CHROMA = CANVAS / 2;

/**
 * 기저 기여를 반올림하기 위해 더하는 값. 2^(BASIS_SHIFT-1) = 32.
 *
 * 왜 필요한가:
 *   기여는 (ampCoef * bval) >> BASIS_SHIFT 로 계산한다. `>>`는 산술 시프트라
 *   내림이고, 음수에서는 0에서 멀어지는 쪽으로 내려간다. 그래서 양수 기여는
 *   0쪽으로 깎이고 음수 기여는 더 커진다. 결과는 한쪽으로 쏠린 편향이다.
 *
 *   실측하면 |ampCoef|가 작을 때 픽셀마다 평균 -0.49 만큼 어두워졌다.
 *   기저 표 전체에 걸쳐 거의 정확히 -0.5 다. ampCoef=1 에서는 기저 칸의
 *   49.2%가 0으로 죽어 서로 다른 기저가 같은 그림이 되기도 했다.
 *
 *   32를 더하고 시프트하면 가장 가까운 정수로 반올림된다. 실측 편향이
 *   -0.4922 에서 +0.0078 로 떨어진다. 여전히 정수 연산만 쓴다.
 *
 *   AMP_MULT의 비대칭과 같은 종류의 결함이었다. 미감 조절이 아니다.
 */
const BASIS_ROUND = 1 << (BASIS_SHIFT - 1);

// ── 필드 값 확장 ─────────────────────────────────────────────────────────
// 좁은 필드를 0..255로 펼친다. 최댓값이 정확히 255가 되도록 상위 비트를 반복한다.

/** 6비트(0..63) → 0..255 */
function expand6(v) {
  return ((v << 2) | (v >> 4)) & 0xff;
}

/** 4비트(0..15) → 0..255 */
function expand4(v) {
  return ((v << 4) | v) & 0xff;
}

// ── 필드 컨테이너 ────────────────────────────────────────────────────────

/** 재사용 가능한 필드 저장소를 만든다. 셀마다 새로 할당하지 않기 위해 존재한다. */
export function createFields(spec) {
  const n = spec.blockCount;
  return {
    spec,
    header: { baseLuma: 0, baseCb: 0, baseCr: 0, quant: 0, profile: 0, reserved: 0 },
    mode: new Uint8Array(n),
    dc: new Uint8Array(n),
    basis: new Uint8Array(n),
    amp: new Uint8Array(n),
    cb: new Uint8Array(n),
    cr: new Uint8Array(n),
  };
}

/**
 * 코드워드를 필드로 분해한다.
 *
 * 나눗셈과 나머지(= 하위 비트 읽기)뿐이다. 모든 코드워드가 성공한다.
 */
export function decodeFields(spec, code, into = null) {
  const fields = into ?? createFields(spec);
  const bytes = codeToBytes(code, spec.byteLength);
  const digits = decomposeBytes(bytes, spec.widths);
  const plan = spec.digits;

  for (let i = 0; i < plan.length; i++) {
    const slot = plan[i];
    if (slot.kind === 'block') fields[slot.plane][slot.block] = digits[i];
    else fields.header[slot.field] = digits[i];
  }
  return fields;
}

/** 필드를 코드워드로 합성한다. decodeFields의 정확한 역함수. */
export function encodeFields(spec, fields) {
  const plan = spec.digits;
  const digits = new Array(plan.length);
  for (let i = 0; i < plan.length; i++) {
    const slot = plan[i];
    digits[i] = slot.kind === 'block' ? fields[slot.plane][slot.block] : fields.header[slot.field];
  }
  return bytesToCode(composeBytes(digits, spec.widths, spec.byteLength));
}

// ── 프레임 버퍼 ──────────────────────────────────────────────────────────

/** 재사용 가능한 렌더 버퍼. 셀마다 새로 할당하면 GC가 프레임을 잡아먹는다. */
export function createFrame(spec) {
  const B = spec.blockPx;
  return {
    spec,
    luma: new Uint8Array(CANVAS * CANVAS),
    chromaB: new Uint8Array(CHROMA * CHROMA),
    chromaR: new Uint8Array(CHROMA * CHROMA),
    rgba: new Uint8ClampedArray(CANVAS * CANVAS * 4),
    pred: new Int32Array(B * B),
    top: new Int32Array(B),
    topRight: new Int32Array(B),
    left: new Int32Array(B),
    fields: createFields(spec),
  };
}

// ── 인트라 예측 ──────────────────────────────────────────────────────────

/**
 * 블록 하나를 예측한다. 전부 정수 연산이며 나눗셈은 시프트로만 한다.
 *
 * 가중치 합이 항상 B(2의 거듭제곱)이므로 >> logB가 정확한 나눗셈이다.
 */
export function predictBlock(mode, B, logB, top, topRight, left, topLeft, pred) {
  switch (mode) {
    case 0: {
      // DC — 위와 왼쪽 참조의 평균. 블록 경계를 만든다.
      let sum = 0;
      for (let i = 0; i < B; i++) sum += top[i] + left[i];
      const dc = (sum + B) >> (logB + 1);
      pred.fill(dc);
      break;
    }
    case 1: {
      // VERTICAL — 위쪽 행을 아래로 복제. 수직 줄무늬.
      for (let y = 0; y < B; y++) {
        const row = y * B;
        for (let x = 0; x < B; x++) pred[row + x] = top[x];
      }
      break;
    }
    case 2: {
      // HORIZONTAL — 왼쪽 열을 오른쪽으로 복제. 수평 줄무늬.
      for (let y = 0; y < B; y++) {
        const row = y * B;
        const v = left[y];
        for (let x = 0; x < B; x++) pred[row + x] = v;
      }
      break;
    }
    case 3: {
      // DIAG_45 — 위쪽 참조를 좌하 방향으로 끌어당긴다. 사선 줄무늬.
      const lastRight = B - 1;
      for (let y = 0; y < B; y++) {
        const row = y * B;
        for (let x = 0; x < B; x++) {
          const i = x + y + 1;
          pred[row + x] = i < B ? top[i] : topRight[i - B < lastRight ? i - B : lastRight];
        }
      }
      break;
    }
    case 4: {
      // DIAG_135 — 좌상 참조를 우하 방향으로 끌어당긴다.
      for (let y = 0; y < B; y++) {
        const row = y * B;
        for (let x = 0; x < B; x++) {
          pred[row + x] = x > y ? top[x - y - 1] : x < y ? left[y - x - 1] : topLeft;
        }
      }
      break;
    }
    case 5: {
      // SMOOTH — 수직/수평 감쇠를 섞는다. 넓은 번짐.
      const bottom = left[B - 1];
      const right = top[B - 1];
      for (let y = 0; y < B; y++) {
        const row = y * B;
        const wy = B - 1 - y;
        const wyi = y + 1;
        for (let x = 0; x < B; x++) {
          const v = (top[x] * wy + bottom * wyi) >> logB;
          const h = (left[y] * (B - 1 - x) + right * (x + 1)) >> logB;
          pred[row + x] = (v + h + 1) >> 1;
        }
      }
      break;
    }
    case 6: {
      // SMOOTH_V — 위에서 아래로 감쇠.
      const bottom = left[B - 1];
      for (let y = 0; y < B; y++) {
        const row = y * B;
        const wy = B - 1 - y;
        const wyi = y + 1;
        for (let x = 0; x < B; x++) pred[row + x] = (top[x] * wy + bottom * wyi) >> logB;
      }
      break;
    }
    default: {
      // SMOOTH_H — 왼쪽에서 오른쪽으로 감쇠.
      const right = top[B - 1];
      for (let y = 0; y < B; y++) {
        const row = y * B;
        const v = left[y];
        for (let x = 0; x < B; x++) pred[row + x] = (v * (B - 1 - x) + right * (x + 1)) >> logB;
      }
      break;
    }
  }
}

/**
 * 블록의 참조 픽셀을 모은다.
 *
 * 이미 재구성된 위쪽 행과 왼쪽 열만 본다. 이것이 폐루프이며,
 * 한 블록의 변화가 우하단으로 번지는 이유다.
 * 이미지 경계에서는 헤더의 baseLuma를 참조값으로 쓴다.
 */
export function gatherReferences(luma, px0, py0, B, base, top, topRight, left) {
  if (py0 === 0) {
    top.fill(base);
    topRight.fill(base);
  } else {
    const row = (py0 - 1) * CANVAS;
    for (let i = 0; i < B; i++) top[i] = luma[row + px0 + i];
    const limit = CANVAS - 1;
    for (let i = 0; i < B; i++) {
      let sx = px0 + B + i;
      if (sx > limit) sx = limit; // 오른쪽 끝은 마지막 값을 복제한다
      topRight[i] = luma[row + sx];
    }
  }

  if (px0 === 0) {
    left.fill(base);
  } else {
    for (let i = 0; i < B; i++) left[i] = luma[(py0 + i) * CANVAS + px0 - 1];
  }

  if (py0 === 0 || px0 === 0) return base;
  return luma[(py0 - 1) * CANVAS + px0 - 1];
}

/**
 * 예측 결과에 DC 보정과 기저를 더해 루마 평면에 쓴다.
 *
 * 디코더와 투영기가 **반드시 같은 식**을 써야 하므로 여기 한 곳에만 둔다.
 * 그래야 decode(project(img))가 투영 미리보기와 일치한다.
 */
export function writeBlock(
  luma,
  px0,
  py0,
  B,
  logScale,
  pred,
  dcOffset,
  ampCoef,
  basisIndex,
  basisBlend = 0,
) {
  const patternBase = basisIndex * (BASIS_SIZE * BASIS_SIZE);
  const last = BASIS_SIZE - 1;
  // 혼합 방향. 이웃 기저 칸을 어느 쪽에서 끌어올지 정한다.
  const stepX = basisBlend === 1 || basisBlend === 3 ? 1 : 0;
  const stepY = basisBlend === 2 || basisBlend === 3 ? 1 : 0;

  for (let y = 0; y < B; y++) {
    const predRow = y * B;
    const lumaRow = (py0 + y) * CANVAS + px0;
    const sy = y >> logScale;
    const patternRow = patternBase + sy * BASIS_SIZE;
    // 이웃 행은 끝에서 자기 자신을 복제한다. 그래야 경계가 튀지 않는다.
    const nyRow = patternBase + (sy + stepY > last ? last : sy + stepY) * BASIS_SIZE;

    for (let x = 0; x < B; x++) {
      const sx = x >> logScale;
      // 기저는 8x8을 정수 배율로 복제해 확대한다. 블록 경계가 남는다.
      let bval = BASIS[patternRow + sx];
      if (basisBlend !== 0) {
        const nx = sx + stepX > last ? last : sx + stepX;
        // 이웃 칸과 반씩 섞는다. 단일 DCT 기저가 아닌 패턴이 나온다.
        // >>는 산술 시프트라 음수에서도 결정론적이다.
        bval = (bval + BASIS[nyRow + nx]) >> 1;
      }
      let v = pred[predRow + x] + dcOffset + ((ampCoef * bval + BASIS_ROUND) >> BASIS_SHIFT);
      if (v < 0) v = 0;
      else if (v > 255) v = 255;
      luma[lumaRow + x] = v;
    }
  }
}

// ── 렌더링 ───────────────────────────────────────────────────────────────

/**
 * 필드를 256x256 RGBA로 렌더한다.
 *
 * 예외를 던지지 않는다. 어떤 필드 조합이라도 그림이 나온다.
 */
export function renderFields(spec, fields, frame) {
  const { luma, chromaB, chromaR, rgba, pred, top, topRight, left } = frame;
  const G = spec.tier;
  const B = spec.blockPx;
  const logB = spec.logBlockPx;
  const logScale = spec.logBasisScale;
  const header = fields.header;

  const base = expand6(header.baseLuma);
  const quant = header.quant;

  // profile은 양자화 계열을 고른다. v1은 이 필드를 읽지 않아서 4개의 주소가
  // 같은 그림을 냈다. 진법이 4이므로 값은 이미 0..3 안에 있다.
  const tables = QUANT_PROFILES[header.profile];
  const dcStep = tables.lumaDc[quant];
  const acStep = tables.ac[quant];
  const chromaStep = tables.chroma[quant];

  // reserved는 기저 혼합(하위 2비트)과 크로마 어긋남(상위 2비트)으로 나뉜다.
  const { basisBlend, chromaShift } = decodeReserved(header.reserved);

  // 1. 루마 평면 — 래스터 순서로 폐루프 재구성
  for (let by = 0; by < G; by++) {
    const py0 = by * B;
    for (let bx = 0; bx < G; bx++) {
      const bi = by * G + bx;
      const px0 = bx * B;

      const topLeft = gatherReferences(luma, px0, py0, B, base, top, topRight, left);
      predictBlock(fields.mode[bi], B, logB, top, topRight, left, topLeft, pred);

      writeBlock(
        luma,
        px0,
        py0,
        B,
        logScale,
        pred,
        (fields.dc[bi] - DC_BIAS) * dcStep,
        AMP_MULT[fields.amp[bi]] * acStep,
        fields.basis[bi],
        basisBlend,
      );
    }
  }

  // 2. 크로마 평면 — 블록 단위 평탄 채움
  const baseCb = expand4(header.baseCb);
  const baseCr = expand4(header.baseCr);
  const CB = spec.chromaBlockPx;
  for (let by = 0; by < G; by++) {
    const cy0 = by * CB;
    for (let bx = 0; bx < G; bx++) {
      const bi = by * G + bx;
      const cx0 = bx * CB;

      let vb = baseCb + (fields.cb[bi] - CHROMA_BIAS) * chromaStep;
      if (vb < 0) vb = 0;
      else if (vb > 255) vb = 255;

      let vr = baseCr + (fields.cr[bi] - CHROMA_BIAS) * chromaStep;
      if (vr < 0) vr = 0;
      else if (vr > 255) vr = 255;

      for (let y = 0; y < CB; y++) {
        const row = (cy0 + y) * CHROMA + cx0;
        for (let x = 0; x < CB; x++) {
          chromaB[row + x] = vb;
          chromaR[row + x] = vr;
        }
      }
    }
  }

  // 3. YCbCr → RGB. 크로마는 최근접으로 2배 확대한다(의도적).
  //    BT.601 계수를 65536배 정수로 굳혔다.
  // 크로마 평면을 반 블록씩 밀어 루마와 어긋내게 한다. reserved 상위 2비트.
  // 밀린 만큼은 평면 끝에서 감긴다. CHROMA가 2의 거듭제곱이라 마스크로 된다.
  const shiftMask = CHROMA - 1;
  const halfChromaBlock = CB >> 1;
  const shiftX = chromaShift & 1 ? halfChromaBlock : 0;
  const shiftY = chromaShift & 2 ? halfChromaBlock : 0;

  let o = 0;
  for (let y = 0; y < CANVAS; y++) {
    const chromaRow = (((y >> 1) + shiftY) & shiftMask) * CHROMA;
    const lumaRow = y * CANVAS;
    for (let x = 0; x < CANVAS; x++) {
      const Y = luma[lumaRow + x];
      const cx = ((x >> 1) + shiftX) & shiftMask;
      const cb = chromaB[chromaRow + cx] - 128;
      const cr = chromaR[chromaRow + cx] - 128;
      // Uint8ClampedArray가 0..255로 자동 클램프한다.
      rgba[o] = Y + ((91881 * cr) >> 16);
      rgba[o + 1] = Y - ((22554 * cb + 46802 * cr) >> 16);
      rgba[o + 2] = Y + ((116130 * cb) >> 16);
      rgba[o + 3] = 255;
      o += 4;
    }
  }

  return frame;
}

/**
 * 코드워드 하나를 256x256 RGBA로 만든다.
 *
 * 이 프로젝트의 핵심 한 줄. 검색도, 시행착오도, 실패도 없다.
 */
export function renderCode(spec, code, frame) {
  const target = frame ?? createFrame(spec);
  decodeFields(spec, code, target.fields);
  return renderFields(spec, target.fields, target);
}

/** 편의 함수. 티어 번호로 바로 렌더한다. */
export function renderTierCode(tier, code, frame) {
  return renderCode(tierSpec(tier), code, frame);
}
