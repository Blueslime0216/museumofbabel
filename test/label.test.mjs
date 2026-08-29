import test from 'node:test';
import assert from 'node:assert/strict';
import { describe, TITLE_WORDS } from '../src/label.mjs';
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

const LANGS = ['en', 'ko', 'ja', 'zh', 'ru'];

test('제목에 undefined 나 NaN 이 새지 않는다', () => {
  for (const lang of LANGS) {
    for (let i = 0; i < 80; i++) {
      const [x, y] = randomCoordinate(spec.axisBits);
      const { title } = at(x, y, lang).info;
      assert.ok(title.length > 1, `${lang}: ${title}`);
      assert.ok(!/undefined|NaN|null/.test(title), `${lang}: ${title}`);
    }
  }
});

// ── 낱말 표 ──────────────────────────────────────────────────────────────
//
// 제목 번호는 코드워드의 고정된 자리에서 뽑는다 (형용사 32 · 명사 32 · 형식 8).
// 표가 한 칸이라도 짧으면 그 자리에 걸린 좌표에서 undefined 가 새고, 길면
// 언어에 따라 다른 낱말이 나온다. 좌표를 뽑아 보는 방식으로는 32개 중 하나가
// 빈 것을 놓치기 쉬우므로 세어 본다.

test('모든 언어의 낱말 표 크기가 같다', () => {
  const SIZES = { hues: 12, neutrals: 8, adjectives: 32, nouns: 32, forms: 8 };
  for (const [group, size] of Object.entries(SIZES)) {
    for (const lang of LANGS) {
      const table = TITLE_WORDS[group][lang];
      assert.ok(table, `${group} 에 ${lang} 이 없다`);
      assert.equal(table.length, size, `${group}.${lang} 의 크기`);
    }
  }
});

test('낱말 표에 빈 칸이나 중복이 없다', () => {
  for (const group of ['hues', 'neutrals', 'adjectives', 'nouns']) {
    for (const lang of LANGS) {
      const table = TITLE_WORDS[group][lang];
      for (const word of table) {
        assert.equal(typeof word, 'string', `${group}.${lang}`);
        assert.ok(word.trim().length > 0, `${group}.${lang} 에 빈 낱말이 있다`);
      }
      assert.equal(
        new Set(table).size,
        table.length,
        `${group}.${lang} 에 같은 낱말이 두 번 있다: ${table.join(' · ')}`,
      );
    }
  }
});

test('러시아어 명사가 모두 남성이다', () => {
  // 형용사를 남성 하나로만 적었으므로 명사도 남성이어야 한다. 여성·중성은
  // -а · -я · -о · -е 로 끝나므로 그것만 막아도 대부분 잡힌다. 연음부호(-ь)로
  // 끝나는 것은 성이 갈리므로 손으로 골랐다 (вестибюль · флигель 둘 다 남성).
  for (const word of TITLE_WORDS.nouns.ru) {
    assert.ok(!/[аяоеиы]$/i.test(word), `남성이 아닐 수 있다: ${word}`);
  }
});

// 언어마다 제목이 자기 글자로 나오는지 본다. 사전은 번역됐는데 낱말 표에
// 그 언어를 넣지 않으면 화면만 번역되고 제목은 영어로 남는다.
const SCRIPTS = {
  ko: /[가-힣]/,
  ja: /[\u3040-\u30ff\u3400-\u9fff]/,
  zh: /[\u3400-\u9fff]/,
  ru: /[\u0400-\u04ff]/,
};

for (const [lang, script] of Object.entries(SCRIPTS)) {
  test(`${lang} 제목이 자기 글자로 나온다`, () => {
    for (let i = 0; i < 60; i++) {
      const [x, y] = randomCoordinate(spec.axisBits);
      const { title } = at(x, y, lang).info;
      assert.ok(script.test(title), title);
      assert.ok(!/[A-Za-z]/.test(title), `라틴 문자가 남았다: ${title}`);
    }
  });
}

test('러시아어 제목은 첫 글자만 대문자다', () => {
  // 러시아어는 제목에서 첫 낱말만 대문자로 쓴다. 영어처럼 낱말마다 올려 쓰면
  // 어색하다. 낱말 표에는 대문자로 저장하고 제목 안에서 내려 쓴다.
  for (let i = 0; i < 120; i++) {
    const [x, y] = randomCoordinate(spec.axisBits);
    const { title } = at(x, y, 'ru').info;
    const rest = title.slice(1);
    assert.ok(!/[А-ЯЁ]/.test(rest), `가운데에 대문자가 있다: ${title}`);
    assert.match(title, /^[А-ЯЁ]/, `첫 글자가 대문자가 아니다: ${title}`);
  }
});

test('중국어 제목에 가나가 섞이지 않는다', () => {
  for (let i = 0; i < 60; i++) {
    const [x, y] = randomCoordinate(spec.axisBits);
    const { title } = at(x, y, 'zh').info;
    assert.ok(!/[\u3040-\u30ff]/.test(title), title);
  }
});

test('다섯 언어가 같은 자리에서 서로 다른 제목을 만든다', () => {
  // 형식 번호와 색 계열은 좌표만으로 정해진다. 소장품 번호와 수치는 언어와
  // 무관해야 하고, 제목은 다섯 개가 모두 달라야 한다.
  for (let i = 0; i < 20; i++) {
    const [x, y] = randomCoordinate(spec.axisBits);
    const infos = LANGS.map(lang => at(x, y, lang).info);
    const titles = new Set(infos.map(info => info.title));
    assert.equal(titles.size, LANGS.length, [...titles].join(' / '));
    for (const info of infos) {
      assert.equal(info.accession, infos[0].accession);
      assert.equal(info.quant, infos[0].quant);
      assert.equal(info.zones, infos[0].zones);
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
