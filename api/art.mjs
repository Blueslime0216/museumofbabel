// /api/art?a=<주소> → PNG
//
// 링크 카드에 들어갈 그림을 만든다. 사람이 보는 화면은 여전히 브라우저가 그린다.
// 이 함수는 크롤러만 상대한다.
//
// ── 기록을 남기지 않는다 ────────────────────────────────────────────────
//
// 이 파일에는 console 이 한 번도 나오지 않는다. 좌표도, 요청도, 시간도 적지 않는다.
// 실패해도 적지 않는다. **의도한 것이다.** 지우지 마라.
//
// 그리고 같은 주소는 언제나 같은 그림이므로 응답을 영구 캐시로 표시한다.
// 그러면 두 번째 요청부터는 CDN 이 답하고 이 함수는 아예 실행되지 않는다.
// 함수가 실행되지 않으면 런타임 기록도 생기지 않는다.
//
// 우리가 못 하는 것 하나는 정직하게 적어 둔다. **플랫폼의 요청 기록은 앱이
// 끌 수 없다.** Vercel 은 대시보드에서 볼 수 있는 요청 기록을 남기고, 보관
// 기간은 요금제에 따른다(취미·프로는 짧다). 애플리케이션 코드로 그것을 없앨
// 방법은 없다. 로그 드레인을 붙이지 않는 것, 분석 기능을 켜지 않는 것,
// 그리고 위의 캐시가 우리가 할 수 있는 전부다. ! - dev/03_로드맵.md 참조.

import { readAddress, renderArtworkPng, CARD_SIZE } from './_lib/artwork.mjs';

/** 한 해. 같은 주소는 같은 그림이므로 영원히 캐시해도 옳다. */
const FOREVER = 'public, max-age=31536000, s-maxage=31536000, immutable';

export default function handler(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.status(405).setHeader('Allow', 'GET, HEAD').end();
    return;
  }

  const state = readAddress(request.query?.a);
  if (!state) {
    // 그림 자리에 글자를 돌려줄 수는 없다. 짧게 끝낸다.
    response.status(400).setHeader('Cache-Control', 'public, max-age=60').end();
    return;
  }

  const png = renderArtworkPng(state, CARD_SIZE);

  response.setHeader('Content-Type', 'image/png');
  response.setHeader('Content-Length', String(png.length));
  response.setHeader('Cache-Control', FOREVER);
  // 이 그림에서 다른 곳으로 주소가 새 나가지 않게 한다.
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.status(200);
  if (request.method === 'HEAD') response.end();
  else response.end(png);
}
