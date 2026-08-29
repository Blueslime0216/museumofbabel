// PNG 인코더 — 픽셀에서 파일로
//
// 왜 있는가
//   브라우저에서는 canvas.toBlob 이 PNG 를 만들어 준다. 서버에는 캔버스가 없다.
//   링크 카드에 넣을 그림을 함수가 만들어야 하므로 여기서 직접 쓴다.
//   `node:zlib` 만 쓴다. 의존성을 늘리지 않는다.
//
// src/png.mjs 와 무엇이 다른가
//   그쪽은 이미 있는 PNG 에 tEXt 청크를 끼우고 읽는다. 만들지는 못한다.
//   이 파일은 만든다. CRC 계산이 겹치지만 그쪽은 브라우저에서도 돌아야 하므로
//   Buffer 를 쓸 수 없다. 겹치는 열 줄을 합치려고 양쪽을 묶지 않는다.

import { deflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * RGB 픽셀을 PNG 로. 알파는 없다. 전시물은 불투명하다.
 *
 * 필터는 2번(Up)을 쓴다. 위 픽셀과의 차이만 남기는 방식이다.
 * 우리 그림은 구역이 크고 납작해서 같은 행이 여러 줄 이어진다. 그 행들이
 * 전부 0 이 되어 압축이 아주 잘 된다. 필터 없이 쓰면 파일이 몇 배가 된다.
 */
export function encodePng(rgb, width, height) {
  if (rgb.length !== width * height * 3) {
    throw new RangeError(`픽셀 수가 ${width}×${height}×3 과 다르다`);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 채널당 8비트
  header[9] = 2; // 트루컬러 (RGB)
  header[10] = 0; // 압축: deflate
  header[11] = 0; // 필터 방식: 표준
  header[12] = 0; // 인터레이스 없음

  const stride = width * 3;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const at = y * (stride + 1);
    raw[at] = 2; // Up 필터
    const row = y * stride;
    const above = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      raw[at + 1 + x] = (rgb[row + x] - (y === 0 ? 0 : rgb[above + x])) & 0xff;
    }
  }

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
