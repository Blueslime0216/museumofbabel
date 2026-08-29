// 시트 — 고른 전시물의 정보
//
// 요구사항 7장.
//   휴대폰은 아래에서 올라오는 바텀 시트, PC 는 우하단 플로팅 패널.
//   내용과 상태는 같고 배치와 제스처만 다르다. 그래서 한 코드다.
//
// 세 상태
//   숨김   아무것도 안 고른 상태
//   살짝   제목 한 줄만 보인다. 탭하면 이 상태로 열린다
//   펼침   전부 보인다. 위로 끌면 이 상태가 된다
//
// 끌기의 시작값을 상수로 계산하지 않는다. 지금 적용된 transform 을 읽는다.
// 그래야 --peek 이나 안전 영역 값이 바뀌어도 어긋나지 않는다.

import { CANVAS, formatHash, shortenNumber, toBase36 } from '../codec.mjs';
import { describe } from '../label.mjs';
import { downloadArtwork } from '../download.mjs';
import { t } from '../i18n/index.mjs';

const DEBUG_HOLD_MS = 700;

export function createSheet({ toast, onShow }) {
  const $ = id => document.getElementById(id);

  const sheet = $('sheet');
  const body = $('sheet-body');
  const grip = $('sheet-grip');
  const peek = $('sheet-peek');
  const detail = $('detail');
  const detailCtx = detail.getContext('2d', { alpha: false });
  const menu = $('download-menu');
  const downloadButton = $('btn-download');

  let state = 'hidden';
  let current = null; // { tier, locality, x, y, code, bitmap, info }

  // ── 상태 ───────────────────────────────────────────────────────────────

  function setState(next) {
    state = next;
    sheet.dataset.state = next;
    sheet.style.removeProperty('--sheet-y');
    sheet.dataset.dragging = '0';
    document.body.dataset.sheet = next;
    sheet.setAttribute('aria-hidden', next === 'hidden' ? 'true' : 'false');
    // 접혀 있을 때 본문은 화면 밖이다. 읽어 줄 이유가 없다.
    body.setAttribute('aria-hidden', next === 'expanded' ? 'false' : 'true');
    if (next !== 'expanded') closeMenu();
  }

  function close() {
    setState('hidden');
    current = null;
  }

  // ── 내용 ───────────────────────────────────────────────────────────────

  function show(artwork) {
    current = artwork;
    const info = describe(artwork);
    current.info = info;
    current.hash = formatHash(artwork);

    $('peek-title').textContent = info.title;
    $('peek-acc').textContent = info.accession;
    $('plaque-title').textContent = info.title;
    $('plaque-medium').textContent = t('sheet.medium', { bytes: info.bytes });
    $('plaque-acc').textContent = t('sheet.accession', { id: info.accession });
    $('address').textContent = current.hash;
    $('address').dataset.open = '0';

    detailCtx.imageSmoothingEnabled = false;
    detailCtx.clearRect(0, 0, CANVAS, CANVAS);
    if (artwork.bitmap) detailCtx.drawImage(artwork.bitmap, 0, 0);

    const rows = [
      [t('sheet.floor'), `${artwork.tier} × ${artwork.tier}`],
      [t('sheet.zones'), String(info.zones)],
      [t('sheet.addressSize'), `${info.bytes} B · ${info.bits} bit`],
      [t('sheet.quantization'), `${info.quant} / 15`],
      [t('sheet.palette'), `${info.palette.primary} · ${info.palette.secondary}`],
      ['x', shortenNumber(toBase36(artwork.x), 7, 5)],
      ['y', shortenNumber(toBase36(artwork.y), 7, 5)],
    ];
    $('record').replaceChildren(
      ...rows.flatMap(([key, value]) => {
        const dt = document.createElement('dt');
        dt.textContent = key;
        const dd = document.createElement('dd');
        dd.textContent = value;
        return [dt, dd];
      }),
    );

    if (state === 'hidden') setState('peek');
    onShow?.(info);
  }

  /** 언어가 바뀌면 지금 보이는 내용을 다시 채운다. */
  function refresh() {
    if (current) show(current);
  }

  // ── 끌기 ───────────────────────────────────────────────────────────────

  const currentY = () => new DOMMatrixReadOnly(getComputedStyle(sheet).transform).m42;
  let drag = null;

  grip.addEventListener('pointerdown', event => {
    grip.setPointerCapture(event.pointerId);
    sheet.dataset.dragging = '1';
    drag = {
      id: event.pointerId,
      y: event.clientY,
      from: currentY(),
      wasExpanded: state === 'expanded',
      moved: 0,
    };
  });

  grip.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    drag.moved = event.clientY - drag.y;
    const height = sheet.getBoundingClientRect().height;
    const at = Math.max(-18, Math.min(height, drag.from + drag.moved));
    sheet.style.setProperty('--sheet-y', `${at}px`);
  });

  const endDrag = event => {
    if (!drag || drag.id !== event.pointerId) return;
    const { moved, wasExpanded } = drag;
    drag = null;
    if (wasExpanded) setState(moved > 70 ? 'peek' : 'expanded');
    else if (moved < -40) setState('expanded');
    else if (moved > 60) close();
    else setState('peek');
  };
  grip.addEventListener('pointerup', endDrag);
  grip.addEventListener('pointercancel', endDrag);

  peek.addEventListener('click', () => setState('expanded'));

  $('address').addEventListener('click', event => {
    const element = event.currentTarget;
    element.dataset.open = element.dataset.open === '1' ? '0' : '1';
  });

  // ── 복사 ───────────────────────────────────────────────────────────────

  $('btn-copy').addEventListener('click', async () => {
    if (!current) return;
    const url = `${location.origin}${location.pathname}${current.hash}`;
    try {
      await navigator.clipboard.writeText(url);
      toast(t('toast.copied'));
    } catch {
      // 클립보드가 막힌 환경도 있다. 조용히 실패하지 않는다.
      toast(t('toast.copyFailed'));
      $('address').dataset.open = '1';
    }
  });

  // ── 다운로드 ───────────────────────────────────────────────────────────

  function closeMenu() {
    menu.hidden = true;
    downloadButton.setAttribute('aria-expanded', 'false');
  }

  async function save(size, { stamp = true } = {}) {
    if (!current?.bitmap) return;
    try {
      await downloadArtwork({
        bitmap: current.bitmap,
        size,
        hash: current.hash,
        accession: current.info.accession,
        stamp,
      });
    } catch {
      toast(t('toast.saveFailed'));
    }
  }

  let holdTimer = 0;
  let holdFired = false;

  function debugSave() {
    holdFired = true;
    navigator.vibrate?.(24);
    closeMenu();
    toast(t('toast.debug'));
    save(CANVAS, { stamp: false });
  }

  downloadButton.addEventListener('pointerdown', () => {
    holdFired = false;
    holdTimer = setTimeout(debugSave, DEBUG_HOLD_MS);
  });
  const cancelHold = () => clearTimeout(holdTimer);
  downloadButton.addEventListener('pointerup', cancelHold);
  downloadButton.addEventListener('pointercancel', cancelHold);
  downloadButton.addEventListener('pointerleave', cancelHold);

  downloadButton.addEventListener('click', event => {
    if (holdFired) {
      holdFired = false;
      return;
    }
    // PC 는 Alt(Option)+Shift. macOS 에서 Ctrl+클릭은 우클릭이라 쓸 수 없다.
    if (event.altKey && event.shiftKey) {
      debugSave();
      return;
    }
    const open = menu.hidden;
    menu.hidden = !open;
    downloadButton.setAttribute('aria-expanded', String(open));
  });

  menu.addEventListener('click', event => {
    const item = event.target.closest('.menu-item');
    if (!item) return;
    closeMenu();
    save(Number(item.dataset.size));
  });

  // ── 바깥에서 부르는 것 ─────────────────────────────────────────────────

  return {
    show,
    close,
    refresh,
    collapse() {
      if (state === 'expanded') setState('peek');
    },
    get state() {
      return state;
    },
    get open() {
      return state !== 'hidden';
    },
    get artwork() {
      return current;
    },
    /** Esc 를 받았을 때. 한 단계씩 접는다. */
    escape() {
      if (!menu.hidden) {
        closeMenu();
        return true;
      }
      if (state === 'expanded') {
        setState('peek');
        return true;
      }
      if (state === 'peek') {
        close();
        return true;
      }
      return false;
    },
  };
}
