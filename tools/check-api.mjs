// 함수 검사 — 핸들러를 직접 불러 본다
//
// Vercel 런타임 없이 확인한다. 핸들러는 (request, response) 두 개만 받는 평범한
// 함수이므로 가짜를 만들어 넣으면 된다. `vercel dev` 를 깔지 않아도 된다.
//
// 여기서 지키는 것
//   1. 그림      200 · image/png · 실제로 PNG · 영구 캐시 · 주소 도장
//   2. 카드      og:image 가 우리 그림 함수를 정확히 가리킨다
//   3. 거절      이상한 주소와 잘못된 메서드
//   4. **기록 없음**  핸들러가 console 을 한 번도 부르지 않는다
//
// 4번이 이 파일의 요점이다. 좌표를 적지 않겠다는 약속을 코드로 지킨다.
// 사람이 console.log 를 하나 끼워 넣으면 여기서 실패한다.
//
// 못 보는 것 하나. vercel.json 의 크롤러 라우팅은 실제 배포에서만 확인된다.
// 배포 뒤에 User-Agent 를 바꿔 요청해 보는 것은 사람의 몫이다.

import { inflateSync } from 'node:zlib';

import art from '../api/art.mjs';
import card from '../api/card.mjs';

const results = [];
let failed = 0;
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failed++;
}

/** 가짜 response. 핸들러가 무엇을 돌려줬는지 모아 둔다. */
function fakeResponse() {
  const headers = {};
  const state = { status: 0, headers, body: null, ended: false };
  const self = {
    status(code) {
      state.status = code;
      return self;
    },
    setHeader(key, value) {
      headers[key.toLowerCase()] = value;
      return self;
    },
    getHeader(key) {
      return headers[key.toLowerCase()];
    },
    end(body) {
      state.body = body ?? null;
      state.ended = true;
      return self;
    },
    state,
  };
  return self;
}

const request = (query, { method = 'GET', host = 'demo-museumofbabel.vercel.app' } = {}) => ({
  method,
  query,
  headers: { host },
});

async function call(handler, ...args) {
  const response = fakeResponse();
  await handler(request(...args), response);
  return response.state;
}

// ── 4 — 기록을 남기지 않는다 (먼저 심는다) ───────────────────────────────

const spoken = [];
const realConsole = {};
for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
  realConsole[level] = console[level];
  console[level] = (...parts) => spoken.push(`${level}: ${parts.join(' ')}`);
}

// ── 1 — 그림 ─────────────────────────────────────────────────────────────

const ADDRESS = 'v1.8.4.abc.def';

{
  const png = await call(art, { a: ADDRESS });
  check('그림: 200 이다', png.status === 200, `${png.status}`);
  check('그림: image/png 이다', png.headers['content-type'] === 'image/png');
  check(
    '그림: 영구 캐시로 표시한다',
    /immutable/.test(png.headers['cache-control'] ?? '') &&
      /s-maxage=31536000/.test(png.headers['cache-control'] ?? ''),
    png.headers['cache-control'],
  );
  check('그림: 리퍼러를 보내지 않는다', png.headers['referrer-policy'] === 'no-referrer');
  check(
    '그림: 길이 헤더가 실제와 같다',
    Number(png.headers['content-length']) === png.body?.length,
    `${png.headers['content-length']} vs ${png.body?.length}`,
  );

  const body = png.body ?? Buffer.alloc(0);
  const signature = [...body.subarray(0, 8)].join(',');
  check('그림: 진짜 PNG 다', signature === '137,80,78,71,13,10,26,10', signature);

  // IHDR 을 읽어 크기를 본다
  const width = body.readUInt32BE(16);
  const height = body.readUInt32BE(20);
  check('그림: 1024×1024 다', width === 1024 && height === 1024, `${width}×${height}`);

  // IDAT 이 실제로 풀린다 (인코더가 깨진 zlib 를 내지 않았다)
  let idat = null;
  let at = 8;
  while (at + 12 <= body.length) {
    const length = body.readUInt32BE(at);
    if (body.subarray(at + 4, at + 8).toString('latin1') === 'IDAT') {
      idat = body.subarray(at + 8, at + 8 + length);
      break;
    }
    at += 12 + length;
  }
  let unpacked = 0;
  try {
    unpacked = inflateSync(idat).length;
  } catch {
    /* 아래 단정이 잡는다 */
  }
  check(
    '그림: 압축이 풀린다',
    unpacked === 1024 * (1 + 1024 * 3),
    `${unpacked} vs ${1024 * (1 + 1024 * 3)}`,
  );

  check(
    '그림: 주소 도장이 있다',
    body.includes(Buffer.from(`babel-address\0#${ADDRESS}`, 'latin1')),
    '',
  );
  check('그림: 파일이 지나치게 크지 않다', body.length < 1_500_000, `${(body.length / 1024).toFixed(0)}KB`);

  const head = await call(art, { a: ADDRESS }, { method: 'HEAD' });
  check('그림: HEAD 는 본문이 없다', head.status === 200 && head.body === null);
}

// ── 2 — 카드 ─────────────────────────────────────────────────────────────

{
  const page = await call(card, { a: ADDRESS });
  const html = String(page.body ?? '');
  check('카드: 200 이다', page.status === 200, `${page.status}`);
  check('카드: text/html 이다', /text\/html/.test(page.headers['content-type'] ?? ''));

  const image = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1];
  check(
    '카드: og:image 가 그림 함수를 가리킨다',
    image === `https://demo-museumofbabel.vercel.app/api/art?a=${ADDRESS}`,
    image ?? '없다',
  );
  check(
    '카드: og:url 이 사람이 갈 자리다',
    /<meta property="og:url" content="https:\/\/demo-museumofbabel\.vercel\.app\/\?a=v1\.8\.4\.abc\.def"/.test(
      html,
    ),
  );
  check('카드: 큰 그림 카드로 요청한다', /twitter:card" content="summary_large_image"/.test(html));
  check(
    '카드: 그림 크기를 알려 준다',
    /og:image:width" content="1024"/.test(html) && /og:image:height" content="1024"/.test(html),
  );
  check('카드: 사람은 미술관으로 보낸다', /http-equiv="refresh"/.test(html) && /<a href=/.test(html));
  check('카드: 스크립트가 없다', !/<script/i.test(html));

  // 주소에 따옴표를 섞어 넣으려 해도 태그가 깨지지 않는다.
  // (parseHash 가 먼저 막지만, 막는 곳이 하나뿐이면 언젠가 새어 나온다)
  const nasty = await call(card, { a: 'v1.8.4.abc.def" onload="alert(1)' });
  check(
    '카드: 이상한 주소는 카드를 만들지 않는다',
    nasty.status === 302,
    `${nasty.status}`,
  );
}

// ── 3 — 거절 ─────────────────────────────────────────────────────────────

{
  for (const bad of [undefined, '', 'hello', 'v1.7.4.abc.def', 'v1.8.4.ABC.def']) {
    const png = await call(art, { a: bad });
    check(`거절: 그림이 "${String(bad).slice(0, 16)}" 를 400 으로 막는다`, png.status === 400);
  }
  const wrongMethod = await call(art, { a: ADDRESS }, { method: 'POST' });
  check('거절: 그림이 POST 를 405 로 막는다', wrongMethod.status === 405);
  const cardMethod = await call(card, { a: ADDRESS }, { method: 'DELETE' });
  check('거절: 카드가 DELETE 를 405 로 막는다', cardMethod.status === 405);
}

// ── 4 — 기록 없음 (마지막에 확인) ────────────────────────────────────────

for (const [level, real] of Object.entries(realConsole)) console[level] = real;

check(
  '함수가 아무것도 적지 않는다',
  spoken.length === 0,
  spoken.length ? spoken.join(' / ').slice(0, 200) : '',
);

// ── 결과 ─────────────────────────────────────────────────────────────────

for (const { name, ok, detail } of results) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} 통과`);
process.exit(failed === 0 ? 0 : 1);
