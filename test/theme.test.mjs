import test from 'node:test';
import assert from 'node:assert/strict';
import { measure, inkFor } from '../src/theme.mjs';

/** 한 색으로 채운 그림. */
function flat(r, g, b, size = 16) {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = 255;
  }
  return rgba;
}

/** 검정과 흰색을 번갈아 놓은 그림. */
function checker(size = 16) {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const on = (i + Math.floor(i / size)) % 2 === 0 ? 255 : 0;
    rgba[i * 4] = on;
    rgba[i * 4 + 1] = on;
    rgba[i * 4 + 2] = on;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

test('밝은 배경에는 검정 글자를 고른다', () => {
  const { relative } = measure(flat(250, 250, 120));
  assert.equal(inkFor(relative), '#000000');
});

test('어두운 배경에는 흰 글자를 고른다', () => {
  const { relative } = measure(flat(20, 10, 60));
  assert.equal(inkFor(relative), '#ffffff');
});

test('노란 배경에 흰 글자를 얹지 않는다', () => {
  // 이 사고를 막는 것이 자동 판정의 이유다.
  const { relative } = measure(flat(255, 255, 0));
  assert.equal(inkFor(relative), '#000000');
});

test('균일한 그림은 흩어짐이 0 이다', () => {
  assert.equal(measure(flat(120, 80, 200)).spread, 0);
});

test('무늬가 있는 그림은 흩어짐이 크다', () => {
  const { spread } = measure(checker());
  assert.ok(spread > 100, `흩어짐이 너무 작다: ${spread}`);
});

test('흩어짐으로 단색 같은 좌표를 걸러낼 수 있다', () => {
  // theme.mjs 의 MIN_SPREAD 가 26 이다. 이 경계가 뜻을 갖는지 확인한다.
  assert.ok(measure(flat(90, 90, 90)).spread < 26);
  assert.ok(measure(checker()).spread >= 26);
});
