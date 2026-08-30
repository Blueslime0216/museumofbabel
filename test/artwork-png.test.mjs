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
  styleAt,
  toBase62,
  fromBase36,
  axisBitsFor,
  ADDRESSABLE_TIERS,
  LOBBY_TIER,
  VERSION_MARKER,
} from '../src/codec.mjs';

// ── 시험용 주소 ──────────────────────────────────────────────────────────
//
// 주소를 글자로 적어 두지 않는다. 형식이 바뀌면 검사가 통째로 썩기 때문이다.
// v2 → v3 로 바꿀 때 실제로 다섯 개가 한꺼번에 깨졌다. 상태에서 만들어 쓴다.

/** 층 하나의 시험용 주소. 좌표는 아무 값이나 고정으로 쓴다. */
function addressOf(tier) {
  return formatHash({
    tier,
    locality: 4,
    x: fromBase36('abc'),
    y: fromBase36('def'),
  }).slice(1);
}

const SAMPLE = addressOf(8);

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
  const state = readAddress(SAMPLE);
  assert.ok(state, '주소를 읽었다');

  const png = renderArtworkPng(state, CARD_SIZE);
  const decoded = decodePng(png);
  assert.equal(decoded.width, CARD_SIZE);
  assert.equal(decoded.height, CARD_SIZE);

  // 코덱을 따로 돌려 원본 픽셀을 얻는다.
  // 전시실을 반드시 같이 적용해야 한다. 이 좌표가 어느 방에 있는지가
  // 그림을 정하므로, 방을 빼먹으면 카드가 방문자가 보는 것과 달라진다.
  const spec = tierSpec(state.tier);
  const frame = createFrame(spec);
  renderCode(
    spec,
    coordinatesToCode(state.x, state.y, localityMix(state.locality, spec.axisBits), spec.axisBits),
    frame,
    styleAt(state.x, state.y),
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
  const state = readAddress(SAMPLE);
  const png = renderArtworkPng(state, CARD_SIZE);
  const rawSize = CARD_SIZE * CARD_SIZE * 3;
  assert.ok(
    png.length < rawSize / 8,
    `${(png.length / 1024).toFixed(0)}KB 가 원본 ${(rawSize / 1024).toFixed(0)}KB 의 8분의 1보다 작다`,
  );
});

// ── 3 — 도장 ─────────────────────────────────────────────────────────────

test('PNG 에 주소가 적혀 있다', () => {
  const state = readAddress(addressOf(4));
  const png = renderArtworkPng(state, 512);
  assert.equal(readStamp(png), formatHash(state));
});

// ── 4 — 주소 읽기 ────────────────────────────────────────────────────────

test('주소는 # 이 있어도 없어도 읽힌다', () => {
  const withHash = readAddress(`#${SAMPLE}`);
  const without = readAddress(SAMPLE);
  assert.deepEqual(withHash, without);
  assert.equal(addressText(withHash), SAMPLE);
});

test('이상한 주소는 null 이다', () => {
  // 층 4 의 축을 넘는 좌표를 담은 주소. 형식은 맞고 값이 밖이다.
  const tier4Axis = axisBitsFor(4);
  const outside = (() => {
    const size = 1n << BigInt(tier4Axis);
    const tierIndex = ADDRESSABLE_TIERS.indexOf(4);
    const body = size << BigInt(tier4Axis); // x = size (한 칸 초과)
    return `${VERSION_MARKER}${toBase62((body << 6n) | BigInt((4 << 3) | tierIndex))}`;
  })();

  for (const bad of [
    '',
    '   ',
    null,
    undefined,
    'hello',
    'v1.8.4.abc.def', // 옛 판. 판 표식에서 걸린다
    'v2.8.4.abc.def', // 옛 판
    'B123', // v2 표식
    'D123', // 아직 없는 판
    `${VERSION_MARKER}abc!def`, // 62진수가 아닌 글자
    `${VERSION_MARKER}`, // 몸통이 없다
    outside, // 층 4 의 축을 넘는 값
    `${VERSION_MARKER}${'z'.repeat(9000)}`, // 너무 길다
  ]) {
    assert.equal(readAddress(bad), null, `"${String(bad).slice(0, 24)}" 는 null`);
  }
});

test('로비 주소는 그림이 없으므로 거부된다', () => {
  // 형식으로는 유효하지만 이 함수의 약속은 "그릴 수 있는 작품 하나" 다.
  const lobby = formatHash({ tier: LOBBY_TIER, locality: 4, x: 3n, y: 7n }).slice(1);
  assert.equal(readAddress(lobby), null);
});

test('층마다 다 읽힌다', () => {
  for (const tier of [4, 8, 16, 32]) {
    const state = readAddress(addressOf(tier));
    assert.ok(state, `층 ${tier}`);
    assert.equal(state.tier, tier);
  }
});

test('가장 깊은 층의 가장 긴 주소도 길이 제한에 걸리지 않는다', () => {
  // 손으로 적어 둔 4000자 제한이 층 32 의 최대 주소(4,306자)보다 짧아서 카드와
  // 그림이 조용히 400 을 돌려주던 결함이 있었다. 제한을 명세에서 끌어내도록 고쳤다.
  //
  // 좌표를 최대로 둬야 최대 길이가 나온다. x 가 높은 자리에 있으므로 x 가 작으면
  // 주소도 짧아진다 (같은 층에서도 길이가 다르다).
  const size = 1n << BigInt(axisBitsFor(32));
  const longest = formatHash({ tier: 32, locality: 4, x: size - 1n, y: size - 1n }).slice(1);

  assert.ok(longest.length > 4000, `층 32 의 최대 주소가 ${longest.length} 자다`);
  assert.ok(readAddress(longest), '가장 깊은 층의 주소를 거부했다');
});
