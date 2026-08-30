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
  createFields,
  createFrame,
  encodeFields,
  gatherReferences,
  predictBlock,
  renderCode,
  writeBlock,
} from './codec.mjs';
import { codeToCoordinates, localityMix } from './space.mjs';

/**
 * 시험해 볼 양자화 후보.
 *
 * 전부 시험하면 티어 16에서 느려진다. 대표값만 고른다.
 * 이것은 rank 방향의 탐색이므로 허용된다.
 */
const QUANT_CANDIDATES = [3, 6, 9, 12, 15];

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
 * 한 양자화 후보로 전체 이미지를 탐욕적으로 투영한다.
 *
 * 블록을 래스터 순서로 하나씩 확정하고, 확정한 결과를 즉시 재구성 버퍼에 쓴다.
 * 다음 블록은 그 재구성 결과를 참조한다. 폐루프다.
 */
function projectWithQuant(spec, target, quant, baseLuma, baseCb, baseCr, scratch) {
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

  let totalError = 0;

  for (let by = 0; by < G; by++) {
    const py0 = by * B;
    for (let bx = 0; bx < G; bx++) {
      const bi = by * G + bx;
      const px0 = bx * B;

      // ── 크로마: 직접 양자화. 탐색 없음 ──
      const CB = spec.chromaBlockPx;
      const cx0 = bx * CB;
      const cy0 = by * CB;
      let cbTotal = 0;
      let crTotal = 0;
      for (let y = 0; y < CB; y++) {
        const row = (cy0 + y) * CHROMA + cx0;
        for (let x = 0; x < CB; x++) {
          cbTotal += target.cb[row + x];
          crTotal += target.cr[row + x];
        }
      }
      const area = CB * CB;
      fields.cb[bi] = clampIndex(
        nearest(Math.round(cbTotal / area) - baseCbValue, chromaStep) + CHROMA_BIAS,
        15,
      );
      fields.cr[bi] = clampIndex(
        nearest(Math.round(crTotal / area) - baseCrValue, chromaStep) + CHROMA_BIAS,
        15,
      );

      // ── 루마: 모드 8종을 비교한다 ──
      let bestMode = 0;
      let bestDc = DC_BIAS;
      let bestBasis = 0;
      let bestAmp = 0;
      let bestError = Infinity;

      for (let mode = 0; mode < MODE_NAMES.length; mode++) {
        const topLeft = gatherReferences(work, px0, py0, B, baseValue, top, topRight, left);
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
          bestDc = dcIndex;
          bestBasis = chosenBasis;
          bestAmp = chosenAmp;
        }
      }

      // 최선의 조합으로 확정하고 재구성 버퍼에 남긴다
      const topLeft = gatherReferences(work, px0, py0, B, baseValue, top, topRight, left);
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

      fields.mode[bi] = bestMode;
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

/**
 * 256x256 RGBA를 이 미술관의 가장 가까운 좌표로 투영한다.
 *
 * 캔버스에 의존하지 않는 순수 함수다. 그래서 Node에서 테스트할 수 있다.
 *
 * 반환하는 rgba는 투영기의 내부 버퍼가 아니라 **실제 디코더가 그린 결과**다.
 * 그래야 미리보기와 그 좌표의 작품이 반드시 같다.
 */
export function projectRgba(rgba, tier, locality) {
  const spec = tierSpec(tier);
  const target = toYcbcr(rgba);

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
    const error = projectWithQuant(spec, target, quant, baseLuma, baseCb, baseCr, scratch);
    if (error < best.error) {
      best.error = error;
      best.quant = quant;
      copyFields(spec, scratch.fields, best.fields);
    }
  }

  // 필드 → 코드워드 → 좌표
  const code = encodeFields(spec, best.fields);
  const mix = localityMix(locality, spec.axisBits);
  const [x, y] = codeToCoordinates(code, mix, spec.axisBits);

  // 권위 있는 결과는 디코더가 그린 것이다
  const frame = renderCode(spec, code, createFrame(spec));

  return {
    x,
    y,
    code,
    quant: best.quant,
    error: best.error,
    rgba: frame.rgba.slice(),
  };
}

/**
 * 브라우저용 진입점. 무엇이든 캔버스가 그릴 수 있으면 받는다.
 *
 * PNG로 제한하지 않는다. 브라우저가 디코딩할 수 있는 형식은 모두 받는다.
 */
export function projectImage(source, tier, locality) {
  return projectRgba(toRgba(source), tier, locality);
}
