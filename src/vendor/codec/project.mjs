// 업로드 투영 — 이미지 → 주소
//
// 기획서 9장. 솔직하게 밝혀야 할 것:
//   이것은 무손실 왕복이 아니다. 임의의 사진을 256x256에 블록당 25비트로 담을 수 없다.
//   "업로드한 이미지에 가장 가까운 미술관의 좌표"를 찾는 손실 투영이다.
//
// 여기서는 탐색을 허용한다. 지켜야 할 불변식은
// "주소에서 이미지로 가는 unrank가 검색 없이 항상 성공하는 것"이며,
// 그 반대 방향은 최적화 문제이기 때문이다.
//
// 반드시 지킬 것:
//   투영기는 원본 이웃이 아니라 **재구성된 이웃**을 참조해야 한다.
//   그래야 decode(project(img))가 투영 미리보기와 정확히 일치한다.
//   그래서 블록 재구성은 codec.mjs의 writeBlock을 그대로 재사용한다.

import {
  CANVAS,
  tierSpec,
  AMP_MULT,
  LUMA_DC_STEP,
  AC_STEP,
  CHROMA_STEP,
  DC_BIAS,
  CHROMA_BIAS,
  MODE_NAMES,
} from './spec.mjs';
import { BASIS, BASIS_SIZE, BASIS_SHIFT, BASIS_ENERGY } from './basis.mjs';
import {
  CHROMA,
  blockValueCount,
  packBlock,
  createFields,
  createFrame,
  encodeFields,
  gatherReferences,
  gatherReferencesReversed,
  predictBlock,
  renderCode,
  unpackBlock,
  writeBlock,
} from './codec.mjs';
import { codeToCoordinates, localityMix } from './space.mjs';
import { MODE_SETS, roomOf, roomStyle, styleAt } from './rooms.mjs';

/**
 * 시험해 볼 양자화 후보. 16개 전부.
 *
 * 이것은 rank 방향의 탐색이므로 허용된다. unrank(주소 → 그림)는 여전히
 * 검색이 없다는 불변식을 지킨다.
 */
const QUANT_CANDIDATES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

const PATTERN_AREA = BASIS_SIZE * BASIS_SIZE;

/** 이미지를 256x256 RGBA로 정규화한다. 브라우저 캔버스가 리샘플링을 해 준다. */
function toRgba(source) {
  const canvas =
    typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(CANVAS, CANVAS)
      : Object.assign(document.createElement('canvas'), { width: CANVAS, height: CANVAS });
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, CANVAS, CANVAS);
  return ctx.getImageData(0, 0, CANVAS, CANVAS).data;
}

/** RGB → YCbCr. 크로마는 4:2:0으로 평균 다운샘플한다. */
function toYcbcr(rgba) {
  const luma = new Uint8Array(CANVAS * CANVAS);
  const cb = new Uint8Array(CHROMA * CHROMA);
  const cr = new Uint8Array(CHROMA * CHROMA);
  const cbSum = new Int32Array(CHROMA * CHROMA);
  const crSum = new Int32Array(CHROMA * CHROMA);

  for (let y = 0; y < CANVAS; y++) {
    for (let x = 0; x < CANVAS; x++) {
      const o = (y * CANVAS + x) * 4;
      const r = rgba[o];
      const g = rgba[o + 1];
      const b = rgba[o + 2];

      luma[y * CANVAS + x] = (19595 * r + 38470 * g + 7471 * b) >> 16;

      const ci = (y >> 1) * CHROMA + (x >> 1);
      cbSum[ci] += 128 + ((-11056 * r - 21712 * g + 32768 * b) >> 16);
      crSum[ci] += 128 + ((32768 * r - 27440 * g - 5328 * b) >> 16);
    }
  }

  for (let i = 0; i < cbSum.length; i++) {
    // 픽셀 4개 평균
    let v = (cbSum[i] + 2) >> 2;
    cb[i] = v < 0 ? 0 : v > 255 ? 255 : v;
    v = (crSum[i] + 2) >> 2;
    cr[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }

  return { luma, cb, cr };
}

function clampIndex(value, limit) {
  return value < 0 ? 0 : value > limit ? limit : value;
}

/** 가장 가까운 정수 인덱스. 음수에서도 대칭이 되도록 처리한다. */
function nearest(value, stepSize) {
  return value >= 0
    ? Math.floor((value + stepSize / 2) / stepSize)
    : -Math.floor((-value + stepSize / 2) / stepSize);
}

/**
 * 전시실 스타일에서 투영기가 쓸 값을 한 번만 뽑는다.
 *
 * 블록마다 계산하면 안 된다. 스타일은 그림 하나 안에서 상수다.
 */
function styleParams(style) {
  const modeSet = style?.modeSet ?? MODE_SETS.ALL;

  // 이 방에서 **실제로 낼 수 있는 모드**와, 그것을 내는 가장 작은 필드 값.
  //
  // 렌더러는 modeSet[필드값 % modeSet.length] 로 읽는다. 그래서 투영기는
  // 모드가 아니라 필드 값을 골라야 한다. 필드 진법이 8이고 modeSet 이 그보다
  // 짧으면 여러 필드 값이 같은 모드를 내므로, 중복은 버리고 하나만 남긴다.
  // (남은 필드 값들은 이 방에서 죽은 비트다 — 같은 그림에 주소가 여러 개 붙는다.)
  const modeChoices = [];
  const seen = new Set();
  for (let value = 0; value < MODE_NAMES.length; value++) {
    const mode = modeSet[value % modeSet.length];
    if (seen.has(mode)) continue;
    seen.add(mode);
    modeChoices.push({ value, mode });
  }

  return {
    modeChoices,
    openLoop: style?.openLoop === true,
    reverseScan: style?.reverseScan === true,
    negative: style?.negative === true,
    gather: style?.reverseScan === true ? gatherReferencesReversed : gatherReferences,
    // undefined = 블록마다, 0 = 전역 하나, n = n x n 구역이 공유
    zones: style?.chroma,
    // 이 방은 크로마를 루마에서 만든다. 블록 크로마 필드를 아무도 읽지 않는다.
    duotone: style?.duotoneLookup != null,
    satScale: style?.satScale ?? 256,
    hue: style?.hueLookup != null,
  };
}

/**
 * 크로마 필드를 채운다. 루마 폐루프와 완전히 독립이므로 미리 한 번에 끝낸다.
 *
 * 구역 공유(chroma: n)인 방에서는 렌더러가 **구역 대표 블록의 값만** 읽는다.
 * 그래서 구역 전체의 평균을 대표 블록에 적어야 한다. 나머지 블록에도 같은 값을
 * 넣어 두는데, 읽히지는 않지만 주소를 결정적으로 만들기 위해서다.
 */
function projectChroma(spec, target, fields, chromaStep, baseCbValue, baseCrValue, params) {
  const G = spec.tier;
  const CB = spec.chromaBlockPx;
  const { zones } = params;

  const quantise = (mean, baseValue) =>
    clampIndex(nearest(Math.round(mean) - baseValue, chromaStep) + CHROMA_BIAS, 15);

  // 전역 하나뿐인 방(단색). 렌더러가 CHROMA_BIAS 를 쓰므로 그대로 맞춘다.
  if (zones === 0) {
    fields.cb.fill(CHROMA_BIAS);
    fields.cr.fill(CHROMA_BIAS);
    return;
  }

  // 구역이 몇 블록을 덮는가. undefined 면 블록마다 하나(= 1블록 구역).
  const blocksPerZone = zones > 0 ? G / zones : 1;

  for (let zy = 0; zy < G; zy += blocksPerZone) {
    for (let zx = 0; zx < G; zx += blocksPerZone) {
      const cx0 = zx * CB;
      const cy0 = zy * CB;
      const span = blocksPerZone * CB;

      let cbTotal = 0;
      let crTotal = 0;
      for (let y = 0; y < span; y++) {
        const row = (cy0 + y) * CHROMA + cx0;
        for (let x = 0; x < span; x++) {
          cbTotal += target.cb[row + x];
          crTotal += target.cr[row + x];
        }
      }
      const area = span * span;
      const cbIndex = quantise(cbTotal / area, baseCbValue);
      const crIndex = quantise(crTotal / area, baseCrValue);

      for (let by = zy; by < zy + blocksPerZone; by++) {
        for (let bx = zx; bx < zx + blocksPerZone; bx++) {
          const bi = by * G + bx;
          fields.cb[bi] = cbIndex;
          fields.cr[bi] = crIndex;
        }
      }
    }
  }
}

/**
 * 한 양자화 후보로 전체 이미지를 탐욕적으로 투영한다.
 *
 * 블록을 그 방의 주사 순서대로 하나씩 확정하고, 확정한 결과를 즉시 재구성 버퍼에
 * 쓴다. 다음 블록은 그 재구성 결과를 참조한다. 폐루프다.
 *
 * `params` 가 전시실이다. 렌더러와 **정확히 같은** 참조·순서·모드 매핑을 써야
 * decode(project(img)) 가 미리보기와 픽셀 단위로 일치한다.
 */
function projectWithQuant(spec, target, quant, baseLuma, baseCb, baseCr, scratch, params) {
  const { fields, work, pred, top, topRight, left, sums } = scratch;
  const G = spec.tier;
  const B = spec.blockPx;
  const logB = spec.logBlockPx;
  const logScale = spec.logBasisScale;
  const tileArea = spec.basisScale * spec.basisScale;

  const dcStep = LUMA_DC_STEP[quant];
  const acStep = AC_STEP[quant];
  const chromaStep = CHROMA_STEP[quant];

  fields.header.quant = quant;
  fields.header.baseLuma = baseLuma;
  fields.header.baseCb = baseCb;
  fields.header.baseCr = baseCr;

  // 투영기는 기준 계열(profile 0, reserved 0)만 목표로 삼는다.
  //
  // 디코더는 profile 4종과 reserved 16종을 모두 해석하지만, 투영기가 그것까지
  // 탐색하면 비용이 64배가 된다. quant 후보 16개와 곱해지므로 티어 16에서
  // 도저히 못 쓴다.
  //
  // 이것은 손실을 감수하는 선택이며 불변식을 깨지 않는다. 투영기의 약속은
  // "업로드한 이미지에 가까운 좌표 하나를 찾는다"이지 "가장 가까운 좌표를
  // 찾는다"가 아니다. 기준 계열 안에서 가장 가까운 좌표를 찾는다.
  // 그래서 아래 writeBlock 호출도 기저 혼합 없이(기본값 0) 부른다.
  fields.header.profile = 0;
  fields.header.reserved = 0;

  const baseValue = ((baseLuma << 2) | (baseLuma >> 4)) & 0xff;
  const baseCbValue = ((baseCb << 4) | baseCb) & 0xff;
  const baseCrValue = ((baseCr << 4) | baseCr) & 0xff;

  // 크로마는 루마 폐루프와 무관하다. 미리 전부 채운다.
  projectChroma(spec, target, fields, chromaStep, baseCbValue, baseCrValue, params);

  const { modeChoices, openLoop, reverseScan, gather } = params;

  /**
   * 이 블록의 참조를 채운다. 렌더러의 같은 자리와 한 글자도 다르면 안 된다.
   *
   * 개방 루프는 이웃을 보지 않는다. 모든 참조가 상수이므로 어떤 예측기든 평탄한
   * 값을 낸다 — 즉 이 방에서는 모드 탐색이 무의미하다. 알려진 결함이며
   * test/rooms.test.mjs 가 현재 동작을 고정해 두었다.
   */
  const loadReferences = (px0, py0) => {
    if (openLoop) {
      top.fill(baseValue);
      topRight.fill(baseValue);
      left.fill(baseValue);
      return baseValue;
    }
    return gather(work, px0, py0, B, baseValue, top, topRight, left);
  };

  let totalError = 0;

  for (let step = 0; step < spec.blockCount; step++) {
    // 역방향 방은 우하단부터 그린다. 렌더러와 같은 순서여야 폐루프가 맞는다.
    const bi = reverseScan ? spec.blockCount - 1 - step : step;
    const by = (bi / G) | 0;
    const bx = bi - by * G;
    const py0 = by * B;
    const px0 = bx * B;

    {
      // ── 루마: 이 방이 낼 수 있는 모드만 비교한다 ──
      let bestFieldValue = modeChoices[0].value;
      let bestMode = modeChoices[0].mode;
      let bestDc = DC_BIAS;
      let bestBasis = 0;
      let bestAmp = 0;
      let bestError = Infinity;

      for (const choice of modeChoices) {
        const mode = choice.mode;
        const topLeft = loadReferences(px0, py0);
        predictBlock(mode, B, logB, top, topRight, left, topLeft, pred);

        // DC 보정을 직접 양자화한다
        let residualSum = 0;
        for (let y = 0; y < B; y++) {
          const predRow = y * B;
          const lumaRow = (py0 + y) * CANVAS + px0;
          for (let x = 0; x < B; x++) {
            residualSum += target.luma[lumaRow + x] - pred[predRow + x];
          }
        }
        const blockArea = B * B;
        const dcIndex = clampIndex(
          nearest(residualSum / blockArea, dcStep) + DC_BIAS,
          31,
        );
        const dcOffset = (dcIndex - DC_BIAS) * dcStep;

        // 남은 잔차를 8x8로 합산한다.
        // 기저는 타일 안에서 상수이므로 이렇게 줄여도 상관계수가 정확하다.
        sums.fill(0);
        for (let y = 0; y < B; y++) {
          const predRow = y * B;
          const lumaRow = (py0 + y) * CANVAS + px0;
          const sumRow = (y >> logScale) * BASIS_SIZE;
          for (let x = 0; x < B; x++) {
            sums[sumRow + (x >> logScale)] +=
              target.luma[lumaRow + x] - pred[predRow + x] - dcOffset;
          }
        }

        // 기저 64개 x 진폭 8개를 평가한다. 이득이 가장 큰 조합을 고른다.
        //
        // bestGain을 -Infinity로 두고 인덱스 0부터 돈다. AMP_MULT에 0이 없으므로
        // "AC를 넣지 않는다"는 선택지가 이제 존재하지 않는다. 이득이 음수인
        // 조합밖에 없어도 그중 가장 덜 나쁜 것을 골라야 한다.
        let bestGain = -Infinity;
        let chosenBasis = 0;
        let chosenAmp = 0;
        for (let k = 0; k < 64; k++) {
          const patternBase = k * PATTERN_AREA;
          let corr = 0;
          for (let p = 0; p < PATTERN_AREA; p++) corr += sums[p] * BASIS[patternBase + p];
          const energy = BASIS_ENERGY[k] * tileArea;

          for (let a = 0; a < AMP_MULT.length; a++) {
            // 디코더의 기여식과 같은 배율: (AMP_MULT * acStep * bval) >> 6
            // 이득은 2*s*corr - s^2*energy (s = AMP*acStep/64)인데,
            // 4096을 곱해 정수로 비교한다. 부동소수점 나눗셈을 피한다.
            const c = AMP_MULT[a] * acStep;
            const gain = 2 * c * (1 << BASIS_SHIFT) * corr - c * c * energy;
            if (gain > bestGain) {
              bestGain = gain;
              chosenBasis = k;
              chosenAmp = a;
            }
          }
        }

        // 디코더와 동일한 식으로 실제 재구성하고 오차를 센다
        writeBlock(
          work,
          px0,
          py0,
          B,
          logScale,
          pred,
          dcOffset,
          AMP_MULT[chosenAmp] * acStep,
          chosenBasis,
        );

        let error = 0;
        for (let y = 0; y < B; y++) {
          const lumaRow = (py0 + y) * CANVAS + px0;
          for (let x = 0; x < B; x++) {
            const d = target.luma[lumaRow + x] - work[lumaRow + x];
            error += d * d;
          }
        }

        if (error < bestError) {
          bestError = error;
          bestMode = mode;
          bestFieldValue = choice.value;
          bestDc = dcIndex;
          bestBasis = chosenBasis;
          bestAmp = chosenAmp;
        }
      }

      // 최선의 조합으로 확정하고 재구성 버퍼에 남긴다
      const topLeft = loadReferences(px0, py0);
      predictBlock(bestMode, B, logB, top, topRight, left, topLeft, pred);
      writeBlock(
        work,
        px0,
        py0,
        B,
        logScale,
        pred,
        (bestDc - DC_BIAS) * dcStep,
        AMP_MULT[bestAmp] * acStep,
        bestBasis,
      );

      // 모드 자체가 아니라 **그 모드를 내는 필드 값**을 적는다
      fields.mode[bi] = bestFieldValue;
      fields.dc[bi] = bestDc;
      fields.basis[bi] = bestBasis;
      fields.amp[bi] = bestAmp;
      totalError += bestError;
    }
  }

  return totalError;
}

function makeScratch(spec) {
  const B = spec.blockPx;
  return {
    fields: createFields(spec),
    work: new Uint8Array(CANVAS * CANVAS),
    pred: new Int32Array(B * B),
    top: new Int32Array(B),
    topRight: new Int32Array(B),
    left: new Int32Array(B),
    sums: new Int32Array(PATTERN_AREA),
  };
}

function copyFields(spec, from, to) {
  Object.assign(to.header, from.header);
  for (const field of spec.blockFields) to[field.name].set(from[field.name]);
  return to;
}

/** RGBA 두 장의 제곱오차. 밀기 후보를 **눈에 보이는 것**으로 고를 때 쓴다. */
function rgbaError(a, b) {
  let total = 0;
  for (let i = 0; i < a.length; i += 4) {
    const dr = a[i] - b[i];
    const dg = a[i + 1] - b[i + 1];
    const db = a[i + 2] - b[i + 2];
    total += dr * dr + dg * dg + db * db;
  }
  return total;
}

/**
 * 렌더러가 마지막에 하는 색 변환을 목표 이미지에 미리 되돌려 놓는다.
 *
 * 이렇게 해 두면 투영기 본체는 방의 색을 몰라도 된다.
 *
 * 되돌릴 수 있는 것
 *   negative  루마를 뒤집는다. 렌더러가 다시 뒤집으므로 정확히 상쇄된다.
 *   satScale  크로마를 미리 나눈다. 렌더러가 곱하면 제자리로 온다.
 *
 * 되돌릴 수 없는 것
 *   hue 띠    각을 좁은 구간으로 **모으는** 사상이라 단사가 아니다.
 *   duotone   크로마를 루마에서 만든다. 블록 크로마 필드를 아무도 읽지 않는다.
 *
 * 이 둘은 색이 방의 것이 된다. 투영기는 밝기만 맞추고 색은 방에 맡긴다.
 * 미리보기가 언제나 실제 렌더 결과이므로 사용자를 속이지는 않는다.
 */
function invertStyleOntoTarget(target, params) {
  if (params.negative) {
    const { luma } = target;
    for (let i = 0; i < luma.length; i++) luma[i] = 255 - luma[i];
  }

  // duotone 방에서는 크로마 필드가 읽히지 않으므로 손댈 이유가 없다.
  if (params.satScale !== 256 && !params.duotone) {
    const { cb, cr } = target;
    const scale = 256 / params.satScale;
    for (let i = 0; i < cb.length; i++) {
      cb[i] = clampIndex(Math.round(128 + (cb[i] - 128) * scale), 255);
      cr[i] = clampIndex(Math.round(128 + (cr[i] - 128) * scale), 255);
    }
  }
}

/**
 * 픽셀아트 방의 투영. 탐색이 전혀 없다.
 *
 * 블록마다 평균 RGB 를 그대로 25비트에 담으면 끝이다. 오차는 정수 왕복 반올림뿐
 * (실측 최대 채널 오차 2). 모드·기저·진폭·quant 를 고를 필요가 없다.
 *
 * 헤더는 이 방에서 읽히지 않는다. 그래도 주소의 일부이므로 0 으로 굳혀
 * 같은 그림이 늘 같은 주소를 받게 한다.
 */
function projectPixelArt(spec, rgba, fields) {
  const G = spec.tier;
  const B = spec.blockPx;

  fields.header.quant = 0;
  fields.header.profile = 0;
  fields.header.reserved = 0;
  fields.header.baseLuma = 0;
  fields.header.baseCb = 0;
  fields.header.baseCr = 0;

  const area = B * B;
  let totalError = 0;

  for (let by = 0; by < G; by++) {
    for (let bx = 0; bx < G; bx++) {
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      for (let y = 0; y < B; y++) {
        let o = ((by * B + y) * CANVAS + bx * B) * 4;
        for (let x = 0; x < B; x++) {
          rSum += rgba[o];
          gSum += rgba[o + 1];
          bSum += rgba[o + 2];
          o += 4;
        }
      }

      const r = clampIndex(Math.round(rSum / area), 255);
      const g = clampIndex(Math.round(gSum / area), 255);
      const b = clampIndex(Math.round(bSum / area), 255);

      // RGB 로 직접 쪼갠다. YCbCr 로 돌리면 안 된다 — 그 입방체가 더 커서
      // 변환이 단사가 아니고, 색이 몇 가지로 뭉개진다(테스트가 잡았다).
      unpackBlock(spec, fields, by * G + bx, r | (g << 8) | (b << 16));

      for (let y = 0; y < B; y++) {
        let o = ((by * B + y) * CANVAS + bx * B) * 4;
        for (let x = 0; x < B; x++) {
          const dr = rgba[o] - r;
          const dg = rgba[o + 1] - g;
          const db = rgba[o + 2] - b;
          totalError += dr * dr + dg * dg + db * db;
          o += 4;
        }
      }
    }
  }

  return totalError;
}

/**
 * 블록 한 개의 자리값. 그 블록의 digit 들이 연속하다는 성질을 이용한다.
 *
 * buildDigitPlan 은 블록 우선·역래스터로 digit 을 놓으므로, 한 블록의 필드들은
 * 반드시 이웃한 자리를 차지한다. 그래서 그 블록의 25비트 묶음이 자리값 하나로
 * 곱해진다. 이 성질이 깨지면 아래 nudgeIntoRoom 의 자체 검사가 잡는다.
 */
function blockPlaceValue(spec, index) {
  let place = 1n;
  for (const digit of spec.digits) {
    if (digit.kind === 'block' && digit.block === index) break;
    place *= BigInt(digit.radix);
  }
  return place;
}

/** 크로마 평면을 채우는 필드들. 이 값은 이웃으로 번지지 않는다. */
const CHROMA_PLANES = new Set(['cb', 'cr']);

/**
 * 블록 하나의 packed 값에서 **크로마만 차지하는 낮은 부분**의 크기.
 *
 * buildDigitPlan 이 블록 필드를 [cr, cb, amp, basis, dc, mode] 순으로 놓으므로
 * 가장 낮은 두 자리가 크로마다. 16 x 16 = 256.
 *
 * 순서가 바뀌면 1 이 나온다. 그때는 밀기가 블록 전체를 훑는 쪽으로 돌아선다.
 */
function chromaLowSpan(spec) {
  let span = 1;
  for (const field of spec.blockFields) {
    if (!CHROMA_PLANES.has(field.name)) break;
    span *= field.radix;
  }
  return span;
}

/** 목표 방에 떨어진 후보 중 이만큼만 실제로 그려서 비교한다. */
const NUDGE_RENDER_BUDGET = 8;

/**
 * 두 packed 낮은자리의 크로마 거리. 어느 후보를 그려 볼지 고르는 데만 쓴다.
 *
 * 후보가 보통 8개쯤 나오는데 그릴 예산도 8이므로 대개 전부 본다. 그래도 예산을
 * 넘길 때 **크로마가 원래와 가까운 것**부터 보게 해 두면 손해가 줄어든다.
 */
function chromaDistance(spec, a, b) {
  let distance = 0;
  let ra = a;
  let rb = b;
  for (const field of spec.blockFields) {
    if (!CHROMA_PLANES.has(field.name)) break;
    distance += Math.abs((ra % field.radix) - (rb % field.radix));
    ra = (ra / field.radix) | 0;
    rb = (rb / field.radix) | 0;
  }
  return distance;
}

/**
 * 우하단 블록의 크로마 자리를 훑어 **목표 전시실에 떨어지는** 주소를 찾는다.
 *
 * ── 왜 되는가 ────────────────────────────────────────────────────────
 * 좌표는 코드워드에서 나오고 전시실은 좌표에서 나온다. 그래서 코드워드를 조금
 * 흔들면 다른 방으로 간다. 그림을 거의 그대로 두면서 방만 고를 수 있다.
 *
 * ── 왜 크로마인가 ────────────────────────────────────────────────────
 * 크로마 평면은 블록마다 독립으로 채워진다. 폐루프가 없다. 그래서 크로마를
 * 흔들면 **어떤 방에서도** 오차가 이웃으로 번지지 않는다. 루마를 흔들면
 * 역방향 주사 방에서 우하단 블록이 제일 먼저 그려지므로 그림 전체가 딸려 나온다.
 *
 * 크로마를 아예 읽지 않는 방(단색·이색 인쇄·구역 공유의 비대표 블록)에서는
 * 그림이 **한 화소도** 바뀌지 않는다. 공짜로 방을 고르는 것이다.
 *
 * ── 왜 우하단인가 ────────────────────────────────────────────────────
 * digit 자리값이 블록 우선·역래스터라서 우하단 블록이 가장 낮은 자리다. 낮은
 * 자리를 흔들어야 좌표의 낮은 비트가 움직이고, roomOf 의 해시가 반응한다.
 * 높은 자리(좌상단 블록)를 흔들면 400회에 방 16개밖에 닿지 않는 것을 실측했다.
 * 우하단 블록의 크로마 256칸은 31개 방 전부에 닿는다.
 */
function nudgeIntoRoom(spec, fields, mix, targetRoom, rgba, style) {
  const baseCode = encodeFields(spec, fields);
  const locate = code => {
    const [x, y] = codeToCoordinates(code, mix, spec.axisBits);
    return { x, y, room: roomOf(x, y) };
  };

  const start = locate(baseCode);
  if (start.room === targetRoom) {
    return { code: baseCode, x: start.x, y: start.y, tried: 0, moved: false };
  }

  const index = spec.blockCount - 1;
  const place = blockPlaceValue(spec, index);
  const original = packBlock(spec, fields, index);

  // 훑을 범위. 크로마 자리가 가장 낮으면 그 256칸만, 아니면 블록 전체를 훑는다.
  const chromaSpan = chromaLowSpan(spec);
  const span = chromaSpan >= 2 ? chromaSpan : blockValueCount(spec);
  const high = original - (original % span);

  // 자체 검사: 산술로 만든 코드가 정식 인코딩과 같은가.
  // digit 배치가 바뀌면 여기서 즉시 드러난다. 후보마다가 아니라 한 번만 한다.
  {
    const probe = high + ((original + 1) % span);
    const arithmetic = baseCode + BigInt(probe - original) * place;
    unpackBlock(spec, fields, index, probe);
    const authoritative = encodeFields(spec, fields);
    unpackBlock(spec, fields, index, original);
    if (arithmetic !== authoritative) {
      throw new Error('블록 자리값이 digit 배치와 맞지 않는다. buildDigitPlan 이 바뀌었다.');
    }
  }

  // 1단계: 목표 방에 떨어지는 값을 모은다. 그리지 않으므로 싸다.
  const hits = [];
  for (let step = 1; step < span; step++) {
    const value = high + ((original + step) % span);
    const code = baseCode + BigInt(value - original) * place;
    const at = locate(code);
    if (at.room === targetRoom) hits.push({ code, x: at.x, y: at.y, value });
  }
  if (hits.length === 0) return null;

  // 2단계: 크로마가 원래와 가까운 것부터 실제로 그려서 가장 덜 상한 것을 고른다.
  // 최종 판단은 언제나 그려 본 결과다. 필드 거리는 순서를 정하는 데만 쓴다.
  const originalLow = original % span;
  hits.sort(
    (a, b) =>
      chromaDistance(spec, a.value % span, originalLow) -
      chromaDistance(spec, b.value % span, originalLow),
  );

  const frame = createFrame(spec);
  let best = null;
  for (const hit of hits.slice(0, NUDGE_RENDER_BUDGET)) {
    renderCode(spec, hit.code, frame, style);
    const error = rgbaError(frame.rgba, rgba);
    if (!best || error < best.error) best = { ...hit, error };
  }

  unpackBlock(spec, fields, index, best.value);
  return { code: best.code, x: best.x, y: best.y, tried: span - 1, moved: true };
}

/**
 * 256x256 RGBA를 이 미술관의 가장 가까운 좌표로 투영한다.
 *
 * 캔버스에 의존하지 않는 순수 함수다. 그래서 Node에서 테스트할 수 있다.
 *
 * 반환하는 rgba는 투영기의 내부 버퍼가 아니라 **실제 디코더가 그린 결과**다.
 * 그래야 미리보기와 그 좌표의 작품이 반드시 같다.
 *
 * `options.room` 을 주면 **그 전시실 안의** 좌표를 찾는다. 그 방의 읽는 방식으로
 * 투영하고, 마지막에 블록 하나를 흔들어 좌표를 그 방 안으로 옮긴다.
 * 주지 않으면 기준 전시실로 투영하고 좌표가 어느 방에 떨어지든 받아들인다.
 *
 * @param {number} [options.room]  목표 전시실 번호 (rooms.mjs 의 ROOMS 색인)
 * @param {object} [options.style] 방 대신 스타일을 직접 줄 때. 시험용이다.
 */
export function projectRgba(rgba, tier, locality, options = {}) {
  const spec = tierSpec(tier);
  const targetRoom = options.room;
  const style =
    options.style ?? (targetRoom === undefined ? null : roomStyle(targetRoom));
  const params = styleParams(style);

  const mix = localityMix(locality, spec.axisBits);

  // ── 픽셀아트 방: 탐색 없는 직접 경로 ──
  if (style?.pixelArt) {
    const fields = createFields(spec);
    const error = projectPixelArt(spec, rgba, fields);

    let code = encodeFields(spec, fields);
    let [x, y] = codeToCoordinates(code, mix, spec.axisBits);

    if (targetRoom !== undefined && roomOf(x, y) !== targetRoom) {
      const moved = nudgeIntoRoom(spec, fields, mix, targetRoom, rgba, style);
      if (!moved) return null;
      code = moved.code;
      x = moved.x;
      y = moved.y;
    }

    const frame = renderCode(spec, code, createFrame(spec), style);
    return { x, y, code, quant: 0, error, room: roomOf(x, y), rgba: frame.rgba.slice() };
  }

  const target = toYcbcr(rgba);

  // 방이 뒤집을 수 있는 색 변환을 목표에서 미리 되돌린다.
  // 헤더 기준값을 정하기 **전에** 해야 한다. 기준값도 변환된 목표의 통계다.
  invertStyleOntoTarget(target, params);

  // 헤더 기준값은 전체 통계로 먼저 정한다
  let lumaTotal = 0;
  for (let i = 0; i < target.luma.length; i++) lumaTotal += target.luma[i];
  const lumaMean = lumaTotal / target.luma.length;

  let cbTotal = 0;
  let crTotal = 0;
  for (let i = 0; i < target.cb.length; i++) {
    cbTotal += target.cb[i];
    crTotal += target.cr[i];
  }
  const cbMean = cbTotal / target.cb.length;
  const crMean = crTotal / target.cr.length;

  const baseLuma = clampIndex(Math.round((lumaMean * 63) / 255), 63);
  const baseCb = clampIndex(Math.round((cbMean * 15) / 255), 15);
  const baseCr = clampIndex(Math.round((crMean * 15) / 255), 15);

  const scratch = makeScratch(spec);
  const best = { error: Infinity, fields: createFields(spec), quant: QUANT_CANDIDATES[0] };

  for (const quant of QUANT_CANDIDATES) {
    scratch.work.fill(0);
    const error = projectWithQuant(
      spec,
      target,
      quant,
      baseLuma,
      baseCb,
      baseCr,
      scratch,
      params,
    );
    if (error < best.error) {
      best.error = error;
      best.quant = quant;
      copyFields(spec, scratch.fields, best.fields);
    }
  }

  // 필드 → 코드워드 → 좌표
  let code = encodeFields(spec, best.fields);
  let [x, y] = codeToCoordinates(code, mix, spec.axisBits);

  // 목표 전시실이 있으면 좌표를 그 방 안으로 옮긴다
  if (targetRoom !== undefined && roomOf(x, y) !== targetRoom) {
    const moved = nudgeIntoRoom(spec, best.fields, mix, targetRoom, rgba, style);
    if (!moved) return null;
    code = moved.code;
    x = moved.x;
    y = moved.y;
  }

  // 권위 있는 결과는 디코더가 그린 것이다. 그 방의 읽는 방식으로 그린다.
  //
  // 방을 강제하지 않았으면 **좌표가 떨어진 방**으로 그린다. 기준 전시실로 그리면
  // 안 된다. 미리보기는 관람객이 그 자리에 걸어 들어갔을 때 보게 될 것이어야 한다.
  // (전시실을 렌더 경로에 연결한 뒤로 이 자리가 거짓말을 하고 있었다. 방이 31개고
  //  그중 30개가 기준이 아니므로 거의 언제나 어긋났다.)
  const frame = renderCode(spec, code, createFrame(spec), style ?? styleAt(x, y));

  return {
    x,
    y,
    code,
    quant: best.quant,
    // 투영기 내부의 루마 제곱오차다. 밀기 전의 값이며 방끼리 비교할 수는 없다.
    error: best.error,
    room: roomOf(x, y),
    rgba: frame.rgba.slice(),
  };
}

/**
 * 브라우저용 진입점. 무엇이든 캔버스가 그릴 수 있으면 받는다.
 *
 * PNG로 제한하지 않는다. 브라우저가 디코딩할 수 있는 형식은 모두 받는다.
 */
export function projectImage(source, tier, locality, options = {}) {
  return projectRgba(toRgba(source), tier, locality, options);
}
