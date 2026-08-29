import test from 'node:test';
import assert from 'node:assert/strict';
import { describe } from '../src/label.mjs';
import {
  tierSpec,
  localityMix,
  coordinatesToCode,
  randomCoordinate,
  decodeFields,
} from '../src/codec.mjs';

const TIER = 8;
const LOCALITY = 4;
const spec = tierSpec(TIER);
const mix = localityMix(LOCALITY, spec.axisBits);

function at(x, y) {
  const code = coordinatesToCode(x, y, mix, spec.axisBits);
  return { info: describe({ tier: TIER, x, y, code }), code };
}

test('같은 좌표는 언제나 같은 제목이다', () => {
  const [x, y] = randomCoordinate(spec.axisBits);
  const first = at(x, y).info;
  const second = at(x, y).info;
  assert.deepEqual(first, second);
});

test('다른 좌표는 대체로 다른 제목이다', () => {
  const titles = new Set();
  for (let i = 0; i < 60; i++) {
    const [x, y] = randomCoordinate(spec.axisBits);
    titles.add(at(x, y).info.title);
  }
  // 조합이 수천 가지이므로 60개에서 대부분 달라야 한다.
  assert.ok(titles.size > 40, `제목이 너무 겹친다: ${titles.size}/60`);
});

test('소장품 번호에 층이 들어가고 국소성은 안 들어간다', () => {
  const [x, y] = randomCoordinate(spec.axisBits);
  const { accession } = at(x, y).info;
  assert.match(accession, /^8-[0-9a-z]{6}$/);
});

test('주소 길이는 층 명세에서 온다', () => {
  const [x, y] = randomCoordinate(spec.axisBits);
  const info = at(x, y).info;
  assert.equal(info.bytes, spec.byteLength);
  assert.equal(info.bits, spec.totalBits);
  assert.equal(info.zones, spec.blockCount);
});

test('양자화 단계가 실제 필드와 같다', () => {
  for (let i = 0; i < 20; i++) {
    const [x, y] = randomCoordinate(spec.axisBits);
    const { info, code } = at(x, y);
    assert.equal(info.quant, decodeFields(spec, code).header.quant);
  }
});

test('색 이름이 목록 안에 있다', () => {
  const known = new Set([
    'Indigo', 'Violet', 'Mauve', 'Carmine', 'Crimson', 'Rust', 'Amber', 'Ochre',
    'Olive', 'Verdigris', 'Celadon', 'Teal',
    'Soot', 'Char', 'Slate', 'Pewter', 'Ash', 'Bone', 'Ivory', 'Chalk',
  ]);
  for (let i = 0; i < 40; i++) {
    const [x, y] = randomCoordinate(spec.axisBits);
    const { palette } = at(x, y).info;
    assert.ok(known.has(palette.primary), palette.primary);
    assert.ok(known.has(palette.secondary), palette.secondary);
  }
});

test('제목에 undefined 나 NaN 이 새지 않는다', () => {
  for (let i = 0; i < 80; i++) {
    const [x, y] = randomCoordinate(spec.axisBits);
    const { title } = at(x, y).info;
    assert.ok(title.length > 3);
    assert.ok(!/undefined|NaN/.test(title), title);
  }
});
