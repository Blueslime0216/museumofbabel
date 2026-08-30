// 로비 배치 — 결정론과 겹침 없음
//
// 로비는 격자가 아니라 자유 배치다. 그래서 "칸이 하나씩 채워진다" 는 보장이 없고,
// 두 물건이 같은 자리에 놓일 수 있다. 눈으로 보면 한 장이 다른 장을 덮은 것뿐이라
// 알아채기 어렵다. 그래서 센다.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  lobbyObjects,
  daySeed,
  LOBBY_SPAN,
  LOGO_SIZE,
  MIN_GAP,
  TODAY_COUNT,
} from '../src/lobby.mjs';
import { axisBitsFor } from '../src/codec.mjs';

const DAY = new Date(2026, 7, 31); // 2026-08-31. 지역 시간으로 고정한다
const CENTRE = Number(LOBBY_SPAN / 2n);

/** 정사각형 두 개가 떨어져 있는가. lobby.mjs 의 규칙과 같아야 한다. */
function apart(a, b) {
  const need = (a.size + b.size) / 2 + MIN_GAP;
  return Math.abs(a.x - b.x) >= need || Math.abs(a.y - b.y) >= need;
}

test('같은 날짜는 같은 로비를 만든다', () => {
  const a = lobbyObjects({ date: DAY });
  const b = lobbyObjects({ date: new Date(2026, 7, 31) });
  assert.deepEqual(
    a.map(object => [object.id, object.x, object.y]),
    b.map(object => [object.id, object.x, object.y]),
  );
});

test('다른 날짜는 다른 배치를 만든다', () => {
  const today = lobbyObjects({ date: DAY });
  const tomorrow = lobbyObjects({ date: new Date(2026, 8, 1) });
  const same =
    JSON.stringify(today.map(o => [o.x, o.y])) ===
    JSON.stringify(tomorrow.map(o => [o.x, o.y]));
  assert.ok(!same, '날짜가 바뀌었는데 배치가 같다');
});

test('날짜 시드가 지역 날짜를 쓴다', () => {
  assert.equal(daySeed(new Date(2026, 7, 31)), 20260831);
  assert.equal(daySeed(new Date(2026, 0, 1)), 20260101);
});

test('물건이 서로 겹치지 않는다', () => {
  // 여러 날을 돌린다. 하루만 보면 우연히 통과할 수 있다.
  for (let day = 1; day <= 28; day++) {
    const objects = lobbyObjects({ date: new Date(2026, 7, day) });
    for (let i = 0; i < objects.length; i++) {
      for (let j = i + 1; j < objects.length; j++) {
        assert.ok(
          apart(objects[i], objects[j]),
          `8월 ${day}일: ${objects[i].id} 와 ${objects[j].id} 가 겹친다 ` +
            `(${objects[i].x.toFixed(1)}, ${objects[i].y.toFixed(1)}) / ` +
            `(${objects[j].x.toFixed(1)}, ${objects[j].y.toFixed(1)})`,
        );
      }
    }
  }
});

test('표지가 가운데에 있고 가장 크다', () => {
  const objects = lobbyObjects({ date: DAY });
  const logo = objects.find(object => object.id === 'logo');
  assert.equal(logo.x, CENTRE);
  assert.equal(logo.y, CENTRE);
  assert.equal(logo.size, LOGO_SIZE);
  for (const object of objects) {
    if (object.id !== 'logo') assert.ok(object.size < LOGO_SIZE, object.id);
  }
});

test('체험관 문의 자리는 날마다 바뀌지 않는다', () => {
  const first = lobbyObjects({ date: DAY }).find(object => object.id === 'workshop');
  const later = lobbyObjects({ date: new Date(2026, 9, 15) }).find(
    object => object.id === 'workshop',
  );
  assert.deepEqual([first.x, first.y], [later.x, later.y]);
  assert.equal(first.action, 'workshop');
});

test('오늘의 그림이 열 장이다', () => {
  const objects = lobbyObjects({ date: DAY });
  const today = objects.filter(object => object.id.startsWith('today-'));
  assert.equal(today.length, TODAY_COUNT);
});

test('오늘의 그림이 여러 층에서 온다', () => {
  // 한 층으로만 채우면 열 장이 다 비슷해 보인다.
  const tiers = new Set();
  for (let day = 1; day <= 20; day++) {
    for (const object of lobbyObjects({ date: new Date(2026, 7, day) })) {
      if (object.id.startsWith('today-')) tiers.add(object.address.tier);
    }
  }
  assert.ok(tiers.size >= 3, `층이 ${[...tiers].join(', ')} 뿐이다`);
});

test('모든 주소가 그 층의 축 안에 있다', () => {
  // 축을 넘으면 그림을 그릴 수 없다. 좌표를 32비트씩 이어 붙여 만들므로
  // 마스크를 잊으면 넘친다.
  for (let day = 1; day <= 28; day++) {
    for (const object of lobbyObjects({ date: new Date(2026, 7, day) })) {
      if (object.kind !== 'art') continue;
      const { tier, x, y } = object.address;
      const limit = 1n << BigInt(axisBitsFor(tier));
      assert.ok(x >= 0n && x < limit, `${object.id} 의 x 가 축을 넘는다`);
      assert.ok(y >= 0n && y < limit, `${object.id} 의 y 가 축을 넘는다`);
    }
  }
});

test('물건이 로비 경계를 넘지 않는다', () => {
  // 고리의 바깥 반경이 로비 절반보다 작아야 순환 경계를 신경 쓰지 않아도 된다.
  for (let day = 1; day <= 28; day++) {
    for (const object of lobbyObjects({ date: new Date(2026, 7, day) })) {
      const half = object.size / 2;
      assert.ok(
        object.x - half >= 0 && object.x + half <= Number(LOBBY_SPAN),
        `${object.id} 가 x 경계를 넘는다: ${object.x}`,
      );
      assert.ok(
        object.y - half >= 0 && object.y + half <= Number(LOBBY_SPAN),
        `${object.id} 가 y 경계를 넘는다: ${object.y}`,
      );
    }
  }
});

test('자리를 적은 후원자는 그 자리에 걸린다', () => {
  const patrons = [
    { name: 'A', address: { tier: 8, locality: 4, x: 5n, y: 7n }, at: { x: 20, y: 44 } },
  ];
  const objects = lobbyObjects({ date: DAY, patrons });
  const hung = objects.find(object => object.name === 'A');
  assert.equal(hung.x, 20);
  assert.equal(hung.y, 44);
  assert.equal(hung.action, 'artwork');
});

test('자리를 적지 않은 후원자도 걸리고 겹치지 않는다', () => {
  const patrons = Array.from({ length: 5 }, (_, index) => ({
    name: `P${index}`,
    address: { tier: 8, locality: 4, x: BigInt(index + 1), y: BigInt(index + 2) },
  }));
  const objects = lobbyObjects({ date: DAY, patrons });
  const hung = objects.filter(object => object.name?.startsWith('P'));
  assert.equal(hung.length, 5);
  for (let i = 0; i < objects.length; i++) {
    for (let j = i + 1; j < objects.length; j++) {
      assert.ok(apart(objects[i], objects[j]), `${objects[i].id} / ${objects[j].id}`);
    }
  }
});

test('후원자가 오늘의 그림보다 먼저 자리를 잡는다', () => {
  // 날마다 바뀌는 것이 사람의 자리를 밀어내면 안 된다.
  const patrons = [{ name: 'A', address: { tier: 8, locality: 4, x: 1n, y: 2n } }];
  const objects = lobbyObjects({ date: DAY, patrons });
  const patronAt = objects.findIndex(object => object.name === 'A');
  const firstToday = objects.findIndex(object => object.id.startsWith('today-'));
  assert.ok(patronAt < firstToday, `후원자 ${patronAt} · 오늘의 그림 ${firstToday}`);
});
