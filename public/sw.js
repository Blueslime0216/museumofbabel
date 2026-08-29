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

const VERSION = 'v2';
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

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw error;
  }
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  const wantsHtml = request.mode === 'navigate' || request.destination === 'document';
  event.respondWith(wantsHtml ? networkFirst(request) : cacheFirst(request));
});
