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

import { CANVAS, LOBBY_AXIS_BITS, axisSize, axisBitsFor } from './codec.mjs';

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

/** 오늘의 그림 개수. */
export const TODAY_COUNT = 10;

/** 오늘의 그림 한 변(칸). */
const TODAY_SIZE = 4;

/** 후원자 그림 한 변(칸). 오늘의 그림보다 조금 작다. */
const PATRON_SIZE = 3.5;

/** 체험관 문 한 변(칸). */
const WORKSHOP_SIZE = 5;

/**
 * 물건을 놓을 고리. 로고 중심에서 이 거리 사이에 흩어진다.
 *
 * 안쪽은 로고(7칸)와 겹치지 않을 만큼, 바깥쪽은 첫 화면에 들어올 만큼이다.
 * 데스크톱에서 화면에 36칸쯤 보이므로 반경 17이면 대체로 한눈에 들어온다.
 */
const RING = { inner: 7.5, outer: 17 };

/**
 * 오늘의 그림이 걸리는 층.
 *
 * 층을 섞는다. 층 4는 블록이 커서 색면처럼 보이고 층 32는 아주 세밀하다.
 * 한 층으로만 채우면 열 장이 다 비슷해 보인다.
 */
const TODAY_TIERS = [4, 8, 16, 32];

/** 로비 물건의 국소성 단계. 주소에 들어가므로 하나로 고정한다. */
const LOBBY_LOCALITY = 4;

// ── 결정론적 난수 ────────────────────────────────────────────────────────
//
// 같은 날에 접속한 사람은 모두 같은 로비를 봐야 한다. "오늘의 그림" 이 사람마다
// 다르면 그것을 두고 이야기할 수 없다. 그래서 난수의 시드가 날짜다.
//
// 저장소도 서버도 없다. 날짜만으로 같은 배치가 다시 나온다.

/** xorshift32. 작품의 규율과 같다 — 같은 시드는 늘 같은 결과다. */
function seeded(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

/**
 * 날짜를 시드로. 지역 시간의 날짜를 쓴다.
 *
 * UTC 로 하면 어떤 지역에서는 아침에 "오늘의 그림" 이 바뀐다. 지역 날짜면 시간대
 * 마다 로비가 다르지만, 각 사람에게는 자기 하루와 맞는다. 그쪽이 낫다.
 */
export function daySeed(date = new Date()) {
  return (date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate()) >>> 0;
}

/** 난수로 축 비트만큼의 좌표를 만든다. 32비트씩 이어 붙인다. */
function randomAxis(random, axisBits) {
  let value = 0n;
  for (let filled = 0; filled < axisBits; filled += 32) {
    value = (value << 32n) | BigInt(Math.floor(random() * 4294967296));
  }
  return value & ((1n << BigInt(axisBits)) - 1n);
}

// ── 겹치지 않게 놓기 ─────────────────────────────────────────────────────

/**
 * 정사각형 두 개가 떨어져 있는가.
 *
 * 물건이 모두 정사각형이므로 축마다 따로 보면 된다(AABB). 원으로 보면 모서리가
 * 겹치는 것을 놓친다.
 */
function apart(a, b) {
  const need = (a.size + b.size) / 2 + MIN_GAP;
  return Math.abs(a.x - b.x) >= need || Math.abs(a.y - b.y) >= need;
}

/**
 * 고리 안의 빈 자리를 찾는다. 못 찾으면 null.
 *
 * 순환은 여기서 무시한다. 고리의 바깥 반경이 17이고 중심이 32이므로 15~49 범위에
 * 머물러 로비 경계(0·63)에 닿지 않는다. 경계에 닿게 넓히면 x=63 과 x=0 이
 * 이웃이라는 것을 여기서도 봐야 한다.
 */
function findSpot(random, size, taken, centre) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const angle = random() * Math.PI * 2;
    const radius = RING.inner + random() * (RING.outer - RING.inner);
    const spot = {
      x: centre + Math.cos(angle) * radius,
      y: centre + Math.sin(angle) * radius,
      size,
    };
    if (taken.every(other => apart(spot, other))) return spot;
  }
  return null;
}

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
 * 체험관 문.
 *
 * 자리를 고정한다. 로고 바로 아래다. 날마다 옮겨 다니면 "저기 있었는데" 가
 * 성립하지 않고, 다시 찾아오는 사람이 매번 헤맨다. 오늘의 그림은 날마다 바뀌어도
 * 되지만 문은 문이어야 한다.
 */
function workshopObject() {
  const centre = Number(LOBBY_SPAN / 2n);
  return {
    id: 'workshop',
    kind: 'art',
    x: centre,
    y: centre + 11,
    size: WORKSHOP_SIZE,
    labelKey: 'lobby.workshop',
    action: 'workshop',
    // 문에 걸린 그림도 좌표다. 고정된 주소이므로 늘 같은 그림이 걸려 있다.
    address: { tier: 8, locality: LOBBY_LOCALITY, x: 0x2b17f4c903n, y: 0x51e08a67d2n },
  };
}

/**
 * 로비에 놓을 물건 전체.
 *
 * 날짜를 받는다. "오늘의 그림" 이 그 날짜를 시드로 하므로, 같은 날에 접속한
 * 사람은 모두 같은 로비를 본다. 날짜를 넘기게 해 둔 것은 검사가 시간을 고정할
 * 수 있게 하려는 것이다.
 *
 * 순서가 곧 놓는 순서다. 먼저 놓인 것이 자리를 차지하고 나중 것이 피한다.
 *   1. 로고와 체험관 문   자리가 고정이다
 *   2. 자리를 적어 둔 후원자
 *   3. 자리를 적지 않은 후원자
 *   4. 오늘의 그림
 * 후원자를 오늘의 그림보다 먼저 놓는다. 날마다 바뀌는 것이 사람의 자리를
 * 밀어내면 안 된다.
 */
export function lobbyObjects({ date = new Date(), patrons = [] } = {}) {
  const centre = Number(LOBBY_SPAN / 2n);
  const random = seeded(daySeed(date));

  const objects = [logoObject(), workshopObject()];
  // 겹침 검사에 쓰는 자리 목록. 물건과 같은 모양이면 된다.
  const taken = objects.map(object => ({ x: object.x, y: object.y, size: object.size }));

  // ── 후원자 ──
  const fixed = patrons.filter(patron => patron.at);
  const floating = patrons.filter(patron => !patron.at);

  for (const [index, patron] of fixed.entries()) {
    const spot = { x: patron.at.x, y: patron.at.y, size: PATRON_SIZE };
    objects.push({
      id: `patron-${index}`,
      kind: 'art',
      ...spot,
      name: patron.name,
      labelKey: 'lobby.patron',
      action: 'artwork',
      address: patron.address,
    });
    taken.push(spot);
  }

  for (const [index, patron] of floating.entries()) {
    const spot = findSpot(random, PATRON_SIZE, taken, centre);
    if (!spot) continue; // 자리가 없으면 걸지 않는다. 겹쳐 거는 것보다 낫다
    objects.push({
      id: `patron-${fixed.length + index}`,
      kind: 'art',
      ...spot,
      name: patron.name,
      labelKey: 'lobby.patron',
      action: 'artwork',
      address: patron.address,
    });
    taken.push(spot);
  }

  // ── 오늘의 그림 ──
  //
  // 좌표를 무작위로 뽑는다. 보기 좋은 것을 골라 두지 않는다 — 무작위 좌표는
  // 무작위 그림이고, 그것이 이 미술관의 정직한 성질이다. 골라 두면 "모든 그림이
  // 이미 걸려 있다" 가 "우리가 고른 그림이 걸려 있다" 로 바뀐다.
  for (let index = 0; index < TODAY_COUNT; index++) {
    const spot = findSpot(random, TODAY_SIZE, taken, centre);
    if (!spot) continue;

    const tier = TODAY_TIERS[Math.floor(random() * TODAY_TIERS.length)];
    const axisBits = axisBitsFor(tier);
    objects.push({
      id: `today-${index}`,
      kind: 'art',
      ...spot,
      labelKey: 'lobby.today',
      action: 'artwork',
      address: {
        tier,
        locality: LOBBY_LOCALITY,
        x: randomAxis(random, axisBits),
        y: randomAxis(random, axisBits),
      },
    });
    taken.push(spot);
  }

  return objects;
}

// ── 체험관 ───────────────────────────────────────────────────────────────
//
// 체험관은 로비와 같은 층(0)이고 같은 크기(64x64)로 감긴다. 다른 곳은 놓인
// 물건뿐이다. 어느 쪽에 있는지는 주소가 아니라 `?w=1` 이 정한다 — 이유는
// hash.mjs 의 PARAM_WORKSHOP 에 적어 두었다.
//
// 바닥을 로비와 같게 두는 이유: 벽 색과 칸 무늬가 바뀌면 "로비에 있는 방" 이
// 아니라 다른 건물이 된다. 걸어 들어간 곳이 여전히 로비 안이라는 감각은 바닥이
// 같아야 유지된다. 여기가 체험관임을 말해 주는 것은 놓인 물건이다.

/** QR 포털 한 변(칸). 체험관에서 가장 큰 물건이다. */
const QR_SIZE = 7;

/**
 * 체험관에 놓을 물건 전체.
 *
 * 날짜를 받지 않는다. 체험관은 도구가 놓인 방이고, 도구는 날마다 자리를 바꾸면
 * 안 된다. 오늘의 그림처럼 바뀌는 것은 로비의 몫이다.
 *
 *   1. QR 포털   가운데. 들어오면 바로 앞에 있다
 *   2. 돌아가는 문   로비의 체험관 문과 **같은 좌표**다
 *
 * 문을 같은 좌표에 두는 것은 우연이 아니다. 로비 (32,43)의 문으로 들어왔으면
 * 체험관 (32,43)에 돌아가는 문이 있다. 문 하나가 두 방을 잇는 것처럼 보인다.
 */
export function workshopObjects() {
  const centre = Number(LOBBY_SPAN / 2n);
  return [
    {
      id: 'qr',
      kind: 'art',
      x: centre,
      y: centre,
      size: QR_SIZE,
      labelKey: 'lobby.qr',
      action: 'qr',
      // 이것도 좌표에서 나온 그림이다. QR 처럼 보이는 그림을 그려 넣지 않는다 —
      // 이 미술관의 모든 픽셀은 주소에서 계산된다는 규칙이 표지에도 적용된다.
      address: { tier: 16, locality: LOBBY_LOCALITY, x: 0x7c3a91e04dn, y: 0x1f6b8d2a05n },
    },
    {
      id: 'exit',
      kind: 'art',
      x: centre,
      y: centre + 11,
      size: WORKSHOP_SIZE,
      labelKey: 'lobby.exit',
      action: 'lobby',
      address: { tier: 8, locality: LOBBY_LOCALITY, x: 0x3d05be7192n, y: 0x6a24c0f83bn },
    },
  ];
}
