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
  tierSpec,
} from '../codec.mjs';
import { readAddress } from '../png.mjs';
import { FLOORS } from '../floors.mjs';
import { t } from '../i18n/index.mjs';

const axisBitsFor = tier => tierSpec(tier).axisBits;

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

  // 전체 URL 이면 해시만 떼어 낸다
  const hashAt = trimmed.indexOf('#');
  const candidate = hashAt >= 0 ? trimmed.slice(hashAt) : trimmed;

  // #v1.… 또는 v1.…
  const withHash = candidate.startsWith('#') ? candidate : `#${candidate}`;
  if (/^#v\d+\./.test(withHash)) {
    try {
      return parseHash(withHash, axisBitsFor);
    } catch {
      return null;
    }
  }

  // 36진수 좌표 두 개. 쉼표나 공백으로 나뉜다.
  // 이때는 층 정보가 없으므로 고른 층을 쓴다.
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

  /** 어느 층에서 찾을지. 열 때 지금 층으로 맞춘다. */
  let searchTier = getWorld().tier;

  function renderFloors() {
    floorRow.replaceChildren(
      ...FLOORS.map(floor => {
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

  floorRow.addEventListener('click', event => {
    const button = event.target.closest('.segment');
    if (!button) return;
    searchTier = Number(button.dataset.tier);
    renderFloors();
    // 층이 바뀌면 앞서 찾아 둔 결과는 뜻이 없다.
    compare.hidden = true;
    found = null;
    goButton.textContent = t('common.go');
  });

  let worker = null;
  let sequence = 0;
  let busy = false;
  let found = null; // 투영으로 찾은 목적지
  let guard = 0; // 워커가 아무 말도 하지 않을 때를 위한 시간 제한

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
        toast(t('toast.projectFailed'));
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
    stopWaiting();
    goButton.textContent = t('common.go');
  }

  function open() {
    reset();
    searchTier = getWorld().tier;
    renderFloors();
    scrim.hidden = false;
    // 휴대폰에서 키보드가 올라오면 화면이 좁아진다. 자동으로 focus 하지 않는다.
    if (matchMedia('(pointer: fine)').matches) input.focus();
  }

  function close() {
    scrim.hidden = true;
  }

  // ── 이미지 ─────────────────────────────────────────────────────────────

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

    let bitmap;
    try {
      bitmap = await createImageBitmap(blob);
    } catch {
      toast(t('toast.badPicture'));
      return;
    }

    busy = true;
    dropzone.dataset.busy = '1';
    compare.hidden = true;
    found = null;

    // 휴대폰에서 층 8 투영이 몇 초 걸린다. 넉넉히 주되 무한히 기다리지 않는다.
    clearTimeout(guard);
    guard = setTimeout(() => stopWaiting(t('toast.projectFailed')), PROJECT_TIMEOUT_MS);

    ensureWorker().postMessage(
      {
        type: 'project',
        id: ++sequence,
        tier: searchTier,
        locality: getWorld().locality,
        bitmap,
      },
      [bitmap],
    );
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
