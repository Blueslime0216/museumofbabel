// 미니맵 검사
//
// 미니맵은 그림을 그리지 않고 주소의 헤더에서 색을 읽는다. 그 읽기가 코덱의
// 정식 해석과 어긋나면 지도가 거짓말을 하는데, 눈으로는 알 수 없다 — 색이
// 그럴듯하게 나오기 때문이다. 그래서 여기서 두 길을 맞춰 본다.

import test from 'node:test';
import assert from 'node:assert/strict';

import { baseToneOf, createMinimapColours, MINIMAP_SPAN } from '../src/minimap.mjs';
import { tierSpec, coordinatesToCode, localityMix, decodeFields } from '../src/codec.mjs';

const LOCALITY = 4;

/** 코덱의 정식 해석으로 기준 색을 구한다. 느리지만 이것이 참이다. */
function toneByCodec(spec, code) {
  const fields = decodeFields(spec, code);
  const expand6 = v => ((v << 2) | (v >> 4)) & 0xff;
  const expand4 = v => ((v << 4) | v) & 0xff;
  const clamp8 = v => (v < 0 ? 0 : v > 255 ? 255 : v);
  const y = expand6(fields.header.baseLuma);
  const vb = expand4(fields.header.baseCb) - 128;
  const vr = expand4(fields.header.baseCr) - 128;
  return {
    r: clamp8(y + ((91881 * vr) >> 16)),
    g: clamp8(y - ((22554 * vb + 46802 * vr) >> 16)),
    b: clamp8(y + ((116130 * vb) >> 16)),
  };
}

/** 시드가 있는 난수. 실패를 되풀이할 수 있어야 한다. */
function seeded(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

function randomAxis(random, axisBits) {
  let value = 0n;
  for (let filled = 0; filled < axisBits; filled += 32) {
    value = (value << 32n) | BigInt(Math.floor(random() * 4294967296));
  }
  return value & ((1n << BigInt(axisBits)) - 1n);
}

for (const tier of [4, 8, 16, 32]) {
  test(`층 ${tier}: 값싼 색 읽기가 코덱의 해석과 같다`, () => {
    const spec = tierSpec(tier);
    const mix = localityMix(LOCALITY, spec.axisBits);
    const random = seeded(0x5eed + tier);

    for (let trial = 0; trial < 12; trial++) {
      const x = randomAxis(random, spec.axisBits);
      const y = randomAxis(random, spec.axisBits);
      const code = coordinatesToCode(x, y, mix, spec.axisBits);
      assert.deepEqual(
        baseToneOf(code),
        toneByCodec(spec, code),
        `층 ${tier} (${x},${y}) 의 색이 다르다`,
      );
    }
  });
}

test('지도의 크기가 홀수라 가운데 칸이 하나다', () => {
  assert.equal(MINIMAP_SPAN % 2, 1);
});

test('지도가 요청한 칸 수만큼 색을 준다', () => {
  const map = createMinimapColours();
  const { span, rgba, empty } = map.cells({ tier: 8, locality: LOCALITY, x: 1000n, y: 2000n });
  assert.equal(span, MINIMAP_SPAN);
  assert.equal(rgba.length, MINIMAP_SPAN * MINIMAP_SPAN * 4);
  assert.equal(empty, false);
  // 알파는 전부 채워져 있어야 한다. 빈 칸이 있으면 지도에 구멍이 보인다.
  for (let at = 3; at < rgba.length; at += 4) assert.equal(rgba[at], 255);
});

test('지도의 가운데가 지금 있는 칸이다', () => {
  const map = createMinimapColours();
  const tier = 8;
  const spec = tierSpec(tier);
  const x = 4242n;
  const y = 777n;
  const { span, rgba } = map.cells({ tier, locality: LOCALITY, x, y });

  const middle = ((span - 1) / 2) * span + (span - 1) / 2;
  const tone = baseToneOf(coordinatesToCode(x, y, localityMix(LOCALITY, spec.axisBits), spec.axisBits));
  assert.deepEqual(
    [rgba[middle * 4], rgba[middle * 4 + 1], rgba[middle * 4 + 2]],
    [tone.r, tone.g, tone.b],
  );
});

test('지도가 축 끝에서 감긴다', () => {
  // 층은 순환한다. 끝에서 잘라 내면 실제로 갈 수 있는 곳이 지도에서 사라진다.
  const map = createMinimapColours();
  const tier = 4;
  const spec = tierSpec(tier);
  const last = (1n << BigInt(spec.axisBits)) - 1n;
  const { span, rgba } = map.cells({ tier, locality: LOCALITY, x: last, y: last });

  // 가운데에서 한 칸 오른쪽은 x=0 이다.
  const half = (span - 1) / 2;
  const at = (half * span + half + 1) * 4;
  const tone = baseToneOf(coordinatesToCode(0n, last, localityMix(LOCALITY, spec.axisBits), spec.axisBits));
  assert.deepEqual([rgba[at], rgba[at + 1], rgba[at + 2]], [tone.r, tone.g, tone.b]);
});

test('한 칸 옮기면 대부분이 캐시에서 나온다', () => {
  // 이 성질이 미니맵의 값을 결정한다. 없으면 층 32에서 끌 때마다 30ms 다.
  const map = createMinimapColours();
  const spot = { tier: 32, locality: LOCALITY, x: 1n << 40n, y: 1n << 40n };
  map.cells(spot);
  const first = map.size;
  assert.equal(first, MINIMAP_SPAN * MINIMAP_SPAN);

  map.cells({ ...spot, x: spot.x + 1n });
  // 새로 들어온 것은 한 줄(33칸)뿐이어야 한다.
  assert.equal(map.size - first, MINIMAP_SPAN, `${map.size - first}칸이 새로 계산됐다`);
});

test('층을 옮기면 기억한 색을 버린다', () => {
  // 같은 좌표라도 층이 다르면 다른 그림이다. 남겨 두면 이전 층의 색이 보인다.
  const map = createMinimapColours();
  map.cells({ tier: 8, locality: LOCALITY, x: 10n, y: 10n });
  assert.ok(map.size > 0);
  map.cells({ tier: 16, locality: LOCALITY, x: 10n, y: 10n });
  assert.equal(map.size, MINIMAP_SPAN * MINIMAP_SPAN);
  map.clear();
  assert.equal(map.size, 0);
});

test('로비에는 작품이 없으므로 지도가 비어 있다', () => {
  const map = createMinimapColours();
  const { empty, rgba } = map.cells({ tier: 0, locality: LOCALITY, x: 32n, y: 32n });
  assert.equal(empty, true);
  assert.ok(rgba.every(value => value === 0));
});
