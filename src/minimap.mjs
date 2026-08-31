// 미니맵 — 주변 칸의 색
//
// 좌상단에 뜨는 작은 지도다. 지금 있는 칸을 가운데에 두고 그 주위를 하늘에서
// 내려다본 것처럼 보여 준다.
//
// 보는 방식이 둘이다. 팜플렛에서 고른다.
//
//   'colour'  주소에서 읽은 그림의 기준 색. 이 층이 어떤 색인지 보인다
//   'rooms'   전시실 경계. 어느 방이 어디까지인지 보인다 (보로노이)
//
// ── 색을 어디서 얻는가 ──────────────────────────────────────────────────
//
// 그림을 그려서 평균을 내지 않는다. 한 장이 0.5~1.1ms 이므로 33x33=1,089칸이면
// 1초가 넘는다.
//
// 대신 **주소에서 기준 색을 곧바로 읽는다.** 코덱의 헤더 낮은 자리에 기준 밝기와
// 기준 크로마가 있고(spec.mjs 의 HEADER_LOW_FIELDS), 그것이 그 그림의 전체 색조다.
// 자리가 가장 낮으므로 나눗셈 몇 번으로 뽑을 수 있다.
//
// 실측(축을 꽉 채운 실제 좌표. 칸당 → 1,089칸):
//
//   층 4   0.001ms →   1ms      전시실 0.0055ms →  5.9ms
//   층 8   0.002ms →   2ms      전시실 0.0058ms →  6.3ms
//   층 16  0.009ms →  10ms      전시실 0.0094ms → 10.3ms
//   층 32  0.074ms →  80ms      전시실 0.0258ms → 28.1ms
//
// 한 장을 새로 만드는 것은 층을 옮길 때뿐이고 그때는 커튼이 내려와 있다. 걸어
// 다닐 때는 새로 들어온 줄(33칸)만 계산한다 — 층 32에서 2.4ms 다.
//
// ── 캐시 열쇠를 문자열로 만들면 안 된다 ──────────────────────────────────
//
// 처음에는 열쇠를 `${x},${y}` 로 만들었다. **이것이 미술관을 멈춰 세웠다.**
// 층 32의 축은 12,812비트이고 BigInt → 십진 문자열은 자릿수에 대해 값이 급히
// 오른다. 실측 칸당 0.41ms, 지도 한 장에 444ms 다. 캐시가 다 맞아도 열쇠는
// 매번 새로 만들므로, 캐시가 있다는 사실이 아무 도움이 되지 않았다.
//
//   층 4   0.0007ms →   0.7ms
//   층 8   0.0034ms →   3.7ms
//   층 16  0.0371ms →  40.4ms
//   층 32  0.4078ms → 444.1ms      ← 프레임마다 이것을 태우고 있었다
//
// 지금은 하위 비트만 잘라 숫자 하나로 만든다. 한 장에 0.37ms 다(1,200배).
// 잘라 낸 자리끼리 부딪히려면 6,700만 칸 떨어져 있어야 하는데, 한 지도는 33칸
// 폭이므로 그런 두 칸이 같은 지도에 들어오는 일은 없다.

import { tierSpec, coordinatesToCode, localityMix, isLobbyTier, roomOf, ROOMS } from './codec.mjs';

/**
 * 미니맵 한 변의 칸 수. 홀수여야 가운데 칸이 하나로 정해진다.
 *
 * 33칸이면 데스크톱 화면(36칸쯤)과 비슷한 넓이다. 지도가 화면보다 훨씬 넓으면
 * 내가 보는 것이 지도의 한 점이 되어 쓸모가 없고, 좁으면 지도가 아니다.
 */
export const MINIMAP_SPAN = 33;

/** 볼 수 있는 방식. 미니맵의 단추가 이 목록을 돌린다. */
export const MINIMAP_MODES = ['colour', 'rooms'];

/**
 * 고를 수 있는 배율. 1이 기본이고 크면 당겨 본다.
 *
 * 배율은 지도가 **덮는 넓이**를 뜻한다. 4배면 기본의 4분의 1만큼을 크게 보고,
 * 0.25배면 네 배 넓은 곳을 작게 본다.
 */
export const MINIMAP_SCALES = [0.25, 0.5, 1, 2, 4];

/**
 * 한 지도에서 값을 물어볼 칸의 최대 개수.
 *
 * 0.25배로 넓히면 한 변이 132칸, 곧 17,424칸이 된다. 층 32에서 칸당 0.074ms 이므로
 * 1.3초다. 그것을 낼 수 없다.
 *
 * 그래서 넓힐 때는 **띄어 읽는다.** 지도가 132칸을 덮더라도 값을 묻는 것은 33칸
 * 간격으로 고른 표본뿐이다. 지도가 거칠어지는 것은 축척이 작아졌다는 뜻이므로
 * 오히려 맞고, 값은 배율과 무관하게 일정하다.
 */
const MAX_SAMPLES = 33;

/** 배율 → 지도가 덮는 칸 수. 홀수로 만들어 가운데 칸을 남긴다. */
export function spanFor(scale, base = MINIMAP_SPAN) {
  const wanted = Math.max(3, Math.round(base / scale));
  return wanted % 2 === 1 ? wanted : wanted + 1;
}

/** 몇 칸마다 하나씩 물어볼 것인가. 넓을 때만 1보다 커진다. */
export function stepFor(span) {
  return Math.max(1, Math.ceil(span / MAX_SAMPLES));
}

/** 캐시 열쇠로 쓸 하위 비트. 26비트씩 두 축이면 52비트로 안전한 정수다. */
const KEY_BITS = 26n;
const KEY_MASK = (1n << KEY_BITS) - 1n;
const KEY_SPAN = 2 ** 26;

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
 * 전시실 색표. 방 번호마다 하나씩.
 *
 * 색조를 고르게 돌린다. 방의 성격을 색으로 옮기려 하지 않았다 — 이 방식이
 * 답하는 물음은 "어느 방이 어디까지인가" 이고, 그러려면 이웃한 방이 서로 달라
 * 보이는 것이 전부다. 그림의 색으로 보고 싶으면 'colour' 가 그 일을 한다.
 *
 * 밝기와 채도를 낮게 묶어 둔다. 미니맵은 벽에 걸린 안내판이고, 원색으로 칠하면
 * 지도가 작품보다 시끄러워진다.
 */
export const ROOM_TINTS = ROOMS.map((room, index) => {
  const hue = ((index * 360) / ROOMS.length) % 360;
  // HSL(hue, 38%, 42%) 를 손으로 푼다. 색 하나뿐이라 표를 들일 이유가 없다.
  const s = 0.38;
  const l = 0.42;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const h = hue / 60;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const [r1, g1, b1] =
    h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
    name: room.name,
  };
});

/**
 * 층 하나의 색을 기억하는 지도.
 *
 * 캐시가 있는 이유: 한 칸 옮기면 지도의 33x33 중 33칸만 새로 들어온다. 캐시가
 * 없으면 1,089칸을 다시 계산하고, 층 32에서는 그것이 80ms 다.
 *
 * 방식마다 따로 기억한다. 같은 칸이라도 'colour' 와 'rooms' 는 다른 값이다.
 * 층이나 국소성이 바뀌면 둘 다 버린다.
 */
export function createMinimapColours() {
  const caches = { colour: new Map(), rooms: new Map() };
  let cachedFloor = '';

  return {
    /**
     * 가운데를 중심으로 span x span 칸의 RGBA 를 만든다.
     *
     * 좌표는 축 크기로 감긴다. 미술관의 층은 순환하므로 지도의 끝도 이어진다.
     * 감기지 않게 잘라 내면 실제로 갈 수 있는 곳이 지도에서 사라진다.
     */
    cells({ tier, locality, x, y, span = MINIMAP_SPAN, mode = 'colour' }) {
      // 그리는 알맹이는 표본 격자다. 띄어 읽으면 span 보다 작다.
      //
      // 표본 수를 홀수로 만든다. 그래야 가운데 표본이 **정확히 지금 칸**이 된다.
      // 짝수면 가운데가 두 표본 사이에 떨어져서, 지도의 가운데 점과 실제 자리가
      // 반 칸씩 어긋난다.
      const step = stepFor(span);
      const even = Math.ceil(span / step);
      const across = even % 2 === 1 ? even : even + 1;
      const covers = across * step;
      const rgba = new Uint8ClampedArray(across * across * 4);
      // 로비와 체험관에는 작품이 없다. 색을 물을 대상이 없으므로 비워 준다.
      if (isLobbyTier(tier)) return { span: across, covers, step, rgba, empty: true };

      const floor = `${tier}:${locality}`;
      if (floor !== cachedFloor) {
        caches.colour = new Map();
        caches.rooms = new Map();
        cachedFloor = floor;
      }
      const cache = caches[mode] ?? caches.colour;
      // 캐시가 한없이 자라지 않게 한다. 한 지도가 1,089칸이므로 넉넉한 상한이다.
      if (cache.size > 20000) cache.clear();

      const spec = tierSpec(tier);
      const mask = (1n << BigInt(spec.axisBits)) - 1n;
      const mix = localityMix(locality, spec.axisBits);
      // 가운데 표본을 기준으로 잰다. 표본이 홀수이므로 정확히 지금 칸이다.
      const half = BigInt((across - 1) / 2);
      const stride = BigInt(step);
      const rooms = mode === 'rooms';

      let at = 0;
      for (let row = 0; row < across; row++) {
        const cy = (y + (BigInt(row) - half) * stride) & mask;
        // 열쇠의 y 쪽은 줄마다 한 번만 만든다.
        const keyY = Number(cy & KEY_MASK);
        for (let column = 0; column < across; column++) {
          const cx = (x + (BigInt(column) - half) * stride) & mask;
          const key = Number(cx & KEY_MASK) * KEY_SPAN + keyY;
          let tone = cache.get(key);
          if (tone === undefined) {
            tone = rooms
              ? ROOM_TINTS[roomOf(cx, cy)]
              : baseToneOf(coordinatesToCode(cx, cy, mix, spec.axisBits));
            cache.set(key, tone);
          }
          rgba[at] = tone.r;
          rgba[at + 1] = tone.g;
          rgba[at + 2] = tone.b;
          rgba[at + 3] = 255;
          at += 4;
        }
      }

      // span 은 그림의 한 변(표본 수)이고 covers 는 그 그림이 덮는 칸 수다.
      // 보이는 범위 네모를 그리는 쪽이 covers 를 쓴다.
      return { span: across, covers, step, rgba, empty: false };
    },

    /** 층을 옮길 때 부른다. 검사가 캐시 초기화를 직접 확인한다. */
    clear() {
      caches.colour = new Map();
      caches.rooms = new Map();
      cachedFloor = '';
    },

    get size() {
      return caches.colour.size + caches.rooms.size;
    },
  };
}
