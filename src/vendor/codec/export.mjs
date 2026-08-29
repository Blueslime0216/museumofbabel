// 내보내기 — AVIF를 우선하고, 안 되면 알린 뒤 대체한다
//
// 기획서 5장.
//   브라우저의 AVIF 인코딩 지원은 환경마다 다르다. 반드시 기능 감지를 한다.
//   조용히 PNG를 주고 AVIF라고 하지 않는다.
//
// AVIF는 이 프로젝트에서 주소 형식이 아니라 표시/내보내기 형식이다.
// 주소 공간은 AVIF 인코더가 없어도 완전히 동작한다.

const LABELS = {
  'image/avif': 'AVIF',
  'image/webp': 'WebP',
  'image/png': 'PNG',
};

/** 선호 순서. 앞에서부터 실제로 만들어지는 것을 쓴다. */
const PREFERRED = ['image/avif', 'image/webp', 'image/png'];

function makeCanvas(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function toBlob(canvas, type, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

/**
 * Blob이 정말 요청한 형식인지 확인한다.
 *
 * 브라우저는 지원하지 않는 형식을 요청받으면 조용히 PNG를 돌려준다.
 * MIME 타입만 믿지 않고 매직 바이트까지 본다.
 */
async function isReally(blob, type) {
  if (!blob) return false;
  if (blob.type !== type) return false;
  if (type !== 'image/avif') return true;

  const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (head.length < 12) return false;
  // ISOBMFF: [크기 4바이트]['ftyp'][브랜드]
  const tag = String.fromCharCode(head[4], head[5], head[6], head[7]);
  return tag === 'ftyp';
}

let cachedSupport = null;

/** 실제로 만들어지는 최선의 형식을 알아낸다. 결과는 캐시한다. */
export async function detectBestType() {
  if (cachedSupport) return cachedSupport;

  const probe = makeCanvas(2);
  const ctx = probe.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 2, 2);

  for (const type of PREFERRED) {
    try {
      const blob = await toBlob(probe, type, 0.9);
      if (await isReally(blob, type)) {
        cachedSupport = type;
        return type;
      }
    } catch {
      /* 다음 후보로 넘어간다 */
    }
  }

  cachedSupport = 'image/png';
  return cachedSupport;
}

/** UI 표시용 문구. */
export async function describeExportSupport() {
  const type = await detectBestType();
  return LABELS[type] ?? type;
}

function download(blob, filename, extension) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${filename}.${extension}`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // 즉시 해제하면 일부 브라우저에서 저장이 취소된다
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * 현재 작품을 파일로 내려받는다.
 *
 * 반환값의 type으로 실제 형식을 알 수 있다. 호출한 쪽이 사용자에게 알린다.
 */
export async function exportCurrent({ rgba, size, filename }) {
  const canvas = makeCanvas(size);
  canvas.getContext('2d', { alpha: false }).putImageData(new ImageData(rgba, size, size), 0, 0);

  const type = await detectBestType();
  let blob = await toBlob(canvas, type, 0.92);

  if (!(await isReally(blob, type))) {
    // 감지 결과와 실제가 다르면 PNG로 확실히 떨어뜨린다
    blob = await toBlob(canvas, 'image/png');
    const extension = 'png';
    download(blob, filename, extension);
    return { type: 'image/png', label: LABELS['image/png'], size: blob.size };
  }

  const extension = type.split('/')[1];
  download(blob, filename, extension);
  return { type, label: LABELS[type] ?? type, size: blob.size };
}
