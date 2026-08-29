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

function at(x, y, lang = 'en') {
  const code = coordinatesToCode(x, y, mix, spec.axisBits);
  return { info: describe({ tier: TIER, x, y, code, lang }), code };
}

test('같은 좌표는 언제나 같은 제목이다', () => {
  const [x, y] = randomCoordinate(spec.axisBits);
  assert.deepEqual(at(x, y).info, at(x, y).info);
});

test('다른 좌표는 대체로 다른 제목이다', () => {
  const titles = new Set();
  for (let i = 0; i < 60; i++) {
    const [x, y] = randomCoordinate(spec.axisBits);
    titles.add(at(x, y).info.title);
  }
  assert.ok(titles.size > 40, `제목이 너무 겹친다: ${titles.size}/60`);
});

test('소장품 번호에 층이 들어가고 국소성은 안 들어간다', () => {
  const [x, y] = randomCoordinate(spec.axisBits);
  assert.match(at(x, y).info.accession, /^8-[0-9a-z]{6}$/);
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

test('영어 색 이름이 목록 안에 있다', () => {
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
  for (const lang of ['en', 'ko']) {
    for (let i = 0; i < 80; i++) {
      const [x, y] = randomCoordinate(spec.axisBits);
      const { title } = at(x, y, lang).info;
      assert.ok(title.length > 1, `${lang}: ${title}`);
      assert.ok(!/undefined|NaN|null/.test(title), `${lang}: ${title}`);
    }
  }
});

// ── 한국어판 ─────────────────────────────────────────────────────────────

test('한국어 제목은 한글로 나온다', () => {
  for (let i = 0; i < 40; i++) {
    const [x, y] = randomCoordinate(spec.axisBits);
    const { title } = at(x, y, 'ko').info;
    assert.ok(/[가-힣]/.test(title), title);
  }
});

test('한국어 제목이 연결 조사를 쓰지 않는다', () => {
  // "{A}과 {B}" 처럼 쓰면 받침에 따라 과/와가 갈려서 단어를 넣는 순간 문법이
  // 깨진다. 그래서 가운뎃점과 쉼표로만 잇는다.
  //
  // 은/는/이/가 까지 막지는 않는다. "말없는" · "품은" 처럼 형용사의 정상적인
  // 어미이기 때문이다. 위험한 것은 두 낱말을 잇는 과/와뿐이다.
  for (let i = 0; i < 200; i++) {
    const [x, y] = randomCoordinate(spec.axisBits);
    const { title } = at(x, y, 'ko').info;
    assert.ok(!/(과|와)\s/.test(title), `연결 조사가 보인다: ${title}`);
  }
});

test('한국어 단어에 과 · 와로 끝나는 것이 없다', () => {
  // 위 검사가 뜻을 갖는 전제다. 사전에 그런 낱말을 넣으면 조용히 무너진다.
  const words = [];
  for (let i = 0; i < 200; i++) {
    const [x, y] = randomCoordinate(spec.axisBits);
    const info = at(x, y, 'ko').info;
    words.push(info.palette.primary, info.palette.secondary);
  }
  for (const word of new Set(words)) {
    assert.ok(!/[과와]$/.test(word), `색 이름이 조사처럼 끝난다: ${word}`);
  }
});

test('같은 좌표의 두 언어 제목이 같은 자리에서 나온다', () => {
  // 형식 번호와 색 계열이 같아야 한다. 색 이름만 언어가 다르다.
  const [x, y] = randomCoordinate(spec.axisBits);
  const en = at(x, y, 'en').info;
  const ko = at(x, y, 'ko').info;
  assert.notEqual(en.title, ko.title);
  assert.equal(en.accession, ko.accession);
  assert.equal(en.quant, ko.quant);
});

test('없는 언어는 영어로 떨어진다', () => {
  const [x, y] = randomCoordinate(spec.axisBits);
  assert.equal(at(x, y, 'zz').info.title, at(x, y, 'en').info.title);
});
