import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCamera,
  visibleCells,
  worldToScreen,
  MIN_CELL,
  MAX_VISIBLE,
} from '../src/camera.mjs';
import { zoomBudgetFor, isDeepestFloor } from '../src/floors.mjs';
import { TIERS } from '../src/codec.mjs';

function settle(camera, steps = 400, dt = 1 / 60) {
  for (let i = 0; i < steps && !camera.settled; i++) camera.update(dt);
}

test('목표로 수렴한다', () => {
  const camera = createCamera({ x: 0, y: 0, zoom: 100 });
  camera.setViewport(400, 800);
  camera.moveTo(7, -3);
  settle(camera);
  assert.equal(camera.settled, true);
  assert.equal(camera.x, 7);
  assert.equal(camera.y, -3);
});

test('목표를 도중에 바꿔도 튀지 않는다', () => {
  const camera = createCamera({ x: 0, y: 0, zoom: 100 });
  camera.setViewport(400, 800);
  camera.moveTo(10, 0);
  for (let i = 0; i < 10; i++) camera.update(1 / 60);
  const midway = camera.x;
  assert.ok(midway > 0 && midway < 10, '가는 중이어야 한다');

  // 반대로 꺾는다
  camera.moveTo(-10, 0);
  const first = camera.x;
  camera.update(1 / 60);
  assert.ok(camera.x < first, '곧바로 반대 방향으로 움직여야 한다');
  settle(camera);
  assert.equal(camera.x, -10);
});

test('프레임 간격이 흔들려도 같은 곳에 도착한다', () => {
  const steady = createCamera({ zoom: 100 });
  const jittery = createCamera({ zoom: 100 });
  for (const camera of [steady, jittery]) {
    camera.setViewport(400, 800);
    camera.moveTo(5, 5);
  }
  settle(steady);
  for (let i = 0; i < 400 && !jittery.settled; i++) {
    jittery.update(i % 3 === 0 ? 1 / 30 : 1 / 120);
  }
  assert.equal(steady.x, jittery.x);
  assert.equal(steady.y, jittery.y);
});

test('줌 한계를 화면 크기에서 정한다', () => {
  const camera = createCamera({ zoom: 100 });
  camera.setViewport(390, 844);
  const { min, max } = camera.zoomBounds;
  assert.equal(min, MIN_CELL, '휴대폰 크기에서는 손가락 크기가 이긴다');
  assert.equal(Math.round(max), Math.round(390 * 0.9));

  camera.zoomTo(10);
  assert.equal(camera.target.zoom, MIN_CELL, '아래로 넘지 않는다');
  camera.zoomTo(99999);
  assert.equal(camera.target.zoom, camera.zoomBounds.max, '위로 넘지 않는다');
});

test('줌해도 붙잡은 점이 움직이지 않는다', () => {
  const camera = createCamera({ x: 0, y: 0, zoom: 100 });
  camera.setViewport(400, 800);
  const grab = [120, 300];
  const before = worldToScreen(camera, ...screenWorld(camera, grab), 400, 800);

  camera.zoomAround(180, grab[0], grab[1], 400, 800);
  const after = worldToScreen(camera, ...screenWorld(camera, grab), 400, 800);
  assert.ok(Math.abs(after[0] - before[0]) < 1e-6);
  assert.ok(Math.abs(after[1] - before[1]) < 1e-6);

  function screenWorld(cam, [sx, sy]) {
    return [cam.x + (sx - 200) / cam.zoom, cam.y + (sy - 400) / cam.zoom];
  }
});

test('보이는 셀 범위가 줌에 따라 넓어진다', () => {
  const camera = createCamera({ x: 0, y: 0, zoom: 200 });
  camera.setViewport(400, 800);
  const tight = visibleCells(camera, 400, 800, 0);
  camera.snapTo({ zoom: 100 });
  const wide = visibleCells(camera, 400, 800, 0);
  assert.ok(wide.i1 - wide.i0 > tight.i1 - tight.i0);
});

test('넓은 화면에서는 동시 표시 상한이 줌아웃을 막는다', () => {
  const camera = createCamera({ zoom: 200 });
  camera.setViewport(1280, 860);
  camera.zoomTo(1); // 끝까지 줌아웃을 시도한다
  const cell = camera.target.zoom;
  assert.ok(cell > MIN_CELL, `넓은 화면에서는 ${MIN_CELL}px 보다 커야 한다: ${cell}`);

  camera.snapTo({ zoom: cell });
  const { i0, i1, j0, j1 } = visibleCells(camera, 1280, 860, 0);
  const count = (i1 - i0 + 1) * (j1 - j0 + 1);
  // 상한 130 에 여유(테두리 한 겹)를 준 값. 캐시 180 을 넘지 않아야 한다.
  assert.ok(count <= 170, `동시 표시가 너무 많다: ${count}`);
});

test('화면이 줄어들면 현재 줌도 한계 안으로 들어온다', () => {
  const camera = createCamera({ zoom: 200 });
  camera.setViewport(1600, 1000);
  camera.snapTo({ zoom: camera.zoomBounds.max });
  camera.setViewport(320, 560);
  assert.ok(camera.zoom <= camera.zoomBounds.max, '현재 값도 잘려야 한다');
});

// ── 층별 줌 예산 ─────────────────────────────────────────────────────────

test('층이 깊어질수록 멀리 보지 못한다', () => {
  const phone = { width: 390, height: 844 };
  const previous = { min: 0, visible: Infinity };

  for (const tier of TIERS.slice().sort((a, b) => a - b)) {
    const camera = createCamera();
    camera.setViewport(phone.width, phone.height, zoomBudgetFor(tier));
    const { min } = camera.zoomBounds;
    const visible = (phone.width * phone.height) / (min * min);

    assert.ok(min > previous.min, `티어 ${tier} 의 최소 줌 ${min} 이 앞 층보다 크지 않다`);
    assert.ok(
      visible < previous.visible,
      `티어 ${tier} 가 앞 층보다 많이 보여 준다 (${visible.toFixed(0)}점)`,
    );
    previous.min = min;
    previous.visible = visible;
  }
});

test('최대 줌은 층과 무관하게 같다', () => {
  // 한 점을 크게 보는 것은 렌더 부담을 늘리지 않으므로 제한할 이유가 없다.
  // 다만 최소 줌이 올라가면 max 의 하한(min+1)이 따라 오를 수는 있다.
  const width = 1280;
  const height = 860;
  const shallow = createCamera();
  shallow.setViewport(width, height, zoomBudgetFor(4));
  const deep = createCamera();
  deep.setViewport(width, height, zoomBudgetFor(Math.max(...TIERS)));

  assert.equal(
    deep.zoomBounds.max,
    shallow.zoomBounds.max,
    '깊은 층에서 최대 줌이 달라졌다',
  );
});

test('층별 최소 줌이 드래그 처리량 요구를 넘는다', () => {
  // 검은 칸이 안 생길 조건은  zoom >= sqrt(v * H * 한장시간 / (1000 * 워커수)) 다.
  // 근거와 실측값은 floors.mjs 에 적어 두었다. 여기서는 그 부등식을 지킨다.
  const WORKERS = 2;
  const OVERHEAD_MS = 0.6;
  const SLOW = 6; // 오래된 휴대폰이 데스크톱보다 느린 배수
  const DRAG = 800; // px/s. "적당한 속도로 탐색"
  // 실측한 층별 코덱 시간(데스크톱, ms). 층이 깊어져도 캔버스가 같으므로 완만하다.
  const CODEC_MS = { 4: 0.474, 8: 0.515, 16: 0.609, 32: 1.104 };

  for (const screen of [
    { width: 390, height: 844 },
    { width: 820, height: 1180 },
    { width: 1920, height: 1080 },
  ]) {
    for (const tier of TIERS) {
      const perTile = (OVERHEAD_MS + (CODEC_MS[tier] ?? 1.2)) * SLOW;
      const needed = Math.sqrt((DRAG * screen.height * perTile) / (1000 * WORKERS));

      const camera = createCamera();
      camera.setViewport(screen.width, screen.height, zoomBudgetFor(tier));
      const { min } = camera.zoomBounds;

      assert.ok(
        min >= needed,
        `${screen.width}x${screen.height} 티어 ${tier}: 최소 줌 ${min.toFixed(0)} 이 ` +
          `필요한 ${needed.toFixed(0)} 보다 작다. 끌면 검은 칸이 보인다`,
      );
    }
  }
});

test('예산을 주지 않으면 층과 무관한 기본값을 쓴다', () => {
  // 기존 호출자(2인자)가 그대로 동작해야 한다.
  const without = createCamera();
  without.setViewport(1280, 860);
  const explicit = createCamera();
  explicit.setViewport(1280, 860, { maxVisible: MAX_VISIBLE, minCell: MIN_CELL });
  assert.deepEqual(without.zoomBounds, explicit.zoomBounds);
});

test('가장 깊은 층만 깊이 비네트를 받는다', () => {
  const deepest = Math.max(...TIERS);
  for (const tier of TIERS) {
    assert.equal(
      isDeepestFloor(tier),
      tier === deepest,
      `티어 ${tier} 의 최심층 판정이 틀렸다`,
    );
  }
  assert.equal(TIERS.filter(isDeepestFloor).length, 1, '최심층은 하나여야 한다');
});
