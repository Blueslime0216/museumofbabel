// 전시실 — 같은 주소를 다르게 읽는 방식, 그리고 그것을 좌표에서 유도하는 규칙
//
// ── 왜 주소에 담지 않는가 ────────────────────────────────────────────────
//
// 주소는 곧 좌표다. 좌표에서 전시실을 유도하면 주소 → 그림이 여전히 완전한
// 결정론적 함수이고, 비트를 한 개도 쓰지 않는다. 그리고 전시실이 **장소**가 된다.
// 걸어서 다른 방에 들어가는 경험이 생긴다.
//
// 헤더에 전시실 필드를 두는 방식도 재 보았다. 4,096 전시실이 주소 +0자,
// 1,600만이 +2자였다(헤더 비트는 블록 수와 무관하게 한 번만 내므로 싸다).
// 그래도 좌표 유도를 고른 이유는 위의 "장소" 하나다.
//
// ── 방향이 중요하다 ──────────────────────────────────────────────────────
//
// 불가능: "사선처럼 보이는 그림들이 모여 있는 구역을 찾는다"
//         필드를 제약하면 코드 공간에서 흩어진 집합이 되고, 좌표 변환의 섞기가
//         국소성을 완전히 파괴한다. 연속된 구역이 아니다.
//
// 실제:   "구역이 사선으로 읽는다고 정한다"
//         그 구역의 모든 주소가 사선 그림이 된다. 공짜이고 공간적으로 일관된다.
//
// ── 미감은 잠정이다 ──────────────────────────────────────────────────────
//
// 아래 전시실 목록과 수치는 실시간 튜닝 도구로 확정할 예정이다. 이 파일의 목적은
// 그때 값만 갈아 끼울 수 있는 구조를 두는 것이다. 목록을 고치면 그 구역의 그림이
// 바뀌므로 URL 버전을 올려야 한다.
//
// 고른 근거는 _dev/debug/floors-and-rooms/ 의 대조판과 cull-rooms.mjs 에 있다.
// 후보 40개를 작품 39개에 돌려 1,560번 렌더한 뒤 지각 거리로 걸렀다.

import { MODE_NAMES } from './spec.mjs';

// ── 예측 모드 집합 ───────────────────────────────────────────────────────
//
// 모드를 좁히는 것이 가장 강한 손잡이다. 블록의 기하가 통째로 바뀐다.
// 대각만 남기면 마름모와 광선이 나오고, DC만 남기면 무늬 없는 모자이크가 된다.

export const MODE_SETS = {
  ALL: [0, 1, 2, 3, 4, 5, 6, 7],
  FLAT: [0], // DC 만. 평면 모자이크
  WEAVE: [1, 2], // 수직 + 수평. 직조
  VERTICAL: [1],
  HORIZONTAL: [2],
  DIAGONAL: [3, 4],
  BLEED: [5, 6, 7], // SMOOTH 세 가지. 번짐
};

// ── 색 처리 ──────────────────────────────────────────────────────────────

/**
 * 크로마 해상도.
 *
 * null   블록마다 (지금의 기본)
 * 0      전역 색조만. 단색
 * n      n x n 구역이 값을 공유
 *
 * 실측: 4x4 는 기준과 지각 거리 0.58 로 너무 비슷했다. 2x2 는 0.88 로 살았다.
 */

/** 크로마 좌표 회전·수축을 미리 계산한 표. 16x16 = 256칸이면 전부 덮는다. */
const hueTableCache = new Map();

function hueTable(hue, spread) {
  const key = `${hue}:${spread}`;
  let table = hueTableCache.get(key);
  if (table) return table;

  // 색상(각)을 좁은 띠로 모으고 채도(길이)는 그대로 둔다.
  //
  // 왜 회전이 아니라 수축인가: 회전만 하면 칸마다 다른 색이 같이 돌아서 소란이
  // 그대로 남는다. 방이 하나의 색으로 기억되게 하려면 각을 모아야 한다.
  // 실제로 회전만 했을 때 방이 구분되지 않는 것을 확인했다.
  table = new Int16Array(256 * 2);
  const target = (hue * Math.PI) / 180;
  const width = (spread * Math.PI) / 180;
  for (let cb = 0; cb < 16; cb++) {
    for (let cr = 0; cr < 16; cr++) {
      const b = cb - 8;
      const r = cr - 8;
      const magnitude = Math.sqrt(b * b + r * r);
      const angle = Math.atan2(r, b);
      const packed = target + (angle / Math.PI) * width;
      const i = (cb * 16 + cr) * 2;
      table[i] = Math.round(Math.cos(packed) * magnitude);
      table[i + 1] = Math.round(Math.sin(packed) * magnitude);
    }
  }
  hueTableCache.set(key, table);
  return table;
}

/** 이색 인쇄: 크로마를 루마에서 만든다. 루마 256칸 표로 미리 계산한다. */
const duotoneTableCache = new Map();

function duotoneTable(a, b) {
  const key = `${a}:${b}`;
  let table = duotoneTableCache.get(key);
  if (table) return table;
  table = new Int16Array(256 * 2);
  for (let y = 0; y < 256; y++) {
    // (y - 128) / 128 을 정수로: (y - 128) * 2 / 256
    const t = (y - 128) / 128;
    table[y * 2] = Math.round(a * t);
    table[y * 2 + 1] = Math.round(b * t);
  }
  duotoneTableCache.set(key, table);
  return table;
}

// ── 전시실 목록 ──────────────────────────────────────────────────────────
//
// 지각 거리로 걸러 남은 것들. 버린 축도 기록해 둔다.
//   기저 대역(완만/중간/조밀)  기준과 0.31~0.45. 통째로 무의미했다
//   색 구역 4x4               기준과 0.58
//   벽돌 · 기저 전치 · 판화     블록 내부만 바꿔서 거의 안 보인다
//
// 일반 규칙: 지각은 `색 > 블록 단위 구성 > 블록 내부 질감` 순으로 지배된다.
// 3단만 건드리는 축은 방으로 쓸 수 없다.

/**
 * @typedef {object} RoomStyle
 * @property {string} name
 * @property {number[]} [modes]      예측 모드 집합. 없으면 전체
 * @property {number|null} [chroma]  크로마 해상도. undefined=블록별, 0=전역, n=n x n
 * @property {number} [hue]          색상 띠의 중심(도)
 * @property {number} [spread]       색상 띠의 폭(도)
 * @property {number} [satScale]     채도 배율 (256 = 1배. 정수로 다룬다)
 * @property {number[]} [duotone]    이색 인쇄 계수 [cb, cr]
 * @property {boolean} [negative]    루마 반전
 * @property {boolean} [openLoop]    이웃을 참조하지 않는다
 * @property {boolean} [reverseScan] 우하단부터 그린다
 * @property {boolean} [pixelArt]    블록 25비트를 색+밝기로 다시 쪼갠다
 */

/** @type {RoomStyle[]} */
export const ROOMS = [
  { name: 'BASE' },
  { name: 'FLAT_MOSAIC', modes: MODE_SETS.FLAT },
  { name: 'WEAVE', modes: MODE_SETS.WEAVE },
  { name: 'HORIZON', modes: MODE_SETS.HORIZONTAL },
  { name: 'DIAGONAL', modes: MODE_SETS.DIAGONAL },
  { name: 'BLEED', modes: MODE_SETS.BLEED },
  { name: 'ZONED_COLOUR', chroma: 2 },
  { name: 'MONOCHROME', chroma: 0 },
  { name: 'OPEN_LOOP', openLoop: true },
  { name: 'REVERSED', reverseScan: true },
  { name: 'NEGATIVE', negative: true },
  { name: 'PASTEL', satScale: 90 },
  { name: 'PRIMARY', satScale: 563 },
  { name: 'HUE_RED', hue: 0, spread: 22 },
  { name: 'HUE_AMBER', hue: 60, spread: 22 },
  { name: 'HUE_GREEN', hue: 120, spread: 22 },
  { name: 'HUE_CYAN', hue: 180, spread: 22 },
  { name: 'HUE_BLUE', hue: 240, spread: 22 },
  { name: 'HUE_VIOLET', hue: 300, spread: 22 },
  { name: 'DUO_BLUE_ORANGE', duotone: [95, -55] },
  { name: 'DUO_RED_GREEN', duotone: [-75, 85] },
  { name: 'DUO_VIOLET_AMBER', duotone: [30, 95] },
  { name: 'DUO_INK', duotone: [70, 15] },
  { name: 'OPEN_MONO', openLoop: true, chroma: 0 },
  { name: 'RAIN', modes: MODE_SETS.VERTICAL, duotone: [95, -55] },
  { name: 'BLEED_PASTEL', modes: MODE_SETS.BLEED, satScale: 90 },
  { name: 'FLAT_CYAN', modes: MODE_SETS.FLAT, hue: 180, spread: 22 },
  { name: 'DIAGONAL_DUO', modes: MODE_SETS.DIAGONAL, duotone: [-75, 85] },
  { name: 'MONO_PRIMARY', chroma: 0, satScale: 563 },
  { name: 'REVERSED_DIAGONAL', reverseScan: true, modes: MODE_SETS.DIAGONAL },
  // 픽셀아트: 블록을 평탄하게 만들면 mode·amp·basis 12비트가 죽는다.
  // 그래서 25비트를 luma 8 · cb 8 · cr 8 로 다시 쪼갠다. 블록마다 정확한 24비트 색.
  // 이 방은 투영이 탐색 없이 정확하다 — 블록 평균 색을 그대로 담으면 된다.
  { name: 'PIXEL_ART', pixelArt: true },
];

/** 미리 계산한 표를 스타일에 붙인다. 렌더 루프에서 삼각함수를 쓰지 않기 위해. */
function prepare(room) {
  if (room.prepared) return room;
  room.modeSet = room.modes ?? MODE_SETS.ALL;
  room.hueLookup = room.hue === undefined ? null : hueTable(room.hue, room.spread ?? 22);
  room.duotoneLookup = room.duotone ? duotoneTable(room.duotone[0], room.duotone[1]) : null;
  room.prepared = true;
  return room;
}
for (const room of ROOMS) prepare(room);

export function roomStyle(index) {
  return ROOMS[index % ROOMS.length];
}

export function roomIndexByName(name) {
  return ROOMS.findIndex(r => r.name === name);
}

// ── 구역 배정 ────────────────────────────────────────────────────────────
//
// 보로노이. 씨앗을 격자 칸 안에서 해시로 흔들어 유기적인 다각형을 만든다.
// 격자로 나누면 방이 정사각형으로 보여서 건물 같지 않다.
//
// 씨앗 간격 160칸: 한 화면이 약 3~7칸이므로 방 하나가 약 23~50 화면 폭이다.
// 거대함이 느껴지는 크기이며, 걸어서 경계를 만날 수 있는 크기다.

export const CLUSTER_SPAN = 160n;

/** 32비트 해시. 결정론적이어야 한다. 좌표는 BigInt 다. */
function hashSeed(gx, gy) {
  let h = Number(((gx * 73856093n) ^ (gy * 19349663n)) & 0xffffffffn) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 2246822507) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * 좌표 → 전시실 번호.
 *
 * 주변 3x3 씨앗만 본다. 씨앗이 자기 칸 안에만 있으므로 그보다 먼 씨앗이
 * 더 가까울 수 없다. 그래서 아홉 번의 비교로 끝난다.
 */
export function roomOf(x, y) {
  const gx = x / CLUSTER_SPAN;
  const gy = y / CLUSTER_SPAN;
  const span = Number(CLUSTER_SPAN);
  let best = Infinity;
  let chosen = 0;

  for (let dy = -1n; dy <= 1n; dy++) {
    for (let dx = -1n; dx <= 1n; dx++) {
      const sx = gx + dx;
      const sy = gy + dy;
      const h = hashSeed(sx, sy);
      const px = sx * CLUSTER_SPAN + BigInt(h % span);
      const py = sy * CLUSTER_SPAN + BigInt((h >>> 10) % span);
      // 차이는 몇 칸 범위이므로 Number 로 내려도 안전하다
      const ddx = Number(x - px);
      const ddy = Number(y - py);
      const distance = ddx * ddx + ddy * ddy;
      if (distance < best) {
        best = distance;
        chosen = (h >>> 20) % ROOMS.length;
      }
    }
  }
  return chosen;
}

/** 좌표 → 전시실 스타일. 렌더 직전에 한 번 부른다. */
export function styleAt(x, y) {
  return ROOMS[roomOf(x, y)];
}
