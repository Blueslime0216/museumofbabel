// 카메라 — 목표값 하나와 그것을 임계 감쇠로 따라가는 상태 하나
//
// 요구사항 5장.
//   탭 포커스 · 방향키 · 무작위 점프 · 개방 줌아웃 · 경계 탄성이 모두
//   "카메라를 어디로 옮긴다" 는 같은 일이다. 각각을 별도 애니메이션으로 만들면
//   서로 겹칠 때 튄다. 특히 방향키를 연달아 누르거나 반대로 꺾는 경우다.
//
//   그래서 입력은 목표값만 바꾼다. 대각선 · 급반전 · 연타가 별도 처리 없이
//   자연스럽게 이어진다. "애니메이션 충돌" 이라는 개념 자체가 없다.
//
// 단위
//   x · y   셀 단위의 실수. 정수면 그 전시물의 정중앙이다
//   zoom    전시물 한 변의 화면 크기(CSS px). 256 이면 1:1
//
// DOM 을 모른다. 그래서 Node 에서 그대로 테스트한다.

/** 셀 하나의 원본 크기. 코덱의 CANVAS 와 같지만 여기서는 단위일 뿐이다. */
export const CELL_SOURCE = 256;

/** 전시물 한 변이 이보다 작아지지 않는다. 엄지로 누를 수 있는 크기를 넘겨 둔다. */
export const MIN_CELL = 56;

/** 화면 짧은 쪽에 대한 최대 비율. 한 장이 화면을 거의 채운다. */
export const MAX_CELL_RATIO = 0.9;

/**
 * 한 화면에 동시에 표시할 전시물의 상한.
 *
 * 이것이 줌아웃의 실제 한계를 정한다. 비트맵 하나가 256KB 이므로 표시 개수가
 * 캐시 상한을 넘으면 타일이 서로를 밀어내고 빈 칸이 생긴다.
 * 요구사항 11장의 "휴대폰 100 · PC 150" 을 이 하나로 지킨다.
 */
export const MAX_VISIBLE = 130;

/** 임계 감쇠의 빠름. 클수록 빨리 따라붙는다. */
const RATE = 11;

/** 이보다 가까우면 도착한 것으로 본다. */
const EPSILON = { pos: 1e-4, zoom: 1e-3 };

function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

/** 1 - e^(-rate·dt). 프레임 간격이 흔들려도 결과가 같다. */
function approach(current, target, dt, rate = RATE) {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

export function createCamera({ x = 0, y = 0, zoom = 120 } = {}) {
  const now = { x, y, zoom };
  const goal = { x, y, zoom };
  let bounds = { min: MIN_CELL, max: 512 };

  return {
    get x() {
      return now.x;
    },
    get y() {
      return now.y;
    },
    get zoom() {
      return now.zoom;
    },
    get target() {
      return { ...goal };
    },
    get settled() {
      return (
        Math.abs(now.x - goal.x) < EPSILON.pos &&
        Math.abs(now.y - goal.y) < EPSILON.pos &&
        Math.abs(now.zoom - goal.zoom) < EPSILON.zoom
      );
    },

    /**
     * 화면 크기가 정해지면 줌 한계가 정해진다.
     *
     * 최소 줌은 두 조건 중 큰 쪽이다.
     *   손가락으로 누를 수 있는 크기 (minCell)
     *   동시 표시 개수가 상한을 넘지 않는 크기 (maxVisible)
     * 넓은 화면에서는 두 번째가 이긴다. 그래야 큰 화면에서 타일이 서로를 밀어내지 않는다.
     *
     * `budget` 은 층별 정책이며 floors.mjs 가 정한다. 카메라는 그것이 어디서
     * 왔는지 모른다. 주지 않으면 층과 무관한 기본값을 쓴다.
     * 깊은 층은 한 장을 그리는 데 더 오래 걸리므로 상한이 낮아지고,
     * 그 결과 멀리 보지 못한다. 이유는 floors.mjs 에 적어 두었다.
     */
    setViewport(width, height, budget = null) {
      const maxVisible = budget?.maxVisible ?? MAX_VISIBLE;
      const minCell = budget?.minCell ?? MIN_CELL;
      const shorter = Math.max(1, Math.min(width, height));
      const byBudget = Math.sqrt((width * height) / maxVisible);
      const min = Math.max(minCell, byBudget);
      // 최대 줌은 층과 무관하게 고정이다. 한 점을 크게 보는 것은
      // 렌더 부담을 늘리지 않으므로 제한할 이유가 없다.
      bounds = { min, max: Math.max(min + 1, shorter * MAX_CELL_RATIO) };
      now.zoom = clamp(now.zoom, bounds.min, bounds.max);
      goal.zoom = clamp(goal.zoom, bounds.min, bounds.max);
    },

    get zoomBounds() {
      return { ...bounds };
    },

    /** 목표만 옮긴다. 카메라는 스스로 따라간다. */
    moveTo(nextX, nextY) {
      goal.x = nextX;
      goal.y = nextY;
    },

    zoomTo(nextZoom) {
      goal.zoom = clamp(nextZoom, bounds.min, bounds.max);
    },

    /** 손으로 끌 때. 목표와 현재를 함께 옮겨 지연을 없앤다. */
    dragBy(dx, dy) {
      now.x += dx;
      now.y += dy;
      goal.x = now.x;
      goal.y = now.y;
    },

    /**
     * 화면의 한 점을 붙잡은 채로 줌한다.
     *
     * 휠과 핀치가 모두 이것을 쓴다. 붙잡은 점이 움직이지 않아야 손과 맞는다.
     */
    zoomAround(nextZoom, screenX, screenY, width, height) {
      const from = now.zoom;
      const to = clamp(nextZoom, bounds.min, bounds.max);
      if (to === from) return;

      // 붙잡은 점의 세계 좌표는 줌 전후로 같아야 한다.
      const wx = now.x + (screenX - width / 2) / from;
      const wy = now.y + (screenY - height / 2) / from;
      now.zoom = to;
      now.x = wx - (screenX - width / 2) / to;
      now.y = wy - (screenY - height / 2) / to;
      goal.x = now.x;
      goal.y = now.y;
      goal.zoom = to;
    },

    /** 애니메이션 없이 곧바로 앉힌다. 암전 중 교체에 쓴다. */
    snapTo({ x: nx, y: ny, zoom: nz }) {
      if (nx !== undefined) now.x = goal.x = nx;
      if (ny !== undefined) now.y = goal.y = ny;
      if (nz !== undefined) {
        const z = clamp(nz, bounds.min, bounds.max);
        now.zoom = goal.zoom = z;
      }
    },

    /** 개방 애니메이션이 줌을 직접 몰 때. 목표까지 같이 옮겨 스프링과 싸우지 않는다. */
    forceZoom(value) {
      const z = clamp(value, bounds.min, bounds.max);
      now.zoom = z;
      goal.zoom = z;
    },

    /** 한 프레임. 움직였으면 true. */
    update(dt) {
      const before = { ...now };
      now.x = approach(now.x, goal.x, dt);
      now.y = approach(now.y, goal.y, dt);
      now.zoom = approach(now.zoom, goal.zoom, dt);

      if (Math.abs(now.x - goal.x) < EPSILON.pos) now.x = goal.x;
      if (Math.abs(now.y - goal.y) < EPSILON.pos) now.y = goal.y;
      if (Math.abs(now.zoom - goal.zoom) < EPSILON.zoom) now.zoom = goal.zoom;

      return (
        before.x !== now.x || before.y !== now.y || before.zoom !== now.zoom
      );
    },
  };
}

/** 화면 좌표 → 세계 좌표(셀 단위 실수). */
export function screenToWorld(camera, screenX, screenY, width, height) {
  return [
    camera.x + (screenX - width / 2) / camera.zoom,
    camera.y + (screenY - height / 2) / camera.zoom,
  ];
}

/** 세계 좌표 → 화면 좌표. */
export function worldToScreen(camera, worldX, worldY, width, height) {
  return [
    width / 2 + (worldX - camera.x) * camera.zoom,
    height / 2 + (worldY - camera.y) * camera.zoom,
  ];
}

/** 지금 화면에 보이는 셀 범위. 한 겹 여유를 준다. */
export function visibleCells(camera, width, height, margin = 1) {
  const halfW = width / 2 / camera.zoom;
  const halfH = height / 2 / camera.zoom;
  return {
    i0: Math.floor(camera.x - halfW) - margin,
    i1: Math.ceil(camera.x + halfW) + margin,
    j0: Math.floor(camera.y - halfH) - margin,
    j1: Math.ceil(camera.y + halfH) + margin,
  };
}
