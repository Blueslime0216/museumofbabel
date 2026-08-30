// 찾기 — 그림이나 주소로 자리를 찾는다
//
// 요구사항 8장.
//   이미지를 올렸을 때의 갈래
//     tEXt 청크가 있다   그 좌표로 곧바로 간다. 비교 화면 없음
//     없다               투영해서 가장 닮은 좌표를 찾는다
//                        올린 그림과 찾은 그림을 나란히 보여준 뒤 들어간다
//
//   청크 값이 손으로 고쳐졌는지 검증하지 않는다. 적힌 좌표를 그대로 믿는다.
//   그림과 주소가 어긋난 파일을 만드는 것이 이 프로젝트의 농담이다.
//
// 글자 입력은 세 형태를 다 받는다. 전체 URL · 해시만 · 36진수 좌표 두 개.

import {
  CANVAS,
  DEFAULT_TIER,
  DEFAULT_LOCALITY,
  fromBase36,
  parseHash,
  VERSION_MARKER,
  axisBitsFor,
} from '../codec.mjs';
import { readAddress } from '../png.mjs';
import { ARTWORK_FLOORS } from '../floors.mjs';
import { ROOMS } from '../codec.mjs';
import { t } from '../i18n/index.mjs';


/** 투영을 이보다 오래 기다리지 않는다. */
const PROJECT_TIMEOUT_MS = 30000;

/**
 * 사람이 붙여넣을 수 있는 것을 좌표로 읽는다.
 *
 * 실패하면 null 을 돌려준다. 예외를 던지지 않는다. 호출한 쪽이 토스트로 알린다.
 */
export function parseDestination(text, { tier = DEFAULT_TIER } = {}) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return null;

  // 전체 URL 이면 주소만 떼어 낸다. 두 자리를 다 받는다.
  //   표준형    https://…/?a=C1a2b3…
  //   `#` 자리  https://…/#C1a2b3…
  const query = /[?&]a=([^&#\s]+)/.exec(trimmed);
  if (query) {
    try {
      return parseHash(`#${decodeURIComponent(query[1]).replace(/^#/, '')}`, axisBitsFor);
    } catch {
      return null;
    }
  }

  const hashAt = trimmed.indexOf('#');
  const candidate = hashAt >= 0 ? trimmed.slice(hashAt) : trimmed;

  // `#C1a2b3…` 또는 `C1a2b3…`
  //
  // 판 표식으로 가른다. 아래의 "36진수 좌표 두 개" 갈래와 겹치지 않아야 하는데,
  // 그쪽은 반드시 값이 두 개이고 이쪽은 한 덩어리라서 겹치지 않는다.
  const withHash = candidate.startsWith('#') ? candidate : `#${candidate}`;
  if (withHash.startsWith(`#${VERSION_MARKER}`)) {
    try {
      return parseHash(withHash, axisBitsFor);
    } catch {
      return null;
    }
  }

  // 36진수 좌표 두 개. 쉼표나 공백으로 나뉜다.
  // 이때는 층 정보가 없으므로 고른 층을 쓴다.
  //
  // 여기만 62진수가 아니라 **36진수**다. 딸림표가 x · y 를 36진수로 보여 주므로
  // 눈으로 옮겨 적는 값이 36진수다. 그래서 대소문자를 가리지 않아도 된다.
  const pair = trimmed.split(/[\s,]+/).filter(Boolean);
  if (pair.length === 2 && pair.every(part => /^[0-9a-z]+$/i.test(part))) {
    try {
      const limit = 1n << BigInt(axisBitsFor(tier));
      const x = fromBase36(pair[0].toLowerCase());
      const y = fromBase36(pair[1].toLowerCase());
      if (x >= limit || y >= limit) return null;
      return { tier, locality: DEFAULT_LOCALITY, x, y };
    } catch {
      return null;
    }
  }

  return null;
}

export function createSearch({ toast, onGo, getWorld }) {
  const $ = id => document.getElementById(id);
  const scrim = $('scrim-search');
  const input = $('search-text');
  const file = $('search-file');
  const dropzone = $('dropzone');
  const compare = $('compare');
  const beforeCanvas = $('compare-before');
  const afterCanvas = $('compare-after');
  const goButton = $('btn-go');
  const floorRow = $('search-floor-row');
  const roomRow = $('search-room-row');
  const roomName = $('search-room-name');

  /** 어느 층에서 찾을지. 열 때 지금 층으로 맞춘다. */
  let searchTier = getWorld().tier;

  /**
   * 어느 전시실에서 찾을지. 기본값은 기준 전시실(0번)이다.
   *
   * "어디든" 이라는 선택지는 두지 않는다. 방을 강제하지 않으면 투영기는 기준
   * 전시실을 가정해 최적화하는데 좌표는 아무 방에나 떨어지고, 그 방이 그것을
   * 자기 방식으로 읽는다. 실측하면 올린 그림과의 오차가 평균 10배(최악 34배)
   * 나빠졌다 — 12개 표본 전부에서 나빴다. 아무도 원하지 않는 결과다.
   *
   * 그래서 찾기는 늘 어떤 방 안에서 찾는다. 기본이 기준 전시실일 뿐이다.
   */
  let searchRoom = 0;

  function renderFloors() {
    // 로비는 뺀다. 찾기는 "이 그림에 가까운 작품" 을 찾는 것이고
    // 로비에는 작품이 없다. 목록에 두면 고를 수 있는 것처럼 보인다.
    floorRow.replaceChildren(
      ...ARTWORK_FLOORS.map(floor => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'segment';
        button.dataset.tier = String(floor.tier);
        if (floor.tier === searchTier) button.setAttribute('aria-current', 'true');
        button.append(
          Object.assign(document.createElement('span'), {
            textContent: String(floor.level),
          }),
          Object.assign(document.createElement('small'), { textContent: floor.grid }),
        );
        return button;
      }),
    );
  }

  /**
   * 전시실 고르기.
   *
   * 칸에는 **번호만** 넣는다. 31칸에 이름을 적으면 칸이 터지고, 작품 딸림표가
   * 이름과 번호를 함께 보여 주므로 번호만으로도 이어진다. 대신 지금 고른 방의
   * 이름을 목록 아래에 한 줄로 적는다 — 이름이 필요한 순간은 그 하나다.
   *
   * 눈으로 보지 않는 사람에게는 번호만으로 아무 뜻이 없으므로 칸마다 이름을
   * `aria-label` 로 붙인다.
   */
  function renderRooms() {
    roomRow.replaceChildren(
      ...ROOMS.map((room, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'segment';
        button.dataset.room = String(index);
        button.setAttribute('aria-label', t(`room.${room.name}`));
        if (index === searchRoom) button.setAttribute('aria-current', 'true');
        button.append(
          Object.assign(document.createElement('span'), { textContent: String(index + 1) }),
        );
        return button;
      }),
    );
    roomName.textContent = t(`room.${ROOMS[searchRoom].name}`);
  }

  /** 고른 것이 바뀌면 앞서 찾아 둔 결과는 뜻이 없다. */
  function invalidateFound() {
    compare.hidden = true;
    found = null;
    goButton.textContent = t('common.go');
  }

  floorRow.addEventListener('click', event => {
    const button = event.target.closest('.segment');
    if (!button) return;
    const next = Number(button.dataset.tier);
    if (next === searchTier) return;
    searchTier = next;
    renderFloors();
    invalidateFound();

    // **올린 그림이 있으면 그 자리에서 새 층을 다시 찾는다.**
    //   다시 올리게 하면 "같은 그림이 층마다 어디에 있나" 를 견주기가 번거롭다.
    //   층을 눌러 보는 것 자체가 그 비교다.
    if (picture) project(picture);
  });

  roomRow.addEventListener('click', event => {
    const button = event.target.closest('.segment');
    if (!button) return;
    const next = Number(button.dataset.room);
    if (next === searchRoom) return;
    searchRoom = next;
    renderRooms();
    invalidateFound();

    // 층과 같은 이유로 곧바로 다시 찾는다. 방을 눌러 보는 것이 곧 비교다.
    if (picture) project(picture);
  });

  let worker = null;
  let sequence = 0;
  let busy = false;
  let found = null; // 투영으로 찾은 목적지
  let guard = 0; // 워커가 아무 말도 하지 않을 때를 위한 시간 제한

  /**
   * 마지막으로 올린 그림. 층을 바꿀 때 다시 쓴다.
   *
   * 비트맵이 아니라 Blob 을 남긴다. 비트맵은 워커로 넘길 때 소유권이 옮겨 가서
   * 이쪽에서는 못 쓰게 된다. Blob 이면 필요할 때 다시 만들면 된다.
   * 청크로 곧바로 찾은 그림은 남기지 않는다. 그 그림에는 층이 이미 적혀 있다.
   */
  let picture = null;

  /**
   * 매달리지 않게 한다.
   *
   * 워커가 불러오다 죽으면 onmessage 가 한 번도 오지 않는다. 그러면 busy 가
   * 켜진 채로 남아 다시 시도할 수도 없다. 실제로 그 상태를 만들어 봤다.
   * 그래서 onerror 와 시간 제한을 둘 다 둔다.
   */
  function stopWaiting(message) {
    clearTimeout(guard);
    guard = 0;
    busy = false;
    dropzone.dataset.busy = '0';
    if (message) toast(message);
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(new URL('../project.worker.mjs', import.meta.url), { type: 'module' });
    worker.onerror = () => {
      // 워커를 버린다. 다음 시도에서 새로 만든다.
      worker?.terminate();
      worker = null;
      stopWaiting(t('toast.projectFailed'));
    };
    worker.onmessage = event => {
      const message = event.data;
      stopWaiting();

      if (message.type !== 'projected') {
        // 고른 방에 떨어지는 주소를 못 찾은 경우만 따로 알린다.
        // 다른 방을 고르거나 "어디든" 으로 두면 된다는 것을 알려야 한다.
        toast(
          message.message === 'room-unreachable'
            ? t('toast.roomUnreachable')
            : t('toast.projectFailed'),
        );
        return;
      }

      // 기다리는 동안 고른 것이 바뀌었다. 이 결과는 옛 조건의 것이다.
      // 화면에 보여 주지 않고 새 조건으로 다시 찾는다.
      const stale = message.tier !== searchTier || message.room !== searchRoom;
      if (stale) {
        message.before?.close?.();
        message.after?.close?.();
        if (picture) project(picture);
        return;
      }

      found = {
        tier: message.tier,
        locality: message.locality,
        x: BigInt(message.x),
        y: BigInt(message.y),
      };
      paint(beforeCanvas, message.before);
      paint(afterCanvas, message.after);
      compare.hidden = false;
      goButton.textContent = t('search.goThere');
      goButton.focus();
    };
    return worker;
  }

  function paint(canvas, bitmap) {
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bitmap, 0, 0, CANVAS, CANVAS);
    bitmap.close?.();
  }

  function reset() {
    input.value = '';
    file.value = '';
    compare.hidden = true;
    found = null;
    picture = null;
    stopWaiting();
    goButton.textContent = t('common.go');
  }

  function open() {
    reset();
    searchTier = getWorld().tier;
    // 방은 지금 서 있는 방으로 맞추지 않는다. 열 때마다 기준 전시실이다.
    // 걸어 들어간 방이 곧 찾고 싶은 방이라고 단정할 수 없고, 기준 전시실이
    // 올린 그림을 가장 잘 닮는다.
    searchRoom = 0;
    renderFloors();
    renderRooms();
    scrim.hidden = false;
    // 휴대폰에서 키보드가 올라오면 화면이 좁아진다. 자동으로 focus 하지 않는다.
    if (matchMedia('(pointer: fine)').matches) input.focus();
  }

  function close() {
    scrim.hidden = true;
  }

  // ── 이미지 ─────────────────────────────────────────────────────────────

  /**
   * 그림 하나를 지금 고른 층에 투영한다.
   *
   * 층을 바꿀 때도 이것을 다시 부른다. 그래서 그림을 받는 일(accept)과
   * 투영하는 일을 나눠 두었다.
   */
  async function project(blob) {
    if (busy) return;

    let bitmap;
    try {
      bitmap = await createImageBitmap(blob);
    } catch {
      toast(t('toast.badPicture'));
      return;
    }

    picture = blob;
    busy = true;
    dropzone.dataset.busy = '1';
    compare.hidden = true;
    found = null;
    goButton.textContent = t('common.go');

    // 휴대폰에서 층 8 투영이 몇 초 걸린다. 넉넉히 주되 무한히 기다리지 않는다.
    clearTimeout(guard);
    guard = setTimeout(() => stopWaiting(t('toast.projectFailed')), PROJECT_TIMEOUT_MS);

    ensureWorker().postMessage(
      {
        type: 'project',
        id: ++sequence,
        tier: searchTier,
        locality: getWorld().locality,
        room: searchRoom,
        bitmap,
      },
      [bitmap],
    );
  }

  async function accept(blob) {
    if (busy) return;
    if (!blob || !blob.type?.startsWith('image/')) {
      toast(t('toast.notPicture'));
      return;
    }

    // 먼저 우리 청크를 본다. 있으면 정확히 그 자리다. 투영할 이유가 없다.
    if (blob.type === 'image/png') {
      try {
        const stamped = readAddress(new Uint8Array(await blob.arrayBuffer()));
        const destination = stamped ? parseDestination(stamped) : null;
        if (destination) {
          close();
          onGo(destination);
          return;
        }
      } catch {
        /* 청크가 없거나 깨졌다. 투영으로 넘어간다. */
      }
    }

    await project(blob);
  }

  dropzone.addEventListener('click', () => file.click());
  file.addEventListener('change', () => accept(file.files?.[0]));

  // 드래그&드롭. PC 에서만 쓰이지만 막아 둘 이유가 없다.
  for (const name of ['dragenter', 'dragover']) {
    dropzone.addEventListener(name, event => {
      event.preventDefault();
      dropzone.dataset.over = '1';
    });
  }
  for (const name of ['dragleave', 'drop']) {
    dropzone.addEventListener(name, event => {
      event.preventDefault();
      dropzone.dataset.over = '0';
    });
  }
  dropzone.addEventListener('drop', event => accept(event.dataTransfer?.files?.[0]));

  // 창 전체에 떨어뜨려도 받는다. 모달이 열려 있지 않으면 열어 준다.
  window.addEventListener('dragover', event => event.preventDefault());
  window.addEventListener('drop', event => {
    const dropped = event.dataTransfer?.files?.[0];
    if (!dropped) return;
    event.preventDefault();
    if (scrim.hidden) open();
    accept(dropped);
  });

  // ── 글자 ───────────────────────────────────────────────────────────────

  function go() {
    if (found) {
      const destination = found;
      close();
      onGo(destination);
      return;
    }
    const destination = parseDestination(input.value, { tier: searchTier });
    if (!destination) {
      toast(t(input.value.trim() ? 'toast.badAddress' : 'toast.nothing'));
      return;
    }
    close();
    onGo(destination);
  }

  goButton.addEventListener('click', go);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      go();
    }
  });

  scrim.addEventListener('click', event => {
    if (event.target === scrim || event.target.closest('[data-close]')) close();
  });

  return {
    open,
    close,
    get isOpen() {
      return !scrim.hidden;
    },
    dispose() {
      worker?.terminate();
      worker = null;
    },
  };
}
