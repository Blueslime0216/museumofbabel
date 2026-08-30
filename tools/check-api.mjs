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
import { readFileSync } from 'node:fs';

import art from '../api/art.mjs';
import card from '../api/card.mjs';
import { formatHash, fromBase36, VERSION_MARKER } from '../src/codec.mjs';

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

/**
 * 요청에 실을 호스트.
 *
 * 함수는 이 값을 그대로 되울려 og:url 과 og:image 를 만든다. 코드에 도메인이
 * 박혀 있지 않다는 뜻이고, 그래서 도메인을 바꿔도 카드가 따라온다.
 */
const HOST = 'museumofbabel.org';

const request = (query, { method = 'GET', host = HOST } = {}) => ({
  method,
  query,
  headers: { host },
});

async function call(handler, ...args) {
  const response = fakeResponse();
  await handler(request(...args), response);
  return response.state;
}

// ── 0 — vercel.json 이 스키마를 지키는가 ─────────────────────────────────
//
// **왜 이 검사가 있는가.** 설명을 남기려고 `"//": "…"` 키를 넣었다. JSON 에는
// 주석이 없고 Vercel 의 설정 스키마는 모르는 키를 거부한다. 배포가 실패했다.
//
// 그런데 **사이트는 멀쩡해 보였다.** 배포가 실패하면 이전 배포가 그대로 살아
// 있기 때문이다. 링크 카드에 옛 그림이 뜨는 것을 보고서야 알았다. 조용히
// 실패하는 종류라 검사로 막아야 한다.
{
  const text = readFileSync(new URL('../vercel.json', import.meta.url), 'utf8');
  let config = null;
  try {
    config = JSON.parse(text);
  } catch (error) {
    check('설정: JSON 으로 읽힌다', false, String(error.message));
  }

  if (config) {
    check('설정: JSON 으로 읽힌다', true);

    // 어디에도 주석 키가 없어야 한다
    const commentKeys = [];
    const walk = (node, path) => {
      if (Array.isArray(node)) {
        node.forEach((item, index) => walk(item, `${path}[${index}]`));
      } else if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) {
          if (key.startsWith('//')) commentKeys.push(`${path}.${key}`);
          walk(value, `${path}.${key}`);
        }
      }
    };
    walk(config, '');
    check(
      '설정: 주석 키가 없다',
      commentKeys.length === 0,
      commentKeys.join(' · ') || 'JSON 에는 주석이 없다. 설명은 문서에 쓴다',
    );

    // 스키마가 아는 키만 쓴다. 전부는 아니고 우리가 쓰는 것만 적어 둔다.
    const TOP = new Set([
      'buildCommand',
      'outputDirectory',
      'installCommand',
      'devCommand',
      'framework',
      'cleanUrls',
      'trailingSlash',
      'rewrites',
      'redirects',
      'headers',
      'functions',
      'regions',
      'crons',
      'images',
      'github',
      '$schema',
    ]);
    const unknownTop = Object.keys(config).filter(key => !TOP.has(key));
    check('설정: 최상위 키가 모두 알려진 것이다', unknownTop.length === 0, unknownTop.join(' · '));

    const RULE = {
      rewrites: ['source', 'destination', 'has', 'missing'],
      redirects: ['source', 'destination', 'has', 'missing', 'permanent', 'statusCode'],
      headers: ['source', 'headers', 'has', 'missing'],
    };
    for (const [section, allowed] of Object.entries(RULE)) {
      const bad = [];
      for (const [index, rule] of (config[section] ?? []).entries()) {
        for (const key of Object.keys(rule)) {
          if (!allowed.includes(key)) bad.push(`${section}[${index}].${key}`);
        }
      }
      check(`설정: ${section} 규칙에 모르는 키가 없다`, bad.length === 0, bad.join(' · '));
    }

    // has 의 정규식이 실제로 컴파일되는가. Vercel 은 Rust 엔진을 쓰지만
    // 인라인 플래그 같은 것을 안 쓰면 자바스크립트에서도 같은 뜻이다.
    const patterns = [];
    for (const rule of [...(config.rewrites ?? []), ...(config.redirects ?? [])]) {
      for (const condition of rule.has ?? []) {
        if (condition.value) patterns.push(condition.value);
      }
    }
    let compiled = true;
    let inlineFlag = null;
    for (const pattern of patterns) {
      try {
        new RegExp(pattern);
      } catch {
        compiled = false;
      }
      // (?i) 류는 엔진마다 다르다. 쓰지 않는다.
      if (/\(\?[a-z]/.test(pattern)) inlineFlag = pattern;
    }
    check('설정: has 정규식이 컴파일된다', compiled, `${patterns.length}개`);
    check(
      '설정: has 정규식에 인라인 플래그가 없다',
      inlineFlag === null,
      inlineFlag ?? '엔진마다 다르게 읽힐 수 있다',
    );

    // 크롤러 규칙이 실제로 크롤러를 잡는가
    //
    // **redirects 여야 한다.** Vercel 은 redirects → 파일시스템 → rewrites 순서로
    // 본다. 우리가 가로채려는 자리는 `/` 이고 거기에는 실제 index.html 이 있다.
    // rewrites 에 두면 파일이 먼저 잡혀 규칙까지 오지 않는다. 처음에 rewrites 로
    // 썼다가 로고 그림만 뜨는 것을 보고 알았다.
    const crawlerRule = (config.redirects ?? []).find(rule => rule.destination === '/api/card');
    check('설정: 크롤러를 /api/card 로 보내는 규칙이 있다', Boolean(crawlerRule));
    check(
      '설정: 크롤러 규칙이 redirects 에 있다',
      !(config.rewrites ?? []).some(rule => rule.destination === '/api/card'),
      'rewrites 는 파일시스템 뒤에 온다. / 에는 index.html 이 있어 안 걸린다',
    );
    if (crawlerRule) {
      check(
        '설정: 크롤러 규칙이 / 의 ?a= 만 잡는다',
        crawlerRule.source === '/' &&
          crawlerRule.has?.some(c => c.type === 'query' && c.key === 'a'),
        `${crawlerRule.source}`,
      );
      check(
        '설정: 크롤러 규칙이 영구 이동이 아니다',
        crawlerRule.permanent === false || crawlerRule.statusCode === 302,
        '영구로 두면 브라우저가 기억해 사람도 카드로 간다',
      );
      const agent = crawlerRule.has?.find(c => c.type === 'header')?.value;
      const test = new RegExp(`^${agent}$`);
      const shouldMatch = [
        'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
        'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
        'Twitterbot/1.0',
        'facebookexternalhit/1.1',
        'TelegramBot (like TwitterBot)',
        'Mozilla/5.0 (compatible; kakaotalk-scrap/1.0)',
        'WhatsApp/2.19.81 A',
        'Mozilla/5.0 (compatible; LinkedInBot/1.0)',
        'Iframely/1.3.1',
        'Embedly +1.0',
      ];
      const shouldNot = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
      ];
      const missed = shouldMatch.filter(ua => !test.test(ua));
      const caught = shouldNot.filter(ua => test.test(ua));
      check('설정: 크롤러를 잡는다', missed.length === 0, missed.map(u => u.slice(0, 32)).join(' · '));
      check('설정: 사람은 안 잡는다', caught.length === 0, caught.map(u => u.slice(0, 32)).join(' · '));
    }
  }
}

// ── 4 — 기록을 남기지 않는다 (먼저 심는다) ───────────────────────────────

const spoken = [];
const realConsole = {};
for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
  realConsole[level] = console[level];
  console[level] = (...parts) => spoken.push(`${level}: ${parts.join(' ')}`);
}

// ── 1 — 그림 ─────────────────────────────────────────────────────────────

// 주소를 글자로 적어 두지 않는다. 형식이 바뀌면 검사가 통째로 썩는다.
const ADDRESS = formatHash({ tier: 8, locality: 4, x: fromBase36('abc'), y: fromBase36('def') })
  .slice(1);

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
    image === `https://${HOST}/api/art?a=${ADDRESS}`,
    image ?? '없다',
  );
  const url = /<meta property="og:url" content="([^"]+)"/.exec(html)?.[1];
  check(
    '카드: og:url 이 사람이 갈 자리다',
    url === `https://${HOST}/?a=${ADDRESS}`,
    url ?? '없다',
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
  const nasty = await call(card, { a: `${ADDRESS}" onload="alert(1)` });
  check(
    '카드: 이상한 주소는 카드를 만들지 않는다',
    nasty.status === 302,
    `${nasty.status}`,
  );
}

// ── 3 — 거절 ─────────────────────────────────────────────────────────────

{
  for (const bad of [
    undefined,
    '',
    'hello',
    'v1.8.4.abc.def', // 옛 판. 판 표식에서 걸린다
    'v2.8.4.abc.def', // 옛 판
    'B4kZq9wT', // v2 표식
    `${VERSION_MARKER}abc!def`, // 62진수가 아닌 글자
    VERSION_MARKER, // 몸통이 없다
  ]) {
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
