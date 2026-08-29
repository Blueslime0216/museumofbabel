import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = join(here, '..', 'src', 'i18n');

/** 사전 파일을 스스로 찾는다. 언어를 늘리면 검사가 자동으로 따라온다. */
const files = readdirSync(dir).filter(name => name.endsWith('.mjs') && name !== 'index.mjs');
const tables = {};
for (const name of files) {
  const code = name.replace('.mjs', '');
  tables[code] = (await import(new URL(`../src/i18n/${name}`, import.meta.url))).default;
}
const codes = Object.keys(tables);

test('사전이 두 개 이상이다', () => {
  assert.ok(codes.length >= 2, codes.join(', '));
  assert.ok('en' in tables, '영어가 기준이다');
});

test('약속한 언어가 모두 있다', () => {
  for (const code of ['en', 'ko', 'ja', 'zh', 'ru']) {
    assert.ok(code in tables, `${code} 사전이 없다`);
  }
});

test('모든 사전이 같은 키를 갖는다', () => {
  // 한쪽에만 키가 있으면 그 언어에서 원문이나 키가 그대로 새어 나온다.
  const base = Object.keys(tables.en).sort();
  for (const code of codes) {
    const keys = Object.keys(tables[code]).sort();
    const missing = base.filter(key => !keys.includes(key));
    const extra = keys.filter(key => !base.includes(key));
    assert.deepEqual(missing, [], `${code} 에 없는 키`);
    assert.deepEqual(extra, [], `${code} 에만 있는 키`);
  }
});

test('빈 값이 없다', () => {
  for (const code of codes) {
    for (const [key, value] of Object.entries(tables[code])) {
      assert.equal(typeof value, 'string', `${code}.${key}`);
      assert.ok(value.trim().length > 0, `${code}.${key} 가 비었다`);
    }
  }
});

test('자리표시자가 언어마다 같다', () => {
  const holders = text => (text.match(/\{(\w+)\}/g) ?? []).sort();
  for (const code of codes) {
    if (code === 'en') continue;
    for (const key of Object.keys(tables.en)) {
      assert.deepEqual(
        holders(tables[code][key]),
        holders(tables.en[key]),
        `${code}.${key} 의 자리표시자가 영어와 다르다`,
      );
    }
  }
});

test('영어 사전은 라틴 문자만 쓴다', () => {
  // 다른 언어의 글자가 섞였다면 붙여넣기 사고다. meta.native 는 자국어 표기라 예외다.
  const foreign = /[가-힣\u3040-\u30ff\u3400-\u9fff\u0400-\u04ff]/;
  for (const [key, value] of Object.entries(tables.en)) {
    if (key === 'meta.native') continue;
    assert.ok(!foreign.test(value), `en.${key} 에 다른 언어의 글자가 있다: ${value}`);
  }
});

test('어느 사전도 번역을 빠뜨리지 않았다', () => {
  for (const code of codes) {
    if (code === 'en') continue;
    for (const [key, value] of Object.entries(tables[code])) {
      if (key.startsWith('meta.')) continue;
      // 영어와 글자까지 같으면 번역을 잊은 것이다.
      assert.notEqual(value, tables.en[key], `${code}.${key} 가 영어와 같다`);
    }
  }
});

// 언어마다 자기 글자를 쓰는지 본다. 한 줄이라도 영어가 남으면 여기서 드러난다.
//
// meta.language 는 영어 이름이고 meta.native 는 자국어 표기다. 둘 다 건너뛴다.
// 자리표시자(`{level}`)와 숫자·기호는 어느 언어에나 있으므로 지운 뒤에 본다.
const SCRIPTS = {
  ko: /[가-힣]/,
  ja: /[\u3040-\u30ff\u3400-\u9fff]/,
  zh: /[\u3400-\u9fff]/,
  ru: /[\u0400-\u04ff]/,
};

for (const [code, script] of Object.entries(SCRIPTS)) {
  test(`${code} 사전이 자기 글자를 쓴다`, () => {
    for (const [key, value] of Object.entries(tables[code])) {
      if (key.startsWith('meta.')) continue;
      assert.ok(script.test(value), `${code}.${key} 에 자기 글자가 없다: ${value}`);
    }
  });

  test(`${code} 사전에 영어 낱말이 남지 않았다`, () => {
    for (const [key, value] of Object.entries(tables[code])) {
      if (key.startsWith('meta.')) continue;
      const latin = value.replace(/\{\w+\}/g, '').match(/[A-Za-z]{2,}/g);
      assert.equal(latin, null, `${code}.${key} 에 영어가 남았다: ${latin?.join(' · ')}`);
    }
  });
}

test('중국어 사전에 일본어 가나가 섞이지 않았다', () => {
  // 두 사전을 나란히 쓰다 보면 서로 새기 쉽다. 가나는 중국어에 없다.
  for (const [key, value] of Object.entries(tables.zh)) {
    assert.ok(!/[\u3040-\u30ff]/.test(value), `zh.${key} 에 가나가 있다: ${value}`);
  }
});
