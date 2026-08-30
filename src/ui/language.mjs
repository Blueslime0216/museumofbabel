// 언어 모달 — 가운데에 목록
//
// 요구사항 9장. 우상단 버튼을 누르면 열리고 목록에서 고른다.

import { LANGUAGES, language, meta, setLanguage, t } from '../i18n/index.mjs';

export function createLanguagePicker({ onChange }) {
  const scrim = document.getElementById('scrim-language');
  const list = document.getElementById('lang-list');

  function render() {
    list.replaceChildren(
      ...LANGUAGES.map(code => {
        const info = meta(code);
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.className = 'lang';
        button.type = 'button';
        button.dataset.lang = code;
        if (code === language()) button.setAttribute('aria-current', 'true');

        // `Korean (한국어)` 처럼 한 줄로 모아 가운데 놓는다. 예전에는 이름과
        // 자국어 표기를 양 끝으로 밀어 두었는데, 칸이 넓어서 둘이 멀찍이 떨어져
        // 한 언어의 두 표기로 읽히지 않았다.
        //
        // 자국어 표기는 **따로 감싼다.** 화면 검사가 "영어를 골랐을 때 화면에
        // 한글이 남아 있지 않다" 를 확인하는데, 언어 목록의 자국어 표기는 일부러
        // 그 나라 글자로 두는 예외다. 그 예외를 `.lang-native` 로 알아본다.
        const label = document.createElement('span');
        label.className = 'lang-label';

        if (info.native === info.name) {
          // 영어처럼 두 표기가 같으면 괄호가 군더더기다
          label.textContent = info.name;
        } else {
          const native = document.createElement('span');
          native.className = 'lang-native';
          native.textContent = info.native;
          label.append(document.createTextNode(`${info.name} (`), native, document.createTextNode(')'));
        }

        button.append(label);
        item.append(button);
        return item;
      }),
    );
  }

  list.addEventListener('click', event => {
    const button = event.target.closest('.lang');
    if (!button) return;
    const changed = setLanguage(button.dataset.lang);
    scrim.hidden = true;
    if (changed) {
      render();
      onChange?.(button.dataset.lang);
    }
  });

  scrim.addEventListener('click', event => {
    if (event.target === scrim || event.target.closest('[data-close]')) scrim.hidden = true;
  });

  render();

  return {
    open() {
      render();
      scrim.hidden = false;
    },
    close() {
      scrim.hidden = true;
    },
    get isOpen() {
      return !scrim.hidden;
    },
    refresh: render,
    get label() {
      return t('controls.language');
    },
  };
}
