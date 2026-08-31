// 미니맵 — 좌상단의 작은 지도
//
// 색을 어디서 얻는지는 `src/minimap.mjs` 에 적어 두었다. 이 파일은 그 색을
// 화면에 놓는 일만 한다.
//
// ── 층과 로비가 다르게 보인다 ────────────────────────────────────────────
//
// 작품 층에서는 **지금 칸을 가운데 둔 33x33 창**이다. 층은 끝이 없으므로(순환)
// 전체를 담을 수 없고, 담아도 한 점이 되어 아무것도 알려 주지 않는다.
//
// 로비와 체험관에서는 **방 전체(64x64)**를 담는다. 담을 수 있는 크기이고, 로비에서
// 알고 싶은 것은 "지금 색이 어떤가" 가 아니라 "표지와 문이 어디 있는가" 이기
// 때문이다. 그래서 벽 색 위에 물건을 네모로 찍는다.
//
// ── 왜 캔버스를 두 장 쓰는가 ────────────────────────────────────────────
//
// 칸 색은 span x span (33px) 짜리 작은 그림이다. 그것을 그대로 크게 그리면
// 브라우저가 부드럽게 보간해서 칸 경계가 뭉갠다. 작은 캔버스에 원본을 두고
// `imageSmoothingEnabled = false` 로 확대하면 칸이 칸으로 보인다.

import {
  createMinimapColours,
  MINIMAP_SPAN,
  MINIMAP_MODES,
  MINIMAP_SCALES,
  spanFor,
} from '../minimap.mjs';
import { LOBBY_SPAN, LOBBY_WALL } from '../lobby.mjs';
import { isLobbyTier } from '../codec.mjs';
import { t, onLanguageChange } from '../i18n/index.mjs';

/** 지금 자리를 나타내는 고리의 색. 어느 그림 위에서도 보이게 흰색이다. */
const HERE = 'rgba(255, 255, 255, 0.92)';

/** 화면에 보이는 범위를 나타내는 네모. */
const VIEW = 'rgba(255, 255, 255, 0.5)';

/** 로비에 놓인 물건의 색. 벽보다 밝게 둔다. */
const OBJECT = 'rgba(233, 226, 214, 0.78)';

/**
 * 미니맵을 만든다.
 *
 * `onOpen` 은 눌렀을 때 부른다. 지도는 그림이 아니라 버튼이다 — 팜플렛을 펼치는
 * 손잡이다.
 */
/** 고른 방식과 배율을 기억하는 자리. 다음에 와도 같은 지도를 본다. */
const STORE_KEY = 'babel.minimap.mode';
const STORE_SCALE = 'babel.minimap.scale';

export function createMinimap({ root, button, onOpen }) {
  const canvas = button.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const colours = createMinimapColours();

  // 칸 색 원본. 확대는 그릴 때 한다.
  const source = document.createElement('canvas');
  const sourceCtx = source.getContext('2d');

  let last = null;
  let painted = 0;
  let spent = 0;
  let size = 0;
  let mode = 'colour';
  let scale = 1;
  // 마지막으로 받은 갱신 인자. 방식·배율이 바뀌면 이것으로 곧바로 다시 그린다.
  let latest = null;

  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (MINIMAP_MODES.includes(saved)) mode = saved;
    const savedScale = Number(localStorage.getItem(STORE_SCALE));
    if (MINIMAP_SCALES.includes(savedScale)) scale = savedScale;
  } catch {
    // 저장소를 막아 둔 브라우저가 있다. 기본값으로 간다.
  }

  const modeButton = root?.querySelector('#minimap-mode') ?? null;
  const outButton = root?.querySelector('#minimap-out') ?? null;
  const inButton = root?.querySelector('#minimap-in') ?? null;
  const scaleLabel = root?.querySelector('#minimap-scale') ?? null;

  /** 저장소에 적어 둔다. 막혀 있어도 이번 관람 동안은 유지된다. */
  function remember(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch {
      /* 막아 둔 브라우저가 있다 */
    }
  }

  /** 조작 줄의 글자와 눌림 가능 여부를 지금 상태에 맞춘다. */
  function renderBar() {
    if (modeButton) modeButton.textContent = t(`minimap.mode.${mode}`);
    if (scaleLabel) scaleLabel.textContent = scale === 1 ? '1×' : `${scale}×`;
    // 배율의 끝에서는 눌러도 할 일이 없다. 눌리지 않는 것으로 그것을 알린다.
    if (outButton) outButton.disabled = scale <= MINIMAP_SCALES[0];
    if (inButton) inButton.disabled = scale >= MINIMAP_SCALES[MINIMAP_SCALES.length - 1];
  }

  /** 배율을 목록에서 한 칸 옮긴다. */
  function nudge(direction) {
    const at = MINIMAP_SCALES.indexOf(scale);
    const next = MINIMAP_SCALES[Math.min(MINIMAP_SCALES.length - 1, Math.max(0, at + direction))];
    if (next === scale) return;
    scale = next;
    remember(STORE_SCALE, scale);
    renderBar();
    repaint();
  }

  button.addEventListener('click', () => onOpen?.());

  // 방식을 돌린다. 두 가지뿐이라 목록을 열 이유가 없다 — 누르면 바뀐다.
  modeButton?.addEventListener('click', () => {
    const at = MINIMAP_MODES.indexOf(mode);
    setMode(MINIMAP_MODES[(at + 1) % MINIMAP_MODES.length]);
    renderBar();
  });
  // 넓게 보기 · 좁게 보기. 배율이 클수록 좁은 곳을 크게 본다.
  outButton?.addEventListener('click', () => nudge(-1));
  inButton?.addEventListener('click', () => nudge(1));

  /** 방식을 갈아 끼운다. 밖에서도 부른다(검사·자). */
  function setMode(next) {
    if (!MINIMAP_MODES.includes(next) || next === mode) return;
    mode = next;
    remember(STORE_KEY, next);
    repaint();
  }

  onLanguageChange(renderBar);
  renderBar();

  /**
   * 그릴 면적을 화면 배율에 맞춘다. 안 맞추면 흐릿해진다.
   *
   * **프레임마다 부르면 안 된다.** getBoundingClientRect 는 배치를 강제로
   * 계산하게 만든다. 창 크기가 바뀔 때만 부른다.
   */
  function fit() {
    const rect = button.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const next = Math.max(1, Math.round(rect.width * dpr));
    size = next;
    if (canvas.width !== next || canvas.height !== next) {
      canvas.width = next;
      canvas.height = next;
      last = null; // 크기가 바뀌었으니 다시 그린다
    }
    return size;
  }

  fit();

  /** 칸 색을 확대해 채운다. 작품 층에서 쓴다. */
  function paintCells(size, cells) {
    if (source.width !== cells.span) {
      source.width = cells.span;
      source.height = cells.span;
    }
    sourceCtx.putImageData(new ImageData(cells.rgba, cells.span, cells.span), 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source, 0, 0, cells.span, cells.span, 0, 0, size, size);
  }

  /** 벽 위에 물건을 찍는다. 로비와 체험관에서 쓴다. */
  function paintRoom(size, objects) {
    ctx.fillStyle = LOBBY_WALL;
    ctx.fillRect(0, 0, size, size);

    const scale = size / Number(LOBBY_SPAN);
    ctx.fillStyle = OBJECT;
    for (const object of objects) {
      const side = Math.max(2, object.size * scale);
      ctx.fillRect(object.x * scale - side / 2, object.y * scale - side / 2, side, side);
    }
  }

  /**
   * 지도를 갱신한다. 중앙 칸이 바뀔 때와 줌이 눈에 띄게 바뀔 때만 부른다.
   *
   * `across` 는 화면에 보이는 칸 수다. 보이는 범위를 네모로 그리는 데 쓴다.
   * 지도 안에서 내가 어느 만큼을 보고 있는지가 없으면 축척을 알 수 없다.
   */
  function update(args) {
    latest = args;
    const { tier, locality, x, y, across = 0, cell = null, objects = [] } = args;
      const lobby = isLobbyTier(tier);

      // 열쇠에 좌표를 **문자열로 넣지 않는다.** 층 32의 좌표를 십진으로 바꾸는
      // 데 0.4ms 가 들고, 그것을 프레임마다 태워 미술관을 멈춰 세운 적이 있다.
      // 칸 번호(cell)로 견준다 — 좌표가 바뀌면 칸도 바뀐다.
      const key = lobby
        ? `L:${cell?.i},${cell?.j}:${objects.length}:${size}`
        : `${tier}:${locality}:${cell?.i},${cell?.j}:${mode}:${scale}:${Math.round(across * 2)}:${size}`;
      if (key === last) return;
      last = key;

      const started = performance.now();
      ctx.clearRect(0, 0, size, size);

      // 지도가 덮는 칸 수. 로비는 방 전체이고, 작품 층은 배율이 정한다.
      let covers = Number(LOBBY_SPAN);
      if (lobby) {
        paintRoom(size, objects);
      } else {
        const cells = colours.cells({ tier, locality, x, y, span: spanFor(scale), mode });
        covers = cells.covers;
        paintCells(size, cells);
      }

      // 보이는 범위. 지도의 한 칸이 몇 px 인지에서 나온다.
      const perCell = size / covers;
      const middle = lobby ? { x: Number(x) * perCell, y: Number(y) * perCell } : { x: size / 2, y: size / 2 };

      if (across > 0) {
        const side = Math.min(size, across * perCell);
        ctx.strokeStyle = VIEW;
        ctx.lineWidth = Math.max(1, perCell * 0.12);
        ctx.strokeRect(middle.x - side / 2, middle.y - side / 2, side, side);
      }

      // 지금 자리. 보이는 범위가 지도를 꽉 채워도 이것은 보여야 한다.
      ctx.fillStyle = HERE;
      const dot = Math.max(2.5, perCell * 0.55);
      ctx.beginPath();
      ctx.arc(middle.x, middle.y, dot, 0, Math.PI * 2);
      ctx.fill();

    painted++;
    spent += performance.now() - started;
    if (cell) button.dataset.cell = `${cell.i},${cell.j}`;
  }

  /**
   * 방식이나 배율이 바뀌었을 때 **곧바로** 다시 그린다.
   *
   * 이것이 없으면 단추를 눌러도 지도가 그대로다. 갱신은 칸이 바뀔 때만 오므로,
   * 걸어 나가기 전까지 아무 일도 일어나지 않는다. 눌렀는데 아무 일이 없으면
   * 단추가 고장난 것으로 읽힌다.
   */
  function repaint() {
    last = null;
    if (latest) update(latest);
  }

  return {
    update,

    /** 층을 옮길 때 부른다. 기억한 색을 버린다. */
    reset() {
      colours.clear();
      last = null;
    },

    /** 창 크기가 바뀌었을 때만 부른다. 배치를 강제로 계산하게 만든다. */
    resize() {
      fit();
    },

    get mode() {
      return mode;
    },

    get scale() {
      return scale;
    },

    /** 검사와 자가 배율을 직접 준다. */
    setScale(next) {
      if (!MINIMAP_SCALES.includes(next) || next === scale) return;
      scale = next;
      remember(STORE_SCALE, scale);
      renderBar();
      repaint();
    },

    /** 밖에서 방식을 갈아 끼운다(검사·자). 조작 줄도 함께 맞춘다. */
    setMode(next) {
      setMode(next);
      renderBar();
    },

    /**
     * 화면 검사가 보는 값.
     *
     * `spent` 는 지도를 그리는 데 쓴 시간의 합이다. 프레임 예산을 먹고 있는지
     * 사람이 눈으로 알 수 없어서 숫자로 내놓는다.
     */
    get stats() {
      return {
        painted,
        cached: colours.size,
        mode,
        scale,
        span: spanFor(scale),
        spent: Math.round(spent * 10) / 10,
      };
    },
  };
}
