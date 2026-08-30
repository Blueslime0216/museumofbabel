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
// 옛 `#` 링크는 버리지 않는다. 들어오는 순간 읽어서 `?a=` 로 바꾼다.
// 한 번만 일어나고 히스토리에 쌓이지 않는다.
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
  randomCoordinate,
} from './codec.mjs';

const MIN_GAP_MS = 500;

/** 쿼리 이름. 한 자로 둔다. 주소가 이미 길다. */
export const PARAM = 'a';


/** 상태 → 주소창에 넣을 문자열. `?a=…` 형태다. */
export function queryFor(state) {
  // 우리 주소는 `[0-9a-z.]` 와 `v2` 뿐이라 인코딩할 것이 없다. 그래도 규칙은 지킨다.
  return `?${PARAM}=${encodeURIComponent(formatHash(state).slice(1))}`;
}

/** 남에게 줄 전체 링크. 이것이 카드에 그림을 띄우는 형태다. */
export function shareUrlFor(state) {
  return `${location.origin}${location.pathname}${queryFor(state)}`;
}

function randomState(extra) {
  const [x, y] = randomCoordinate(axisBitsFor(DEFAULT_TIER));
  return { tier: DEFAULT_TIER, locality: DEFAULT_LOCALITY, x, y, ...extra };
}

/**
 * 주소창의 `#` 만 읽는다. 옛 링크를 붙였을 때를 위해 있다.
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
export function readState() {
  const query = new URLSearchParams(location.search).get(PARAM);
  if (query) {
    try {
      return { ...parseHash(`#${query.replace(/^#/, '')}`, axisBitsFor), fromUrl: true };
    } catch {
      // 남이 준 깨진 주소다. 조용히 무시하지 않고 호출한 쪽이 알린다.
      return randomState({ fromUrl: false, broken: true });
    }
  }

  if (location.hash.length > 1) {
    try {
      return { ...parseHash(location.hash, axisBitsFor), fromUrl: true, legacy: true };
    } catch {
      return randomState({ fromUrl: false, broken: true, legacy: true });
    }
  }

  return randomState({ fromUrl: false });
}

export function createHashWriter() {
  let last = '';
  let lastAt = 0;
  let timer = 0;
  let queued = null;

  function commit(query) {
    last = query;
    lastAt = performance.now();
    // 해시는 남기지 않는다. 옛 링크로 들어왔다면 이 호출이 그것을 지운다.
    history.replaceState(null, '', `${location.pathname}${query}`);
  }

  return {
    /**
     * 중앙 전시물이 바뀌었을 때만 부른다.
     * paused 가 참이면 아무것도 하지 않는다 (제스처 중).
     */
    set(state, { paused = false } = {}) {
      const query = queryFor(state);
      if (query === last) return;
      if (paused) {
        queued = query;
        return;
      }

      const since = performance.now() - lastAt;
      if (since >= MIN_GAP_MS) {
        commit(query);
        queued = null;
        return;
      }

      queued = query;
      if (timer) return;
      timer = setTimeout(() => {
        timer = 0;
        if (queued && queued !== last) commit(queued);
        queued = null;
      }, MIN_GAP_MS - since);
    },

    /** 제스처가 끝난 뒤 한 번 밀어 준다. */
    flush() {
      if (queued && queued !== last) {
        commit(queued);
        queued = null;
      }
    },

    /** 옛 `#` 링크로 들어왔을 때 곧바로 표준형으로 바꾼다. */
    normalize(state) {
      commit(queryFor(state));
    },

    get current() {
      return last;
    },
  };
}
