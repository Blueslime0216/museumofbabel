// 층 — 관람객이 쓰는 이름과 코덱의 티어를 잇는다
//
// 코덱은 "티어" 라고 부르고 그 값은 구역 격자의 한 변이다 (4 · 8 · 16).
// 관람객에게 4 나 16 은 아무 뜻이 없다. 그래서 1층 · 2층 · 3층으로 부른다.
// 낮은 층이 거칠고 주소가 짧다. 높은 층이 세밀하고 주소가 길다.
//
// 이 대응을 한 곳에만 둔다. 층 모달과 찾기 모달이 같은 목록을 쓴다.

import { TIERS, tierSpec, LOBBY_TIER, isLobbyTier } from './codec.mjs';
import { LOBBY_SPAN } from './lobby.mjs';
import { MAX_VISIBLE, MIN_CELL } from './camera.mjs';
import { t } from './i18n/index.mjs';

// ── 층별 줌 예산 ─────────────────────────────────────────────────────────
//
// 깊은 층은 멀리 보지 못한다. 서사이기도 하지만 먼저 물리다.
//
// 왜 층마다 달라야 하는가
//   끌면 앞쪽 가장자리로 새 전시물이 들어온다. 화면 W x H, 한 변이 zoom px,
//   가로로 v px/s 로 끌 때 초당 들어오는 칸은 v*H / zoom^2 이다.
//   렌더 처리량은 워커 수 / 한 장 시간이다. 앞의 값이 뒤를 넘으면
//   가장자리에 아직 그리지 못한 검은 칸이 보인다.
//
//   조건을 풀면  zoom >= sqrt(v * H * 한장시간 / (1000 * 워커수))
//   즉 최소 줌은 한 장을 그리는 시간의 제곱근에 비례한다.
//
// 실측한 한 장의 코덱 시간 (데스크톱, 중앙값)
//   층1 0.474ms · 층2 0.515ms · 층3 0.609ms · 층4 1.104ms
//
// 층 1~3 은 서로 비슷하다. 캔버스가 어느 층에서나 256x256 이라 그릴 픽셀 수가
// 같기 때문이다. 층이 깊어지면 블록만 잘게 쪼개진다. 층4 만 두 배 가까이 든다.
//
// 그래서 처리량만 따르면 층 1~3 이 거의 같아지는데, 그러면 "깊어질수록 멀리
// 못 본다" 가 눈에 보이지 않는다. 두 요구를 함께 만족시킨다.
//   (a) 처리량: 적당한 탐색 속도에서 검은 칸이 없어야 한다
//   (b) 서사:   층마다 단조롭게 좁아져야 한다
//
// (b) 를 만족시키는 손잡이는 이미 있다. 최소 줌은 sqrt(화면면적 / 동시표시상한)
// 이므로 **동시 표시 상한을 층마다 줄이면** 된다. 그것이 곧 "이 층은 한눈에
// 몇 점까지 보여 주는가" 이고, 같은 값이 렌더 부담도 정한다. 손잡이 하나로 둘 다 잡힌다.

/** 층이 한 단계 깊어질 때 동시 표시 상한을 나누는 값. */
const NARROW_PER_FLOOR = 1.25;

/**
 * 가장 깊은 층인가.
 *
 * 그 층에만 아주 약한 비네트를 얹는다. "여기가 끝이다" 를 글자 없이 말하는
 * 방법이며, 스타일은 stage.css 의 --depth 가 받는다.
 *
 * 층 수를 세지 않고 티어로 판단한다. 층이 늘거나 줄어도 따라온다.
 * (구조적으로 32가 마지막이므로 실제로는 늘지 않는다. spec.mjs 참조)
 */
export function isDeepestFloor(tier) {
  return tier === Math.max(...TIERS);
}

/**
 * 층별 줌 예산.
 *
 * 실측으로 확인한 것 (오래된 휴대폰을 데스크톱의 6배 느림으로 가정, v=800px/s)
 *   휴대폰 390x844 에서 필요한 최소 줌은 층별로 47 · 48 · 49 · 59 px
 *   아래 값은 56 · 63 · 70 · 78 px 이므로 모든 층에서 여유가 있다
 *   그때 동시에 보이는 전시물은 105 · 83 · 67 · 54 점이다
 *
 * v=2500px/s 같은 강한 플릭은 층4 에서 104px 를 요구하므로 여전히 부족하다.
 * 그것은 "적당한 속도로 탐색" 의 범위를 넘는다고 보고 덮지 않는다.
 */
export function zoomBudgetFor(tier) {
  // 로비는 작품을 그리지 않으므로 렌더 부담이 거의 없다. 그래서 1층과 같은
  // 예산을 준다. 더 넓게 열 수도 있지만, 빈 격자를 멀리 보여 줄 이유가 없다.
  if (isLobbyTier(tier)) {
    return { maxVisible: MAX_VISIBLE, minCell: MIN_CELL, restScale: 1 };
  }
  const level = Math.max(1, FLOORS.find(floor => floor.tier === tier)?.level ?? 1);
  const steps = level - 1;
  const narrow = NARROW_PER_FLOOR ** steps;
  return {
    /** 이 층이 한눈에 보여 주는 전시물 수의 상한. */
    maxVisible: Math.round(MAX_VISIBLE / narrow),
    /** 전시물 한 변이 이보다 작아지지 않는다. */
    minCell: Math.round(MIN_CELL * Math.sqrt(narrow)),
    /** 입장할 때의 기본 줌에 곱하는 값. 깊은 층은 더 당겨서 시작한다. */
    restScale: Math.sqrt(narrow),
  };
}

/**
 * 로비(0층). 작품이 없으므로 tierSpec 이 없다.
 *
 * 층 번호가 0이고 나머지가 1부터인 이유: 관람객에게 "0층 = 로비" 는 건물의
 * 관례 그대로다. 그리고 작품 층의 번호를 바꾸지 않아도 된다.
 */
const LOBBY_FLOOR = {
  tier: LOBBY_TIER,
  level: 0,
  isLobby: true,
  grid: `${LOBBY_SPAN} × ${LOBBY_SPAN}`,
  zones: 0,
  bytes: 0,
};

/** 낮은 층부터. 로비가 0층, 작품 층은 1부터. */
export const FLOORS = [
  LOBBY_FLOOR,
  ...TIERS.slice()
    .sort((a, b) => a - b)
    .map((tier, index) => {
      const spec = tierSpec(tier);
      return {
        tier,
        level: index + 1,
        isLobby: false,
        grid: `${tier} × ${tier}`,
        zones: spec.blockCount,
        bytes: spec.byteLength,
      };
    }),
];

/**
 * 작품이 있는 층만. 로비를 뺀다.
 *
 * 찾기(투영)처럼 "작품" 을 전제하는 기능은 이 목록을 쓴다. 로비를 그런 자리에
 * 두면 고를 수 있는 것처럼 보이고, 골랐을 때 할 수 있는 일이 없다.
 */
export const ARTWORK_FLOORS = FLOORS.filter(floor => !floor.isLobby);

export function floorFor(tier) {
  return FLOORS.find(floor => floor.tier === tier) ?? FLOORS[0];
}

/** "2층" 또는 "Floor 2". */
export function floorName(tier) {
  return t('floor.name', { level: floorFor(tier).level });
}
