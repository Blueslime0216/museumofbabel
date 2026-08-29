// 서버가 만드는 PNG 검사
//
// 여기서 지키는 것
//   1. 형식      서명 · IHDR · CRC · 청크 순서가 맞다
//   2. 픽셀      디코딩하면 코덱이 만든 픽셀과 정확히 같다
//   3. 도장      tEXt 로 적은 주소가 다시 읽힌다
//   4. 주소 읽기 `#` 이 있어도 없어도 받고, 이상한 것은 null 이다
//
// 2번을 위해 PNG 디코더를 여기서 짧게 쓴다. 인코더를 인코더로 검사하면 뜻이
// 없으므로 반대 방향을 따로 만든다. 우리가 쓰는 형식(트루컬러 8비트 · Up 필터)
// 만 읽으면 되므로 스무 줄이면 된다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';

import { encodePng } from '../api/_lib/png-encode.mjs';
import { readAddress, addressText, renderArtworkPng, CARD_SIZE } from '../api/_lib/artwork.mjs';
import { readAddress as readStamp } from '../src/png.mjs';
import {
  CANVAS,
  tierSpec,
  coordinatesToCode,
  localityMix,
  createFrame,
  renderCode,
  formatHash,
} from '../src/codec.mjs';

// ── 아주 작은 PNG 디코더 (검사용) ────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
const crc32 = bytes => {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function decodePng(buffer) {
  assert.deepEqual(
    [...buffer.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    'PNG 서명',
  );

  const found = [];
  const parts = [];
  let width = 0;
  let height = 0;
  let at = 8;
  while (at + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.subarray(at + 4, at + 8).toString('latin1');
    const data = buffer.subarray(at + 8, at + 8 + length);
    const stored = buffer.readUInt32BE(at + 8 + length);
    assert.equal(crc32(buffer.subarray(at + 4, at + 8 + length)), stored, `${type} 의 CRC`);
    found.push(type);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, '채널당 8비트');
      assert.equal(data[9], 2, '트루컬러');
      assert.equal(data[10], 0, 'deflate');
      assert.equal(data[11], 0, '표준 필터');
      assert.equal(data[12], 0, '인터레이스 없음');
    }
    if (type === 'IDAT') parts.push(data);
    at += 12 + length;
  }

  assert.equal(found[0], 'IHDR', '첫 청크는 IHDR');
  assert.equal(found.at(-1), 'IEND', '끝 청크는 IEND');

  // Up 필터를 되돌린다
  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * 3;
  assert.equal(raw.length, height * (stride + 1), '압축을 풀면 크기가 맞는다');
  const rgb = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const source = y * (stride + 1);
    assert.equal(raw[source], 2, `${y}행의 필터는 Up`);
    for (let x = 0; x < stride; x++) {
      const above = y === 0 ? 0 : rgb[(y - 1) * stride + x];
      rgb[y * stride + x] = (raw[source + 1 + x] + above) & 0xff;
    }
  }
  return { width, height, rgb, chunks: found };
}

// ── 1 · 2 — 형식과 픽셀 ──────────────────────────────────────────────────

test('작은 그림을 넣으면 그대로 되돌아온다', () => {
  const width = 5;
  const height = 3;
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0; i < rgb.length; i++) rgb[i] = (i * 37) & 0xff;

  const decoded = decodePng(encodePng(rgb, width, height));
  assert.equal(decoded.width, width);
  assert.equal(decoded.height, height);
  assert.deepEqual([...decoded.rgb], [...rgb]);
});

test('픽셀 수가 안 맞으면 던진다', () => {
  assert.throws(() => encodePng(Buffer.alloc(10), 4, 4), /픽셀 수가/);
});

test('전시물 PNG 가 코덱의 픽셀과 같다', () => {
  const state = readAddress('v1.8.4.abc.def');
  assert.ok(state, '주소를 읽었다');

  const png = renderArtworkPng(state, CARD_SIZE);
  const decoded = decodePng(png);
  assert.equal(decoded.width, CARD_SIZE);
  assert.equal(decoded.height, CARD_SIZE);

  // 코덱을 따로 돌려 원본 픽셀을 얻는다
  const spec = tierSpec(state.tier);
  const frame = createFrame(spec);
  renderCode(
    spec,
    coordinatesToCode(state.x, state.y, localityMix(state.locality, spec.axisBits), spec.axisBits),
    frame,
  );

  const scale = CARD_SIZE / CANVAS;
  let checked = 0;
  for (let y = 0; y < CANVAS; y++) {
    for (let x = 0; x < CANVAS; x++) {
      const source = (y * CANVAS + x) * 4;
      // 확대된 사각형 안에서 세 점을 골라 본다. 최근접이면 다 같아야 한다.
      for (const [dy, dx] of [
        [0, 0],
        [scale >> 1, scale >> 1],
        [scale - 1, scale - 1],
      ]) {
        const target = ((y * scale + dy) * CARD_SIZE + (x * scale + dx)) * 3;
        assert.equal(decoded.rgb[target], frame.rgba[source], `(${x},${y}) 의 R`);
        assert.equal(decoded.rgb[target + 1], frame.rgba[source + 1], `(${x},${y}) 의 G`);
        assert.equal(decoded.rgb[target + 2], frame.rgba[source + 2], `(${x},${y}) 의 B`);
        checked++;
      }
    }
  }
  assert.equal(checked, CANVAS * CANVAS * 3);
});

test('Up 필터가 파일을 실제로 줄인다', () => {
  // 우리 그림은 구역이 납작해서 같은 행이 이어진다. 필터가 그것을 0 으로 만든다.
  const state = readAddress('v1.8.4.abc.def');
  const png = renderArtworkPng(state, CARD_SIZE);
  const rawSize = CARD_SIZE * CARD_SIZE * 3;
  assert.ok(
    png.length < rawSize / 8,
    `${(png.length / 1024).toFixed(0)}KB 가 원본 ${(rawSize / 1024).toFixed(0)}KB 의 8분의 1보다 작다`,
  );
});

// ── 3 — 도장 ─────────────────────────────────────────────────────────────

test('PNG 에 주소가 적혀 있다', () => {
  const state = readAddress('#v1.4.4.abc.def');
  const png = renderArtworkPng(state, 512);
  assert.equal(readStamp(png), formatHash(state));
});

// ── 4 — 주소 읽기 ────────────────────────────────────────────────────────

test('주소는 # 이 있어도 없어도 읽힌다', () => {
  const withHash = readAddress('#v1.8.4.abc.def');
  const without = readAddress('v1.8.4.abc.def');
  assert.deepEqual(withHash, without);
  assert.equal(addressText(withHash), 'v1.8.4.abc.def');
});

test('이상한 주소는 null 이다', () => {
  for (const bad of [
    '',
    '   ',
    null,
    undefined,
    'hello',
    'v9.8.4.abc.def', // 버전이 다르다
    'v1.7.4.abc.def', // 없는 층
    'v1.8.99.abc.def', // 없는 국소성 단계
    'v1.8.4.ABC.def', // 대문자
    'v1.8.4.abc', // 축이 하나
    `v1.4.4.${'z'.repeat(200)}.def`, // 층 4 의 축을 넘는 값
    `v1.8.4.${'z'.repeat(5000)}.def`, // 너무 길다
  ]) {
    assert.equal(readAddress(bad), null, `"${String(bad).slice(0, 24)}" 는 null`);
  }
});

test('층마다 다 읽힌다', () => {
  for (const tier of [4, 8, 16]) {
    const state = readAddress(`v1.${tier}.4.abc.def`);
    assert.ok(state, `층 ${tier}`);
    assert.equal(state.tier, tier);
  }
});
