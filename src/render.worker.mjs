// 렌더 워커 — 좌표를 픽셀로
//
// 왜 워커인가
//   renderCode 는 정수 연산만 하고 DOM 을 건드리지 않는다. 그래서 그대로 돈다.
//   메인 스레드에서 돌리면 렌더가 프레임을 물어서 패닝이 끊긴다.
//   프레임 예산으로 쪼개는 방법은 끊김을 잘게 나누는 것이고, 워커는 없애는 것이다.
//
// 좌표는 문자열로 받는다. BigInt 도 구조화 복제가 되지만, 문자열이면
// 로그와 캐시 키가 그대로 읽힌다.

import {
  CANVAS,
  tierSpec,
  localityMix,
  coordinatesToCode,
  createFrame,
  renderCode,
} from './codec.mjs';

/** 층마다 프레임 버퍼와 혼합 계수를 재사용한다. */
const perTier = new Map();

function contextFor(tier, locality) {
  const key = `${tier}:${locality}`;
  let hit = perTier.get(key);
  if (!hit) {
    const spec = tierSpec(tier);
    hit = { spec, mix: localityMix(locality, spec.axisBits), frame: createFrame(spec) };
    perTier.set(key, hit);
  }
  return hit;
}

self.onmessage = async event => {
  const message = event.data;
  if (message?.type !== 'render') return;

  const { id, key, tier, locality, x, y } = message;
  try {
    const { spec, mix, frame } = contextFor(tier, locality);
    const code = coordinatesToCode(BigInt(x), BigInt(y), mix, spec.axisBits);
    renderCode(spec, code, frame);

    // 픽셀을 복사해서 넘긴다. createImageBitmap 이 비동기이므로 다음 요청이
    // 같은 프레임 버퍼에 덮어쓰면 엉뚱한 그림이 나간다. 256KB 복사는
    // 렌더 비용에 비하면 싸다.
    const pixels = new ImageData(new Uint8ClampedArray(frame.rgba), CANVAS, CANVAS);
    const bitmap = await createImageBitmap(pixels);
    self.postMessage({ type: 'rendered', id, key, x, y, tier, locality, bitmap }, [bitmap]);
  } catch (error) {
    // 있을 수 없다. 모든 좌표가 유효하기 때문이다. 그래도 형식은 갖춘다.
    self.postMessage({ type: 'failed', id, key, message: String(error?.message ?? error) });
  }
};
