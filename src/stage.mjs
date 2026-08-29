// 전시장 — 캔버스 한 장에 격자를 그린다
//
// 요구사항 3장 · 11장.
//   전시물마다 캔버스를 두면 줌아웃에서 배후 버퍼가 표시 개수만큼 늘어나
//   휴대폰에서 죽는다. 그래서 화면 크기 캔버스 한 장에 캐시된 비트맵을 찍는다.
//   메모리가 표시 개수와 무관해진다.
//
// 이 파일이 정하는 것
//   무엇이 보이는가 · 무엇을 먼저 준비할 것인가 · 어디에 찍을 것인가
// 이 파일이 정하지 않는 것
//   어떻게 가져오는가 (tiles) · 어디를 보는가 (camera)

import { visibleCells, worldToScreen } from './camera.mjs';
import { tileKey } from './tiles.mjs';
import { wrap } from './codec.mjs';

/** 전시물 사이의 벽. 한 변에 대한 비율. */
const GAP = 0.06;

/** 이 크기를 넘으면 얇은 액자선이 생긴다. */
const FRAME_AT = 200;

/** 고른 것 외를 덮는 정도. */
const DIM_ALPHA = 0.68;

export function createStage({ canvas, camera, tiles, wall = '#12100e' }) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const view = { width: 0, height: 0, dpr: 1 };
  let world = { tier: 8, locality: 4, baseX: 0n, baseY: 0n, axisBits: 812 };
  let dim = 0;
  let focus = null; // { i, j }
  let velocity = { x: 0, y: 0 };

  function resize() {
    const rect = canvas.getBoundingClientRect();
    view.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    view.width = rect.width;
    view.height = rect.height;
    canvas.width = Math.max(1, Math.round(rect.width * view.dpr));
    canvas.height = Math.max(1, Math.round(rect.height * view.dpr));
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    camera.setViewport(view.width, view.height);
  }

  /** 셀 번호 → 세계 좌표. 축 크기로 감싸므로 경계 처리가 따로 없다. */
  function coordOf(i, j) {
    return [
      wrap(world.baseX + BigInt(i), world.axisBits),
      wrap(world.baseY + BigInt(j), world.axisBits),
    ];
  }

  function keyOf(i, j) {
    const [x, y] = coordOf(i, j);
    return tileKey(world.tier, world.locality, x, y);
  }

  /**
   * 지금 필요한 목록. 앞쪽이 급한 것이다.
   *
   * 화면 중심에서 가까운 순서로 놓되, 끌고 있는 방향으로는 거리를 깎아 준다.
   * 그래서 가고 있는 쪽이 먼저 그려진다.
   */
  /**
   * zoom 을 넘기면 그 줌에서 보일 범위로 계산한다.
   *
   * 개방 전 미리 렌더가 이것을 쓴다. 개방은 줌인에서 시작해 줌아웃으로 끝나므로,
   * 지금 줌(줌인)으로 계산하면 끝난 뒤에 필요한 칸이 준비되지 않는다.
   * 실제로 그 버그가 있었다. 개방이 끝난 화면에 빈 칸이 남았다.
   */
  function wishlist(margin, zoom = camera.zoom) {
    const halfW = view.width / 2 / zoom;
    const halfH = view.height / 2 / zoom;
    const i0 = Math.floor(camera.x - halfW) - margin;
    const i1 = Math.ceil(camera.x + halfW) + margin;
    const j0 = Math.floor(camera.y - halfH) - margin;
    const j1 = Math.ceil(camera.y + halfH) + margin;
    const speed = Math.hypot(velocity.x, velocity.y);
    const ux = speed > 1e-3 ? velocity.x / speed : 0;
    const uy = speed > 1e-3 ? velocity.y / speed : 0;
    const lead = Math.min(3, speed * 0.35);

    const out = [];
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = i - camera.x;
        const dy = j - camera.y;
        const cost = Math.hypot(dx, dy) - lead * (dx * ux + dy * uy) * 0.5;
        const [x, y] = coordOf(i, j);
        out.push({ key: tileKey(world.tier, world.locality, x, y), i, j, x, y, cost, tier: world.tier, locality: world.locality });
      }
    }
    out.sort((a, b) => a.cost - b.cost);
    return out;
  }

  /**
   * 캐시에 담기는 범위까지만 미리 렌더한다.
   *
   * 왜 필요한가
   *   줌아웃 끝에서는 보이는 것만으로도 캐시의 대부분을 쓴다. 거기에 바깥 두 겹을
   *   더하면 목록이 캐시보다 커져서 **영원히 일부가 없는 상태**가 된다.
   *   그러면 missing 이 0 이 안 되고, 매 프레임 다시 그리고 다시 요청한다.
   *   화면은 멀쩡해 보이지만 배터리를 태운다. 실측으로 발견했다.
   *   (데스크톱 최소 줌에서 보이는 것만 165장, 캐시는 180장이었다.)
   */
  function affordableMargin(wanted) {
    const budget = tiles.capacity * 0.9;
    const cols = Math.ceil(view.width / camera.zoom) + 1;
    const rows = Math.ceil(view.height / camera.zoom) + 1;
    for (let margin = wanted; margin > 0; margin--) {
      if ((cols + margin * 2) * (rows + margin * 2) <= budget) return margin;
    }
    return 0;
  }

  function paintCell(item) {
    const bitmap = tiles.get(item.key);
    if (!bitmap) return false;

    const inner = camera.zoom * (1 - GAP);
    const [sx, sy] = worldToScreen(camera, item.i, item.j, view.width, view.height);
    const left = sx - inner / 2;
    const top = sy - inner / 2;

    ctx.drawImage(bitmap, left, top, inner, inner);

    if (inner > FRAME_AT) {
      ctx.strokeStyle = 'rgba(239,233,221,0.16)';
      ctx.lineWidth = 1;
      ctx.strokeRect(left + 0.5, top + 0.5, inner - 1, inner - 1);
    }
    return true;
  }

  return {
    resize,
    get view() {
      return { ...view };
    },
    get world() {
      return { ...world };
    },

    setWorld(next) {
      world = { ...world, ...next };
    },

    setFocus(cell) {
      focus = cell;
    },
    get focus() {
      return focus;
    },

    setDim(value) {
      dim = value;
    },

    /** 끌기 속도를 알려 준다. 미리 렌더의 방향이 여기서 나온다. */
    setVelocity(vx, vy) {
      velocity = { x: vx, y: vy };
    },

    /** 화면 좌표 → 셀 번호. 탭이 어느 전시물인지 알아낸다. */
    cellAt(screenX, screenY) {
      return [
        Math.round(camera.x + (screenX - view.width / 2) / camera.zoom),
        Math.round(camera.y + (screenY - view.height / 2) / camera.zoom),
      ];
    },

    coordOf,
    keyOf,

    /**
     * 한 프레임 그린다. 아직 없는 것은 벽으로 남는다.
     *
     * 커튼이 렌더를 기다린 뒤 열리므로 사용자는 빈 칸을 거의 보지 않는다.
     * 손으로 빠르게 끌 때만 잠깐 보인다.
     */
    draw({ prefetch = 1, request = true } = {}) {
      ctx.fillStyle = wall;
      ctx.fillRect(0, 0, view.width, view.height);

      // 구역이 32px 이라 축소해도 경계가 살아 있다. 최근접이 훨씬 선명하다.
      ctx.imageSmoothingEnabled = false;

      const list = wishlist(affordableMargin(prefetch));
      // 순위를 먼저 알린다. 이것이 없으면 캐시가 무엇을 지킬지 모른다.
      if (request) tiles.want(list);
      else tiles.keep(list);

      let missing = 0;
      for (const item of list) {
        if (!paintCell(item)) missing++;
      }

      if (dim > 0.01 && focus) {
        ctx.fillStyle = `rgba(18,16,14,${DIM_ALPHA * dim})`;
        ctx.fillRect(0, 0, view.width, view.height);
        const [x, y] = coordOf(focus.i, focus.j);
        paintCell({
          key: tileKey(world.tier, world.locality, x, y),
          i: focus.i,
          j: focus.j,
        });
      }

      return missing;
    },

    /**
     * 커튼 뒤에서 미리 렌더한다. 다 준비되면 resolve 한다.
     *
     * 목표 줌에서 보일 것을 기준으로 삼는다. 그래서 개방이 끝나는 순간에
     * 빈 칸이 없다.
     */
    /** 지금 미리 렌더가 몇 겹까지 되는가. 개발자 패널이 본다. */
    marginFor: affordableMargin,

    preheat({ timeout = 6000, zoom } = {}) {
      return new Promise(resolve => {
        const started = performance.now();
        const tick = () => {
          const list = wishlist(0, zoom);
          const need = list.filter(item => !tiles.has(item.key));
          if (need.length === 0 || performance.now() - started > timeout) {
            resolve(need.length);
            return;
          }
          tiles.want(list);
          requestAnimationFrame(tick);
        };
        tick();
      });
    },
  };
}
