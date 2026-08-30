// 토스트 — 짧게 알리고 사라진다
//
// 요구사항 8장. 읽을 수 없는 입력 · 투영 실패 · 디버그 발동을 여기로 알린다.
// 조용한 실패보다 시끄러운 정직함이 낫다.
//
// ── 머무는 시간은 문구 길이에서 나온다 ──────────────────────────────────
//
// 예전에는 무엇을 알리든 2.4초였다. 짧은 "복사했습니다" 에는 넉넉하지만 두 줄짜리
// 설명에는 다 읽기 전에 사라졌다. 그래서 글자 수로 시간을 정한다.
//
// 글자 수를 그냥 세면 안 된다. 같은 내용을 한국어·일본어·중국어는 라틴 문자보다
// 훨씬 적은 글자로 적는다. 글자당 같은 시간을 주면 그 언어들만 짧게 머문다.
// 그래서 CJK 글자에 가중치를 준다. 다섯 언어가 비슷한 시간을 받게 하는 것이 목적이다.
//
// 아래 프로그레스바가 남은 시간을 보여 준다. 얼마나 남았는지 눈으로 알 수 있으면
// 사라지는 것이 갑작스럽지 않고, 놓쳤을 때 "지금 사라졌다" 를 알 수 있다.

/** 문구가 없어도 눈에 들어올 최소 시간. */
const MIN_MS = 2600;
/** 아무리 길어도 이보다 오래 붙잡지 않는다. 화면을 가린다. */
const MAX_MS = 7200;
/** 읽기 시작하는 데 드는 몫. 글자 수와 무관하다. */
const BASE_MS = 1900;
/** 라틴 글자 하나당. */
const PER_UNIT_MS = 95;

/**
 * CJK 글자는 라틴 글자보다 많은 정보를 담는다. 읽는 시간도 그만큼 더 걸린다.
 * 2.1 은 다섯 언어의 같은 문구가 비슷한 시간을 받도록 고른 값이다.
 */
const CJK_WEIGHT = 2.1;

/** 한글 · 한자 · 가나가 시작되는 자리. 이 위는 CJK 로 센다. */
const CJK_START = 0x2e80;

/** 문구를 다 읽는 데 줄 시간. */
export function lifeFor(message) {
  let units = 0;
  for (const character of String(message)) {
    units += character.codePointAt(0) >= CJK_START ? CJK_WEIGHT : 1;
  }
  const wanted = BASE_MS + units * PER_UNIT_MS;
  return Math.round(Math.min(MAX_MS, Math.max(MIN_MS, wanted)));
}

export function createToasts(host) {
  return function toast(message, { life } = {}) {
    const ms = life ?? lifeFor(message);

    const element = document.createElement('div');
    element.className = 'toast surface';
    // 프로그레스바가 이 값으로 애니메이션 길이를 맞춘다. 두 곳에 같은 수를
    // 적으면 반드시 어긋나므로 한 곳에서만 정한다.
    element.style.setProperty('--toast-life', `${ms}ms`);

    const text = document.createElement('span');
    text.className = 'toast-text';
    text.textContent = message;

    // 남은 시간. 읽히는 정보가 아니라 장식이므로 보조기기에서 숨긴다.
    const progress = document.createElement('div');
    progress.className = 'toast-progress';
    progress.setAttribute('aria-hidden', 'true');

    element.append(text, progress);
    host.append(element);

    setTimeout(() => {
      element.dataset.out = '1';
      setTimeout(() => element.remove(), 280);
    }, ms);

    return element;
  };
}
