// 전시실 이름 — 코덱의 방 목록과 사전이 어긋나지 않는지 본다
//
// 이름은 코덱이 아니라 UI 의 것이다. `rooms.mjs` 는 코드명(`FLAT_CYAN`)만 알고,
// 사람이 읽는 이름은 사전의 `room.<코드명>` 이 낸다. 그래서 둘이 어긋날 수 있다.
//
// 어긋나면 화면에 `room.FLAT_CYAN` 같은 키가 그대로 나온다. 조용한 실패이고,
// 방을 하나 더 넣거나 이름을 바꿀 때 가장 잘 잊는 자리다. 그래서 검사로 묶는다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { ROOMS } from '../src/codec.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = join(here, '..', 'src', 'i18n');
const files = readdirSync(dir).filter(name => name.endsWith('.mjs') && name !== 'index.mjs');

const tables = {};
for (const name of files) {
  tables[name.replace('.mjs', '')] = (
    await import(new URL(`../src/i18n/${name}`, import.meta.url))
  ).default;
}

const keyOf = room => `room.${room.name}`;

test('모든 전시실에 다섯 언어의 이름이 있다', () => {
  for (const [code, table] of Object.entries(tables)) {
    const missing = ROOMS.filter(room => !(keyOf(room) in table)).map(room => room.name);
    assert.deepEqual(missing, [], `${code} 에 이름이 없는 전시실`);
  }
});

test('사전에 없는 전시실의 이름이 남아 있지 않다', () => {
  // 방을 지웠는데 이름만 남으면 사전이 조용히 부풀고, 무엇이 살아 있는지 흐려진다.
  const live = new Set(ROOMS.map(keyOf));
  for (const [code, table] of Object.entries(tables)) {
    const orphans = Object.keys(table).filter(key => key.startsWith('room.') && !live.has(key));
    assert.deepEqual(orphans, [], `${code} 에 남은 옛 전시실 이름`);
  }
});

test('한 언어 안에서 이름이 겹치지 않는다', () => {
  // 두 방이 같은 이름이면 "그 방으로 가자" 가 성립하지 않는다.
  for (const [code, table] of Object.entries(tables)) {
    const seen = new Map();
    for (const room of ROOMS) {
      const name = table[keyOf(room)];
      assert.ok(!seen.has(name), `${code}: ${seen.get(name)} 와 ${room.name} 의 이름이 같다 (${name})`);
      seen.set(name, room.name);
    }
  }
});

test('이름이 번호로만 되어 있지 않다', () => {
  // 번호는 기억에 남지 않는다. 이름을 붙인 이유가 그것이다.
  for (const [code, table] of Object.entries(tables)) {
    for (const room of ROOMS) {
      const name = table[keyOf(room)];
      assert.ok(
        !/^[\d\s./-]+$/.test(name),
        `${code}.${keyOf(room)} 가 숫자뿐이다: ${name}`,
      );
    }
  }
});

test('이름이 한 줄에 들어갈 만큼 짧다', () => {
  // 시트의 표와 찾기 모달에 들어간다. 길면 줄이 넘치거나 잘린다.
  // CJK 는 한 글자가 넓으므로 따로 센다.
  const LIMIT = { en: 24, ru: 26, ko: 12, ja: 12, zh: 10 };
  for (const [code, table] of Object.entries(tables)) {
    for (const room of ROOMS) {
      const name = table[keyOf(room)];
      assert.ok(
        name.length <= LIMIT[code],
        `${code}.${keyOf(room)} 가 ${name.length}자다 (상한 ${LIMIT[code]}): ${name}`,
      );
    }
  }
});

test('일본어와 중국어 이름이 서로 베끼지 않았다', () => {
  // 한자만 쓰면 두 사전이 같아지기 쉽다. 그러면 한쪽을 번역하지 않은 것과 같다.
  const same = ROOMS.filter(
    room => tables.ja[keyOf(room)] === tables.zh[keyOf(room)],
  ).map(room => room.name);
  assert.deepEqual(same, [], '일본어와 중국어 이름이 같은 전시실');
});
