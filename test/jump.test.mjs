// 여덟 방향 건너뛰기 검사
//
// 좌표 셈이 틀려도 화면은 그럴듯하다 — 어딘가 다른 그림이 나오기 때문이다.
// 그래서 방향과 거리를 숫자로 붙든다.

import test from 'node:test';
import assert from 'node:assert/strict';

import { JUMP_DIRECTIONS, JUMP_STEPS, jumpTarget } from '../src/jump.mjs';
import { tierSpec, axisBitsFor, LOBBY_AXIS_BITS } from '../src/codec.mjs';

test('여덟 방향이 모두 다르고 여덟 개다', () => {
  assert.equal(JUMP_DIRECTIONS.length, 8);
  const seen = new Set(JUMP_DIRECTIONS.map(d => `${d.dx},${d.dy}`));
  assert.equal(seen.size, 8);
  // 가운데(0,0)는 방향이 아니다.
  assert.ok(!seen.has('0,0'));
  // 모든 성분이 -1 · 0 · 1 이다. 그래야 두 축의 걸음이 같다.
  for (const d of JUMP_DIRECTIONS) {
    assert.ok([-1, 0, 1].includes(d.dx) && [-1, 0, 1].includes(d.dy), `${d.id}`);
  }
});

test('여덟 방향이 위에서 시계 방향으로 돈다', () => {
  // 나오는 시차를 이 순서로 주므로, 순서가 어긋나면 단추가 뒤죽박죽 나온다.
  const angles = JUMP_DIRECTIONS.map(d => Math.atan2(d.dy, d.dx));
  // 위(-90도)에서 시작해 시계 방향으로 45도씩.
  const expected = [-90, -45, 0, 45, 90, 135, 180, -135].map(deg => (deg * Math.PI) / 180);
  for (let at = 0; at < 8; at++) {
    assert.ok(
      Math.abs(Math.cos(angles[at]) - Math.cos(expected[at])) < 1e-9 &&
        Math.abs(Math.sin(angles[at]) - Math.sin(expected[at])) < 1e-9,
      `${JUMP_DIRECTIONS[at].id} 가 ${(angles[at] * 180) / Math.PI}도다`,
    );
  }
});

test('한 번에 1,000걸음이다', () => {
  assert.equal(JUMP_STEPS, 1000n);
});

test('두 축의 걸음이 정확히 1,000이다', () => {
  // 대각선을 707걸음으로 줄이지 않기로 정했다. 사람이 기억하는 것은 "오른쪽으로
  // 1,000, 아래로 1,000" 이고, 그것이 좌표의 셈에 가깝다.
  const bits = tierSpec(8).axisBits;
  const from = { x: 1n << 100n, y: 1n << 90n };
  for (const direction of JUMP_DIRECTIONS) {
    const to = jumpTarget(from, direction, bits);
    assert.equal(to.x - from.x, BigInt(direction.dx) * JUMP_STEPS, `${direction.id} 의 x`);
    assert.equal(to.y - from.y, BigInt(direction.dy) * JUMP_STEPS, `${direction.id} 의 y`);
  }
});

test('축 끝에서 감긴다', () => {
  // 감기지 않으면 음수 좌표가 만들어지고 주소가 깨진다. 층은 순환하므로 감기는
  // 것이 맞다 — 왼쪽 끝에서 왼쪽으로 걸으면 오른쪽 끝에서 나온다.
  const bits = LOBBY_AXIS_BITS; // 6비트(64칸). 손으로 셈할 수 있는 크기
  const axis = 1n << BigInt(bits);
  const left = JUMP_DIRECTIONS.find(d => d.id === 'left');
  const to = jumpTarget({ x: 0n, y: 0n }, left, bits, 1000n);
  assert.ok(to.x >= 0n && to.x < axis, `${to.x}`);
  // 1,000 = 64 × 15 + 40 이므로 0에서 왼쪽으로 1,000걸음이면 24다.
  assert.equal(to.x, (0n - 1000n) & (axis - 1n));
  assert.equal(to.x, 24n);
});

test('모든 작품 층에서 축 안에 남는다', () => {
  for (const tier of [4, 8, 16, 32]) {
    const bits = axisBitsFor(tier);
    const axis = 1n << BigInt(bits);
    const from = { x: 0n, y: axis - 1n };
    for (const direction of JUMP_DIRECTIONS) {
      const to = jumpTarget(from, direction, bits);
      assert.ok(to.x >= 0n && to.x < axis, `층 ${tier} ${direction.id} 의 x`);
      assert.ok(to.y >= 0n && to.y < axis, `층 ${tier} ${direction.id} 의 y`);
    }
  }
});

test('반대 방향으로 두 번 가면 제자리다', () => {
  // 되돌아올 수 있어야 한다. 오차가 남으면 "저쪽으로 갔다 돌아온" 사람이 다른
  // 그림 앞에 선다.
  const bits = tierSpec(16).axisBits;
  const from = { x: 12345678901234567890n, y: 98765432109876543210n };
  for (const direction of JUMP_DIRECTIONS) {
    const opposite = JUMP_DIRECTIONS.find(d => d.dx === -direction.dx && d.dy === -direction.dy);
    assert.ok(opposite, `${direction.id} 의 반대가 없다`);
    const there = jumpTarget(from, direction, bits);
    const back = jumpTarget(there, opposite, bits);
    assert.equal(back.x, from.x, `${direction.id} 의 x`);
    assert.equal(back.y, from.y, `${direction.id} 의 y`);
  }
});
