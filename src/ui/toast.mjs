// 토스트 — 짧게 알리고 사라진다
//
// 요구사항 8장. 읽을 수 없는 입력 · 투영 실패 · 디버그 발동을 여기로 알린다.
// 조용한 실패보다 시끄러운 정직함이 낫다.

const LIFE_MS = 2400;

export function createToasts(host) {
  return function toast(message, { life = LIFE_MS } = {}) {
    const element = document.createElement('div');
    element.className = 'toast surface';
    element.textContent = message;
    host.append(element);

    setTimeout(() => {
      element.dataset.out = '1';
      setTimeout(() => element.remove(), 280);
    }, life);

    return element;
  };
}
