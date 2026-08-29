// 무한 2차원 그리드
//
// 기획서 10.3, 12장.
//   - 화면 밖으로 나간 셀만 재활용한다. 전체를 다시 그리지 않는다
//   - 좌표는 BigInt이며 축 크기로 감긴다
//   - 렌더는 전부 클라이언트에서 한다. 네트워크 요청 0건
//   - 중앙에서 가까운 셀을 먼저 그린다

import { CANVAS, tierSpec } from './spec.mjs';
import { wrap } from './space.mjs';

const VIEW_COLS = 7;
const VIEW_ROWS = 5;
const POOL_COLS = VIEW_COLS + 2; // 9
const POOL_ROWS = VIEW_ROWS + 2; // 7
const HALF_X = (POOL_COLS - 1) / 2; // 4
const HALF_Y = (POOL_ROWS - 1) / 2; // 3
const CENTER_COL = (VIEW_COLS - 1) / 2; // 3
const CENTER_ROW = (VIEW_ROWS - 1) / 2; // 2

/** 프레임당 렌더 예산. 넘으면 다음 프레임으로 넘긴다. */
const FRAME_BUDGET_MS = 7;

export function createGallery({ element, track, renderer, onCenterChange, onCellPick }) {
  const tiles = [];
  let state = { tier: 8, locality: 4, x: 0n, y: 0n };
  let offsetX = 0;
  let offsetY = 0;
  let generation = 0;
  let queue = [];
  let frameHandle = 0;
  let drag = null;

  // ── 타일 풀 만들기 ──────────────────────────────────────
  for (let oy = -HALF_Y; oy <= HALF_Y; oy++) {
    for (let ox = -HALF_X; ox <= HALF_X; ox++) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cell';
      button.style.width = `${100 / VIEW_COLS}%`;
      button.style.height = `${100 / VIEW_ROWS}%`;

      const canvas = document.createElement('canvas');
      canvas.width = CANVAS;
      canvas.height = CANVAS;
      button.append(canvas);
      track.append(button);

      const tile = {
        button,
        canvas,
        ctx: canvas.getContext('2d', { alpha: false }),
        ox,
        oy,
        worldX: 0n,
        worldY: 0n,
        drawnKey: null,
      };
      button.addEventListener('click', () => {
        if (tile.ox === 0 && tile.oy === 0) return;
        onCellPick?.(tile.worldX, tile.worldY);
      });
      tiles.push(tile);
    }
  }

  function axisBits() {
    return tierSpec(state.tier).axisBits;
  }

  function cellWidth() {
    return Math.max(1, element.clientWidth / VIEW_COLS);
  }
  function cellHeight() {
    return Math.max(1, element.clientHeight / VIEW_ROWS);
  }

  // ── 배치 ────────────────────────────────────────────────

  function place(tile) {
    tile.button.style.left = `${(tile.ox + CENTER_COL) * (100 / VIEW_COLS)}%`;
    tile.button.style.top = `${(tile.oy + CENTER_ROW) * (100 / VIEW_ROWS)}%`;
    tile.button.dataset.center = tile.ox === 0 && tile.oy === 0 ? '1' : '0';
  }

  function applyTransform() {
    track.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
  }

  function keyOf(tile) {
    return `${state.tier}:${state.locality}:${tile.worldX}:${tile.worldY}`;
  }

  function refreshWorld(tile) {
    const bits = axisBits();
    tile.worldX = wrap(state.x + BigInt(tile.ox), bits);
    tile.worldY = wrap(state.y + BigInt(tile.oy), bits);
    tile.button.setAttribute('aria-label', `좌표 ${tile.worldX}, ${tile.worldY}`);
    tile.button.title = `(${tile.worldX}, ${tile.worldY})`;
  }

  // ── 렌더 큐 ─────────────────────────────────────────────

  function enqueue(tile) {
    const wanted = keyOf(tile);
    if (tile.drawnKey === wanted) return;
    tile.button.dataset.pending = '1';
    if (!queue.includes(tile)) queue.push(tile);
    schedule();
  }

  function schedule() {
    if (frameHandle || queue.length === 0) return;
    frameHandle = requestAnimationFrame(drainQueue);
  }

  function drainQueue() {
    frameHandle = 0;
    const mine = generation;
    const started = performance.now();

    // 중앙에서 가까운 셀 먼저
    queue.sort((a, b) => Math.abs(a.ox) + Math.abs(a.oy) - (Math.abs(b.ox) + Math.abs(b.oy)));

    while (queue.length > 0) {
      const tile = queue.shift();
      if (generation !== mine) return;
      draw(tile);
      if (performance.now() - started > FRAME_BUDGET_MS) break;
    }

    if (queue.length > 0) schedule();
  }

  function draw(tile) {
    const key = keyOf(tile);
    tile.ctx.putImageData(
      renderer.imageDataFor(state.tier, state.locality, tile.worldX, tile.worldY),
      0,
      0,
    );
    tile.drawnKey = key;
    tile.button.dataset.pending = '0';
  }

  /** 중앙 셀은 큐를 기다리지 않고 즉시 그린다. */
  function drawCenterNow() {
    const center = tiles.find(tile => tile.ox === 0 && tile.oy === 0);
    if (center) {
      refreshWorld(center);
      draw(center);
      queue = queue.filter(tile => tile !== center);
    }
  }

  // ── 위치 변경 ───────────────────────────────────────────

  /** 전부 다시 배치하고 다시 그린다. 층/단계/순간이동에 쓴다. */
  function reset(next) {
    state = { ...state, ...next };
    generation++;
    queue = [];
    offsetX = 0;
    offsetY = 0;
    applyTransform();

    for (const tile of tiles) {
      refreshWorld(tile);
      tile.drawnKey = null;
      place(tile);
    }
    drawCenterNow();
    for (const tile of tiles) enqueue(tile);
    onCenterChange?.(state.x, state.y);
  }

  /** 논리 좌표를 한 칸 단위로 옮긴다. 화면 밖 타일만 재활용한다. */
  function shift(dx, dy) {
    if (dx === 0 && dy === 0) return;
    const bits = axisBits();
    state.x = wrap(state.x + BigInt(dx), bits);
    state.y = wrap(state.y + BigInt(dy), bits);

    for (const tile of tiles) {
      tile.ox -= dx;
      tile.oy -= dy;
      let recycled = false;
      while (tile.ox < -HALF_X) {
        tile.ox += POOL_COLS;
        recycled = true;
      }
      while (tile.ox > HALF_X) {
        tile.ox -= POOL_COLS;
        recycled = true;
      }
      while (tile.oy < -HALF_Y) {
        tile.oy += POOL_ROWS;
        recycled = true;
      }
      while (tile.oy > HALF_Y) {
        tile.oy -= POOL_ROWS;
        recycled = true;
      }
      refreshWorld(tile);
      place(tile);
      if (recycled) tile.drawnKey = null;
      enqueue(tile);
    }
    onCenterChange?.(state.x, state.y);
  }

  /** 픽셀 단위 이동을 누적하고, 한 칸을 넘으면 논리 좌표를 옮긴다. */
  function pan(dx, dy) {
    offsetX += dx;
    offsetY += dy;

    const halfW = cellWidth() / 2;
    const halfH = cellHeight() / 2;
    let stepX = 0;
    let stepY = 0;

    while (offsetX > halfW) {
      offsetX -= cellWidth();
      stepX -= 1;
    }
    while (offsetX < -halfW) {
      offsetX += cellWidth();
      stepX += 1;
    }
    while (offsetY > halfH) {
      offsetY -= cellHeight();
      stepY -= 1;
    }
    while (offsetY < -halfH) {
      offsetY += cellHeight();
      stepY += 1;
    }

    applyTransform();
    if (stepX || stepY) shift(stepX, stepY);
  }

  // ── 입력 ────────────────────────────────────────────────

  element.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: 0 };
    element.setPointerCapture(event.pointerId);
    element.classList.add('dragging');
  });

  element.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    if (dx || dy) pan(dx, dy);
  });

  function endDrag(event) {
    if (!drag || drag.id !== event.pointerId) return;
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    // 끌었으면 클릭으로 취급하지 않는다
    const moved = drag.moved;
    drag = null;
    element.classList.remove('dragging');
    if (moved > 6) {
      const swallow = e => e.stopPropagation();
      element.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => element.removeEventListener('click', swallow, { capture: true }), 0);
    }
  }
  element.addEventListener('pointerup', endDrag);
  element.addEventListener('pointercancel', endDrag);
  element.addEventListener('lostpointercapture', endDrag);

  element.addEventListener(
    'wheel',
    event => {
      event.preventDefault();
      pan(-event.deltaX, -event.deltaY);
    },
    { passive: false },
  );

  element.addEventListener('keydown', event => {
    const map = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      a: [-1, 0],
      d: [1, 0],
      w: [0, -1],
      s: [0, 1],
    };
    const move = map[event.key];
    if (!move) return;
    event.preventDefault();
    const scale = event.shiftKey ? 5 : 1;
    shift(move[0] * scale, move[1] * scale);
  });

  return {
    reset,
    shift,
    get position() {
      return [state.x, state.y];
    },
    get viewSize() {
      return { cols: VIEW_COLS, rows: VIEW_ROWS, pool: tiles.length };
    },
    /** 캐시를 비운 뒤 강제로 다시 그린다. 결정성 확인용. */
    redrawAll() {
      generation++;
      queue = [];
      for (const tile of tiles) tile.drawnKey = null;
      drawCenterNow();
      for (const tile of tiles) enqueue(tile);
    },
  };
}
