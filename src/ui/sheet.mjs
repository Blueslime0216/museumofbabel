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
import { shareUrlFor } from '../hash.mjs';
import { t } from '../i18n/index.mjs';

const DEBUG_HOLD_MS = 700;

/**
 * PC 배치인지. sheet.css 의 미디어 쿼리와 같은 조건이다.
 *
 * 같은 조건을 두 곳에 적는 것이 마음에 걸리지만, 대안은 CSS 변수를 읽어 오는
 * 것이고 그쪽이 더 돌아가는 길이다. 값이 갈리면 검사가 잡는다.
 */
const DESKTOP = '(min-width: 760px) and (pointer: fine)';
const isDesktop = () => matchMedia(DESKTOP).matches;

/** 손잡이를 이보다 덜 움직였으면 끌기가 아니라 누른 것이다. input.mjs 와 같은 값. */
const GRIP_SLOP = 6;

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
    grip.setAttribute('aria-expanded', next === 'expanded' ? 'true' : 'false');
    if (next !== 'expanded') closeMenu();
  }

  /**
   * 무엇을 고르면 어느 상태로 열리는가.
   *
   * 휴대폰은 제목 줄만(peek). 시트가 화면의 88%를 덮으므로 곧바로 펼치면
   * 미술관이 가려진다.
   * PC 는 펼침(expanded). 우하단 패널이라 아무것도 가리지 않는데 제목 한 줄만
   * 보여 주면 한 번 더 누르게 만드는 것 말고는 하는 일이 없다.
   */
  const restingState = () => (isDesktop() ? 'expanded' : 'peek');

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
      // 전시실은 이름과 번호를 함께 보여 준다.
      //
      // 이름만 두면 찾기 모달과 이어지지 않는다. 그쪽은 번호로 고르기 때문이다.
      // 번호만 두면 기억에 남지 않는다. 둘을 붙여야 "청자의 방이 27번이구나" 가
      // 남고, 걸어 다니다 마음에 든 방을 나중에 찾아갈 수 있다.
      [t('sheet.room'), `${t(`room.${info.room.id}`)} · ${info.room.index + 1}`],
      [t('sheet.zones'), String(info.zones)],
      [t('sheet.addressSize'), `${info.bytes} B · ${info.bits} bit`],
      [t('sheet.quantization'), `${info.quant} / 15`],
      [t('sheet.palette'), `${info.palette.primary} · ${info.palette.secondary}`],
      // 좌표는 줄여 보여 주고, 눌러서 전체를 펼 수 있다.
      //
      // 줄이는 이유: 층 32의 한 축이 36진법으로 2,000자가 넘는다. 그대로 두면
      // 딸림표가 좌표 두 줄짜리 벽이 된다.
      //
      // 그래도 펼 수 있어야 한다. 이것은 그 그림이 어디 있는지를 말하는 유일한
      // 값이고, 줄인 것만 보여 주면 미술관이 그 값을 숨기는 것이 된다.
      ['x', shortenNumber(toBase36(artwork.x), 7, 5), toBase36(artwork.x)],
      ['y', shortenNumber(toBase36(artwork.y), 7, 5), toBase36(artwork.y)],
    ];
    $('record').replaceChildren(
      ...rows.flatMap(([key, value, full]) => {
        const dt = document.createElement('dt');
        dt.textContent = key;
        const dd = document.createElement('dd');
        if (full && full !== value) {
          // 펼 수 있는 값. 단추로 둔다 — 키보드로도 펼 수 있어야 한다.
          const toggle = document.createElement('button');
          toggle.type = 'button';
          toggle.className = 'reveal';
          toggle.dataset.open = '0';
          toggle.dataset.short = value;
          toggle.dataset.full = full;
          toggle.textContent = value;
          toggle.setAttribute('aria-expanded', 'false');
          toggle.setAttribute('aria-label', t('sheet.revealAxis', { axis: key }));
          dd.append(toggle);
        } else {
          dd.textContent = value;
        }
        return [dt, dd];
      }),
    );

    if (state === 'hidden') setState(restingState());
    onShow?.(info);
  }

  /** 언어가 바뀌면 지금 보이는 내용을 다시 채운다. */
  function refresh() {
    if (current) show(current);
  }

  // ── 끌기 ───────────────────────────────────────────────────────────────

  const currentY = () => new DOMMatrixReadOnly(getComputedStyle(sheet).transform).m42;
  let drag = null;

  /** 끌고 나면 브라우저가 click 도 보낸다. 그 한 번은 무시한다. */
  let swallowClick = false;

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

    // 거의 움직이지 않았으면 끌기가 아니다. click 이 뒤따라 오므로 거기서 처리한다.
    if (Math.abs(moved) < GRIP_SLOP) {
      sheet.dataset.dragging = '0';
      sheet.style.removeProperty('--sheet-y');
      return;
    }

    swallowClick = true;
    if (wasExpanded) setState(moved > 70 ? 'peek' : 'expanded');
    else if (moved < -40) setState('expanded');
    else if (moved > 60) close();
    else setState('peek');
  };
  grip.addEventListener('pointerup', endDrag);
  grip.addEventListener('pointercancel', endDrag);

  // 손잡이를 누르면 접기와 펼치기를 오간다. 마우스로는 끄는 것보다 이것이 쉽다.
  // button 이므로 Enter · Space 로도 같은 일이 일어난다.
  grip.addEventListener('click', () => {
    if (swallowClick) {
      swallowClick = false;
      return;
    }
    setState(state === 'expanded' ? 'peek' : 'expanded');
  });

  peek.addEventListener('click', () => setState('expanded'));

  $('address').addEventListener('click', event => {
    const element = event.currentTarget;
    element.dataset.open = element.dataset.open === '1' ? '0' : '1';
  });

  // 좌표를 펴고 접는다. 목록을 다시 지어도 붙어 있게 위임으로 받는다.
  $('record').addEventListener('click', event => {
    const toggle = event.target.closest('.reveal');
    if (!toggle) return;
    const open = toggle.dataset.open === '1';
    toggle.dataset.open = open ? '0' : '1';
    toggle.textContent = open ? toggle.dataset.short : toggle.dataset.full;
    toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
  });

  // ── 복사 ───────────────────────────────────────────────────────────────

  $('btn-copy').addEventListener('click', async () => {
    if (!current) return;
    // `?a=` 형태로 준다. 이 형태만 링크 카드에 그림이 뜬다 (hash.mjs 참조).
    const url = shareUrlFor(current);
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
    /**
     * 화면에 손을 대면 접는다.
     *
     * **PC 에서는 접지 않는다.** 패널이 우하단에 떠 있어 가리는 것이 없으므로
     * 접을 이유가 없고, 접으면 PC 의 기본 상태(펼침)와 싸운다. 전시물을 하나
     * 고르고 다음 것을 고를 때마다 반쯤 닫혔다 열리는 꼴이 된다.
     */
    collapse() {
      if (isDesktop()) return;
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
