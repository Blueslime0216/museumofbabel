// 커튼 — 암전 → 교체 → 원형 개방
//
// 요구사항 6장.
//   목업에서 무작위 점프가 갑자기 바뀌어 끊김이 느껴졌다. 그래서 암전을 사이에
//   넣는다. 완전히 검어진 순간에 좌표를 바꾸고, 그 뒤에서 전시물을 다 렌더한
//   다음 원형으로 열린다. 그래서 그림이 뒤늦게 뜨는 장면이 원리적으로 없다.
//
// 단계
//   dim   균일한 검정으로 320ms. 줌은 변하지 않는다
//   hold  완전히 검은 상태. 좌표 교체와 렌더를 기다린다. 시간 제한이 없다
//   open  가운데에서 원형으로. 이때 카메라가 줌아웃된다
//
// ── 개방 시간은 고정이 아니다 ────────────────────────────────────────────
//
// 예전에는 1400ms 로 못박혀 있었다. 빠른 기기에서는 지루하고, 느린 기기에서는
// 그 1.4초 동안 프레임마다 화면을 다시 그리느라 오히려 버벅였다.
//
// 지금은 부르는 쪽이 이번 개방의 길이를 정한다. `setOpen` 으로 넣으며, 기준은
// **그 기기가 전시물 한 장을 그리는 데 걸리는 시간**이다(main.mjs). 빠르면
// 최소값으로 열고, 느리면 남은 렌더가 도착할 만큼 늘린다. 느려서 버벅이는 것을
// "조금 더 긴 암전" 으로 바꾸는 것이며, 이 커튼이 원래 그러려고 있는 것이다.
//
// 상태기계에 DOM 이 없다. 그래서 Node 에서 그대로 테스트한다.
// 화면에 칠하는 일은 attachCurtain 이 한다.

export const PHASE = {
  CLEAR: 'clear',
  DIM: 'dim',
  HOLD: 'hold',
  OPEN: 'open',
};

/** 개방이 이보다 빠르면 열리는 것이 보이지 않는다. */
export const OPEN_MIN_MS = 400;
/** 이보다 오래 끌면 개방이 아니라 기다림이 된다. */
export const OPEN_MAX_MS = 1400;

const FULL = { dim: 320, open: OPEN_MIN_MS };
const REDUCED = { dim: 160, open: 300 };

/**
 * 순수 상태기계.
 *
 * 시간을 스스로 읽지 않는다. update(dt) 로 받는다. 그래서 테스트에서 시간을
 * 마음대로 돌릴 수 있다.
 */
export function createCurtainState({ reducedMotion = false } = {}) {
  const ms = reducedMotion ? REDUCED : FULL;
  let phase = PHASE.CLEAR;
  let elapsed = 0;
  let pending = null; // hold 단계에서 기다리는 준비 작업
  let onOpened = null;
  /** 이번 개방의 길이. travel/arrive 마다 기본값으로 돌아간다. */
  let openMs = ms.open;

  function begin(phaseName) {
    phase = phaseName;
    elapsed = 0;
  }

  return {
    get phase() {
      return phase;
    },
    get reducedMotion() {
      return reducedMotion;
    },
    /** 입력을 받아도 되는가. 암전과 대기 중에는 받지 않는다. */
    get busy() {
      return phase === PHASE.DIM || phase === PHASE.HOLD;
    },
    /** 암전의 진행도 0..1. 화면을 칠하는 데 쓴다. */
    get dimProgress() {
      if (phase === PHASE.DIM) return Math.min(1, elapsed / ms.dim);
      if (phase === PHASE.HOLD) return 1;
      return phase === PHASE.OPEN ? 1 : 0;
    },
    /** 개방의 진행도 0..1. 카메라 줌아웃이 이 값에 맞춰 움직인다. */
    get openProgress() {
      if (phase === PHASE.OPEN) return Math.min(1, elapsed / openMs);
      if (phase === PHASE.CLEAR) return 1;
      return 0;
    },
    /** 이번 개방에 걸리는 시간(ms). 화면 검사와 개발자 패널이 본다. */
    get openDuration() {
      return openMs;
    },

    /**
     * 이번 개방의 길이를 정한다. 준비 작업(prepare) 안에서 부르면 된다.
     *
     * hold 단계에서 준비가 끝난 직후에 open 이 시작되므로, 그때 부르는 값이
     * 이번 개방에 그대로 쓰인다. 움직임 줄이기 설정에서는 무시한다 — 그 설정의
     * 뜻은 "애니메이션을 짧게" 이고, 렌더가 느리다고 길게 만들 이유가 없다.
     */
    setOpen(value) {
      if (reducedMotion) return;
      if (!Number.isFinite(value)) return;
      openMs = Math.round(Math.min(OPEN_MAX_MS, Math.max(OPEN_MIN_MS, value)));
    },

    /**
     * 자리를 옮긴다. 암전부터 시작한다.
     *
     * prepare 는 완전히 검어진 순간에 불린다. 좌표를 바꾸고 필요한 전시물을
     * 렌더하는 일을 여기서 한다. Promise 를 돌려주면 그것이 끝날 때까지 기다린다.
     */
    travel(prepare, done) {
      pending = prepare ?? null;
      onOpened = done ?? null;
      openMs = ms.open;
      begin(PHASE.DIM);
    },

    /**
     * 첫 진입. 이미 검은 상태에서 시작하므로 암전을 건너뛴다.
     */
    arrive(prepare, done) {
      pending = prepare ?? null;
      onOpened = done ?? null;
      openMs = ms.open;
      begin(PHASE.HOLD);
      this.update(0);
    },

    /** 한 프레임. 단계가 바뀌면 true. */
    update(dt) {
      const was = phase;
      elapsed += dt * 1000;

      if (phase === PHASE.DIM && elapsed >= ms.dim) {
        begin(PHASE.HOLD);
      }

      if (phase === PHASE.HOLD && pending) {
        const work = pending;
        pending = null;
        // 준비가 동기로 끝나도 한 프레임은 검은 화면을 보여 준다.
        Promise.resolve()
          .then(work)
          .catch(() => {
            /* 준비가 실패해도 커튼은 열어야 한다. 검은 화면에 갇히면 안 된다. */
          })
          .then(() => {
            if (phase === PHASE.HOLD) begin(PHASE.OPEN);
          });
      }

      if (phase === PHASE.OPEN && elapsed >= openMs) {
        begin(PHASE.CLEAR);
        const finish = onOpened;
        onOpened = null;
        finish?.();
      }

      return was !== phase;
    },
  };
}

/**
 * 상태기계를 화면에 칠한다.
 *
 * 커스텀 프로퍼티 애니메이션에 의존하지 않는다. 카메라 루프가 이미 매 프레임
 * 돌고 있으므로 거기서 값을 갱신한다.
 */
export function attachCurtain(element, state) {
  let lastMode = null;

  return function paint() {
    const { phase } = state;

    if (phase === PHASE.CLEAR) {
      if (lastMode !== 'clear') {
        element.dataset.mode = 'clear';
        element.style.opacity = '0';
        lastMode = 'clear';
      }
      return;
    }

    if (phase === PHASE.OPEN) {
      if (lastMode !== 'open') {
        element.dataset.mode = 'open';
        element.style.opacity = '1';
        lastMode = 'open';
      }
      // 원이 화면을 덮을 때까지 키운다. 안쪽과 바깥쪽 반경을 벌려
      // 경계를 부드럽게 만든다.
      //
      // 곡선을 고른 이유. 처음에는 1-(1-t)^2.2 를 썼는데 원이 전체 시간의
      // 앞 30% 에서 화면을 벗어나 버렸다. 개방이 눈에 거의 안 보였다.
      // t^0.75 는 시작을 조금 빠르게 하면서도 끝까지 반경이 자란다.
      //
      // 145 로 끝나므로 마지막 프레임에서 안쪽 반경(=145-34)도 100% 를 넘는다.
      // 그래서 clear 로 넘어갈 때 툭 끊기는 느낌이 없다.
      const t = state.openProgress;
      const outer = 145 * Math.pow(t, 0.75);
      element.style.setProperty('--open-inner', `${Math.max(0, outer - 34)}%`);
      element.style.setProperty('--open-outer', `${outer}%`);
      return;
    }

    // dim 또는 hold
    if (lastMode !== 'dim') {
      element.dataset.mode = 'dim';
      lastMode = 'dim';
    }
    element.style.opacity = String(state.dimProgress);
  };
}
