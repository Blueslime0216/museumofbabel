// 언어 — 문자열 사전과 t()
//
// 요구사항 9장.
//   기본은 영어. 목록은 영어와 한국어. 문자열 파일만 추가하면 늘어난다.
//   경로에 언어를 넣지 않는다. 좌표가 이미 해시에 있고 검색 노출이 목표가 아니다.
//   선택은 localStorage 에 저장한다 (무늬와 달리 방문을 넘어 남는다).

import en from './en.json';
import ko from './ko.json';

const TABLES = { en, ko };
const STORE_KEY = 'mob.lang';
export const LANGUAGES = Object.keys(TABLES);

/** 첫 방문의 언어. 한국어가 아니면 영어다. */
function detect() {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved && TABLES[saved]) return saved;
  } catch {
    /* 저장이 막혀 있어도 이번 방문에는 문제가 없다 */
  }
  for (const tag of navigator.languages ?? [navigator.language ?? 'en']) {
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

export function setLanguage(code) {
  if (!TABLES[code] || code === current) return false;
  current = code;
  try {
    localStorage.setItem(STORE_KEY, code);
  } catch {
    /* 무시 */
  }
  document.documentElement.lang = code;
  applyStaticText();
  for (const listener of listeners) listener(code);
  return true;
}

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
