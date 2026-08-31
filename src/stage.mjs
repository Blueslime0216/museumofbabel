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

import { worldToScreen } from './camera.mjs';
import { isLobbyTier } from './codec.mjs';
import { lobbyTilePhase } from './lobby.mjs';

/**
 * 로비 딸림표를 적기 시작하는 크기(화면 px).
 *
 * 물건이 이보다 작게 보이면 글자를 적지 않는다. 로비에는 물건이 서른 개 넘게
 * 있으므로, 작을 때도 적으면 화면이 읽을 수 없는 글자로 덮인다.
 */
const LABEL_AT = 92;

/** 전시물 사이의 벽. 한 변에 대한 비율. */
const GAP = 0.06;

/** 이 크기를 넘으면 얇은 액자선이 생긴다. */
const FRAME_AT = 200;

/** 고른 것 외를 덮는 정도. */
const DIM_ALPHA = 0.68;

/**
 * 고른 것이 한 걸음 앞으로 나온 만큼. 한 변에 대한 비율.
 *
 * 0.15 이면 안쪽 크기가 0.94 → 1.081 이 된다. 벽(GAP)을 메우고 옆 전시물을
 * 양쪽으로 4%씩 물고 들어간다. **그래서 고른 것을 반드시 옆 칸보다 나중에
 * 찍어야 한다.** draw 가 그 순서를 맡는다.
 *
 * 처음에 0.07 로 두었다 (벽을 겨우 메우는 정도). 눈으로 보고 키웠다.
 * 그 값에서는 어둡게 하기가 거의 다 일하고 크기는 티가 나지 않았다.
 */
const FOCUS_LIFT = 0.15;

/**
 * 고른 것 뒤에 지는 그림자.
 *
 * REACH 는 칸 간격(zoom)에 대한 비율이며 그림자가 퍼져 나가는 거리다.
 * 0.30 이면 옆 작품 여덟 장을 각각 3분의 1 정도 덮는다. 계산은 이렇다.
 *
 *   고른 것의 테두리   0.94 × 1.15 / 2 = 0.541 (칸 간격 기준)
 *   옆 작품의 앞 테두리 0.5 - 0.94 / 2 = 0.53
 *   옆 작품의 3분의 1   0.53 + 0.94 / 3 = 0.843
 *   필요한 거리         0.843 - 0.541 = 0.302
 *
 * 줌에 비례하게 두는 이유. 픽셀로 고정하면 줌아웃에서 그림자가 옆 작품을 다
 * 덮고 줌인에서는 사라진다. 화면에서 보이는 관계가 같아야 한다.
 *
 * ALPHA 는 그림자를 만드는 검정의 진하기다. 화면이 그만큼 어두워지지는 않는다.
 * 흐림이 계단을 뭉개므로 테두리 바로 옆에서도 절반쯤만 남는다. 실측으로는 옆
 * 작품이 가까이에서 4분의 1쯤 더 어두워진다.
 */
const SHADOW_REACH = 0.3;
const SHADOW_ALPHA = 0.8;

/** 커지고 작아지는 빠름. 어둡게 하기보다 조금 빠르게 둔다. */
const LIFT_RATE = 13;
const DIM_RATE = 9;

/** 이보다 가까우면 도착한 것으로 본다. camera.mjs 와 같은 방식이다. */
const EPSILON = 0.002;

/** 1 - e^(-rate·dt). 프레임 간격이 흔들려도 결과가 같다. */
function approach(current, target, dt, rate) {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

export function createStage({ canvas, camera, tiles, zoomBudgetFor = null, wall = '#12100e', reducedMotion = false }) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const view = { width: 0, height: 0, dpr: 1 };
  let world = { tier: 8, locality: 4, baseX: 0n, baseY: 0n, axisBits: 812 };
  let axisMask = (1n << 812n) - 1n;

  /**
   * 지금 어느 미술관을 보고 있는가. 캐시 키의 앞자리다.
   *
   * 자리를 옮기면 올라간다. 그래서 옛 미술관의 키와 절대 겹치지 않는다.
   */
  let worldId = 0;

  let focus = null; // { i, j }
  let velocity = { x: 0, y: 0 };

  // ── 고른 것의 애니메이션 ─────────────────────────────────────────────
  //
  // 어둡게 하기와 앞으로 나오기를 둘 다 여기서 몬다. 목표값을 두고 임계 감쇠로
  // 따라가는 방식이며 카메라와 같다. 그래서 연타와 급반전이 자연히 이어진다.
  //
  // 앞으로 나온 정도를 칸마다 따로 둔다. 옮기는 순간에는 **두 칸이 동시에**
  // 움직여야 하기 때문이다. 떠난 칸은 줄어들고 새 칸은 커진다. 하나만 두면
  // 떠난 칸이 툭 하고 제자리로 돌아간다.
  let dimNow = 0;
  let dimGoal = 0;
  const lift = new Map(); // "i,j" → { i, j, value }

  const cellId = (i, j) => `${i},${j}`;

  /**
   * 로비에 놓인 물건. 격자가 아니라 실수 좌표에 얹힌다.
   *
   * 비어 있으면(작품 층) 아래 계산이 전부 건너뛰어진다.
   */
  let lobbyObjects = [];

  /**
   * 지금 화면에 보이는 물건의 자리들.
   *
   * 로비는 축이 작아서(64칸) 화면에 **같은 물건이 여러 번** 보일 수 있다. 순환
   * 공간이므로 그것이 맞다 — 한 방향으로 걸으면 같은 로고를 다시 만난다.
   * 그래서 한 물건이 여러 자리를 낸다.
   *
   * 그리는 쪽과 누르는 쪽이 **이 함수를 함께 쓴다.** 따로 계산하면 보이는 자리와
   * 눌리는 자리가 어긋난다.
   */
  function lobbyPlacements() {
    if (lobbyObjects.length === 0) return [];

    const span = Number(axisMask) + 1;
    // 화면 i=0 이 가리키는 좌표. coordOf 와 같은 규약이다.
    const baseX = Number(world.baseX & axisMask);
    const baseY = Number(world.baseY & axisMask);

    const halfW = view.width / 2 / camera.zoom;
    const halfH = view.height / 2 / camera.zoom;
    const left = camera.x - halfW;
    const right = camera.x + halfW;
    const top = camera.y - halfH;
    const bottom = camera.y + halfH;

    const placements = [];
    for (const object of lobbyObjects) {
      // 물건의 좌표를 화면 칸 번호로. 한 주기 안으로 접어 둔다.
      let ix = (object.x - baseX) % span;
      if (ix < 0) ix += span;
      let iy = (object.y - baseY) % span;
      if (iy < 0) iy += span;

      const half = object.size / 2;
      const kFrom = Math.floor((left - ix - half) / span);
      const kTo = Math.ceil((right - ix + half) / span);
      const mFrom = Math.floor((top - iy - half) / span);
      const mTo = Math.ceil((bottom - iy + half) / span);

      for (let k = kFrom; k <= kTo; k++) {
        for (let m = mFrom; m <= mTo; m++) {
          placements.push({ object, wx: ix + k * span, wy: iy + m * span });
        }
      }
    }
    return placements;
  }

  /** 물건을 바닥 위에 얹는다. 그림이 아직 없는 것은 건너뛴다. */
  function paintLobbyObjects() {
    for (const { object, wx, wy } of lobbyPlacements()) {
      if (!object.bitmap) continue;
      const [sx, sy] = worldToScreen(camera, wx, wy, view.width, view.height);
      const side = object.size * camera.zoom;
      ctx.drawImage(object.bitmap, sx - side / 2, sy - side / 2, side, side);
      paintLobbyLabel(object, sx, sy + side / 2);
    }
  }

  /**
   * 물건 아래에 딸림표를 적는다.
   *
   * 로비에는 벽에 걸린 그림만 있고 그것이 무엇인지 말해 주는 것이 없었다. 미술관
   * 이라면 작품 옆에 이름표가 있다.
   *
   * **너무 작으면 적지 않는다.** 멀리서 보면 글자가 뭉개져 잡음이 되고, 31장이
   * 함께 있으므로 화면이 글자로 덮인다. 물건이 화면에서 이만큼 커졌을 때만 적는다.
   *
   * 글자는 캔버스에 직접 그린다. DOM 으로 얹으면 31개 요소가 프레임마다 자리를
   * 다시 잡아야 하고, 그것은 배치 계산을 프레임마다 강제하는 일이다.
   */
  function paintLobbyLabel(object, sx, bottom) {
    const side = object.size * camera.zoom;
    if (side < LABEL_AT || !object.text) return;

    // 글자 크기는 물건 크기를 따라간다. 다만 너무 커지지 않게 묶는다.
    const size = Math.max(10, Math.min(15, side * 0.11));
    ctx.save();
    ctx.font = `600 ${size}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    // 벽 위에 놓이므로 테두리를 두른다. 그림 위에 걸치는 일도 있다.
    ctx.lineWidth = Math.max(2, size * 0.28);
    ctx.strokeStyle = 'rgba(8, 7, 6, 0.85)';
    ctx.fillStyle = 'rgba(239, 233, 221, 0.94)';
    ctx.lineJoin = 'round';
    const top = bottom + size * 0.45;
    ctx.strokeText(object.text, sx, top);
    ctx.fillText(object.text, sx, top);
    if (object.note) {
      const small = size * 0.82;
      ctx.font = `400 ${small}px ui-sans-serif, system-ui, sans-serif`;
      ctx.lineWidth = Math.max(1.6, small * 0.26);
      ctx.fillStyle = 'rgba(239, 233, 221, 0.72)';
      ctx.strokeText(object.note, sx, top + size * 1.25);
      ctx.fillText(object.note, sx, top + size * 1.25);
    }
    ctx.restore();
  }

  /**
   * 지금 층의 줌 예산을 카메라에 적용한다.
   *
   * 화면 크기가 바뀔 때와 층이 바뀔 때 둘 다 필요하다. 예산이 어디서 오는지는
   * 주입받는다. 그래야 stage 가 층 정책을 알지 않아도 된다.
   */
  function applyZoomBudget() {
    camera.setViewport(view.width, view.height, zoomBudgetFor?.(world.tier) ?? null);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    view.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    view.width = rect.width;
    view.height = rect.height;
    canvas.width = Math.max(1, Math.round(rect.width * view.dpr));
    canvas.height = Math.max(1, Math.round(rect.height * view.dpr));
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    applyZoomBudget();
  }

  /**
   * 셀 번호 → 세계 좌표. 축 크기로 감싸므로 경계 처리가 따로 없다.
   *
   * 마스크를 미리 만들어 둔다. 코덱의 `wrap` 은 부를 때마다 `(1n << 3212n) - 1n`
   * 을 새로 만든다. 층 16 에서는 그 하나가 3212비트다.
   */
  function coordOf(i, j) {
    return [(world.baseX + BigInt(i)) & axisMask, (world.baseY + BigInt(j)) & axisMask];
  }

  /**
   * 캐시 키. **좌표를 문자열로 만들지 않는다.**
   *
   * 예전에는 `층:국소성:x:y` 였다. 층 16 의 좌표는 10진수로 967자이고, 그것을
   * 한 프레임에 165칸 × 2축 만들면 **5.7ms** 였다 (PC 기준. 프레임 예산의 34%).
   * 휴대폰에서는 그 몇 배이므로 층 16 이 눈에 보이게 끊겼다. 실측한 값이다.
   *
   * 지금은 기준점에 번호를 매기고 그 안의 칸 번호만 쓴다. 같은 일이 **0.000ms**
   * 다. 자리를 옮기면 worldId 가 올라가므로 옛 미술관의 키와 겹칠 수 없다.
   *
   * 잃는 것이 하나 있다. 떠났다가 같은 자리로 돌아오면 캐시가 안 맞는다.
   * 자리를 옮길 때는 커튼 뒤에서 어차피 다시 그리므로 값이 크지 않다.
   */
  function keyOf(i, j) {
    // 로비 바닥은 서로 다른 그림이 여덟 장뿐이다(lobby.mjs 의 위상). 칸마다 다른
    // 키를 주면 화면의 900칸을 따로 그리고, 캐시가 180장이라 프레임마다 밀어내고
    // 다시 그린다. 실측 로비 입장 6.96초 · 타일 6,828장 밀려남.
    //
    // 같은 위상이면 픽셀이 **완전히 같다.** 그래서 키를 위상으로 묶는다.
    if (isLobbyTier(world.tier)) {
      const [x, y] = coordOf(i, j);
      return `L@${worldId}:${lobbyTilePhase(x, y)}`;
    }
    return `${world.tier}@${worldId}:${i}:${j}`;
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
        out.push({
          key: keyOf(i, j),
          i,
          j,
          cost,
          tier: world.tier,
          locality: world.locality,
        });
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

  /**
   * 한 칸을 찍는다. grow 는 앞으로 나온 정도(0~1)다.
   *
   * 커진 칸은 옆 칸보다 **나중에** 찍어야 한다. 그리는 순서가 화면 중앙부터라서,
   * 먼저 찍으면 뒤에 오는 옆 칸이 커진 테두리와 그림자를 덮는다. draw 가 그
   * 순서를 맡는다.
   *
   * 그림자도 여기서 진다. 그림이 불투명하므로 캔버스가 알아서 사각형 그림자를
   * 만든다. 직접 사각형을 그리지 않는다.
   */
  function paintCell(item, grow = 0) {
    const bitmap = tiles.get(item.key);
    if (!bitmap) return false;

    const inner = camera.zoom * (1 - GAP) * (1 + FOCUS_LIFT * grow);
    const [sx, sy] = worldToScreen(camera, item.i, item.j, view.width, view.height);
    const left = sx - inner / 2;
    const top = sy - inner / 2;

    if (grow > 0.01) {
      ctx.save();
      ctx.shadowColor = `rgba(0,0,0,${SHADOW_ALPHA * grow})`;
      // shadowBlur 는 변환 행렬을 타지 않는다. 그리는 좌표는 CSS 픽셀인데
      // 그림자는 기기 픽셀이라, dpr 을 곱하지 않으면 고해상도 화면에서 절반만
      // 퍼진다. 실측으로 확인했다.
      ctx.shadowBlur = camera.zoom * SHADOW_REACH * grow * view.dpr;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.drawImage(bitmap, left, top, inner, inner);
      ctx.restore();
    } else {
      ctx.drawImage(bitmap, left, top, inner, inner);
    }

    if (inner > FRAME_AT) {
      ctx.strokeStyle = 'rgba(239,233,221,0.16)';
      ctx.lineWidth = 1;
      ctx.strokeRect(left + 0.5, top + 0.5, inner - 1, inner - 1);
    }
    return true;
  }

  /**
   * 어둡게 하기와 앞으로 나오기를 한 프레임 나아가게 한다.
   *
   * 움직였으면 true. 프레임 루프가 그것으로 다시 그릴지 정한다.
   */
  function animate(dt) {
    // 움직임을 줄여 달라고 한 사람에게는 크기와 어둡기를 곧바로 맞춘다.
    // 효과 자체를 없애지는 않는다. 고른 것이 어느 것인지는 계속 보여야 한다.
    if (reducedMotion) {
      let changed = dimNow !== dimGoal;
      dimNow = dimGoal;
      const at = focus ? cellId(focus.i, focus.j) : null;
      for (const [id, entry] of lift) {
        if (id !== at) {
          lift.delete(id);
          changed = true;
        } else if (entry.value !== 1) {
          entry.value = 1;
          changed = true;
        }
      }
      return changed;
    }

    let moving = false;

    if (dimNow !== dimGoal) {
      dimNow = approach(dimNow, dimGoal, dt, DIM_RATE);
      if (Math.abs(dimNow - dimGoal) < EPSILON) dimNow = dimGoal;
      moving = true;
    }

    const here = focus ? cellId(focus.i, focus.j) : null;
    for (const [id, entry] of lift) {
      const goal = id === here ? 1 : 0;
      if (entry.value === goal) continue;
      entry.value = approach(entry.value, goal, dt, LIFT_RATE);
      if (Math.abs(entry.value - goal) < EPSILON) entry.value = goal;
      moving = true;
      // 다 줄어든 칸은 잊는다. 목록이 자라지 않는다.
      if (entry.value === 0 && goal === 0) lift.delete(id);
    }

    return moving;
  }

  return {
    resize,
    get view() {
      return { ...view };
    },
    get world() {
      return { ...world };
    },

    /**
     * 다른 자리로 옮긴다.
     *
     * worldId 를 올려 캐시 키를 갈아 낸다. 축 마스크도 여기서 한 번만 만든다.
     * 앞으로 나온 칸의 기록도 버린다. 새 미술관의 같은 번호 칸은 다른 그림이다.
     */
    setWorld(next) {
      const previousTier = world.tier;
      world = { ...world, ...next };
      axisMask = (1n << BigInt(world.axisBits)) - 1n;
      worldId++;
      lift.clear();
      // 층이 바뀌면 줌 한계도 바뀐다. 깊은 층은 멀리 보지 못한다.
      // 여기서 다시 적용하지 않으면 다음 resize 까지 이전 층의 한계가 남는다.
      if (world.tier !== previousTier) applyZoomBudget();
    },

    setFocus(cell) {
      focus = cell;
      if (cell && !lift.has(cellId(cell.i, cell.j))) {
        lift.set(cellId(cell.i, cell.j), { i: cell.i, j: cell.j, value: 0 });
      }
    },
    get focus() {
      return focus;
    },

    /** 지금 값과 목표값. 검사가 목표값을 본다 (애니메이션 중이라도 뜻이 분명하다). */
    get dim() {
      return dimNow;
    },
    get dimTarget() {
      return dimGoal;
    },

    setDim(value) {
      dimGoal = value;
    },

    /** 고른 칸이 앞으로 나온 정도 (0~1). */
    get liftNow() {
      return focus ? (lift.get(cellId(focus.i, focus.j))?.value ?? 0) : 0;
    },
    /** 지금 크기가 움직이고 있는 칸의 수. 옮기는 중에는 둘이다. */
    get liftCount() {
      return lift.size;
    },
    /** 앞으로 나왔을 때 한 변이 몇 배가 되는가. 검사가 기대값을 만들 때 쓴다. */
    get liftScale() {
      return 1 + FOCUS_LIFT;
    },

    animate,

    /** 끌기 속도를 알려 준다. 미리 렌더의 방향이 여기서 나온다. */
    setVelocity(vx, vy) {
      velocity = { x: vx, y: vy };
    },

    /**
     * 로비에 놓인 물건을 준다. 로비가 아니면 빈 배열을 준다.
     *
     * 각 물건은 `{ id, kind, x, y, size, bitmap }` 이다. 그림을 준비하는 일은
     * 부르는 쪽(main)이 한다. stage 는 어디에 어떻게 놓는지만 안다.
     */
    setLobbyObjects(list) {
      lobbyObjects = Array.isArray(list) ? list : [];
    },

    get lobbyObjects() {
      return lobbyObjects;
    },

    /**
     * 화면 좌표에 있는 로비 물건. 없으면 null.
     *
     * 그리는 것과 **같은 배치 계산**을 쓴다. 따로 계산하면 눈에 보이는 자리와
     * 눌리는 자리가 어긋난다.
     */
    lobbyObjectAt(screenX, screenY) {
      // 위에 그려진 것이 먼저 잡혀야 하므로 뒤에서부터 본다.
      const placements = lobbyPlacements();
      for (let index = placements.length - 1; index >= 0; index--) {
        const { object, wx, wy } = placements[index];
        const [sx, sy] = worldToScreen(camera, wx, wy, view.width, view.height);
        const half = (object.size * camera.zoom) / 2;
        if (Math.abs(screenX - sx) <= half && Math.abs(screenY - sy) <= half) return object;
      }
      return null;
    },

    /** 화면 좌표 → 셀 번호. 탭이 어느 전시물인지 알아낸다. */
    cellAt(screenX, screenY) {
      return [
        Math.round(camera.x + (screenX - view.width / 2) / camera.zoom),
        Math.round(camera.y + (screenY - view.height / 2) / camera.zoom),
      ];
    },

    /**
     * 셀 번호 → 화면 좌표. cellAt 의 반대다.
     *
     * 캔버스 위에 DOM 을 얹는 쪽이 쓴다(건너뛰기 단추). 그리기는 이 함수를 쓰지
     * 않는다 — 그쪽은 이미 worldToScreen 을 직접 부른다.
     */
    screenOf(i, j) {
      return worldToScreen(camera, i, j, view.width, view.height);
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
      if (request) tiles.want(list, coordOf);
      else tiles.keep(list);

      const here = focus ? cellId(focus.i, focus.j) : null;

      // 1. 평범한 칸. 커지고 있는 칸은 건너뛴다.
      let missing = 0;
      for (const item of list) {
        if (lift.size > 0 && lift.has(cellId(item.i, item.j))) continue;
        if (!paintCell(item)) missing++;
      }

      // 2. 커지고 있는 칸을 위에 얹는다. 작은 것부터 찍어 고른 것이 가장 위에 온다.
      //    떠난 칸은 아직 줄어드는 중이므로 여기에 함께 있다.
      //
      //    여기서는 missing 을 세지 않는다. missing 은 "다시 그려야 하는가" 를
      //    정하는 값이고, 이 칸들은 목록(wishlist) 밖일 수도 있다. 목록 밖의
      //    칸은 아무도 요청하지 않으므로 세면 영원히 다시 그리게 된다.
      //    타일이 도착하면 tiles 의 onArrive 가 어차피 다시 그리게 한다.
      if (lift.size > 0) {
        const rising = [];
        for (const entry of lift.values()) {
          if (entry.i === focus?.i && entry.j === focus?.j) continue;
          rising.push(entry);
        }
        rising.sort((a, b) => a.value - b.value);
        for (const entry of rising) {
          paintCell({ key: keyOf(entry.i, entry.j), i: entry.i, j: entry.j }, entry.value);
        }
      }

      // 2.5 로비의 물건. 바닥 위에 얹는다.
      //
      // 작품 층에서는 목록이 비어 있어 아무 일도 하지 않는다. 어둡게 하기(3)
      // 앞에 두는 이유는, 로비에는 고른 칸이 없어서 어둡게 할 일도 없기 때문이다.
      paintLobbyObjects();

      // 3. 어둡게 하고, 고른 것만 그 위에 다시 찍는다.
      if (dimNow > 0.004 && focus) {
        ctx.fillStyle = `rgba(18,16,14,${DIM_ALPHA * dimNow})`;
        ctx.fillRect(0, 0, view.width, view.height);
      }
      if (focus) {
        paintCell(
          { key: keyOf(focus.i, focus.j), i: focus.i, j: focus.j },
          lift.get(here)?.value ?? 0,
        );
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
          tiles.want(list, coordOf);
          requestAnimationFrame(tick);
        };
        tick();
      });
    },
  };
}
