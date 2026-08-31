// 팜플렛 — 접힌 종이를 펼친다
//
// 미니맵을 누르면 열린다. 세 폭이고 폭마다 하나의 물음에 답한다.
//
//   1폭  지금 내 자리      층 전체를 담은 네모 안의 점
//   2폭  건물 단면도       층 목록. 누르면 그 층의 무작위 자리로
//   3폭  로비와 체험관     로비로 · 체험관으로
//
// ── 왜 미니맵과 다른 그림인가 ────────────────────────────────────────────
//
// 미니맵은 내 자리를 **가운데**에 두고 주변을 보여 준다. 팜플렛은 반대다. 층
// 전체를 네모 하나로 두고 그 안 어디쯤인지를 점으로 찍는다. 둘은 다른 물음에
// 답한다 — "옆에 무엇이 있나" 와 "이 층에서 나는 어디쯤인가".
//
// ── 좌표를 어떻게 비율로 바꾸는가 ────────────────────────────────────────
//
// 층 32의 좌표는 1,600비트가 넘는다. Number 로 바꾸면 Infinity 이거나 정밀도를
// 잃는다. 그래서 **위쪽 비트만** 본다. 점 하나의 자리를 정하는 데 필요한 것은
// 상위 몇 자리뿐이고, 그 아래는 화면에서 같은 픽셀이다.

import { FLOORS, floorFor } from '../floors.mjs';
import { ROOMS, roomOf, isLobbyTier, tierSpec, LOBBY_AXIS_BITS } from '../codec.mjs';
import { MINIMAP_MODES } from '../minimap.mjs';
import { t } from '../i18n/index.mjs';

/** 비율을 잴 때 볼 상위 비트 수. 2^20 이면 화면 한 점보다 훨씬 곱다. */
const PRECISION = 20;

/**
 * 좌표를 0..1 비율로. 축 전체에서 어디쯤인가.
 *
 * 축이 좁으면(로비의 6비트) 그대로 나누고, 넓으면 상위 비트만 남기고 나눈다.
 */
export function axisFraction(value, axisBits) {
  if (axisBits <= PRECISION) {
    return Number(value) / 2 ** axisBits;
  }
  const shift = BigInt(axisBits - PRECISION);
  return Number(value >> shift) / 2 ** PRECISION;
}

export function createPamphlet({
  onGoFloor,
  onGoLobby,
  onGoWorkshop,
  getSpot,
  getMapMode,
  onMapMode,
}) {
  const scrim = document.getElementById('scrim-pamphlet');
  const sheet = document.getElementById('pamphlet');
  const dot = document.getElementById('pamphlet-dot');
  const floorLine = document.getElementById('pamphlet-floor');
  const roomLine = document.getElementById('pamphlet-room');
  const list = document.getElementById('pamphlet-floors');
  const modeRow = document.getElementById('pamphlet-mode-row');

  let closing = 0;
  let opener = null;

  /**
   * 지도를 보는 방식을 고르는 칸.
   *
   * 왜 여기 있는가: 미니맵 자체에 단추를 얹으면 지도가 좁아지고, 지도를 누르는
   * 일(팜플렛 펼치기)과 부딪힌다. 팜플렛은 이미 지도에 관한 종이다.
   */
  function renderModes() {
    const current = getMapMode?.() ?? 'colour';
    modeRow.replaceChildren(
      ...MINIMAP_MODES.map(mode => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'segment';
        button.dataset.mode = mode;
        if (mode === current) button.setAttribute('aria-current', 'true');
        button.textContent = t(`pamphlet.mode.${mode}`);
        return button;
      }),
    );
  }

  /** 층 목록을 짓는다. 아래가 로비, 위가 깊은 층이다(CSS 가 뒤집어 쌓는다). */
  function renderFloors(spot) {
    const items = [];

    for (const floor of FLOORS) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      // 층 고르기 모달과 같은 부품이다. 같은 일을 하는 목록이 서로 달라 보이면
      // 안 된다.
      button.className = 'lang';
      button.dataset.tier = String(floor.tier);
      if (floor.tier === spot.tier && !spot.workshop) {
        button.setAttribute('aria-current', 'true');
      }

      const name = document.createElement('span');
      name.textContent = floor.isLobby ? t('floor.lobby') : t('floor.name', { level: floor.level });

      const grid = document.createElement('span');
      grid.className = 'lang-native';
      grid.textContent = floor.grid;

      button.append(name, grid);
      item.append(button);
      items.push(item);

      // 체험관은 로비에 딸린 방이다. 로비 바로 위(목록에서는 바로 다음)에 둔다.
      if (floor.isLobby) {
        const inside = document.createElement('li');
        const enter = document.createElement('button');
        enter.type = 'button';
        enter.className = 'lang fold-inside';
        enter.dataset.workshop = '1';
        if (spot.workshop) enter.setAttribute('aria-current', 'true');
        const label = document.createElement('span');
        label.textContent = t('lobby.workshop');
        enter.append(label);
        inside.append(enter);
        items.push(inside);
      }
    }

    list.replaceChildren(...items);
  }

  /** 1폭을 채운다. 점의 자리와 두 줄의 글. */
  function renderHere(spot) {
    const lobby = isLobbyTier(spot.tier);
    const axisBits = lobby ? LOBBY_AXIS_BITS : tierSpec(spot.tier).axisBits;
    dot.style.left = `${axisFraction(spot.x, axisBits) * 100}%`;
    dot.style.top = `${axisFraction(spot.y, axisBits) * 100}%`;

    floorLine.textContent = spot.workshop
      ? t('lobby.workshop')
      : lobby
        ? t('floor.lobby')
        : t('floor.name', { level: floorFor(spot.tier).level });

    // 전시실은 작품 층에만 있다. 로비에서는 그 줄을 비운다 — 없는 것을
    // 있는 것처럼 적으면 안 된다.
    if (lobby) {
      roomLine.textContent = t('pamphlet.lobbyNote');
      return;
    }
    const index = roomOf(spot.x, spot.y);
    roomLine.textContent = `${t(`room.${ROOMS[index].name}`)} · ${index + 1}`;
  }

  function open() {
    clearTimeout(closing);
    opener = document.activeElement;
    const spot = getSpot();
    renderHere(spot);
    renderFloors(spot);
    renderModes();

    // 접힌 상태로 붙이고 다음 프레임에 펼친다. 같은 프레임에 두 상태를 주면
    // 브라우저가 하나로 합쳐서 모션이 없다.
    scrim.classList.add('folded');
    scrim.hidden = false;
    requestAnimationFrame(() => scrim.classList.remove('folded'));
  }

  function close() {
    if (scrim.hidden) return;
    // 접히는 모습을 보여 준 뒤에 숨긴다. hidden 을 먼저 주면 즉시 사라진다.
    scrim.classList.add('folded');
    clearTimeout(closing);
    closing = setTimeout(() => {
      scrim.hidden = true;
    }, 460);
    // 어디서 열었는지로 초점을 돌려준다. 키보드만 쓰는 사람에게 필요하다.
    if (opener instanceof HTMLElement) opener.focus();
  }

  list.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    close();
    if (button.dataset.workshop === '1') {
      onGoWorkshop();
      return;
    }
    const tier = Number(button.dataset.tier);
    // 로비를 고르면 로비 가운데로. 작품 층은 그 층의 무작위 자리로.
    if (isLobbyTier(tier)) onGoLobby();
    else onGoFloor(tier);
  });

  // 지도 방식을 바꾸는 것은 자리를 옮기는 일이 아니다. 팜플렛을 닫지 않는다 —
  // 바뀐 지도를 바로 확인하려면 지도가 보여야 하고, 지도는 팜플렛 밖에 있다.
  // 그래서 칸만 갱신하고 열린 채로 둔다.
  modeRow.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    onMapMode?.(button.dataset.mode);
    renderModes();
  });

  document.getElementById('pamphlet-to-lobby').addEventListener('click', () => {
    close();
    onGoLobby();
  });
  document.getElementById('pamphlet-to-workshop').addEventListener('click', () => {
    close();
    onGoWorkshop();
  });

  scrim.addEventListener('click', event => {
    if (event.target === scrim || event.target.closest('[data-close]')) close();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !scrim.hidden) close();
  });

  return {
    open,
    close,
    toggle() {
      if (scrim.hidden) open();
      else close();
    },
    /** 화면 검사가 보는 상태. */
    get state() {
      return scrim.hidden ? 'hidden' : scrim.classList.contains('folded') ? 'folding' : 'open';
    },
    /** 언어가 바뀌면 열린 채로 다시 짓는다. */
    refresh() {
      if (scrim.hidden) return;
      const spot = getSpot();
      renderHere(spot);
      renderFloors(spot);
      renderModes();
    },
    get element() {
      return sheet;
    },
  };
}
