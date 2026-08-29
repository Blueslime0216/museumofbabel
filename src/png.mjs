// PNG tEXt 청크 — 좌표를 파일 안에 적고 다시 읽는다
//
// 요구사항 7장 · 8장.
//   투영기는 왕복하지 않는다. 무손실 픽셀을 그대로 다시 넣어도 좌표가 돌아오지
//   않는다 (원인은 01 의 작업노트에 있다). 그래서 파일에 주소를 적는다.
//
//   이것이 무엇인지는 정직하게 말해야 한다. **그림에서 주소를 복원하는 것이
//   아니라 파일에 주소를 적어 두는 것이다.** 그림만 보고 되찾는 일은 투영기가
//   하고, 그것이 근사라는 사실은 그대로 남는다.
//
// 값이 손으로 고쳐졌는지 검증하지 않는다. 적힌 좌표를 그대로 믿는다.
// 그림과 주소가 어긋난 파일을 만드는 것이 이 프로젝트의 농담이다.
//
// 의존성이 없다. 바이트를 직접 다룬다.

export const KEYWORD = 'babel-address';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** PNG 청크의 CRC-32. 표에 한 번 만들어 재사용한다. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes, from = 0, to = bytes.length) {
  let c = 0xffffffff;
  for (let i = from; i < to; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function readU32(bytes, at) {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

function writeU32(bytes, at, value) {
  bytes[at] = (value >>> 24) & 0xff;
  bytes[at + 1] = (value >>> 16) & 0xff;
  bytes[at + 2] = (value >>> 8) & 0xff;
  bytes[at + 3] = value & 0xff;
}

function isPng(bytes) {
  if (bytes.length < 8) return false;
  return SIGNATURE.every((byte, index) => bytes[index] === byte);
}

/** Latin-1 만 쓴다. tEXt 의 규격이다. 우리 값은 36진수와 점이라 안전하다. */
function latin1(text) {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0xff) throw new RangeError('tEXt 에는 Latin-1 만 담을 수 있다');
    out[i] = code;
  }
  return out;
}

function fromLatin1(bytes) {
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

/** 청크 목록을 훑는다. 형식이 아니면 빈 배열이다. */
function* chunks(bytes) {
  if (!isPng(bytes)) return;
  let at = 8;
  while (at + 8 <= bytes.length) {
    const length = readU32(bytes, at);
    const type = fromLatin1(bytes.subarray(at + 4, at + 8));
    const dataAt = at + 8;
    if (dataAt + length + 4 > bytes.length) return;
    yield { type, at, dataAt, length, end: dataAt + length + 4 };
    if (type === 'IEND') return;
    at = dataAt + length + 4;
  }
}

/**
 * tEXt 청크를 IEND 바로 앞에 끼운다.
 *
 * 앞에 끼울 수도 있지만 IEND 앞이 가장 단순하다. 디코더는 순서를 신경 쓰지 않는다.
 */
export function writeText(pngBytes, keyword, value) {
  const bytes = pngBytes instanceof Uint8Array ? pngBytes : new Uint8Array(pngBytes);
  if (!isPng(bytes)) throw new TypeError('PNG 가 아니다');

  let iend = null;
  for (const chunk of chunks(bytes)) {
    if (chunk.type === 'IEND') iend = chunk;
  }
  if (!iend) throw new TypeError('IEND 가 없다');

  const key = latin1(keyword);
  const text = latin1(value);
  const dataLength = key.length + 1 + text.length;
  const chunk = new Uint8Array(12 + dataLength);

  writeU32(chunk, 0, dataLength);
  chunk.set(latin1('tEXt'), 4);
  chunk.set(key, 8);
  chunk[8 + key.length] = 0; // 키워드와 값 사이의 구분자
  chunk.set(text, 9 + key.length);
  writeU32(chunk, 8 + dataLength, crc32(chunk, 4, 8 + dataLength));

  const out = new Uint8Array(bytes.length + chunk.length);
  out.set(bytes.subarray(0, iend.at), 0);
  out.set(chunk, iend.at);
  out.set(bytes.subarray(iend.at), iend.at + chunk.length);
  return out;
}

/** tEXt 청크를 찾아 값을 돌려준다. 없으면 null. */
export function readText(pngBytes, keyword) {
  const bytes = pngBytes instanceof Uint8Array ? pngBytes : new Uint8Array(pngBytes);
  const wanted = latin1(keyword);

  for (const chunk of chunks(bytes)) {
    if (chunk.type !== 'tEXt') continue;
    const data = bytes.subarray(chunk.dataAt, chunk.dataAt + chunk.length);
    const nul = data.indexOf(0);
    if (nul !== wanted.length) continue;
    let same = true;
    for (let i = 0; i < wanted.length; i++) {
      if (data[i] !== wanted[i]) {
        same = false;
        break;
      }
    }
    if (same) return fromLatin1(data.subarray(nul + 1));
  }
  return null;
}

/** 편의. 우리 키워드로 주소를 적는다. */
export function stampAddress(pngBytes, hash) {
  return writeText(pngBytes, KEYWORD, hash);
}

/** 편의. 우리 키워드로 주소를 읽는다. */
export function readAddress(pngBytes) {
  return readText(pngBytes, KEYWORD);
}
