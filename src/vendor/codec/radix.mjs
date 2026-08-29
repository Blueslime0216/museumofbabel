// 혼합 진법 분해와 합성 — 이 프로젝트의 심장
//
// 여기에는 해시도, 난수도, 유효성 검사도, 재시도도 없다.
// 나눗셈과 나머지뿐이다. 그래서 모든 주소가 유효하고, 모든 변환이 가역이다.
//
// 두 가지 구현을 제공한다.
//   decompose / compose        참조 구현. 일반 진법에서 동작. 명세 그 자체.
//   decomposeBytes / composeBytes  고속 구현. 진법이 모두 2의 거듭제곱일 때만.
// 두 구현이 항상 같은 결과를 낸다는 것은 test/radix.test.mjs가 보증한다.

/** 진법 목록이 만드는 전체 공간의 크기. */
export function spaceSize(radices) {
  let total = 1n;
  for (const r of radices) total *= BigInt(r);
  return total;
}

/**
 * 참조 구현: 정수 하나를 자릿수로 분해한다.
 *
 * 낮은 자리부터 벗겨낸다. digits[0]이 최하위 자리다.
 * value가 공간 크기를 넘으면 던진다. 이것은 "입력 범위 확인"이며
 * "출력 유효성 검사"가 아니다. 출력은 언제나 유효하다.
 */
export function decompose(value, radices) {
  if (typeof value !== 'bigint') throw new TypeError('value는 BigInt여야 한다');
  if (value < 0n) throw new RangeError('value는 음수일 수 없다');
  let n = value;
  const digits = new Array(radices.length);
  for (let i = 0; i < radices.length; i++) {
    const r = BigInt(radices[i]);
    digits[i] = Number(n % r);
    n /= r;
  }
  if (n !== 0n) throw new RangeError('value가 진법 공간을 넘었다');
  return digits;
}

/** 참조 구현: 자릿수를 정수로 합성한다. decompose의 정확한 역함수. */
export function compose(digits, radices) {
  if (digits.length !== radices.length) throw new RangeError('자릿수 개수가 진법 개수와 다르다');
  let n = 0n;
  for (let i = radices.length - 1; i >= 0; i--) {
    const d = digits[i];
    if (!Number.isInteger(d) || d < 0 || d >= radices[i]) {
      throw new RangeError(`자리 ${i}의 값 ${d}이(가) 진법 ${radices[i]} 범위를 벗어났다`);
    }
    n = n * BigInt(radices[i]) + BigInt(d);
  }
  return n;
}

/** 정수를 고정 길이 바이트열로 만든다. 빅엔디언. 바이트 0이 최상위다. */
export function codeToBytes(code, byteLength) {
  if (typeof code !== 'bigint') throw new TypeError('code는 BigInt여야 한다');
  if (code < 0n) throw new RangeError('code는 음수일 수 없다');
  const out = new Uint8Array(byteLength);
  let v = code;
  for (let i = byteLength - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  if (v !== 0n) throw new RangeError(`code가 ${byteLength}바이트를 넘었다`);
  return out;
}

/** 바이트열을 정수로 되돌린다. codeToBytes의 역함수. */
export function bytesToCode(bytes) {
  let v = 0n;
  for (let i = 0; i < bytes.length; i++) v = (v << 8n) | BigInt(bytes[i]);
  return v;
}

/**
 * 고속 구현: 바이트열에서 자릿수를 직접 읽는다.
 *
 * 진법이 모두 2의 거듭제곱이면 "나머지 연산"은 "하위 비트 읽기"와 같다.
 * 그래서 큰 BigInt 나눗셈을 수백 번 하지 않고 비트만 긁어올 수 있다.
 * 최하위 비트(=바이트열의 마지막 바이트의 0번 비트)부터 순서대로 읽는다.
 *
 * widths의 각 값은 32 이하여야 한다. 실제 명세는 최대 6이다.
 */
export function decomposeBytes(bytes, widths) {
  const len = bytes.length;
  const digits = new Array(widths.length);
  let pos = 0;
  for (let i = 0; i < widths.length; i++) {
    const width = widths[i];
    let out = 0;
    let got = 0;
    while (got < width) {
      const byteIndex = len - 1 - (pos >> 3);
      if (byteIndex < 0) throw new RangeError('바이트열이 자릿수 폭 합계보다 짧다');
      const bitInByte = pos & 7;
      const take = Math.min(8 - bitInByte, width - got);
      const chunk = (bytes[byteIndex] >>> bitInByte) & ((1 << take) - 1);
      out |= chunk << got;
      got += take;
      pos += take;
    }
    digits[i] = out;
  }
  return digits;
}

/** 고속 구현: 자릿수를 바이트열로 쓴다. decomposeBytes의 역함수. */
export function composeBytes(digits, widths, byteLength) {
  const out = new Uint8Array(byteLength);
  let pos = 0;
  for (let i = 0; i < widths.length; i++) {
    const width = widths[i];
    let value = digits[i];
    if (!Number.isInteger(value) || value < 0 || value >= 1 << width) {
      throw new RangeError(`자리 ${i}의 값 ${value}이(가) 폭 ${width} 범위를 벗어났다`);
    }
    let put = 0;
    while (put < width) {
      const byteIndex = byteLength - 1 - (pos >> 3);
      if (byteIndex < 0) throw new RangeError('바이트열이 자릿수 폭 합계보다 짧다');
      const bitInByte = pos & 7;
      const take = Math.min(8 - bitInByte, width - put);
      const chunk = (value >>> put) & ((1 << take) - 1);
      out[byteIndex] |= chunk << bitInByte;
      put += take;
      pos += take;
    }
  }
  return out;
}

/** 진법이 모두 2의 거듭제곱인지 확인한다. 고속 경로 사용 가능 여부. */
export function allPowersOfTwo(radices) {
  return radices.every(r => Number.isInteger(Math.log2(r)));
}
