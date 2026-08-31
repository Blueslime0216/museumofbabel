// /api/card?a=<주소> → 크롤러용 HTML
//
// 링크를 붙인 곳에서 보이는 카드다. 크롤러는 자바스크립트를 돌리지 않으므로
// 여기 적힌 메타 태그만 읽는다.
//
// **사람은 이 페이지를 거의 보지 않는다.** vercel.json 이 크롤러의 요청만
// 이쪽으로 돌린다. 사람은 정적 index.html 을 CDN 에서 받는다. 그래야 함수가
// 실행되는 횟수가 최소로 줄고, 기록도 그만큼 안 생긴다.
//
// 그래도 사람이 오면(크롤러 목록에 없는 브라우저 등) 곧바로 미술관으로 보낸다.
// 자바스크립트 없이도 되게 meta refresh 와 링크를 같이 둔다.
//
// api/art.mjs 와 같은 이유로 여기에도 console 이 없다. 지우지 마라.

import { readAddress, addressText, CARD_SIZE } from './_lib/artwork.mjs';

const FOREVER = 'public, max-age=31536000, s-maxage=31536000, immutable';

/** 카드에 보일 글. 작품 제목은 넣지 않는다 — 아래 주석 참조. */
const TITLE = 'Museum of Babel';
const DESCRIPTION = 'Every possible picture already hangs here. You only need the address.';

const escape = text =>
  String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

export default function handler(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.status(405).setHeader('Allow', 'GET, HEAD').end();
    return;
  }

  const state = readAddress(request.query?.a);
  if (!state) {
    response.status(302).setHeader('Location', '/').end();
    return;
  }

  const address = addressText(state);
  const host = request.headers['x-forwarded-host'] ?? request.headers.host ?? '';
  const origin = `https://${host}`;
  const page = `${origin}/?a=${encodeURIComponent(address)}`;
  const image = `${origin}/api/art?a=${encodeURIComponent(address)}`;

  // 제목에 생성된 작품 제목(예: "연지 습작")을 넣고 싶었지만 넣지 않았다.
  // 제목은 언어마다 다르고, 크롤러가 어느 언어로 보는지 알 수 없다. 카드에
  // 한국어 제목이 박히면 영어권 사람에게 뜻 없는 글자가 된다. 층과 좌표 대신
  // 미술관 이름만 두고, 그림이 말하게 한다.
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escape(TITLE)}</title>
<meta name="description" content="${escape(DESCRIPTION)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="${escape(TITLE)}" />
<meta property="og:title" content="${escape(TITLE)}" />
<meta property="og:description" content="${escape(DESCRIPTION)}" />
<meta property="og:url" content="${escape(page)}" />
<meta property="og:image" content="${escape(image)}" />
<!-- 카카오톡과 몇몇 곳은 secure_url 을 먼저 본다. 같은 주소를 한 번 더 적어 준다.
     https 뿐이라 다른 값이 될 일이 없다. -->
<meta property="og:image:secure_url" content="${escape(image)}" />
<meta property="og:image:type" content="image/png" />
<meta property="og:image:width" content="${CARD_SIZE}" />
<meta property="og:image:height" content="${CARD_SIZE}" />
<meta property="og:image:alt" content="An artwork from the Museum of Babel" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escape(TITLE)}" />
<meta name="twitter:description" content="${escape(DESCRIPTION)}" />
<meta name="twitter:image" content="${escape(image)}" />
<link rel="canonical" href="${escape(page)}" />
<meta http-equiv="refresh" content="0; url=${escape(page)}" />
</head>
<body>
<p><a href="${escape(page)}">${escape(TITLE)}</a></p>
</body>
</html>
`;

  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Cache-Control', FOREVER);
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.status(200);
  if (request.method === 'HEAD') response.end();
  else response.end(html);
}
