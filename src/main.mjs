// 시작과 배선
//
// 여기에는 계산이 없다. 무엇을 언제 부르는지만 있다.
//
//   camera   어디를 보는가
//   curtain  자리를 옮길 때의 암전 → 교체 → 개방
//   stage    캔버스에 무엇을 어디에 찍는가
//   tiles    비트맵을 어떻게 가져오는가
//   theme    UI 무늬 (방문 하나 동안 유지)
//   hash     주소 읽기와 쓰기
//   sheet    고른 전시물의 정보

import { tierSpec, coordinatesToCode, localityMix, randomCoordinate } from './codec.mjs';
import { createCamera, MIN_CELL } from './camera.mjs';
import { createCurtainState, attachCurtain, PHASE } from './curtain.mjs';
import { createTiles, tileKey } from './tiles.mjs';
import { createStage } from './stage.mjs';
import { createInput } from './input.mjs';
import { readState, createHashWriter } from './hash.mjs';
import { applyTheme } from './theme.mjs';
import { createToasts } from './ui/toast.mjs';
import { createSheet } from './ui/sheet.mjs';
import { createHint } from './ui/hint.mjs';

/** 개방이 시작될 때의 줌 배율. 3×3 쯤이 보이는 상태에서 벌어진다. */
const OPEN_FROM = 1.85;

/** 방향키로 옮길 때 이 크기보다 작으면 감상할 수 있게 줌인해 준다. */
const READING_CELL = 150;

const canvas = document.getElementById('stage');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── 상태 ─────────────────────────────────────────────────────────────────

let state = readState();
let spec = tierSpec(state.tier);
let dirty = true;
let restZoom = 120;
let keyboardMode = false;

const camera = createCamera({ x: 0, y: 0, zoom: 120 });
const curtain = createCurtainState({ reducedMotion });
const paintCurtain = attachCurtain(document.getElementById('curtain'), curtain);
const hash = createHashWriter();
const toast = createToasts(document.getElementById('toasts'));
const hint = createHint(document.getElementById('hint'));

const tiles = createTiles({
  workerCount: navigator.hardwareConcurrency >= 8 ? 3 : 2,
  onArrive: key => {
    dirty = true;
    // 시트가 기다리던 그림이 도착했으면 채워 준다.
    if (wantedForSheet === key) {
      wantedForSheet = null;
      openSheetAt(sheetCell.i, sheetCell.j);
    }
  },
});

const stage = createStage({ canvas, camera, tiles });
const sheet = createSheet({ root: document.body, toast });

let wantedForSheet = null;
let sheetCell = { i: 0, j: 0 };

// ── 화면 크기 ────────────────────────────────────────────────────────────

/** 화면 크기에서 기본 줌을 정한다. 휴대폰에서 3열쯤 보인다. */
function computeRestZoom() {
  const { width, height } = stage.view;
  const shorter = Math.max(1, Math.min(width, height));
  return Math.max(MIN_CELL + 40, Math.min(164, shorter / 3.1));
}

function resize() {
  stage.resize();
  restZoom = computeRestZoom();
  if (curtain.phase === PHASE.CLEAR) camera.zoomTo(restZoom);
  dirty = true;
}

// ── 자리 옮기기 ──────────────────────────────────────────────────────────

function applyWorld() {
  spec = tierSpec(state.tier);
  stage.setWorld({
    tier: state.tier,
    locality: state.locality,
    baseX: state.x,
    baseY: state.y,
    axisBits: spec.axisBits,
  });
  camera.snapTo({ x: 0, y: 0 });
}

/**
 * 암전 → 교체 → 개방.
 *
 * 첫 진입은 이미 검은 화면이므로 암전을 건너뛴다.
 */
function goto(next, { first = false } = {}) {
  sheet.close();
  stage.setFocus(null);
  stage.setDim(0);

  const prepare = async () => {
    state = { ...state, ...next };
    applyWorld();
    camera.forceZoom(restZoom * OPEN_FROM);
    hash.set(state);
    hash.flush();
    // 개방이 끝난 뒤의 줌으로 준비한다. 지금 줌(줌인)으로 하면 열린 화면에
    // 빈 칸이 남는다. 실제로 그 버그가 있었다.
    await stage.preheat({ zoom: restZoom });
    dirty = true;
  };

  if (first) curtain.arrive(prepare, () => hint.show());
  else curtain.travel(prepare);
}

function jumpRandom() {
  const [x, y] = randomCoordinate(tierSpec(state.tier).axisBits);
  goto({ x, y });
}

// ── 전시물 고르기 ────────────────────────────────────────────────────────

function openSheetAt(i, j) {
  sheetCell = { i, j };
  const [x, y] = stage.coordOf(i, j);
  const key = tileKey(state.tier, state.locality, x, y);
  const bitmap = tiles.get(key);

  if (!bitmap) {
    // 아직 안 그려졌다. 도착하면 다시 부른다.
    wantedForSheet = key;
    tiles.want([{ key, i, j, x, y, tier: state.tier, locality: state.locality }]);
    return;
  }

  const code = coordinatesToCode(x, y, localityMix(state.locality, spec.axisBits), spec.axisBits);
  sheet.show({ tier: state.tier, locality: state.locality, x, y, code, bitmap });
}

function focusCell(i, j, { reading = false } = {}) {
  camera.moveTo(i, j);
  stage.setFocus({ i, j });
  stage.setDim(1);
  if (reading && camera.target.zoom < READING_CELL) camera.zoomTo(READING_CELL);
  openSheetAt(i, j);
  dirty = true;
}

// ── 입력 ─────────────────────────────────────────────────────────────────

const input = createInput({
  element: canvas,
  camera,
  stage,
  isBlocked: () => curtain.busy,
  onTap: (i, j) => {
    keyboardMode = false;
    document.body.dataset.keyboard = '0';
    focusCell(i, j);
  },
  // 카메라를 건드릴 때마다 다시 그린다. 이것이 없으면 드래그가 뚝뚝 끊긴다.
  onChange: () => {
    dirty = true;
  },
  onGestureEnd: () => {
    hash.flush();
    dirty = true;
  },
});

canvas.addEventListener('pointerdown', () => {
  hint.hide();
  sheet.collapse();
});

// ── 키보드 ───────────────────────────────────────────────────────────────

const ARROWS = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

window.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (sheet.escape()) {
      if (!sheet.open) {
        stage.setFocus(null);
        stage.setDim(0);
        dirty = true;
      }
      event.preventDefault();
    }
    return;
  }

  const move = ARROWS[event.key];
  if (move) {
    if (curtain.busy) return;
    event.preventDefault();
    hint.hide();
    keyboardMode = true;
    document.body.dataset.keyboard = '1';

    // 고른 것이 없으면 화면 중앙에서 출발한다.
    const from = stage.focus ?? { i: Math.round(camera.x), j: Math.round(camera.y) };
    focusCell(from.i + move[0], from.j + move[1], { reading: true });
    return;
  }

  if (event.key === 'r' || event.key === 'R') {
    if (event.metaKey || event.ctrlKey) return; // 새로고침을 막지 않는다
    jumpRandom();
  }
});

document.getElementById('btn-random').addEventListener('click', jumpRandom);
document.getElementById('btn-search').addEventListener('click', () => {
  toast('Find is coming next');
});
document.getElementById('btn-language').addEventListener('click', () => {
  toast('Language is coming next');
});

window.addEventListener('resize', resize);
window.addEventListener('hashchange', () => {
  const next = readState();
  if (!next.fromUrl) return;
  const same =
    next.tier === state.tier &&
    next.locality === state.locality &&
    next.x === state.x &&
    next.y === state.y;
  if (same) return;
  goto(next);
});

// ── 프레임 루프 ──────────────────────────────────────────────────────────

let last = performance.now();

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  input.update();
  curtain.update(dt);

  if (curtain.phase === PHASE.OPEN) {
    // 개방과 줌아웃이 한 몸으로 움직인다. 스프링과 싸우지 않게 직접 몬다.
    const t = curtain.openProgress;
    const eased = 1 - Math.pow(1 - t, 2.2);
    camera.forceZoom(restZoom * (OPEN_FROM + (1 - OPEN_FROM) * eased));
    dirty = true;
  } else if (camera.update(dt)) {
    dirty = true;
  }

  paintCurtain();

  if (dirty) {
    const prefetch = input.dragging ? 1 : 2;
    const missing = stage.draw({ prefetch });
    dirty = missing > 0 || !camera.settled;
  }

  if (curtain.phase === PHASE.CLEAR) {
    const [cx, cy] = stage.coordOf(Math.round(camera.x), Math.round(camera.y));
    hash.set({ ...state, x: cx, y: cy }, { paused: input.dragging || input.pinching });
  }

  requestAnimationFrame(frame);
}

// ── 시작 ─────────────────────────────────────────────────────────────────

applyTheme();
resize();
if (state.broken) toast('That address could not be read. Here is somewhere else.');
goto(state, { first: true });
requestAnimationFrame(frame);

// 개발용 손잡이. D5 의 ?debug=1 패널이 이 자리를 대신한다.
Object.assign(window, {
  __museum: {
    get state() {
      return { ...state, x: String(state.x), y: String(state.y) };
    },
    get camera() {
      return { x: camera.x, y: camera.y, zoom: camera.zoom, target: camera.target };
    },
    get tiles() {
      return tiles.stats;
    },
    get curtain() {
      return { phase: curtain.phase, open: curtain.openProgress, dim: curtain.dimProgress };
    },
    get sheet() {
      return { state: sheet.state, title: sheet.artwork?.info?.title ?? null };
    },
    get keyboardMode() {
      return keyboardMode;
    },
    jumpRandom,
    goto,
    focusCell,
  },
});
