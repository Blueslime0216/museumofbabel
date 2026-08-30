import test from 'node:test';
import assert from 'node:assert/strict';
import { describe, TITLE_WORDS, TITLE_SERIES } from '../src/label.mjs';
import {
  tierSpec,
  localityMix,
  coordinatesToCode,
  randomCoordinate,
  decodeFields,
  ROOMS,
  CLUSTER_SPAN,
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
// 제목 번호는 코드워드의 고정된 자리에서 뽑는다 (형용사 64 · 명사 64 · 형식 16 · 명작 16).
// 표가 한 칸이라도 짧으면 그 자리에 걸린 좌표에서 undefined 가 새고, 길면
// 언어에 따라 다른 낱말이 나온다. 좌표를 뽑아 보는 방식으로는 32개 중 하나가
// 빈 것을 놓치기 쉬우므로 세어 본다.

test('모든 언어의 낱말 표 크기가 같다', () => {
  const SIZES = { hues: 12, neutrals: 8, adjectives: 64, nouns: 64, forms: 16, masterworks: 16 };
  for (const [group, size] of Object.entries(SIZES)) {
    for (const lang of LANGS) {
      const table = TITLE_WORDS[group][lang];
      assert.ok(table, `${group} 에 ${lang} 이 없다`);
      assert.equal(table.length, size, `${group}.${lang} 의 크기`);
    }
  }
});

test('낱말 표에 빈 칸이나 중복이 없다', () => {
  for (const group of ['hues', 'neutrals', 'adjectives', 'nouns', 'masterworks']) {
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
      // 연작 번호는 일부러 언어를 가리지 않는다. 로마 숫자는 어느 나라 도록에서나
      // 그대로 쓰므로 번역하지 않는다. 그 꼬리만 떼고 본체를 본다.
      const body = title.replace(/ (?:I|V|X)+$/, '');
      assert.ok(script.test(body), title);
      assert.ok(!/[A-Za-z]/.test(body), `라틴 문자가 남았다: ${title}`);
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

// ── 전시실 ───────────────────────────────────────────────────────────────

test('작품 정보에 전시실이 들어 있다', () => {
  const spec = tierSpec(8);
  const x = 0x51f3a2c4d1n;
  const y = 0x2b90e7f16an;
  const code = coordinatesToCode(x, y, localityMix(4, spec.axisBits), spec.axisBits);
  const info = describe({ tier: 8, x, y, code, lang: 'ko' });

  assert.ok(info.room, '전시실 정보가 없다');
  assert.equal(info.room.total, ROOMS.length);
  assert.ok(
    info.room.index >= 0 && info.room.index < ROOMS.length,
    `전시실 번호 ${info.room.index} 가 범위 밖이다`,
  );
  assert.equal(info.room.id, ROOMS[info.room.index].name);
});

test('전시실은 좌표에서 나온다 — 같은 코드워드도 자리가 다르면 다른 방이다', () => {
  // 이것이 전시실 설계의 핵심이다. 코드워드만 보고는 방을 알 수 없다.
  // 그래서 describe 가 x·y 를 받아야 한다.
  const spec = tierSpec(8);
  const code = 0x9e3779b97f4a7c15n;

  const rooms = new Set();
  for (let i = 0; i < 40; i++) {
    const x = BigInt(i) * CLUSTER_SPAN + 12345n;
    rooms.add(describe({ tier: 8, x, y: 67890n, code, lang: 'ko' }).room.index);
  }
  assert.ok(rooms.size >= 6, `같은 코드워드가 ${rooms.size}개 방에만 나타난다`);
});

test('전시실 정보가 언어와 무관하다', () => {
  // 번호와 식별자는 번역 대상이 아니다. 방 이름은 미감 확정 후에 붙인다.
  const spec = tierSpec(16);
  const x = 0x77abcdn;
  const y = 0x91def0n;
  const code = coordinatesToCode(x, y, localityMix(4, spec.axisBits), spec.axisBits);
  const ko = describe({ tier: 16, x, y, code, lang: 'ko' }).room;
  const en = describe({ tier: 16, x, y, code, lang: 'en' }).room;
  assert.deepEqual(ko, en);
});

// ── 제목의 다양성 · 명작 · 연작 ──────────────────────────────────────────
//
// 제목의 조각은 코드워드의 서로 다른 자리에서 뽑는다. 자리가 겹치면 두 조각이
// 함께 움직여서, 표를 늘려도 조합이 늘지 않는다. 크기를 세는 검사로는 그것을
// 잡을 수 없다 — 표는 멀쩡하고 뽑는 자리만 잘못됐기 때문이다. 그래서 센다.

test('제목이 충분히 다양하다', () => {
  const seen = new Set();
  const N = 3000;
  for (let i = 0; i < N; i++) {
    const [x, y] = randomCoordinate(spec.axisBits);
    seen.add(at(x, y, 'ko').info.title);
  }
  // 표만 보면 형식 16 x 형용사 64 x 명사 64 = 65,536 골격이다. 색까지 곱해지므로
  // 3,000 표본이면 겹침이 적어야 한다. 자리가 겹치면 이 값이 뚝 떨어진다.
  assert.ok(
    seen.size > N * 0.4,
    `${N} 개에서 서로 다른 제목이 ${seen.size} 개뿐이다. 뽑는 자리가 겹쳤을 수 있다`,
  );
});

test('네 조각이 서로 독립으로 움직인다', () => {
  // 같은 좌표에서 한 조각만 달라지는 코드워드를 만들 수는 없으므로, 많은 표본에서
  // 각 자리의 값이 골고루 나오는지를 본다. 한 자리가 죽으면 그 조각이 고정된다.
  const forms = new Set();
  const adjectives = new Set();
  const nouns = new Set();
  for (let i = 0; i < 4000; i++) {
    const [x, y] = randomCoordinate(spec.axisBits);
    const code = coordinatesToCode(x, y, localityMix(LOCALITY, spec.axisBits), spec.axisBits);
    const pick = (shift, size) => Number((code >> BigInt(shift)) & BigInt(size - 1));
    forms.add(pick(59, 16));
    adjectives.add(pick(31, 64));
    nouns.add(pick(43, 64));
  }
  assert.equal(forms.size, 16, `형식 자리가 ${forms.size} 가지만 낸다`);
  assert.equal(adjectives.size, 64, `형용사 자리가 ${adjectives.size} 가지만 낸다`);
  assert.equal(nouns.size, 64, `명사 자리가 ${nouns.size} 가지만 낸다`);
});

test('명작은 드물게 나오고 다섯 언어 모두 있다', () => {
  const lists = Object.fromEntries(
    LANGS.map(lang => [lang, new Set(TITLE_WORDS.masterworks[lang])]),
  );
  let found = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const [x, y] = randomCoordinate(spec.axisBits);
    if (lists.ko.has(at(x, y, 'ko').info.title)) found++;
  }
  // 설계는 1/512 다. 너무 흔하면 특별하지 않고, 너무 드물면 아무도 못 본다.
  const rate = N / Math.max(1, found);
  assert.ok(rate > 256 && rate < 1024, `명작이 1/${rate.toFixed(0)} 로 나온다 (설계 1/512)`);
});

test('명작에는 연작 번호가 붙지 않는다', () => {
  // 고유한 이름에 번호를 달면 고유하지 않다.
  const masters = new Set(TITLE_WORDS.masterworks.ko);
  for (let i = 0; i < 20000; i++) {
    const [x, y] = randomCoordinate(spec.axisBits);
    const { title } = at(x, y, 'ko').info;
    const bare = title.replace(/ (?:I|V|X)+$/, '');
    if (bare !== title) {
      assert.ok(!masters.has(bare), `명작에 연작 번호가 붙었다: ${title}`);
    }
  }
});

test('연작 번호가 이따금 붙는다', () => {
  let numbered = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) {
    const [x, y] = randomCoordinate(spec.axisBits);
    const { title } = at(x, y, 'ko').info;
    if (TITLE_SERIES.some(numeral => title.endsWith(` ${numeral}`))) numbered++;
  }
  const rate = N / Math.max(1, numbered);
  assert.ok(rate > 5 && rate < 14, `연작이 1/${rate.toFixed(1)} 로 붙는다 (설계 1/8)`);
});

test('연작 번호에 I 이 홀로 오지 않는다', () => {
  // 홀로 있는 작품에 "제1번" 을 붙이면 없는 연작을 암시한다.
  assert.ok(!TITLE_SERIES.includes('I'), TITLE_SERIES.join(' '));
  assert.equal(TITLE_SERIES.length, 8);
});
