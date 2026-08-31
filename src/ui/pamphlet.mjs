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
import { floorThumbnail } from '../minimap.mjs';
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

/**
 * 평면도에서 누른 자리 → 좌표.
 *
 * ── 한 점이 얼마나 넓은가 ────────────────────────────────────────────────
 *
 * 평면도는 200px 남짓이고 층 32의 축은 2^12812 칸이다. 한 점 안에 들어가는 칸이
 * 상상할 수 없이 많다. 그러니 "누른 그 칸" 이라는 것은 없다.
 *
 * 그래서 **그 점이 덮는 구간의 가운데**로 간다. 오차는 그 점의 절반, 곧 지도에서
 * 반 픽셀이다. 지도를 눌러 옮기는 일에 그보다 정밀한 뜻은 없다.
 *
 * 가운데로 가는 것이 구간의 시작으로 가는 것보다 낫다. 시작으로 가면 지도의 왼쪽
 * 위를 눌렀을 때 늘 좌표 0에 떨어지고, 그 자리는 층마다 같은 그림이라 "지도를
 * 눌러도 같은 데로 간다" 로 읽힌다.
 */
export function spotFromFraction(fraction, axisBits, pixels) {
  const axis = 1n << BigInt(axisBits);
  const steps = BigInt(Math.max(1, Math.round(pixels)));
  const band = axis / steps || 1n;
  // 누른 점의 번호. 끝을 눌러도 축 안에 남아야 한다.
  const at = BigInt(Math.min(Math.max(0, Math.floor(fraction * Number(steps))), Number(steps) - 1));
  return (band * at + band / 2n) & (axis - 1n);
}

export function createPamphlet({ onGoFloor, onGoLobby, onGoWorkshop, onGoSpot, getSpot }) {
  const scrim = document.getElementById('scrim-pamphlet');
  const sheet = document.getElementById('pamphlet');
  const dot = document.getElementById('pamphlet-dot');
  const floorLine = document.getElementById('pamphlet-floor');
  const roomLine = document.getElementById('pamphlet-room');
  const list = document.getElementById('pamphlet-floors');
  const plan = document.getElementById('pamphlet-plan');
  const thumb = document.getElementById('pamphlet-thumb');
  const thumbCtx = thumb.getContext('2d');
  const pin = document.getElementById('pamphlet-pin');
  const ask = document.getElementById('pamphlet-ask');

  let closing = 0;
  let opener = null;
  /** 웨이포인트가 가리키는 자리. 없으면 null. */
  let waypoint = null;

  /** 축소도 원본. 표본 크기 그대로 두고 그릴 때 확대한다. */
  const source = document.createElement('canvas');
  const sourceCtx = source.getContext('2d');

  /** 평면도의 배경을 그린다. 층이 바뀔 때만 값이 든다. */
  function renderThumbnail(spot) {
    const lobby = isLobbyTier(spot.tier);
    const rect = plan.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const size = Math.max(1, Math.round(rect.width * dpr));
    if (thumb.width !== size || thumb.height !== size) {
      thumb.width = size;
      thumb.height = size;
    }
    thumbCtx.clearRect(0, 0, size, size);
    // 로비는 작품이 없으므로 축소도가 없다. 벽 색이 그대로 보인다.
    if (lobby) return;

    const { samples, rgba } = floorThumbnail({ tier: spot.tier, locality: spot.locality });
    if (source.width !== samples) {
      source.width = samples;
      source.height = samples;
    }
    sourceCtx.putImageData(new ImageData(rgba, samples, samples), 0, 0);
    thumbCtx.imageSmoothingEnabled = false;
    thumbCtx.drawImage(source, 0, 0, samples, samples, 0, 0, size, size);
  }

  /** 웨이포인트를 치운다. 물어보던 것도 함께 사라진다. */
  function clearPin() {
    waypoint = null;
    pin.hidden = true;
    ask.hidden = true;
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
    // 지난번에 세워 둔 웨이포인트는 남기지 않는다. 그 사이에 걸어 다녔을 수 있고,
    // 다른 층일 수도 있다.
    clearPin();
    renderHere(spot);
    renderFloors(spot);

    // 접힌 상태로 붙이고 다음 프레임에 펼친다. 같은 프레임에 두 상태를 주면
    // 브라우저가 하나로 합쳐서 모션이 없다.
    scrim.classList.add('folded');
    scrim.hidden = false;
    // 배경 축소도는 폭이 자리를 잡은 뒤에 잰다. 접힌 상태에서 재면 크기가 0이다.
    requestAnimationFrame(() => {
      scrim.classList.remove('folded');
      renderThumbnail(spot);
    });
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

  // 지도를 보는 방식과 배율은 **미니맵 자체의 조작 줄**이 맡는다. 팜플렛에 두면
  // 바꾼 결과를 보려고 종이를 닫아야 했다 — 조작하는 곳과 결과가 보이는 곳이
  // 달랐다. 지금은 지도 아래 단추가 바로 그 지도를 바꾼다.

  /**
   * 평면도를 눌렀다. 그 자리에 웨이포인트를 세우고 갈지 묻는다.
   *
   * 곧바로 옮기지 않는 이유: 한 점이 덮는 넓이가 어마어마하므로 손이 스친 것과
   * 고른 것을 구분해야 한다. 물어보면 고친 기회도 생긴다 — 다시 누르면 옮겨진다.
   */
  plan.addEventListener('click', event => {
    const spot = getSpot();
    const rect = plan.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const fy = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    const axisBits = isLobbyTier(spot.tier) ? LOBBY_AXIS_BITS : tierSpec(spot.tier).axisBits;
    // 누를 수 있는 자리의 수는 평면도의 픽셀 수다. 그것이 이 지도의 해상도다.
    const pixels = Math.round(rect.width);

    waypoint = {
      tier: spot.tier,
      locality: spot.locality,
      workshop: spot.workshop,
      x: spotFromFraction(fx, axisBits, pixels),
      y: spotFromFraction(fy, axisBits, pixels),
    };

    pin.style.left = `${fx * 100}%`;
    pin.style.top = `${fy * 100}%`;
    pin.hidden = false;
    ask.hidden = false;
  });

  document.getElementById('pamphlet-go').addEventListener('click', () => {
    if (!waypoint) return;
    const going = waypoint;
    close();
    onGoSpot?.(going);
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
      },
    get element() {
      return sheet;
    },
  };
}
