// 투영 워커 — 그림에서 주소로
//
// 요구사항 8장.
//   projectRgba 는 순수 함수다. 그래서 워커에서 그대로 돈다.
//   메인 스레드에서 돌리면 그 시간 동안 화면이 완전히 얼어붙는다.
//   층 8 이 PC 에서 3초쯤이므로 휴대폰에서는 그보다 훨씬 걸릴 수 있다.
//
// 이 방향은 근사다. **왕복하지 않는다.**
//   무손실 픽셀을 그대로 다시 넣어도 좌표가 돌아오지 않는다.
//   원인은 quant 후보 5개 제한과 편향된 기준값 추정이다 (01 의 작업노트).
//   그래서 우리가 내려준 파일은 tEXt 청크로 정확히 되찾고, 남이 만든 그림만
//   이 투영을 쓴다.

import { CANVAS, projectRgba } from './codec.mjs';

/** 올린 그림을 256×256 으로 정규화한다. 브라우저가 리샘플링을 해 준다. */
function toRgba(bitmap) {
  const canvas = new OffscreenCanvas(CANVAS, CANVAS);
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, CANVAS, CANVAS);
  return ctx.getImageData(0, 0, CANVAS, CANVAS).data;
}

self.onmessage = async event => {
  const message = event.data;
  if (message?.type !== 'project') return;

  const { id, tier, locality, bitmap } = message;
  try {
    const started = performance.now();
    const source = toRgba(bitmap);
    bitmap.close?.();

    const result = projectRgba(source, tier, locality);
    const elapsed = performance.now() - started;

    // 원본(정규화된 것)과 결과를 둘 다 넘긴다. 나란히 보여 주는 데 쓴다.
    const [before, after] = await Promise.all([
      createImageBitmap(new ImageData(new Uint8ClampedArray(source), CANVAS, CANVAS)),
      createImageBitmap(new ImageData(new Uint8ClampedArray(result.rgba), CANVAS, CANVAS)),
    ]);

    self.postMessage(
      {
        type: 'projected',
        id,
        tier,
        locality,
        x: String(result.x),
        y: String(result.y),
        error: result.error,
        ms: Math.round(elapsed),
        before,
        after,
      },
      [before, after],
    );
  } catch (error) {
    self.postMessage({ type: 'failed', id, message: String(error?.message ?? error) });
  }
};
