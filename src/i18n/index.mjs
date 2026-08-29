// 언어 — 문자열 사전과 t()
//
// 요구사항 9장.
//   기본은 영어. 목록은 영어와 한국어. 문자열 파일만 추가하면 늘어난다.
//   경로에 언어를 넣지 않는다. 좌표가 이미 해시에 있고 검색 노출이 목표가 아니다.
//   선택은 localStorage 에 저장한다 (무늬와 달리 방문을 넘어 남는다).

// JSON import 는 Node 와 번들러가 서로 다른 문법을 요구한다.
// Node 는 `with { type: 'json' }` 을 강제하고 예전 번들러는 그것을 모른다.
// 사전을 그냥 모듈로 두면 그 갈림이 아예 없어진다. 번역하기도 어렵지 않다.
import en from './en.mjs';
import ko from './ko.mjs';

const TABLES = { en, ko };
const STORE_KEY = 'mob.lang';
export const LANGUAGES = Object.keys(TABLES);

/**
 * 첫 방문의 언어.
 *
 * Node 에서도 불린다 (테스트가 label.mjs 를 통해 들어온다). 그래서 브라우저
 * 전역이 없어도 던지지 않는다. 없으면 영어다.
 */
function detect() {
  try {
    const saved = globalThis.localStorage?.getItem(STORE_KEY);
    if (saved && TABLES[saved]) return saved;
  } catch {
    /* 저장이 막혀 있어도 이번 방문에는 문제가 없다 */
  }
  const nav = globalThis.navigator;
  const tags = nav?.languages ?? (nav?.language ? [nav.language] : []);
  for (const tag of tags) {
    const base = String(tag).toLowerCase().split('-')[0];
    if (TABLES[base]) return base;
  }
  return 'en';
}

let current = detect();

export function language() {
  return current;
}

export function meta(code) {
  return {
    code,
    name: TABLES[code]['meta.language'],
    native: TABLES[code]['meta.native'],
  };
}

/**
 * 문자열 하나. 없으면 영어로, 영어에도 없으면 키를 그대로 돌려준다.
 * 조용히 빈 칸이 되는 것보다 키가 보이는 편이 낫다.
 */
export function t(key, values) {
  const text = TABLES[current][key] ?? TABLES.en[key] ?? key;
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (_, name) => (name in values ? String(values[name]) : `{${name}}`));
}

const listeners = new Set();

export function onLanguageChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 언어를 실제로 갈아 끼운다. 저장은 하지 않는다. */
function adopt(code) {
  current = code;
  if (globalThis.document) applyStaticText();
  for (const listener of listeners) listener(code);
}

export function setLanguage(code) {
  if (!TABLES[code] || code === current) return false;
  try {
    globalThis.localStorage?.setItem(STORE_KEY, code);
  } catch {
    /* 저장이 막혀 있어도 이번 방문에는 바뀐 채로 남는다 */
  }
  adopt(code);
  return true;
}

// 탭이 여러 개 열려 있을 때. 한쪽에서 바꾸면 나머지도 따라온다.
//
// 이것이 없으면 탭 A 에서 영어로 바꾸고 탭 B 로 돌아왔을 때 B 는 한국어로
// 남는다. 저장된 값과 화면이 어긋난 상태이며, 관람객에게는 "바꿨는데 안 바뀐다"
// 로 보인다. 새로고침해야 겨우 맞는다.
globalThis.addEventListener?.('storage', event => {
  if (event.key !== STORE_KEY) return;
  const next = event.newValue;
  if (!next || !TABLES[next] || next === current) return;
  adopt(next);
});

/** data-i18n 이 붙은 요소를 한 번에 채운다. */
export function applyStaticText(root = document) {
  for (const element of root.querySelectorAll('[data-i18n]')) {
    element.textContent = t(element.dataset.i18n);
  }
  for (const element of root.querySelectorAll('[data-i18n-label]')) {
    element.setAttribute('aria-label', t(element.dataset.i18nLabel));
  }
  document.documentElement.lang = current;
}
