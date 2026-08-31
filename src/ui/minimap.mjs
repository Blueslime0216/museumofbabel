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

import { createMinimapColours, MINIMAP_SPAN } from '../minimap.mjs';
import { LOBBY_SPAN, LOBBY_WALL } from '../lobby.mjs';
import { isLobbyTier } from '../codec.mjs';

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
export function createMinimap({ button, onOpen }) {
  const canvas = button.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const colours = createMinimapColours();

  // 칸 색 원본. 확대는 그릴 때 한다.
  const source = document.createElement('canvas');
  const sourceCtx = source.getContext('2d');

  let last = null;
  let painted = 0;

  button.addEventListener('click', () => onOpen?.());

  /** 그릴 면적을 화면 배율에 맞춘다. 안 맞추면 흐릿해진다. */
  function fit() {
    const rect = button.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const size = Math.max(1, Math.round(rect.width * dpr));
    if (canvas.width !== size || canvas.height !== size) {
      canvas.width = size;
      canvas.height = size;
      last = null; // 크기가 바뀌었으니 다시 그린다
    }
    return canvas.width;
  }

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

  return {
    /**
     * 지도를 갱신한다. 중앙 칸이 바뀔 때와 줌이 눈에 띄게 바뀔 때만 부른다.
     *
     * `across` 는 화면에 보이는 칸 수다. 보이는 범위를 네모로 그리는 데 쓴다.
     * 지도 안에서 내가 어느 만큼을 보고 있는지가 없으면 축척을 알 수 없다.
     */
    update({ tier, locality, x, y, across = 0, cell = null, objects = [] }) {
      const size = fit();
      const lobby = isLobbyTier(tier);
      // 로비에서는 물건이 자리를 옮기지 않으므로 개수만 봐도 충분하다.
      const key = lobby
        ? `L:${x},${y}:${objects.length}:${size}`
        : `${tier}:${locality}:${x},${y}:${Math.round(across * 4)}:${size}`;
      if (key === last) return;
      last = key;

      ctx.clearRect(0, 0, size, size);

      if (lobby) {
        paintRoom(size, objects);
      } else {
        paintCells(size, colours.cells({ tier, locality, x, y }));
      }

      // 보이는 범위. 지도의 한 칸이 몇 px 인지에서 나온다.
      const span = lobby ? Number(LOBBY_SPAN) : MINIMAP_SPAN;
      const perCell = size / span;
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
      if (cell) button.dataset.cell = `${cell.i},${cell.j}`;
    },

    /** 층을 옮길 때 부른다. 기억한 색을 버린다. */
    reset() {
      colours.clear();
      last = null;
    },

    /** 화면 검사가 보는 값. 몇 번 그렸는지로 갱신이 도는지 확인한다. */
    get stats() {
      return { painted, cached: colours.size };
    },
  };
}
