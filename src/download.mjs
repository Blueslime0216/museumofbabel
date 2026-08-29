// 내보내기 — PNG 만
//
// 요구사항 7장.
//   AVIF 와 WebP 를 쓰지 않는다. 실측으로 확인한 이유가 있다 (01 의 작업노트).
//     Edge 는 AVIF 를 인코딩하지 못해 조용히 다음 후보로 떨어진다
//     그 WebP 는 서브픽셀의 48% 를 바꾼다 (최대차 87)
//     PNG 는 무손실이면서 743바이트 크다. 2KB 파일에서다
//   주소가 픽셀을 정확히 정의한다는 것이 이 프로젝트의 중심 주장이므로,
//   사람이 손에 들고 가는 파일이 그 주장과 어긋나서는 안 된다.
//
// 크기 두 가지.
//   256px   주소가 정의한 픽셀 그 자체. 한 픽셀도 다르지 않다
//   1024px  정확히 4배. 최근접 확대이므로 정보가 늘지는 않는다
//
// 파일 이름에 좌표 전문을 넣지 않는다. 층 8 은 10진수로 244자리라
// 이름이 약 495자가 되어 저장이 깨진다 (01 의 app.mjs 가 그 버그를 갖고 있다).

import { CANVAS } from './codec.mjs';
import { stampAddress } from './png.mjs';

/** 확대는 최근접으로. 구역 경계와 계단이 이 작품의 본질이다. */
function scaleUp(bitmap, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, 0, 0, size, size);
  return canvas;
}

function toBlob(canvas) {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

function trigger(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // 즉시 해제하면 일부 브라우저에서 저장이 취소된다.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * 지금 작품을 파일로 내린다.
 *
 * stamp 가 거짓이면 좌표를 넣지 않는다 (디버그 기능).
 * 좌표를 넣었다는 안내는 화면에 두지 않는다. 발표자가 설명한다.
 */
export async function downloadArtwork({ bitmap, size = CANVAS, hash, accession, stamp = true }) {
  const canvas = size === CANVAS ? scaleUp(bitmap, CANVAS) : scaleUp(bitmap, size);
  const blob = await toBlob(canvas);
  if (!blob) throw new Error('PNG 를 만들지 못했다');

  const plain = new Uint8Array(await blob.arrayBuffer());
  const bytes = stamp ? stampAddress(plain, hash) : plain;

  const name = `museum-of-babel-${accession}-${size}${stamp ? '' : '-plain'}.png`;
  trigger(new Blob([bytes], { type: 'image/png' }), name);

  return { size, bytes: bytes.length, stamped: stamp, name };
}
