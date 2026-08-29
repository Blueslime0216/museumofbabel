// URL 해시 — 읽기와 쓰기
//
// 요구사항 5장.
//   형식은 코덱의 formatHash · parseHash 가 정한다. 여기서 다시 만들지 않는다.
//
// 왜 조여야 하는가
//   replaceState 는 히스토리 항목을 쌓지 않는다. 그래서 뒤로 가기 목록이
//   더러워지지 않는다. 다만 Safari 에 호출 빈도 제한이 있다.
//   중앙 전시물이 바뀔 때만, 500ms 에 한 번을 넘지 않게, 제스처 중에는 멈춘다.
//   최악의 경우 초당 2회다.

import { formatHash, parseHash, tierSpec, DEFAULT_TIER, DEFAULT_LOCALITY, randomCoordinate } from './codec.mjs';

const MIN_GAP_MS = 500;

const axisBitsFor = tier => tierSpec(tier).axisBits;

/** 지금 주소를 읽는다. 읽을 수 없으면 무작위 좌표를 준다. */
export function readState() {
  if (location.hash) {
    try {
      return { ...parseHash(location.hash, axisBitsFor), fromUrl: true };
    } catch {
      // 남이 준 깨진 주소다. 조용히 무시하지 않고 호출한 쪽이 알린다.
      const [x, y] = randomCoordinate(axisBitsFor(DEFAULT_TIER));
      return { tier: DEFAULT_TIER, locality: DEFAULT_LOCALITY, x, y, fromUrl: false, broken: true };
    }
  }
  const [x, y] = randomCoordinate(axisBitsFor(DEFAULT_TIER));
  return { tier: DEFAULT_TIER, locality: DEFAULT_LOCALITY, x, y, fromUrl: false };
}

export function hashFor(state) {
  return formatHash(state);
}

export function createHashWriter() {
  let last = '';
  let lastAt = 0;
  let timer = 0;
  let queued = null;

  function commit(hash) {
    last = hash;
    lastAt = performance.now();
    history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
  }

  return {
    /**
     * 중앙 전시물이 바뀌었을 때만 부른다.
     * paused 가 참이면 아무것도 하지 않는다 (제스처 중).
     */
    set(state, { paused = false } = {}) {
      const hash = formatHash(state);
      if (hash === last) return;
      if (paused) {
        queued = hash;
        return;
      }

      const since = performance.now() - lastAt;
      if (since >= MIN_GAP_MS) {
        commit(hash);
        queued = null;
        return;
      }

      queued = hash;
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

    get current() {
      return last;
    },
  };
}
