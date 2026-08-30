// 입력 — 포인터 · 휠 · 핀치 · 키보드를 카메라 목표값으로
//
// 요구사항 4장.
//   한 손가락은 이동, 두 손가락은 줌. 마우스는 드래그와 휠.
//   탭과 드래그는 이동량 6px 로 가른다.
//
// 브라우저의 페이지 줌이 새지 않게 막는 책임도 여기 있다.
// touch-action: none 은 CSS 가 걸고, iOS 의 gesture 이벤트는 여기서 막는다.

const TAP_SLOP = 6; // 이보다 움직였으면 탭이 아니다
const TAP_MS = 600;
const WHEEL_STEP = 0.0016; // 휠 한 칸이 줌에 곱해지는 정도

/**
 * onChange 는 카메라를 건드린 직후마다 불린다.
 *
 * 이것이 없으면 드래그가 뚝뚝 끊긴다. dragBy 와 zoomAround 는 현재값과 목표값을
 * 함께 옮기므로 camera.update() 가 "변화 없음" 을 돌려준다. 그러면 프레임 루프가
 * 다시 그릴 이유를 못 찾고, 손을 뗄 때 한 번에 몰아서 보인다. 실제로 그랬다.
 */
export function createInput({
  element,
  camera,
  stage,
  onTap,
  onChange,
  onDragStart,
  onGestureEnd,
  isBlocked,
  /**
   * 손이 직접 줌했다. 휠과 핀치가 이것을 부른다.
   *
   * `onChange` 와 나눠 둔 이유: 개방 중에는 줌만 충돌하고 이동은 괜찮다.
   * 둘을 구분하지 못하면 드래그에도 개방의 줌 몰기를 놓아 버려서 줌이 멈춘다.
   */
  onZoom,
}) {
  const pointers = new Map();
  let gesture = null; // 두 손가락일 때의 기준
  let moved = 0;
  let startedAt = 0;
  let velocity = { x: 0, y: 0 };
  let lastMove = 0;
  /** 이번 제스처가 "돌아다니기" 로 판정됐는지. 한 번만 알린다. */
  let announced = false;

  /**
   * 손이 실제로 미술관을 움직이기 시작했다.
   *
   * pointerdown 만으로는 탭과 구분할 수 없다. 6px 을 넘겨야 끌기다.
   * 핀치는 시작하는 순간 곧바로 돌아다니기로 본다.
   */
  function announceDrag() {
    if (announced) return;
    announced = true;
    onDragStart?.();
  }

  const blocked = () => (isBlocked ? isBlocked() : false);

  function localPoint(event) {
    const rect = element.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  function decayVelocity() {
    velocity = { x: velocity.x * 0.9, y: velocity.y * 0.9 };
    stage.setVelocity(velocity.x, velocity.y);
  }

  element.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (blocked()) return;

    element.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, localPoint(event));

    if (pointers.size === 1) {
      moved = 0;
      announced = false;
      startedAt = performance.now();
      velocity = { x: 0, y: 0 };
    }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = {
        distance: Math.hypot(a[0] - b[0], a[1] - b[1]),
        zoom: camera.zoom,
      };
      announceDrag();
    }
  });

  element.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) return;
    const previous = pointers.get(event.pointerId);
    const current = localPoint(event);
    pointers.set(event.pointerId, current);

    const dx = current[0] - previous[0];
    const dy = current[1] - previous[1];
    moved += Math.abs(dx) + Math.abs(dy);

    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const midX = (a[0] + b[0]) / 2;
      const midY = (a[1] + b[1]) / 2;
      if (gesture && gesture.distance > 8 && distance > 8) {
        const { width, height } = stage.view;
        camera.zoomAround((gesture.zoom * distance) / gesture.distance, midX, midY, width, height);
        onZoom?.();
        onChange?.();
      }
      return;
    }

    // 한 손가락 · 마우스 이동
    if (moved > TAP_SLOP) announceDrag();
    camera.dragBy(-dx / camera.zoom, -dy / camera.zoom);
    onChange?.();

    const now = performance.now();
    const gap = Math.max(1, now - lastMove);
    lastMove = now;
    // 셀/초 단위의 속도. 미리 렌더의 방향이 여기서 나온다.
    velocity = {
      x: (-dx / camera.zoom / gap) * 1000,
      y: (-dy / camera.zoom / gap) * 1000,
    };
    stage.setVelocity(velocity.x, velocity.y);
  });

  function release(event) {
    if (!pointers.has(event.pointerId)) return;
    const wasSingle = pointers.size === 1;
    const point = pointers.get(event.pointerId);
    pointers.delete(event.pointerId);

    if (pointers.size < 2) gesture = null;

    if (wasSingle) {
      const quick = performance.now() - startedAt < TAP_MS;
      if (moved < TAP_SLOP && quick && !blocked()) {
        // 화면 좌표도 함께 넘긴다. 로비의 물건은 격자 칸이 아니라 실수 좌표에
        // 얹혀 있어서, 칸 번호만으로는 무엇을 눌렀는지 알 수 없다.
        const [i, j] = stage.cellAt(point[0], point[1]);
        onTap?.(i, j, point[0], point[1]);
      }
      onGestureEnd?.();
    }
  }

  element.addEventListener('pointerup', release);
  element.addEventListener('pointercancel', release);

  element.addEventListener(
    'wheel',
    event => {
      event.preventDefault();
      if (blocked()) return;
      const [px, py] = localPoint(event);
      const { width, height } = stage.view;
      const factor = Math.exp(-event.deltaY * WHEEL_STEP);
      camera.zoomAround(camera.zoom * factor, px, py, width, height);
      onZoom?.();
      onChange?.();
      onGestureEnd?.();
    },
    { passive: false },
  );

  // iOS 의 페이지 확대를 막는다. touch-action 만으로는 새는 경우가 있다.
  for (const name of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(name, event => event.preventDefault(), { passive: false });
  }
  // 두 번 탭 확대도 막는다.
  document.addEventListener('dblclick', event => event.preventDefault());

  return {
    /** 매 프레임. 손을 뗀 뒤 속도를 서서히 줄인다. */
    update() {
      if (pointers.size === 0 && (velocity.x !== 0 || velocity.y !== 0)) decayVelocity();
    },
    get dragging() {
      return pointers.size > 0;
    },
    get pinching() {
      return pointers.size >= 2;
    },
  };
}
