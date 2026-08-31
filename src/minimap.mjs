// 미니맵 — 주변 칸의 색
//
// 좌상단에 뜨는 작은 지도다. 지금 있는 칸을 가운데에 두고 그 주위를 하늘에서
// 내려다본 것처럼 보여 준다.
//
// ── 색을 어디서 얻는가 ──────────────────────────────────────────────────
//
// 그림을 그려서 평균을 내지 않는다. 한 장이 0.5~1.1ms 이므로 33x33=1,089칸이면
// 1초가 넘는다. 끌면서 갱신되는 것에 그 값을 낼 수 없다.
//
// 대신 **주소에서 기준 색을 곧바로 읽는다.** 코덱의 헤더 낮은 자리에 기준 밝기와
// 기준 크로마가 있고(spec.mjs 의 HEADER_LOW_FIELDS), 그것이 그 그림의 전체 색조다.
// 자리가 가장 낮으므로 나눗셈 몇 번으로 뽑을 수 있다. 실측(칸당):
//
//   층 4   0.001ms      1,024칸에 1ms
//   층 8   0.002ms                2ms
//   층 16  0.009ms                9ms
//   층 32  0.028ms               29ms
//
// 가장 나쁜 층도 한 프레임 남짓이고, 옮겨 다닐 때는 새로 들어온 줄만 계산하므로
// (아래 캐시) 실제로는 서른 칸쯤이다.
//
// 그래서 이 미니맵은 보로노이 근사가 아니라 **실제 그림의 색**이다. 다만 기준
// 색이므로 세부 무늬는 없고, 크로마를 뒤집거나 이색 인쇄로 읽는 전시실에서는
// 걸린 그림과 색이 다르다. 지도의 목적은 "저쪽이 따뜻하고 이쪽이 어둡다" 를
// 알려 주는 것이므로 그 차이를 안고 간다.

import { tierSpec, coordinatesToCode, localityMix, isLobbyTier } from './codec.mjs';

/**
 * 미니맵 한 변의 칸 수. 홀수여야 가운데 칸이 하나로 정해진다.
 *
 * 33칸이면 데스크톱 화면(36칸쯤)과 비슷한 넓이다. 지도가 화면보다 훨씬 넓으면
 * 내가 보는 것이 지도의 한 점이 되어 쓸모가 없고, 좁으면 지도가 아니다.
 */
export const MINIMAP_SPAN = 33;

/** 6비트(0..63) → 0..255. 코덱의 expand6 과 같아야 한다. */
const expand6 = v => ((v << 2) | (v >> 4)) & 0xff;

/** 4비트(0..15) → 0..255. 코덱의 expand4 과 같아야 한다. */
const expand4 = v => ((v << 4) | v) & 0xff;

const clamp8 = v => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * 코드워드 → 그 그림의 기준 색.
 *
 * 헤더 낮은 자리의 순서는 quant(16) · baseCr(16) · baseCb(16) · baseLuma(64) 이고
 * 낮은 자리부터 그 순서로 놓인다. 검사가 이 읽기를 코덱의 decodeFields 와
 * 맞춰 본다 — 디짓 배치가 바뀌면 그 검사가 먼저 깨진다.
 *
 * YCbCr → RGB 는 코덱과 같은 BT.601 정수 계수를 쓴다. 미니맵의 색이 그림의 색과
 * 어긋나면 지도가 거짓말을 한다.
 */
export function baseToneOf(code) {
  const luma = Number((code / 4096n) % 64n);
  const cb = Number((code / 256n) % 16n);
  const cr = Number((code / 16n) % 16n);

  const y = expand6(luma);
  const vb = expand4(cb) - 128;
  const vr = expand4(cr) - 128;

  return {
    r: clamp8(y + ((91881 * vr) >> 16)),
    g: clamp8(y - ((22554 * vb + 46802 * vr) >> 16)),
    b: clamp8(y + ((116130 * vb) >> 16)),
  };
}

/**
 * 층 하나의 색을 기억하는 지도.
 *
 * 캐시가 있는 이유: 한 칸 옮기면 지도의 33x33 중 32칸만 새로 들어온다. 캐시가
 * 없으면 1,089칸을 다시 계산하고, 층 32에서는 그것이 30ms 다. 끌기 중에 그 값을
 * 내면 프레임이 무너진다.
 *
 * 층이나 국소성이 바뀌면 버린다. 같은 좌표라도 다른 그림이기 때문이다.
 */
export function createMinimapColours() {
  let cache = new Map();
  let cachedFloor = '';

  return {
    /**
     * 가운데를 중심으로 span x span 칸의 RGBA 를 만든다.
     *
     * 좌표는 축 크기로 감긴다. 미술관의 층은 순환하므로 지도의 끝도 이어진다.
     * 감기지 않게 잘라 내면 실제로 갈 수 있는 곳이 지도에서 사라진다.
     */
    cells({ tier, locality, x, y, span = MINIMAP_SPAN }) {
      const rgba = new Uint8ClampedArray(span * span * 4);
      // 로비와 체험관에는 작품이 없다. 색을 물을 대상이 없으므로 비워 준다.
      if (isLobbyTier(tier)) return { span, rgba, empty: true };

      const floor = `${tier}:${locality}`;
      if (floor !== cachedFloor) {
        cache = new Map();
        cachedFloor = floor;
      }
      // 캐시가 한없이 자라지 않게 한다. 한 지도가 1,089칸이므로 넉넉한 상한이다.
      if (cache.size > 20000) cache.clear();

      const spec = tierSpec(tier);
      const mask = (1n << BigInt(spec.axisBits)) - 1n;
      const mix = localityMix(locality, spec.axisBits);
      const half = BigInt((span - 1) / 2);

      let at = 0;
      for (let row = 0; row < span; row++) {
        const cy = (y - half + BigInt(row)) & mask;
        for (let column = 0; column < span; column++) {
          const cx = (x - half + BigInt(column)) & mask;
          const key = `${cx},${cy}`;
          let tone = cache.get(key);
          if (tone === undefined) {
            tone = baseToneOf(coordinatesToCode(cx, cy, mix, spec.axisBits));
            cache.set(key, tone);
          }
          rgba[at] = tone.r;
          rgba[at + 1] = tone.g;
          rgba[at + 2] = tone.b;
          rgba[at + 3] = 255;
          at += 4;
        }
      }

      return { span, rgba, empty: false };
    },

    /** 층을 옮길 때 부른다. 검사가 캐시 초기화를 직접 확인한다. */
    clear() {
      cache = new Map();
      cachedFloor = '';
    },

    get size() {
      return cache.size;
    },
  };
}
