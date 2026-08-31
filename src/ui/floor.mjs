// 층 모달 — 가운데에 목록
//
// 층을 바꾸면 축 비트 수가 달라져 **같은 좌표가 전혀 다른 그림**이 된다.
// 그래서 지금 자리를 유지하려는 시도를 하지 않는다. 새 층의 무작위 자리로 간다.
// 그것이 정직하고, 관람객에게도 "다른 층은 다른 미술관" 으로 읽힌다.

import { FLOORS, floorFor } from '../floors.mjs';
import { t } from '../i18n/index.mjs';

export function createFloorPicker({ onGo, getTier }) {
  const scrim = document.getElementById('scrim-floor');
  const list = document.getElementById('floor-list');

  function render() {
    const current = floorFor(getTier()).tier;

    list.replaceChildren(
      ...FLOORS.map(floor => {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.className = 'lang';
        button.type = 'button';
        button.dataset.tier = String(floor.tier);
        if (floor.tier === current) button.setAttribute('aria-current', 'true');

        const name = document.createElement('span');
        // 로비는 "0층" 이 아니라 로비다. 팜플렛의 단면도와 같은 이름을 써야
        // 두 곳이 같은 건물을 말하는 것으로 읽힌다.
        name.textContent = floor.isLobby
          ? t('floor.lobby')
          : t('floor.name', { level: floor.level });

        const size = document.createElement('span');
        size.className = 'lang-native';
        size.textContent = floor.grid;

        button.append(name, size);
        item.append(button);
        return item;
      }),
    );
  }

  list.addEventListener('click', event => {
    const button = event.target.closest('.lang');
    if (!button) return;
    const tier = Number(button.dataset.tier);
    scrim.hidden = true;
    // 같은 층을 다시 골라도 옮겨 준다. "다시 무작위" 로 쓸 수 있다.
    onGo(tier);
  });

  scrim.addEventListener('click', event => {
    if (event.target === scrim || event.target.closest('[data-close]')) scrim.hidden = true;
  });

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
  };
}
