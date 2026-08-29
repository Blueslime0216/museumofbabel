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

        const name = document.createElement('span');
        name.textContent = info.name;
        const native = document.createElement('span');
        native.className = 'lang-native';
        native.textContent = info.native;

        button.append(name, native);
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
