// URL 직렬화와 파싱
//
//   C<base62 한 덩어리>
//
// 이미지 데이터는 넣지 않는다. 좌표만 넣는다.
// 좌표에서 코드워드를 계산할 수 있으므로 그것으로 충분하고, 훨씬 짧다.
//
// ── 왜 읽히는 부분을 없앴는가 ────────────────────────────────────────────
//
// v2 는 `v2.<층>.<국소성>.<x>.<y>` 였다. 주소를 보면 구조가 읽혔고, 층과 국소성이
// 사람이 읽는 십진수로 앞에 붙어 있었다. 이 작품에서 주소는 좌표이지 설명이
// 아니므로, 구조를 비트 안으로 접어 넣고 한 덩어리로 만들었다.
//
//   층(3비트) + 국소성(3비트) = 정확히 6비트.
//   ADDRESSABLE_TIERS 가 5개(로비+작품 4층)이고 LOCALITY_LEVELS 가 8개라 딱 맞는다.
//
// 이 6비트를 **가장 낮은 자리**에 둔다. 높은 자리에 두면 안 된다 — base62 문자열은
// 앞의 0을 적지 않으므로, 높은 자리에 둔 값은 좌표가 작을 때 사라진다.
//
// ── 왜 base62 인가 ───────────────────────────────────────────────────────
//
// 이 주소는 **압축할 수 없다.** 모든 비트 패턴이 유효한 그림이므로(정확히
// 2^totalBits 개가 다 쓰인다) 중복이 0이고, 어떤 압축기를 붙여도 비둘기집
// 원리로 평균 길이가 늘어난다. "모든 그림이 이미 걸려 있다"가 곧 압축 불가의
// 증명이다.
//
// 줄일 수 있는 것은 글자당 비트뿐이다.
//
//   base36 (0-9a-z)      5.170 비트/글자   층32 에서 4,967자
//   base62 (0-9A-Za-z)   5.954 비트/글자   층32 에서 4,306자   ← 이것
//   base64url (+ - _)    6.000 비트/글자   층32 에서 4,273자
//
// base64url 은 0.7% 밖에 더 못 얻는데 위험이 붙는다. 하이픈은 더블클릭 선택을
// 끊고, 끝에 `-` `_` `.` `~` 가 오면 채팅앱의 자동 링크가 잘라먹는다. 영숫자만
// 쓰면 그런 사고가 없다.
//
// 대가는 **대소문자를 가린다는 것**이다. base36 소문자 주소는 누가 대문자로
// 바꿔도 살아남았지만 이제는 아니다. 주소를 손으로 옮겨 적는 경로가 있으면
// 그곳에서 대소문자를 보존해야 한다.
//
// ── 왜 앞에 글자 하나를 붙이는가 ─────────────────────────────────────────
//
// 판 표식이다. A=v1, B=v2, C=v3.
//
// 옛 주소를 위한 것이 **아니다.** 옛 판은 버렸고 되살릴 계획도 없다. 이것은
// 다음 판을 위한 것이다. 전시실 수치를 미감 튜닝으로 확정하면 그때 같은 주소가
// 다른 그림을 내므로 판을 또 올려야 한다. 그때 표식이 없으면 v3 주소를 v4 코드가
// **조용히 다른 그림으로** 읽는다. 이 프로젝트가 유일하게 하지 않겠다고 한 일이다.
//
// 판 번호를 비트 안에 접어 넣는 방법도 있었지만, 그러면 옛 주소의 판 칸이 우연히
// 새 판과 같을 확률이 남는다(4비트면 1/16). 표식을 자리 하나로 빼면 확률이 아니라
// 확실한 거부가 된다. 4,306자 중 1자로 사는 보장이다.

import { ADDRESSABLE_TIERS, DEFAULT_TIER, axisBitsFor } from './spec.mjs';
import { LOCALITY_LEVELS, DEFAULT_LOCALITY } from './scramble.mjs';

/** 판 이름. 문서와 기록에서 쓴다. */
export const URL_VERSION = 'v3';

/** 주소 맨 앞의 판 표식. A=v1, B=v2, C=v3. */
export const VERSION_MARKER = 'C';

/** 접어 넣는 헤더의 자리 수. 층 3비트 + 국소성 3비트. */
const TIER_BITS = 3;
const LOCALITY_BITS = 3;
const HEADER_BITS = TIER_BITS + LOCALITY_BITS;
const TIER_MASK = (1 << TIER_BITS) - 1;
const LOCALITY_MASK = (1 << LOCALITY_BITS) - 1;

// 자리 수가 실제로 들어가는지 못박아 둔다. 층이나 국소성을 늘리면 여기서 걸린다.
if (ADDRESSABLE_TIERS.length > TIER_MASK + 1) {
  throw new RangeError(`층이 ${TIER_BITS}비트를 넘는다: ${ADDRESSABLE_TIERS.length}개`);
}
if (LOCALITY_LEVELS.length > LOCALITY_MASK + 1) {
  throw new RangeError(`국소성이 ${LOCALITY_BITS}비트를 넘는다: ${LOCALITY_LEVELS.length}개`);
}

// ── base62 ───────────────────────────────────────────────────────────────
//
// 62는 2의 거듭제곱이 아니므로 BigInt.toString 이 못 한다. 직접 나눈다.
//
// 한 자리씩 나누면 층32(4,306자)에서 나눗셈이 4,306번이고 피제수가 25,630비트다.
// 그래서 62^10 씩 끊어 열 자리를 한 번에 낸다. 나눗셈 횟수가 1/10 이 된다.
//
// 10 이 최적이다. **더 키우면 오히려 느려진다** — 62^10 은 2^60 보다 작아 나눗수가
// 한 워드에 들어가지만, 62^21 은 여러 워드가 되어 나눗셈 한 번이 훨씬 비싸진다.
// 층32 encode 실측: 1자리 14.7ms · 5자리 3.0ms · **10자리 1.8ms** · 21자리 4.0ms.

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const RADIX = 62n;
const CHUNK = 10;
const CHUNK_POWER = RADIX ** BigInt(CHUNK);

/** 62^0 .. 62^CHUNK. 마지막 토막이 짧을 때 쓴다. */
const POWERS = Array.from({ length: CHUNK + 1 }, (_, i) => RADIX ** BigInt(i));

/** 글자 → 값. 코드 포인트로 찾는다. */
const DIGIT_OF = new Int8Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) DIGIT_OF[ALPHABET.charCodeAt(i)] = i;

/** BigInt를 62진수 문자열로. */
export function toBase62(value) {
  if (value < 0n) throw new RangeError('음수는 주소가 아니다');
  if (value === 0n) return '0';

  // 낮은 자리부터 열 자리씩 뽑는다
  const groups = [];
  let rest = value;
  while (rest > 0n) {
    groups.push(rest % CHUNK_POWER);
    rest /= CHUNK_POWER;
  }

  let text = '';
  for (let i = groups.length - 1; i >= 0; i--) {
    let group = groups[i];
    let digits = '';
    while (group > 0n) {
      digits = ALPHABET[Number(group % RADIX)] + digits;
      group /= RADIX;
    }
    // 가장 높은 토막만 앞의 0을 적지 않는다. 나머지는 자리를 채워야 한다.
    text += i === groups.length - 1 ? digits || '0' : digits.padStart(CHUNK, '0');
  }
  return text;
}

/** 62진수 문자열을 BigInt로. 대소문자를 가린다. */
export function fromBase62(text) {
  if (typeof text !== 'string' || text.length === 0) {
    throw new SyntaxError('62진수가 아니다: 빈 문자열');
  }
  let value = 0n;
  for (let i = 0; i < text.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, text.length);
    let group = 0n;
    for (let j = i; j < end; j++) {
      const code = text.charCodeAt(j);
      const digit = code < 128 ? DIGIT_OF[code] : -1;
      if (digit < 0) throw new SyntaxError(`62진수가 아니다: ${text[j]}`);
      group = group * RADIX + BigInt(digit);
    }
    value = value * POWERS[end - i] + group;
  }
  return value;
}

// ── 36진수 ───────────────────────────────────────────────────────────────
//
// 주소에는 더 쓰지 않는다. 딸림표의 x · y 표시와 소장품 번호가 쓴다. 사람이
// 눈으로 읽는 자리이므로 소문자 36진수가 더 낫다.

/** BigInt를 36진수 문자열로. 소문자만 쓴다. */
export function toBase36(value) {
  return value.toString(36);
}

/**
 * 36진수 문자열을 BigInt로.
 *
 * BigInt에는 기수를 받는 생성자가 없으므로 직접 자리별로 누적한다.
 */
export function fromBase36(text) {
  if (!/^[0-9a-z]+$/.test(text)) throw new SyntaxError(`36진수가 아니다: ${text}`);
  let value = 0n;
  for (const ch of text) {
    const digit = ch <= '9' ? ch.charCodeAt(0) - 48 : ch.charCodeAt(0) - 87;
    value = value * 36n + BigInt(digit);
  }
  return value;
}

// ── 주소 ─────────────────────────────────────────────────────────────────

/**
 * 상태를 주소로 만든다. 맨 앞에 `#` 을 붙여 돌려준다.
 *
 * `#` 은 옛 해시 링크 시절의 규약이다. 지금 주소창은 `?a=` 를 쓰므로 부르는 쪽이
 * 떼어 쓴다. 붙여 두는 편이 "이것은 주소 문자열이다" 를 드러내서 남겼다.
 */
export function formatHash({ tier, locality, x, y }) {
  const tierIndex = ADDRESSABLE_TIERS.indexOf(tier);
  if (tierIndex < 0) throw new RangeError(`지원하지 않는 층: ${tier}`);
  if (!Number.isInteger(locality) || locality < 0 || locality >= LOCALITY_LEVELS.length) {
    throw new RangeError(`지원하지 않는 국소성 단계: ${locality}`);
  }

  const axisBits = axisBitsFor(tier);
  const size = 1n << BigInt(axisBits);
  if (x < 0n || y < 0n || x >= size || y >= size) {
    throw new RangeError('좌표가 이 미술관 밖이다');
  }

  // x 를 위, y 를 아래에 두고, 그 아래 6비트에 층과 국소성을 넣는다
  const packed =
    (((x << BigInt(axisBits)) | y) << BigInt(HEADER_BITS)) |
    BigInt((locality << TIER_BITS) | tierIndex);

  return `#${VERSION_MARKER}${toBase62(packed)}`;
}

/**
 * 주소를 상태로 되돌린다.
 *
 * 형식이 어긋나거나 범위를 넘으면 throw한다.
 * 호출한 쪽이 사용자에게 알리고 원점으로 복구할 책임을 진다.
 * 조용히 실패해서는 안 된다.
 *
 * 옛 판(v1 · v2)은 받지 않는다. 판 표식이 다르므로 첫 글자에서 걸러진다.
 *
 * @param axisBitsForTier 옛 호출부가 넘기던 콜백. 기본값이 곧 정답이다.
 */
export function parseHash(hash, axisBitsForTier = axisBitsFor) {
  const text = String(hash ?? '').replace(/^#/, '');
  if (text.length < 2) throw new SyntaxError('좌표 형식이 아니다');
  if (text[0] !== VERSION_MARKER) {
    throw new SyntaxError(`이 미술관의 주소가 아니다: 판 표식이 ${text[0]}`);
  }

  const packed = fromBase62(text.slice(1));

  const tierIndex = Number(packed & BigInt(TIER_MASK));
  if (tierIndex >= ADDRESSABLE_TIERS.length) {
    throw new RangeError(`지원하지 않는 층: 색인 ${tierIndex}`);
  }
  const tier = ADDRESSABLE_TIERS[tierIndex];

  // LOCALITY_LEVELS 가 정확히 8개이므로 3비트가 낼 수 있는 값은 모두 유효하다.
  const locality = Number((packed >> BigInt(TIER_BITS)) & BigInt(LOCALITY_MASK));

  const axisBits = axisBitsForTier(tier);
  const size = 1n << BigInt(axisBits);
  const body = packed >> BigInt(HEADER_BITS);
  const y = body & (size - 1n);
  const x = body >> BigInt(axisBits);
  if (x >= size) throw new RangeError('좌표가 이 미술관 밖이다');

  return { tier, locality, x, y };
}

/** 기본 상태. 주소가 없을 때 쓴다. */
export function defaultState() {
  return { tier: DEFAULT_TIER, locality: DEFAULT_LOCALITY, x: 0n, y: 0n };
}
