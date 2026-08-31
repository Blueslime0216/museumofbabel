// 팜플렛 검사
//
// 팜플렛의 점은 "층 전체에서 내가 어디쯤인가" 를 말한다. 층 32의 좌표는
// 1,600비트가 넘으므로 Number 로 바꾸면 Infinity 이거나 정밀도를 잃는다. 그러면
// 점이 늘 왼쪽 위(0,0)나 오른쪽 아래에 붙는데, 화면으로는 "그런 자리에 있구나"
// 로 보여서 알아챌 수 없다. 그래서 비율 계산만 따로 검사한다.

import test from 'node:test';
import assert from 'node:assert/strict';

import { axisFraction } from '../src/ui/pamphlet.mjs';
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
