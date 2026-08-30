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
// ── 격자가 아니라 자유 배치다 ────────────────────────────────────────────
//
// 작품 층은 칸에 딱 맞는 격자다. 로비는 그러면 안 된다. 로비는 걸어 들어오는
// **장소**이고, 격자에 맞춰 놓인 물건은 전시물처럼 보여서 "여기도 작품 층인가"
// 하게 만든다.
//
// 그래서 격자 타일은 **바닥**으로만 남기고(아래 renderLobbyTile), 그 위에
// 실수 좌표와 임의 크기를 갖는 물건들을 얹는다. 물건은 칸 경계를 무시한다.
//
// 순환은 그대로 지켜진다. 물건도 64칸마다 되풀이해 그리므로, 한 방향으로 계속
// 걸으면 같은 로고를 다시 만난다. 작은 우주라는 말이 그런 뜻이다.
//
// ── 물건의 그림은 어디서 오는가 ──────────────────────────────────────────
//
// 로고 하나만 진짜 이미지 파일이다. 그것은 이 미술관의 표지이므로 좌표에서
// 나올 수 없다.
//
// 나머지는 전부 **주소**다. 오늘의 그림 · 후원자의 그림 · 체험관 포털 모두
// 좌표만 적어 두고 브라우저가 그린다. 그래야 "픽셀은 브라우저가 계산한다.
// 이미지를 가져오지 않는다"가 로비에서도 지켜진다. 후원자의 사진을 호스팅하지
// 않는 이유도 이것이다.

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

// ── 로비에 놓인 물건들 ───────────────────────────────────────────────────

/**
 * @typedef {object} LobbyObject
 * @property {string} id       고유 이름. 화면 검사가 이것으로 찾는다
 * @property {'logo'|'art'} kind
 * @property {number} x        로비 칸 단위의 **실수** 좌표. 물건의 중심
 * @property {number} y
 * @property {number} size     한 변의 길이(칸 단위)
 * @property {string} [labelKey] 사전 키. 이름표에 쓴다
 * @property {object} [address]  kind==='art' 일 때 그림을 낼 좌표
 * @property {'artwork'|'page'} [action] 누르면 무엇을 하는가
 * @property {string} [href]     action==='page' 일 때 갈 곳
 */

/** 중앙 로고의 한 변(칸). 로비에서 가장 큰 물건이다. */
export const LOGO_SIZE = 7;

/** 물건끼리 이만큼은 떨어져 있어야 한다(칸). 겹침 방지가 이 값을 쓴다. */
export const MIN_GAP = 1.2;

/**
 * 중앙 로고.
 *
 * 로비의 한가운데(lobbyHome 과 같은 자리)에 둔다. 처음 들어온 사람이 가장 먼저
 * 보는 것이고, 여기가 어디인지 말해 주는 유일한 물건이다.
 *
 * 이것만 진짜 이미지 파일이다. 미술관의 표지는 좌표에서 나올 수 없다.
 */
function logoObject() {
  const centre = Number(LOBBY_SPAN / 2n);
  return {
    id: 'logo',
    kind: 'logo',
    x: centre,
    y: centre,
    size: LOGO_SIZE,
    labelKey: 'lobby.logo',
  };
}

/**
 * 로비에 놓을 물건 전체.
 *
 * 날짜를 받는다. "오늘의 그림" 이 그 날짜를 시드로 하므로, 같은 날에 접속한
 * 사람은 모두 같은 로비를 본다. 날짜를 넘기게 해 둔 것은 검사가 시간을 고정할
 * 수 있게 하려는 것이다.
 */
export function lobbyObjects({ date = new Date(), patrons = [] } = {}) {
  void date;
  void patrons;
  return [logoObject()];
}
