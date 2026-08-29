// 렌더 조율자 — 좌표를 픽셀로 바꾸고 최근 결과를 재사용한다
//
// 기획서 12장. 중요한 규칙 하나.
//   캐시를 전부 비워도 결과가 완전히 동일해야 한다.
//   캐시는 성능 최적화일 뿐이며 정확성에 관여하지 않는다.
//
// 네트워크를 쓰지 않는다. 코덱이 순수 정수 연산이라 브라우저에서 바로 돈다.

import { CANVAS, tierSpec } from './spec.mjs';
import { createFrame, decodeFields, renderCode } from './codec.mjs';
import { coordinatesToCode, localityMix } from './space.mjs';

export function createRenderer({ cacheLimit = 96 } = {}) {
  const frames = new Map(); // tier → 재사용 프레임 버퍼
  const cache = new Map(); // key → Uint8ClampedArray (LRU)
  const stats = { renders: 0, hits: 0, lastMs: 0, totalMs: 0 };

  function frameFor(tier) {
    let frame = frames.get(tier);
    if (!frame) {
      frame = createFrame(tierSpec(tier));
      frames.set(tier, frame);
    }
    return frame;
  }

  /** 좌표에 해당하는 코드워드. 검색 없이 즉시 계산된다. */
  function codeFor(tier, locality, x, y) {
    const spec = tierSpec(tier);
    return coordinatesToCode(x, y, localityMix(locality, spec.axisBits), spec.axisBits);
  }

  /** 좌표의 픽셀. 캐시에 있으면 재사용한다. */
  function rgbaFor(tier, locality, x, y) {
    const key = `${tier}:${locality}:${x}:${y}`;

    const cached = cache.get(key);
    if (cached !== undefined) {
      stats.hits++;
      cache.delete(key); // LRU 갱신
      cache.set(key, cached);
      return cached;
    }

    const spec = tierSpec(tier);
    const frame = frameFor(tier);
    const started = performance.now();
    renderCode(spec, codeFor(tier, locality, x, y), frame);
    const elapsed = performance.now() - started;

    stats.renders++;
    stats.lastMs = elapsed;
    stats.totalMs += elapsed;

    const copy = frame.rgba.slice();
    cache.set(key, copy);
    if (cache.size > cacheLimit) cache.delete(cache.keys().next().value);
    return copy;
  }

  /** 캔버스에 그릴 수 있는 형태로 감싼다. 복사가 일어나지 않는다. */
  function imageDataFor(tier, locality, x, y) {
    return new ImageData(rgbaFor(tier, locality, x, y), CANVAS, CANVAS);
  }

  /** 개발자 패널용. 디코딩된 필드 값을 그대로 준다. */
  function fieldsFor(tier, locality, x, y) {
    const spec = tierSpec(tier);
    return decodeFields(spec, codeFor(tier, locality, x, y));
  }

  function clear() {
    cache.clear();
  }

  function snapshot() {
    return {
      ...stats,
      cached: cache.size,
      cacheLimit,
      averageMs: stats.renders ? stats.totalMs / stats.renders : 0,
    };
  }

  return { codeFor, rgbaFor, imageDataFor, fieldsFor, clear, snapshot };
}
