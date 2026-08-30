import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCurtainState,
  PHASE,
  OPEN_MIN_MS,
  OPEN_MAX_MS,
} from '../src/curtain.mjs';

/** 상태기계가 시간을 스스로 읽지 않으므로 여기서 돌린다. */
function run(state, ms, step = 16) {
  for (let t = 0; t < ms; t += step) state.update(step / 1000);
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('암전 → 대기 → 개방 → 맑음 순서로만 간다', async () => {
  const seen = [];
  const state = createCurtainState();
  let prepared = false;

  state.travel(async () => {
    // 준비는 완전히 검어진 뒤에 불려야 한다
    assert.equal(state.phase, PHASE.HOLD);
    assert.equal(state.dimProgress, 1);
    prepared = true;
  });

  seen.push(state.phase);
  run(state, 100);
  seen.push(state.phase);
  assert.equal(state.phase, PHASE.DIM, '아직 암전 중');
  assert.equal(prepared, false, '검어지기 전에 준비를 부르면 안 된다');

  run(state, 300);
  assert.equal(state.phase, PHASE.HOLD);
  await flush();
  await flush();
  state.update(0);
  assert.equal(prepared, true);
  assert.equal(state.phase, PHASE.OPEN);

  run(state, 1500);
  assert.equal(state.phase, PHASE.CLEAR);
});

test('암전 중에는 개방 진행도가 0 이다', () => {
  const state = createCurtainState();
  state.travel(() => {});
  run(state, 160);
  assert.equal(state.phase, PHASE.DIM);
  assert.equal(state.openProgress, 0, '암전 중 줌이 움직이면 안 된다');
  assert.ok(state.dimProgress > 0 && state.dimProgress < 1);
});

test('첫 진입은 암전을 건너뛴다', async () => {
  const state = createCurtainState();
  state.arrive(() => {});
  assert.equal(state.phase, PHASE.HOLD, '검은 화면에서 시작한다');
  assert.equal(state.dimProgress, 1);
  await flush();
  await flush();
  state.update(0);
  assert.equal(state.phase, PHASE.OPEN);
});

test('준비가 실패해도 커튼은 열린다', async () => {
  const state = createCurtainState();
  state.travel(() => {
    throw new Error('렌더 실패');
  });
  run(state, 400);
  await flush();
  await flush();
  state.update(0);
  assert.equal(state.phase, PHASE.OPEN, '검은 화면에 갇히면 안 된다');
});

test('대기는 시간 제한이 없다', async () => {
  const state = createCurtainState();
  let release;
  state.travel(() => new Promise(resolve => {
    release = resolve;
  }));
  run(state, 400);
  assert.equal(state.phase, PHASE.HOLD);

  // 준비는 마이크로태스크로 불린다. 동기 루프 직후에는 아직 실행되지 않았다.
  await flush();
  assert.equal(typeof release, 'function', '준비가 시작되어야 한다');

  run(state, 5000);
  assert.equal(state.phase, PHASE.HOLD, '준비가 끝날 때까지 기다린다');
  release();
  await flush();
  await flush();
  state.update(0);
  assert.equal(state.phase, PHASE.OPEN);
});

test('암전과 대기 중에는 입력을 받지 않는다', () => {
  const state = createCurtainState();
  assert.equal(state.busy, false);
  state.travel(() => {});
  assert.equal(state.busy, true);
  run(state, 400);
  assert.equal(state.busy, true, '대기 중에도 막는다');
});

test('모션을 줄이면 시간이 짧아진다', () => {
  const quick = createCurtainState({ reducedMotion: true });
  quick.travel(() => {});
  run(quick, 170);
  assert.equal(quick.phase, PHASE.HOLD, '암전이 160ms 로 줄어든다');
});

// ── 개방 시간이 기기 속도에 맞춰 달라진다 ────────────────────────────────
//
// 예전에는 1400ms 로 못박혀 있었다. 빠른 기기에서는 지루하고, 느린 기기에서는
// 그 1.4초 동안 프레임마다 다시 그리느라 오히려 버벅였다.

test('기본 개방은 최소 시간이다', () => {
  const state = createCurtainState();
  assert.equal(state.openDuration, OPEN_MIN_MS);
});

test('setOpen 이 이번 개방의 길이를 정한다', async () => {
  const state = createCurtainState();
  state.travel(() => state.setOpen(900));
  run(state, 320); // 암전을 지나 hold 로
  await flush();
  state.update(0);

  assert.equal(state.phase, PHASE.OPEN);
  assert.equal(state.openDuration, 900);

  // 900ms 의 절반쯤에서 진행도가 절반쯤이어야 한다
  run(state, 450);
  assert.ok(
    state.openProgress > 0.4 && state.openProgress < 0.6,
    `절반에서 진행도가 ${state.openProgress} 다`,
  );

  run(state, 500);
  assert.equal(state.phase, PHASE.CLEAR, '정한 시간에 끝나야 한다');
});

test('개방 길이는 최소와 최대 사이로 잘린다', () => {
  const state = createCurtainState();
  state.setOpen(10);
  assert.equal(state.openDuration, OPEN_MIN_MS, '너무 짧으면 열리는 것이 안 보인다');
  state.setOpen(99999);
  assert.equal(state.openDuration, OPEN_MAX_MS, '너무 길면 개방이 아니라 기다림이다');
  state.setOpen(Number.NaN);
  assert.equal(state.openDuration, OPEN_MAX_MS, 'NaN 이 길이를 망가뜨리면 안 된다');
});

test('travel 마다 개방 길이가 기본값으로 돌아간다', async () => {
  const state = createCurtainState();
  state.travel(() => state.setOpen(1200));
  run(state, 320);
  await flush();
  state.update(0);
  assert.equal(state.openDuration, 1200);
  run(state, 1300); // 개방을 끝낸다

  // 다음 여행은 앞선 여행의 길이를 물려받지 않는다
  state.travel(null);
  assert.equal(state.openDuration, OPEN_MIN_MS);
});

test('움직임 줄이기에서는 개방 길이를 늘리지 않는다', async () => {
  // 그 설정의 뜻은 "애니메이션을 짧게" 다. 렌더가 느리다고 길게 만들 이유가 없다.
  const state = createCurtainState({ reducedMotion: true });
  const before = state.openDuration;
  state.setOpen(1400);
  assert.equal(state.openDuration, before, '움직임 줄이기를 무시했다');

  // 준비 작업을 주어야 대기에서 나온다. 준비가 없으면 대기가 끝나지 않는다
  // (위의 `대기는 시간 제한이 없다` 가 그 동작을 고정한다).
  state.travel(() => {});
  run(state, 160);
  await flush();
  state.update(0);
  assert.equal(state.phase, PHASE.OPEN);
  run(state, 400);
  assert.equal(state.phase, PHASE.CLEAR, '줄인 개방(300ms)이 끝나야 한다');
});
