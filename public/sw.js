// 서비스 워커 — 오프라인 관람
//
// 요구사항 14장. "와이파이를 끊어도 관람이 계속된다".
//   시연장에 수십 대가 붙는다. 첫 로드만 되면 그 뒤로는 네트워크가 필요 없는
//   구조이므로(렌더가 전부 클라이언트) 파일만 캐시해 두면 된다.
//
// 전략
//   HTML 은 network-first. 새 판이 있으면 그것을 쓴다
//   그 밖의 것은 cache-first. 이름에 해시가 붙어 있어 내용이 바뀌면 이름도 바뀐다
//
// 캐시 이름에 버전을 둔다. 올리면 옛 캐시를 지운다.
//
// **`public/` 의 파일을 고치면 반드시 이 값을 올려야 한다.**
//   빌드가 이름에 해시를 붙여 주는 것은 `assets/` 뿐이다. 아이콘 · 매니페스트 ·
//   파비콘은 이름이 그대로이므로 cache-first 에 걸려 옛 것이 영원히 남는다.
//   실제로 아이콘을 갈아 끼우면서 이 함정을 확인했다.

const VERSION = 'v4'; // 문서 캐시 열쇠가 경로 → 하나로 바뀌었다
const CACHE = `museum-of-babel-${VERSION}`;

self.addEventListener('install', () => {
  // 미리 담지 않는다. 어느 파일이 나올지는 빌드가 정하기 때문이다.
  // 첫 방문이 자연스럽게 캐시를 채운다.
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter(name => name !== CACHE).map(name => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') cache.put(request, response.clone());
  return response;
}

/**
 * HTML 은 경로만으로 저장한다. **쿼리를 키에 넣으면 안 된다.**
 *
 * 좌표가 `?a=` 로 들어가면서 URL 이 작품마다 달라졌다. 그런데 돌아오는 HTML 은
 * 어느 좌표로 들어와도 똑같은 한 장이다. 요청을 그대로 키로 쓰면 관람한 작품
 * 수만큼 같은 10KB 가 쌓인다. 예전에는 좌표가 `#` 에 있어서 URL 이 하나였다.
 */
/**
 * 문서는 **하나의 열쇠**로 저장한다. 경로도 키에 넣지 않는다.
 *
 * `/` · `/lobby` · `/workshop` 이 모두 같은 index.html 을 돌려준다(vercel.json 의
 * rewrites). 경로를 키로 쓰면 같은 10KB 가 세 번 쌓이고, 더 나쁜 것은 오프라인
 * 에서 아직 안 가 본 경로가 열리지 않는다는 것이다. 방은 클라이언트가 경로를
 * 읽어서 가르므로, 문서 자체는 한 장이면 된다.
 */
const pageKey = () => '/';

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const key = pageKey(request);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(key, response.clone());
    return response;
  } catch (error) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw error;
  }
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  // 함수는 건드리지 않는다. 링크 카드용이고 관람에는 쓰이지 않는다.
  // 오프라인에서 필요하지도 않고, 좌표마다 다른 URL 이라 캐시를 부풀린다.
  if (url.pathname.startsWith('/api/')) return;

  const wantsHtml = request.mode === 'navigate' || request.destination === 'document';
  event.respondWith(wantsHtml ? networkFirst(request) : cacheFirst(request));
});
