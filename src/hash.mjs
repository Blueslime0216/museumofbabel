// 주소창 — 읽기와 쓰기
//
// 요구사항 5장. 형식은 코덱의 formatHash · parseHash 가 정한다.
//
// ── 왜 `#` 이 아니라 `?a=` 인가 ─────────────────────────────────────────
//
// 프래그먼트(`#`)는 서버로 가지 않는다. 그것이 좋은 점이었다. 그런데 링크를
// 붙였을 때 그 작품의 그림이 카드에 보이려면 크롤러가 어느 작품인지 알아야 하고,
// 크롤러는 자바스크립트를 돌리지 않으므로 **주소가 서버까지 가야 한다.**
// 그래서 쿼리로 옮겼다. 길이는 두 자 늘어난다 (`#` → `?a=`).
//
// `#` 자리에 적힌 주소도 읽어서 `?a=` 로 바꾼다. 한 번만 일어나고 히스토리에
// 쌓이지 않는다.
//
// 주의: 이것은 **자리**가 다른 것을 받아 주는 것이지 옛 판을 받아 주는 것이 아니다.
// v1 · v2 주소는 판 표식에서 거부된다. `#` 이든 `?a=` 든 마찬가지다.
//
// 표준형을 하나로 두는 이유. 둘을 같이 남기면 `/?a=X#X` 가 되어 주소가 두 배로
// 길어진다. 실제로 그렇게 될 수 있었다.
//
// ── 왜 조여야 하는가 ────────────────────────────────────────────────────
//   replaceState 는 히스토리 항목을 쌓지 않아 뒤로 가기 목록이 더러워지지 않는다.
//   다만 Safari 에 호출 빈도 제한이 있다. 중앙 전시물이 바뀔 때만, 500ms 에
//   한 번을 넘지 않게, 제스처 중에는 멈춘다. 최악의 경우 초당 2회다.

import {
  formatHash,
  parseHash,
  axisBitsFor,
  DEFAULT_TIER,
  DEFAULT_LOCALITY,
  LOBBY_TIER,
  isLobbyTier,
  randomCoordinate,
} from './codec.mjs';
import { lobbyHome } from './lobby.mjs';

const MIN_GAP_MS = 500;

/** 쿼리 이름. 한 자로 둔다. 주소가 이미 길다. */
export const PARAM = 'a';


/**
 * 체험관에 있는지 나타내는 쿼리. 값이 `1` 이면 체험관이다.
 *
 * ── 왜 층이 아니라 쿼리인가 ──────────────────────────────────────────────
 *
 * 체험관은 "로비에 있는 방" 이라는 설정이므로 로비와 같은 층(0)을 쓴다. 그래서
 * 좌표만으로는 로비와 구분되지 않고, 어딘가에 한 비트가 더 필요하다.
 *
 * 주소 안에 넣지 않는다. 층 색인은 `ADDRESSABLE_TIERS` 의 순서이고, 거기에 값을
 * 끼우면 **이미 나간 모든 주소가 다른 층을 가리킨다.** 끝에 붙이면 색인은
 * 보존되지만 그때는 코덱을 고치고 다시 동기화해야 한다. 얻는 것에 비해 비싸다.
 *
 * 작품 주소의 순수성을 해치지도 않는다. 이 쿼리는 **작품이 없는 층에서만** 뜻이
 * 있고, 작품 층 주소에는 아예 붙지 않는다. 로비가 이미 작품 공간 밖이라는 사실의
 * 연장이다.
 */
export const PARAM_WORKSHOP = 'w';

/** 상태 → 주소창에 넣을 문자열. `?a=…` 형태다. */
export function queryFor(state) {
  // 주소는 영숫자뿐이라(base62) 인코딩할 것이 없다. 그래도 규칙은 지킨다.
  const address = `?${PARAM}=${encodeURIComponent(formatHash(state).slice(1))}`;
  return state.workshop ? `${address}&${PARAM_WORKSHOP}=1` : address;
}

/**
 * 비교에 쓸 사본. 네 값만 가진다.
 *
 * 부르는 쪽이 살아 있는 state 객체를 그대로 넘기기도 한다. 참조를 들고 있으면
 * 나중에 그 객체가 바뀌어도 "같다" 로 판정해서 주소창이 멈춘다.
 */
const snapshot = ({ tier, locality, x, y, workshop }) => ({
  tier,
  locality,
  x,
  y,
  workshop: Boolean(workshop),
});

/**
 * 두 상태가 같은 자리인가.
 *
 * **주소 문자열로 견주면 안 된다.** 층 32 의 주소를 만드는 데 1.7ms 가 든다
 * (base62 는 2의 거듭제곱이 아니라 네이티브 변환이 없다). 이 함수는 끌기 중에도
 * 중앙 칸이 바뀔 때마다 불리므로, 초당 30번이면 55ms 를 주소 만드는 데 쓰게 된다.
 * 오래된 휴대폰이 목표 성능이라 그대로 두면 안 된다.
 *
 * BigInt 끼리의 비교는 워드 비교라 값싸다.
 */
function sameSpot(a, b) {
  return (
    a != null &&
    b != null &&
    a.tier === b.tier &&
    a.locality === b.locality &&
    a.x === b.x &&
    a.y === b.y &&
    Boolean(a.workshop) === Boolean(b.workshop)
  );
}

/** 남에게 줄 전체 링크. 이것이 카드에 그림을 띄우는 형태다. */
export function shareUrlFor(state) {
  return `${location.origin}${location.pathname}${queryFor(state)}`;
}

/**
 * 로비 가운데. 주소 없이 들어왔을 때의 자리다.
 *
 * 미술관의 입구이므로 여기가 기본값이다. 무작위 좌표는 `r` 키와 무작위 버튼이
 * 맡는다 — 그것은 관람객이 스스로 고르는 일이고, 처음 문을 열었을 때 일어날
 * 일은 아니다.
 */
function lobbyState(extra) {
  return { tier: LOBBY_TIER, locality: DEFAULT_LOCALITY, ...lobbyHome(), ...extra };
}

function randomState(extra) {
  const [x, y] = randomCoordinate(axisBitsFor(DEFAULT_TIER));
  return { tier: DEFAULT_TIER, locality: DEFAULT_LOCALITY, x, y, ...extra };
}

/**
 * 주소창의 `#` 만 읽는다. `#` 자리에 주소를 적어 붙였을 때를 위해 있다.
 *
 * 읽을 수 없거나 없으면 null. 이미 `?a=` 가 있어도 이쪽을 본다. 사람이 방금
 * 손으로 붙인 것이 이기는 것이 맞다.
 */
export function readLegacyHash() {
  if (location.hash.length <= 1) return null;
  try {
    return { ...parseHash(location.hash, axisBitsFor), fromUrl: true, legacy: true };
  } catch {
    return null;
  }
}

/**
 * 지금 주소를 읽는다. 읽을 수 없으면 무작위 좌표를 준다.
 *
 * `legacy` 가 참이면 옛 `#` 형태로 들어온 것이다. 표준형으로 바꾸는 일은
 * 첫 이동에서 `set` 이 알아서 한다 (`commit` 이 해시를 남기지 않는다).
 */
/**
 * 체험관 쿼리를 상태에 얹는다.
 *
 * **작품 층에서는 무시한다.** 작품 층에 `?w=1` 이 붙은 주소는 뜻이 없고, 그것을
 * 살려 두면 "체험관에 걸린 층 16 작품" 같은 있을 수 없는 상태가 생긴다. 로비
 * 층에서만 방을 가른다.
 */
function withWorkshop(state) {
  if (!isLobbyTier(state.tier)) return state;
  const flag = new URLSearchParams(location.search).get(PARAM_WORKSHOP);
  return flag === '1' ? { ...state, workshop: true } : state;
}

export function readState() {
  const query = new URLSearchParams(location.search).get(PARAM);
  if (query) {
    try {
      return withWorkshop({
        ...parseHash(`#${query.replace(/^#/, '')}`, axisBitsFor),
        fromUrl: true,
      });
    } catch {
      // 남이 준 깨진 주소다. 조용히 무시하지 않고 호출한 쪽이 알린다.
      // 입구로 돌려보낸다 — 무작위 좌표에 던지면 알림을 읽는 동안에도
      // 자기가 어디 있는지 모른다.
      return lobbyState({ fromUrl: false, broken: true });
    }
  }

  if (location.hash.length > 1) {
    try {
      return { ...parseHash(location.hash, axisBitsFor), fromUrl: true, legacy: true };
    } catch {
      return lobbyState({ fromUrl: false, broken: true, legacy: true });
    }
  }

  // 주소 없이 들어왔다. **로비로 보낸다.**
  //
  // 예전에는 무작위 좌표였다. 그러면 처음 온 사람이 아무 설명 없이 낯선 그림
  // 한가운데에 떨어진다. 여기가 무엇인지, 무엇을 할 수 있는지 알 방법이 없다.
  // 로비 가운데에는 이 미술관의 표지가 있고, 거기서부터 걸어 나가면 된다.
  return lobbyState({ fromUrl: false });
}

export function createHashWriter() {
  let last = '';
  let lastSpot = null;
  let lastAt = 0;
  let timer = 0;
  let queued = null;

  // 주소를 만드는 것은 여기 한 곳뿐이다. 그래서 최악의 경우에도 500ms 에 한 번이다.
  function commit(spot) {
    last = queryFor(spot);
    lastSpot = spot;
    lastAt = performance.now();
    // 해시는 남기지 않는다. 옛 링크로 들어왔다면 이 호출이 그것을 지운다.
    history.replaceState(null, '', `${location.pathname}${last}`);
  }

  return {
    /**
     * 중앙 전시물이 바뀌었을 때만 부른다.
     * paused 가 참이면 주소창에 쓰지 않고 담아만 둔다 (제스처 중).
     */
    set(state, { paused = false } = {}) {
      if (sameSpot(state, lastSpot)) return;
      const spot = snapshot(state);
      if (paused) {
        queued = spot;
        return;
      }

      const since = performance.now() - lastAt;
      if (since >= MIN_GAP_MS) {
        commit(spot);
        queued = null;
        return;
      }

      queued = spot;
      if (timer) return;
      timer = setTimeout(() => {
        timer = 0;
        if (queued && !sameSpot(queued, lastSpot)) commit(queued);
        queued = null;
      }, MIN_GAP_MS - since);
    },

    /** 제스처가 끝난 뒤 한 번 밀어 준다. */
    flush() {
      if (queued && !sameSpot(queued, lastSpot)) {
        commit(queued);
        queued = null;
      }
    },

    /** 옛 `#` 링크로 들어왔을 때 곧바로 표준형으로 바꾼다. */
    normalize(state) {
      commit(snapshot(state));
    },

    get current() {
      return last;
    },
  };
}
