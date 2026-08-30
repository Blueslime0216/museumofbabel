import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { writeText, readText, stampAddress, readAddress, KEYWORD } from '../src/png.mjs';

/** 최소한의 진짜 PNG 를 만든다. 1×1 검정 픽셀. */
function makePng() {
  const crcTable = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    return table;
  })();

  const crc = bytes => {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  const chunk = (type, data) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(data)]);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(body));
    return Buffer.concat([head, body, tail]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); // width
  ihdr.writeUInt32BE(1, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const idat = deflateSync(Buffer.from([0, 0, 0, 0])); // 필터 0 + RGB

  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', idat),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

test('적은 값을 그대로 읽는다', () => {
  const hash = '#v2.8.4.abc123.def456';
  const stamped = stampAddress(makePng(), hash);
  assert.equal(readAddress(stamped), hash);
});

test('층 16 의 긴 주소도 담긴다', () => {
  const long = `#v2.16.4.${'z'.repeat(621)}.${'k'.repeat(621)}`;
  const stamped = stampAddress(makePng(), long);
  assert.equal(readAddress(stamped), long);
  assert.equal(long.length > 1250, true, '실제로 긴 값이어야 한다');
});

test('청크가 IEND 앞에 들어가고 서명이 그대로다', () => {
  const before = makePng();
  const after = stampAddress(before, '#v2.8.4.a.b');
  assert.deepEqual([...after.slice(0, 8)], [...before.slice(0, 8)]);
  assert.ok(after.length > before.length);

  // 마지막 청크는 여전히 IEND 여야 한다
  const tail = String.fromCharCode(...after.slice(after.length - 8, after.length - 4));
  assert.equal(tail, 'IEND');
});

test('없는 키워드는 null 이다', () => {
  const stamped = writeText(makePng(), 'other-key', 'value');
  assert.equal(readText(stamped, KEYWORD), null);
  assert.equal(readText(stamped, 'other-key'), 'value');
});

test('청크가 없으면 null 이다', () => {
  assert.equal(readAddress(makePng()), null);
});

test('PNG 가 아니면 거부한다', () => {
  assert.throws(() => stampAddress(new Uint8Array([1, 2, 3]), 'x'), TypeError);
  assert.equal(readAddress(new Uint8Array([1, 2, 3])), null, '읽기는 조용히 null');
});

test('Latin-1 밖의 값은 거부한다', () => {
  assert.throws(() => stampAddress(makePng(), '한글'), RangeError);
});

test('여러 번 적으면 마지막 것이 아니라 첫 것을 읽는다', () => {
  // 형식상 여러 tEXt 가 허용된다. 우리 규격은 하나만 쓰므로 순서를 못 박아 둔다.
  const once = stampAddress(makePng(), '#v2.8.4.first.one');
  const twice = stampAddress(once, '#v2.8.4.second.two');
  assert.equal(readAddress(twice), '#v2.8.4.first.one');
});
