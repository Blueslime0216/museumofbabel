// 렌더 워커 — 좌표를 픽셀로
//
// 왜 워커인가
//   renderCode 는 정수 연산만 하고 DOM 을 건드리지 않는다. 그래서 그대로 돈다.
//   메인 스레드에서 돌리면 렌더가 프레임을 물어서 패닝이 끊긴다.
//   프레임 예산으로 쪼개는 방법은 끊김을 잘게 나누는 것이고, 워커는 없애는 것이다.
//
// 좌표는 **16진수 문자열**로 받는다.
//   BigInt 도 구조화 복제가 되지만 문자열이면 로그가 그대로 읽힌다.
//   10진수가 아니라 16진수인 이유. 2의 거듭제곱 진법은 비트를 옮기기만 하므로
//   자릿수에 선형이다. 10진수는 반복 나눗셈이다. 층 16 의 좌표는 3212비트이고,
//   그 차이가 실측으로 보였다 (10진수 967자 · 0.017ms 대 16진수 803자 · 0.001ms).

import {
  CANVAS,
  tierSpec,
  localityMix,
  coordinatesToCode,
  createFrame,
  renderCode,
  styleAt,
  isLobbyTier,
} from './codec.mjs';
import { renderLobbyTile } from './lobby.mjs';

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
    const wx = BigInt(`0x${x}`);
    const wy = BigInt(`0x${y}`);

    // 순수 계산 시간만 잰다. 비트맵으로 옮기는 비용은 따로다.
    const started = performance.now();
    let source;
    if (isLobbyTier(tier)) {
      // 로비. 코드워드도 전시실도 없다. tierSpec 을 부르면 안 된다.
      source = renderLobbyTile(wx, wy);
    } else {
      const { spec, mix, frame } = contextFor(tier, locality);
      const code = coordinatesToCode(wx, wy, mix, spec.axisBits);
      // 전시실은 좌표에서 나온다. 주소에 담기지 않으므로 여기서 유도한다.
      // 실측: 63타일에 대해 0.553ms. 렌더 한 장이 0.4~1ms 이므로 부담이 없다.
      renderCode(spec, code, frame, styleAt(wx, wy));
      source = frame.rgba;
    }
    const computeMs = performance.now() - started;

    // 픽셀을 복사해서 넘긴다. createImageBitmap 이 비동기이므로 다음 요청이
    // 같은 프레임 버퍼에 덮어쓰면 엉뚱한 그림이 나간다. 256KB 복사는
    // 렌더 비용에 비하면 싸다.
    const pixels = new ImageData(new Uint8ClampedArray(source), CANVAS, CANVAS);
    const bitmap = await createImageBitmap(pixels);
    self.postMessage(
      { type: 'rendered', id, key, x, y, tier, locality, computeMs, bitmap },
      [bitmap],
    );
  } catch (error) {
    // 있을 수 없다. 모든 좌표가 유효하기 때문이다. 그래도 형식은 갖춘다.
    self.postMessage({ type: 'failed', id, key, message: String(error?.message ?? error) });
  }
};
