// 팜플렛 검사
//
// 팜플렛의 점은 "층 전체에서 내가 어디쯤인가" 를 말한다. 층 32의 좌표는
// 1,600비트가 넘으므로 Number 로 바꾸면 Infinity 이거나 정밀도를 잃는다. 그러면
// 점이 늘 왼쪽 위(0,0)나 오른쪽 아래에 붙는데, 화면으로는 "그런 자리에 있구나"
// 로 보여서 알아챌 수 없다. 그래서 비율 계산만 따로 검사한다.

import test from 'node:test';
import assert from 'node:assert/strict';

import { axisFraction, spotFromFraction } from '../src/ui/pamphlet.mjs';
import { floorThumbnail } from '../src/minimap.mjs';
import { tierSpec, LOBBY_AXIS_BITS } from '../src/codec.mjs';

test('축의 처음과 끝이 0과 1에 붙는다', () => {
  for (const tier of [4, 8, 16, 32]) {
    const bits = tierSpec(tier).axisBits;
    const last = (1n << BigInt(bits)) - 1n;
    assert.equal(axisFraction(0n, bits), 0, `층 ${tier} 의 처음`);
    const end = axisFraction(last, bits);
    assert.ok(end > 0.99 && end < 1, `층 ${tier} 의 끝이 ${end}`);
  }
});

test('가운데가 절반이다', () => {
  for (const tier of [4, 8, 16, 32]) {
    const bits = tierSpec(tier).axisBits;
    const middle = 1n << BigInt(bits - 1);
    assert.equal(axisFraction(middle, bits), 0.5, `층 ${tier}`);
  }
});

test('깊은 층에서도 값이 유한하고 0..1 안에 있다', () => {
  // 1,600비트 좌표를 Number 로 바꾸면 Infinity 다. 그 실수를 막는 검사다.
  const bits = tierSpec(32).axisBits;
  assert.ok(bits > 64, `층 32 의 축이 ${bits}비트뿐이다 — 이 검사의 전제가 틀렸다`);
  for (const shift of [1, 7, 63, 100, bits - 1]) {
    const value = 1n << BigInt(shift);
    const fraction = axisFraction(value, bits);
    assert.ok(Number.isFinite(fraction), `2^${shift} 에서 유한하지 않다`);
    assert.ok(fraction >= 0 && fraction < 1, `2^${shift} 에서 ${fraction}`);
  }
});

test('좌표가 커지면 비율도 커진다', () => {
  // 단조성이 깨지면 지도에서 왼쪽에 있는 것이 오른쪽에 찍힌다.
  const bits = tierSpec(16).axisBits;
  let previous = -1;
  for (let step = 0; step <= 8; step++) {
    const value = (BigInt(step) << BigInt(bits - 3)) & ((1n << BigInt(bits)) - 1n);
    const fraction = axisFraction(value, bits);
    if (step < 8) assert.ok(fraction > previous, `${step}단계에서 줄었다`);
    previous = fraction;
  }
});

test('로비의 좁은 축도 다룬다', () => {
  // 로비는 6비트다. 상위 비트만 보는 길로 가면 0이 되어 버린다.
  assert.equal(axisFraction(0n, LOBBY_AXIS_BITS), 0);
  assert.equal(axisFraction(32n, LOBBY_AXIS_BITS), 0.5);
  assert.ok(axisFraction(63n, LOBBY_AXIS_BITS) > 0.98);
});

// ── 웨이포인트 ───────────────────────────────────────────────────────────

test('누른 자리가 축 안에 떨어진다', () => {
  for (const tier of [4, 8, 16, 32]) {
    const bits = tierSpec(tier).axisBits;
    const axis = 1n << BigInt(bits);
    for (const fraction of [0, 0.25, 0.5, 0.999, 1]) {
      const spot = spotFromFraction(fraction, bits, 208);
      assert.ok(spot >= 0n && spot < axis, `층 ${tier} 의 ${fraction} 에서 ${spot}`);
    }
  }
});

test('누른 자리가 그 점의 가운데다', () => {
  // 구간의 시작으로 가면 왼쪽 위를 누를 때마다 좌표 0에 떨어지고, 그 자리는
  // 층마다 같은 그림이라 "지도를 눌러도 같은 데로 간다" 로 읽힌다.
  const bits = tierSpec(8).axisBits;
  const axis = 1n << BigInt(bits);
  const pixels = 200;
  const band = axis / BigInt(pixels);
  assert.equal(spotFromFraction(0, bits, pixels), band / 2n);
  assert.equal(spotFromFraction(0.5, bits, pixels), band * 100n + band / 2n);
});

test('누른 자리를 다시 비율로 바꾸면 누른 곳으로 돌아온다', () => {
  // 이 왕복이 어긋나면 표시가 선 자리와 도착한 자리가 다르다.
  const pixels = 208;
  for (const tier of [4, 8, 16, 32]) {
    const bits = tierSpec(tier).axisBits;
    for (const fraction of [0.1, 0.42, 0.77, 0.95]) {
      const back = axisFraction(spotFromFraction(fraction, bits, pixels), bits);
      assert.ok(
        Math.abs(back - fraction) < 1.5 / pixels,
        `층 ${tier}: ${fraction} → ${back}`,
      );
    }
  }
});

test('한 점 안에서는 어디를 눌러도 같은 자리로 간다', () => {
  // 한 점이 덮는 칸이 상상할 수 없이 많으므로, 같은 점 안의 두 곳은 구분되지
  // 않아야 한다. 구분되면 표시는 같은 자리에 서는데 도착지가 달라진다.
  const bits = tierSpec(32).axisBits;
  const pixels = 200;
  const a = spotFromFraction(0.5, bits, pixels);
  const b = spotFromFraction(0.5 + 0.4 / pixels, bits, pixels);
  assert.equal(a, b);
});

test('로비의 좁은 축에서도 자리를 고른다', () => {
  // 로비는 6비트(64칸)뿐이라 평면도의 픽셀이 칸보다 많다. 그래도 축 안이어야 한다.
  for (const fraction of [0, 0.3, 0.5, 1]) {
    const spot = spotFromFraction(fraction, LOBBY_AXIS_BITS, 208);
    assert.ok(spot >= 0n && spot < 64n, `${fraction} → ${spot}`);
  }
});

// ── 층 축소도 ────────────────────────────────────────────────────────────

test('축소도가 층 전체를 담는다', () => {
  const { samples, rgba, empty } = floorThumbnail({ tier: 8, locality: 4 });
  assert.equal(empty, false);
  assert.equal(rgba.length, samples * samples * 4);
  // 한 색으로 채워지면 표본이 한 자리만 보고 있는 것이다.
  const seen = new Set();
  for (let at = 0; at < rgba.length; at += 4) {
    seen.add(`${rgba[at]},${rgba[at + 1]},${rgba[at + 2]}`);
  }
  assert.ok(seen.size > 8, `${seen.size}가지 색뿐이다`);
});

test('축소도는 층마다 다르다', () => {
  const a = floorThumbnail({ tier: 8, locality: 4 }).rgba.join(',');
  const b = floorThumbnail({ tier: 16, locality: 4 }).rgba.join(',');
  assert.notEqual(a, b);
});

test('로비에는 축소도가 없다', () => {
  const { empty } = floorThumbnail({ tier: 0, locality: 4 });
  assert.equal(empty, true);
});
