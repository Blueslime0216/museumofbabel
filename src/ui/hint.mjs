// 첫 방문 힌트 — 한 번만, 손을 대면 곧바로 사라진다
//
// 요구사항. QR 로 들어온 사람은 화면을 끌 수 있다는 것을 모를 수 있다.
// 그 이상은 넣지 않는다. 설명은 발표자가 한다.
//
// 드래그를 시작했다는 것은 이미 알아냈다는 뜻이므로 3초를 기다리지 않는다.

const KEY = 'mob.hint.seen';
const LIFE_MS = 3200;

export function createHint(element) {
  let timer = 0;
  let done = false;

  try {
    if (localStorage.getItem(KEY)) done = true;
  } catch {
    /* 저장이 막혀 있으면 매 방문에 한 번 보여 준다. 나쁘지 않다. */
  }

  function hide() {
    clearTimeout(timer);
    element.dataset.on = '0';
  }

  return {
    show() {
      if (done) return;
      done = true;
      try {
        localStorage.setItem(KEY, '1');
      } catch {
        /* 무시 */
      }
      element.dataset.on = '1';
      timer = setTimeout(hide, LIFE_MS);
    },
    hide,
  };
}
