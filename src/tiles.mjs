// 타일 — 비트맵 캐시와 워커 요청 대기열
//
// 요구사항 11장.
//   화면에 보이는 것부터 그리고, 가고 있는 방향을 먼저 준비한다.
//   메모리는 표시 개수와 무관하게 캐시 상한으로 묶인다.
//
// 우선순위는 여기서 정하지 않는다. stage 가 순서대로 준 목록을 그대로 믿는다.
// 그래야 "무엇이 급한가" 를 아는 쪽과 "어떻게 가져오는가" 를 아는 쪽이 갈린다.

const CACHE_MAX = 180; // 비트맵 하나가 약 256KB. 180장이면 46MB 쯤
const IN_FLIGHT_MAX = 6; // 동시에 워커에 맡기는 개수

// 키는 stage 가 만든다. 좌표 문자열을 쓰지 않는 이유는 stage.mjs 의 keyOf 에 있다.
// 여기서는 키를 불투명한 문자열로만 다룬다.

export function createTiles({ workerCount = 2, cacheMax = CACHE_MAX, onArrive } = {}) {
  const cache = new Map(); // key → ImageBitmap  (Map 의 삽입 순서로 LRU)
  const inFlight = new Map(); // key → generation
  const workers = [];
  let nextWorker = 0;
  let generation = 0;
  let sequence = 0;
  const stats = { rendered: 0, hits: 0, evicted: 0, totalMs: 0 };

  for (let i = 0; i < workerCount; i++) {
    const worker = new Worker(new URL('./render.worker.mjs', import.meta.url), { type: 'module' });
    worker.onmessage = event => {
      const message = event.data;
      const key = message?.key;
      if (!key) return;

      const born = inFlight.get(key);
      inFlight.delete(key);

      if (message.type !== 'rendered') return;
      // 세대가 지난 결과는 버린다. 층이나 국소성이 바뀐 뒤의 그림이다.
      if (born !== generation) {
        message.bitmap.close?.();
        return;
      }

      stats.rendered++;
      stats.totalMs += message.computeMs ?? 0;
      put(key, message.bitmap);
      onArrive?.(key);
    };
    workers.push(worker);
  }

  /**
   * 무엇을 지킬 것인가.
   *
   * 순서가 중요하다. stage 가 준 목록의 앞쪽이 화면 중앙이고 뒤쪽이 바깥이다.
   * 버릴 때는 이 순위가 가장 낮은 것부터 버린다.
   *
   * 왜 LRU 를 쓰지 않는가
   *   처음에는 get() 이 쓸 때마다 순서를 갱신하는 LRU 였다. 그런데 그리는 순서가
   *   중앙부터라서 한 프레임을 다 그리면 **중앙이 가장 오래된 항목**이 되었다.
   *   그래서 새 타일이 도착할 때마다 중앙을 버렸다. 화면 가운데에 검은 칸이 남았다.
   *   "언제 썼는가" 가 아니라 "지금 얼마나 급한가" 로 버려야 한다.
   */
  const rank = new Map(); // key → 순위 (작을수록 지킨다)

  function keep(list) {
    rank.clear();
    for (let i = 0; i < list.length; i++) rank.set(list[i].key, i);
  }

  function evictOne() {
    let worstKey = null;
    let worstRank = -1;
    for (const key of cache.keys()) {
      const value = rank.has(key) ? rank.get(key) : Number.MAX_SAFE_INTEGER;
      if (value > worstRank) {
        worstRank = value;
        worstKey = key;
      }
    }
    if (worstKey === null) return;
    cache.get(worstKey)?.close?.();
    cache.delete(worstKey);
    stats.evicted++;
  }

  function put(key, bitmap) {
    if (cache.has(key)) cache.get(key).close?.();
    cache.set(key, bitmap);
    while (cache.size > cacheMax) evictOne();
  }

  /** 캐시에 있으면 돌려준다. 순서를 건드리지 않는다. */
  function get(key) {
    const hit = cache.get(key);
    if (hit !== undefined) stats.hits++;
    return hit;
  }

  /**
   * 이 목록이 필요하다고 알린다. 앞쪽이 급한 것이다.
   *
   * 이미 있거나 진행 중인 것은 건너뛴다. 동시 처리 상한까지만 맡긴다.
   * 남은 것은 다음 프레임에 다시 알려 오면 된다. 대기열을 길게 쌓지 않는다.
   *
   * `coordOf(i, j)` 를 함께 받는다. **목록에는 좌표가 없다.**
   *   층 16 의 좌표는 3212비트다. 165칸 전부에 대해 미리 만들면 프레임마다
   *   큰 BigInt 를 330개 버리게 된다. 실제로 워커에 보내는 것은 한 프레임에
   *   여섯 개 이하이므로, 보낼 것만 그때 계산한다.
   */
  function want(list, coordOf) {
    keep(list);
    let room = IN_FLIGHT_MAX - inFlight.size;
    if (room <= 0) return 0;

    let issued = 0;
    for (const item of list) {
      if (room <= 0) break;
      const { key } = item;
      if (cache.has(key) || inFlight.has(key)) continue;

      const [x, y] = coordOf(item.i, item.j);
      inFlight.set(key, generation);
      const worker = workers[nextWorker];
      nextWorker = (nextWorker + 1) % workers.length;
      // 16진수로 보낸다. 2의 거듭제곱 진법은 비트를 옮기기만 하므로 자릿수에
      // 선형이다. 10진수는 나눗셈이라 층 16 에서 눈에 보일 만큼 느리다.
      worker.postMessage({
        type: 'render',
        id: ++sequence,
        key,
        tier: item.tier,
        locality: item.locality,
        x: x.toString(16),
        y: y.toString(16),
      });
      room--;
      issued++;
    }
    return issued;
  }

  return {
    get,
    want,
    keep,
    has: key => cache.has(key),
    get pending() {
      return inFlight.size;
    },
    get size() {
      return cache.size;
    },
    /** 캐시에 들어갈 수 있는 최대 개수. stage 가 미리 렌더 범위를 정할 때 본다. */
    get capacity() {
      return cacheMax;
    },
    get stats() {
      return {
        ...stats,
        size: cache.size,
        pending: inFlight.size,
        // 전시물 하나의 순수 계산 시간. 워커가 보고한 값의 평균이다.
        avgMs: stats.rendered ? stats.totalMs / stats.rendered : 0,
      };
    },

    /**
     * 층이나 국소성이 바뀌면 이전 결과가 무의미해진다.
     * 진행 중인 요청은 취소할 수 없으므로 세대를 올려 결과를 버린다.
     */
    invalidate() {
      generation++;
      for (const bitmap of cache.values()) bitmap.close?.();
      cache.clear();
      inFlight.clear();
      rank.clear();
    },

    dispose() {
      for (const worker of workers) worker.terminate();
      for (const bitmap of cache.values()) bitmap.close?.();
      cache.clear();
    },
  };
}
