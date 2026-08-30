// 로비 — 0층. 작품이 없는 층
//
// ── 무엇인가 ─────────────────────────────────────────────────────────────
//
// 텅 빈 격자다. 여기에는 코드워드도, 주소 → 그림 함수도 없다. 그래서 코덱이
// 아니라 앱에 있다. 코덱이 아는 것은 "0층이라는 층 번호가 주소에 나타날 수
// 있다"는 사실 하나뿐이다(spec.mjs 의 LOBBY_TIER).
//
// ── 왜 작품 공간 밖인가 ──────────────────────────────────────────────────
//
// 로비를 작품 층 안에 만들면 그 좌표의 그림이 보이지 않게 된다. 그것은
// "모든 주소는 유효하다"를 깨뜨린다. 층을 따로 두면 잃는 그림이 하나도 없다.
//
// ── 순환 ─────────────────────────────────────────────────────────────────
//
// 좌표는 축 크기로 감긴다. 로비의 축은 6비트라 64x64 칸이다. 옆으로 64칸
// 걸으면 출발점으로 돌아온다. 작은 우주.
//
// ── 앞으로 들어올 것 ─────────────────────────────────────────────────────
//
// 큐레이터 · 체험관 포털 · 후원자 작품. 아직 없다. 지금은 빈 벽과 바닥 결뿐이다.
// 후원자 작품은 사진이 아니라 **주소**로 저장한다. 그래야 "픽셀은 브라우저가
// 계산한다. 이미지를 가져오지 않는다"가 지켜진다.

import { CANVAS, LOBBY_AXIS_BITS, axisSize } from './codec.mjs';

/** 로비 한 변의 칸 수. 이만큼 걸으면 제자리로 온다. */
export const LOBBY_SPAN = axisSize(LOBBY_AXIS_BITS);

/** 벽 색. style.css 의 --wall 과 같아야 이어져 보인다. */
const WALL = [0x12, 0x10, 0x0e];

/**
 * 로비 칸 하나를 그린다.
 *
 * 결정론적이어야 한다. 같은 좌표는 늘 같은 픽셀이다. 그래서 난수를 쓰지 않고
 * 좌표에서 결을 만든다. 작품과 같은 규율이다.
 *
 * 무늬가 아주 약해야 한다. 로비는 볼 것이 아니라 지나갈 곳이고, 여기에 눈이
 * 머물면 작품 층으로 갈 이유가 줄어든다.
 */
export function renderLobbyTile(x, y, rgba) {
  const target = rgba ?? new Uint8ClampedArray(CANVAS * CANVAS * 4);

  // 칸마다 결의 위상을 바꾼다. 좌표에서 직접 뽑으므로 저장할 것이 없다.
  const phase = Number(((x * 7n) ^ (y * 13n)) & 7n);
  // 격자선을 그릴 자리. 칸 경계가 보여야 "바닥"으로 읽힌다.
  const edge = 2;

  let o = 0;
  for (let py = 0; py < CANVAS; py++) {
    const onEdgeY = py < edge || py >= CANVAS - edge;
    for (let px = 0; px < CANVAS; px++) {
      const onEdge = onEdgeY || px < edge || px >= CANVAS - edge;

      // 아주 약한 사선 결. 진폭이 3이므로 거의 보이지 않는다.
      const grain = ((px + py + phase) & 15) < 8 ? 1 : -1;
      const lift = onEdge ? 10 : 0;

      target[o] = WALL[0] + grain + lift;
      target[o + 1] = WALL[1] + grain + lift;
      target[o + 2] = WALL[2] + grain + lift;
      target[o + 3] = 255;
      o += 4;
    }
  }
  return target;
}

/**
 * 로비의 기본 자리. 순환 공간의 한가운데를 쓴다.
 *
 * 원점을 쓰지 않는 이유: 로비가 64x64 이므로 원점은 모서리이고, 거기서
 * 시작하면 순환을 만나기까지 한 방향으로만 걸어야 한다. 가운데면 어느
 * 방향으로 걸어도 대칭이다.
 */
export function lobbyHome() {
  const half = LOBBY_SPAN / 2n;
  return { x: half, y: half };
}
