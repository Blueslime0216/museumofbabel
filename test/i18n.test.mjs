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

test('영어 사전에 한글이 없다', () => {
  for (const [key, value] of Object.entries(tables.en)) {
    // meta.native 는 자국어 표기이므로 예외다.
    if (key === 'meta.native') continue;
    assert.ok(!/[가-힣]/.test(value), `en.${key} 에 한글이 있다: ${value}`);
  }
});

test('한국어 사전에 번역이 빠진 곳이 없다', () => {
  for (const [key, value] of Object.entries(tables.ko)) {
    if (key.startsWith('meta.')) continue;
    // 영어와 글자까지 같으면 번역을 잊은 것이다.
    assert.notEqual(value, tables.en[key], `ko.${key} 가 영어와 같다`);
  }
});
