// 시작과 배선
//
// 여기에는 계산이 없다. 무엇을 언제 부르는지만 있다.
//
//   camera   어디를 보는가
//   curtain  자리를 옮길 때의 암전 → 교체 → 개방
//   stage    캔버스에 무엇을 어디에 찍는가
//   tiles    비트맵을 어떻게 가져오는가
//   theme    UI 무늬 (방문 하나 동안 유지)
//   hash     주소 읽기와 쓰기
//   sheet    고른 전시물의 정보

import {
  tierSpec,
  coordinatesToCode,
  localityMix,
  randomCoordinate,
  axisBitsFor,
  isLobbyTier,
  // 로비 물건의 그림을 여기서 직접 그린다. 이유는 renderAddress 참조.
  CANVAS,
  renderCode,
  createFrame,
  styleAt,
} from './codec.mjs';
import { lobbyHome, lobbyObjects, workshopObjects } from './lobby.mjs';
import { PATRONS } from './patrons.mjs';
import { createCamera, MIN_CELL } from './camera.mjs';
import { zoomBudgetFor, isDeepestFloor } from './floors.mjs';
import { ROOMS, CLUSTER_SPAN, roomOf } from './codec.mjs';
import { createCurtainState, attachCurtain, PHASE, OPEN_MIN_MS } from './curtain.mjs';
import { createTiles } from './tiles.mjs';
import { createStage } from './stage.mjs';
import { createInput } from './input.mjs';
import { readState, readLegacyHash, createHashWriter } from './hash.mjs';
import { applyTheme } from './theme.mjs';
import { createToasts } from './ui/toast.mjs';
import { createSheet } from './ui/sheet.mjs';
import { createHint } from './ui/hint.mjs';
import { createSearch } from './ui/search.mjs';
import { createLanguagePicker } from './ui/language.mjs';
import { createFloorPicker } from './ui/floor.mjs';
import { createMinimap } from './ui/minimap.mjs';
import { createPamphlet } from './ui/pamphlet.mjs';
import { LOBBY_TIER } from './codec.mjs';
import { applyStaticText, onLanguageChange, t } from './i18n/index.mjs';
import { attachDebug } from './ui/debug.mjs';

/** 개방이 시작될 때의 줌 배율. 3×3 쯤이 보이는 상태에서 벌어진다. */
const OPEN_FROM = 1.85;

/**
 * 이 시간에 전시물 한 장을 그리는 기기에서 최소 개방(400ms)이 편안하다.
 *
 * 실측(데스크톱): 층4 0.474ms · 층8 0.515 · 층16 0.609 · 층32 1.104.
 * 기준을 0.6 으로 두면 얕은 층은 최소값으로 열리고 층32 는 1.8배쯤 늘어난다.
 * 오래된 휴대폰은 한 장이 몇 ms 이므로 훨씬 더 늘어난다.
 */
const OPEN_REFERENCE_MS = 0.6;

/**
 * 이번 개방을 얼마나 오래 열 것인가.
 *
 * 두 가지를 본다.
 *   느린 기기냐            한 장 그리는 시간이 기준보다 길면 그 비율만큼 늘린다
 *   미리 렌더가 남았느냐   남은 것이 도착할 시간을 더한다
 *
 * 개방 중에는 프레임마다 화면을 다시 그린다. 그래서 개방이 길면 그 자체가
 * 부담이다. 빠른 기기에서 1.4초를 끄는 것은 지루하기만 한 것이 아니라 실제로
 * 일을 더 하는 것이었다. 400ms 면 프레임 수가 84 → 24 로 줄어든다.
 *
 * @param missing preheat 이 끝내지 못한 전시물 개수
 */
function openDurationFor(missing) {
  const perTile = tiles.stats.avgMs || OPEN_REFERENCE_MS;
  let ms = OPEN_MIN_MS * Math.max(1, perTile / OPEN_REFERENCE_MS);
  // 아직 오지 않은 것들이 개방 중에 도착하게 한다. 워커가 둘이므로 절반으로 센다.
  if (missing > 0) ms += (missing * perTile) / 2;
  return ms;
}

/** 방향키로 옮길 때 이 크기보다 작으면 감상할 수 있게 줌인해 준다. */
const READING_CELL = 150;

const canvas = document.getElementById('stage');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── 상태 ─────────────────────────────────────────────────────────────────

let state = readState();
let spec = isLobbyTier(state.tier) ? null : tierSpec(state.tier);
let dirty = true;
let restZoom = 120;

/**
 * 개방이 줌을 몰고 있는가.
 *
 * 개방 중에는 프레임마다 `forceZoom` 으로 줌을 직접 몬다. 그런데 그 사이에 손이
 * 휠이나 핀치로 줌하면, `zoomAround` 가 붙잡은 점을 고정하려고 x·y 를 옮긴 뒤
 * 다음 프레임의 `forceZoom` 이 줌만 되돌려 놓는다. 그러면 **옮겨진 x·y 만 남아서**
 * 화면 가운데가 아닌 엉뚱한 곳을 중심으로 줌한 것처럼 보인다. 실제 버그였다.
 *
 * 그래서 손이 줌하면 개방은 줌 몰기를 포기하고 손에 넘긴다. 커튼은 계속 열리고
 * 카메라만 사용자 것이 된다. 막아 버리는 것보다 이쪽이 낫다 — 인트로 중에 줌해
 * 보는 사람은 그 층을 얼마나 넓게 볼 수 있는지 확인하려는 것이다.
 */
let openDrivesZoom = true;
let keyboardMode = false;

const camera = createCamera({ x: 0, y: 0, zoom: 120 });
const curtain = createCurtainState({ reducedMotion });
const paintCurtain = attachCurtain(document.getElementById('curtain'), curtain);
const hash = createHashWriter();
const toast = createToasts(document.getElementById('toasts'));
const hint = createHint(document.getElementById('hint'));

const tiles = createTiles({
  workerCount: navigator.hardwareConcurrency >= 8 ? 3 : 2,
  onArrive: key => {
    dirty = true;
    // 시트가 기다리던 그림이 도착했으면 채워 준다.
    if (wantedForSheet === key) {
      wantedForSheet = null;
      openSheetAt(sheetCell.i, sheetCell.j);
    }
  },
});

const stage = createStage({ canvas, camera, tiles, zoomBudgetFor, reducedMotion });
const announcer = document.getElementById('announcer');

const sheet = createSheet({
  toast,
  // 캔버스에는 읽어 줄 DOM 이 없다. 라벨을 여기서 읽어 준다.
  onShow: info => {
    announcer.textContent = `${info.title}. ${t('sheet.accession', { id: info.accession })}`;
  },
});

const search = createSearch({
  toast,
  getWorld: () => ({ tier: state.tier, locality: state.locality }),
  onGo: destination => goto(destination),
});

const floorPicker = createFloorPicker({
  getTier: () => state.tier,
  // 층이 바뀌면 축 비트 수가 달라져 같은 좌표가 다른 그림이 된다.
  // 지금 자리를 유지하려 하지 않고 새 층의 무작위 자리로 간다.
  onGo: tier => jumpRandom(tier),
});

const languagePicker = createLanguagePicker({
  onChange: () => {
    sheet.refresh();
    floorPicker.refresh();
    pamphlet.refresh();
  },
});

/**
 * 팜플렛. 미니맵을 누르면 펼쳐진다.
 *
 * 자리를 물어보는 함수를 넘긴다(getSpot). 팜플렛이 열릴 때의 자리여야 하므로
 * 값을 미리 주면 안 된다 — 열고 닫는 사이에 걸어 다닌다.
 */
const pamphlet = createPamphlet({
  getSpot: () => ({
    tier: state.tier,
    locality: state.locality,
    // 중앙 칸의 좌표. state 의 좌표는 층에 들어온 순간의 것이다.
    x: mapSpot?.x ?? state.x,
    y: mapSpot?.y ?? state.y,
    workshop: Boolean(state.workshop),
  }),
  // 층을 고르면 그 층의 무작위 자리로. 층 모달과 같은 규칙이다.
  onGoFloor: tier => jumpRandom(tier),
  onGoLobby: () => goto({ tier: LOBBY_TIER, ...lobbyHome(), workshop: false }),
  onGoWorkshop: () => goto({ tier: LOBBY_TIER, ...lobbyHome(), workshop: true }),
  // 지도를 보는 방식. 팜플렛이 고르고 미니맵이 그린다.
  getMapMode: () => minimap.mode,
  onMapMode: mode => {
    minimap.setMode(mode);
    mapDirty = true;
  },
});

const minimap = createMinimap({
  button: document.getElementById('minimap'),
  onOpen: () => pamphlet.toggle(),
});

let wantedForSheet = null;
let sheetCell = { i: 0, j: 0 };

/**
 * URL 에 마지막으로 적은 중앙 칸.
 *
 * 이것이 없으면 프레임마다 좌표를 만들고 해시 문자열을 만든다. 층 16 에서는
 * 그 하나가 0.04ms 이고, 아무 일도 안 하는 화면에서 계속 태운다.
 * 중앙 칸이 바뀔 때만 hash 를 건드린다. 요구사항 6장이 원래 말한 것이다.
 */
let lastCenter = null;

/** 미니맵의 가운데 좌표. 중앙 칸이 바뀔 때만 새로 만든다. */
let mapSpot = null;

/** 지도를 다시 그려야 하는가. 칸이 바뀌면 선다. */
let mapDirty = false;

/** 지도에 그린 "보이는 범위". 줌이 이만큼 달라지면 다시 그린다. */
let lastAcross = 0;

// ── 화면 크기 ────────────────────────────────────────────────────────────

/**
 * 화면 크기에서 기본 줌을 정한다. 1층 휴대폰에서 3열쯤 보인다.
 *
 * 층마다 다르다. 깊은 층은 더 당겨서 시작한다. 그 층의 최소 줌이 이미 크므로
 * 기본값도 같은 비율로 올려야 "입장하자마자 최소 줌에 붙어 있는" 상태를 피한다.
 * 배수는 floors.mjs 가 정하고 그 근거도 거기에 적어 두었다.
 *
 * 마지막으로 카메라의 한계로 자른다. 층별 최소 줌이 이 값보다 클 수 있다.
 */
function computeRestZoom() {
  const { width, height } = stage.view;
  const shorter = Math.max(1, Math.min(width, height));
  const base = Math.max(MIN_CELL + 40, Math.min(164, shorter / 3.1));
  const { restScale } = zoomBudgetFor(state.tier);
  const { min, max } = camera.zoomBounds;
  return Math.min(Math.max(base * restScale, min), max);
}

function resize() {
  stage.resize();
  // 지도의 그릴 면적도 여기서만 다시 잰다. 프레임마다 재면 배치를 강제로
  // 계산하게 만든다.
  minimap.resize();
  mapDirty = true;
  restZoom = computeRestZoom();
  if (curtain.phase === PHASE.CLEAR) camera.zoomTo(restZoom);
  dirty = true;
}

// ── 자리 옮기기 ──────────────────────────────────────────────────────────

/**
 * 로비 로고. 한 번만 읽어 두고 계속 쓴다.
 *
 * 이 미술관에서 **유일하게 좌표에서 나오지 않는 그림**이다. 표지는 계산될 수
 * 없다. 나머지 물건은 전부 주소로 그린다.
 */
let logoImage = null;

async function loadLogo() {
  if (logoImage) return logoImage;
  try {
    const image = new Image();
    image.src = 'logo.svg';
    await image.decode();
    logoImage = image;
  } catch {
    // 표지를 못 읽어도 로비는 걸어 다닐 수 있어야 한다. 빈 자리로 남는다.
    logoImage = null;
  }
  return logoImage;
}

/**
 * 로비에 놓을 물건을 준비한다. 커튼 뒤에서 부른다.
 *
 * 작품 층에서는 목록을 비운다. 그러면 stage 의 물건 레이어가 통째로 건너뛰어진다.
 */
/**
 * 주소 하나를 그려서 비트맵으로 만든다.
 *
 * 워커를 쓰지 않는다. 로비 물건은 서른 장쯤이고 한 장이 0.5~1.1ms 이므로 전부
 * 합쳐도 한 프레임 남짓이다. 게다가 이 일은 **커튼 뒤에서** 한 번만 일어난다.
 * 워커로 보내면 tier 가 층마다 다른 것(타일은 지금 층 하나만 쓴다)을 다루려고
 * 그쪽 계약을 넓혀야 하는데, 얻는 것이 없다.
 */
async function renderAddress({ tier, locality, x, y }) {
  const artSpec = tierSpec(tier);
  const code = coordinatesToCode(x, y, localityMix(locality, artSpec.axisBits), artSpec.axisBits);
  // 전시실을 적용한다. 로비에 걸린 그림도 그 좌표에 실제로 걸려 있는 그림이어야
  // 한다. 눌러서 찾아갔을 때 다른 그림이 나오면 로비가 거짓말을 한 것이 된다.
  const frame = renderCode(artSpec, code, createFrame(artSpec), styleAt(x, y));
  return createImageBitmap(new ImageData(new Uint8ClampedArray(frame.rgba), CANVAS, CANVAS));
}

async function prepareLobby() {
  if (!isLobbyTier(state.tier)) {
    stage.setLobbyObjects([]);
    return;
  }

  // 같은 층에 방이 둘이다. 로비와 체험관은 바닥이 같고 놓인 물건만 다르다.
  const objects = state.workshop ? workshopObjects() : lobbyObjects({ patrons: PATRONS });

  await Promise.all(
    objects.map(async object => {
      if (object.kind === 'logo') {
        object.bitmap = await loadLogo();
        return;
      }
      try {
        object.bitmap = await renderAddress(object.address);
      } catch {
        // 한 장을 못 그려도 로비는 걸어 다닐 수 있어야 한다. 빈 자리로 남는다.
        object.bitmap = null;
      }
    }),
  );

  stage.setLobbyObjects(objects);
}

/**
 * 로비의 물건을 눌렀다.
 *
 * 로고에는 `action` 이 없다. 표지는 버튼이 아니므로 눌러도 아무 일이 없는 것이
 * 맞다. 눌리는 물건(오늘의 그림 · 후원자 · 체험관 포털)은 뒤에 들어온다.
 */
function tapLobbyObject(object) {
  // 그림을 누르면 그 그림이 실제로 걸려 있는 자리로 간다. 오늘의 그림과 후원자의
  // 그림이 그렇다. 로비에서 본 것과 도착해서 보는 것이 같아야 한다.
  if (object.action === 'artwork' && object.address) {
    goto(object.address);
    return;
  }

  // 체험관으로 들어간다. 층은 그대로다 — 같은 로비 층의 다른 방이다.
  // 도착 자리는 가운데(lobbyHome)이고, 거기 QR 포털이 서 있다.
  if (object.action === 'workshop') {
    goto({ ...lobbyHome(), workshop: true });
    return;
  }

  // 체험관에서 로비로 돌아온다. 문이 양쪽에 같은 좌표로 있다.
  if (object.action === 'lobby') {
    goto({ ...lobbyHome(), workshop: false });
    return;
  }

  // QR 만들기는 별도 페이지(museumofbabel.org/qr)의 자리다. 아직 없다.
  //
  // 지금 링크를 걸어 두면 404 로 나간다. 미술관 안에서 알리고 여기 남는 쪽이
  // 낫다 — 나갔다가 돌아오는 길은 브라우저의 뒤로 가기뿐이다.
  if (object.action === 'qr') {
    toast(t('toast.qrSoon'));
  }
}

function applyWorld() {
  // 로비에는 명세가 없다. spec 을 쓰는 곳은 모두 작품 층 전용이어야 한다.
  spec = isLobbyTier(state.tier) ? null : tierSpec(state.tier);
  // 캐시를 비운다. 새 기준점의 칸은 전부 다른 그림이므로 남겨 둘 이유가 없다.
  // 그냥 두면 층 16 에서 46MB 가 쓸모없이 남아 있게 된다.
  tiles.invalidate();
  stage.setWorld({
    tier: state.tier,
    locality: state.locality,
    baseX: state.x,
    baseY: state.y,
    axisBits: axisBitsFor(state.tier),
  });
  // setWorld 가 그 층의 줌 한계를 카메라에 적용했다. 기본 줌은 그 한계에
  // 의존하므로 여기서 다시 계산해야 한다. 그러지 않으면 층을 옮긴 직후
  // 이전 층의 기본 줌으로 개방한다.
  restZoom = computeRestZoom();
  // 가장 깊은 층에만 아주 약한 비네트를 얹는다. 값은 stage.css 가 쓴다.
  document.body.style.setProperty('--depth', isDeepestFloor(state.tier) ? '1' : '0');
  camera.snapTo({ x: 0, y: 0 });
  lastCenter = null;
  // 층이 바뀌면 지도가 기억한 색을 버린다. 같은 좌표라도 다른 그림이다.
  //
  // 같은 층 안에서 무작위로 옮겨도 여기를 지난다. 칸 번호는 0,0 으로 돌아가므로
  // reset 이 없으면 지도가 "같은 칸" 이라 여기고 이전 자리를 계속 보여 준다.
  mapSpot = null;
  mapDirty = false;
  lastAcross = 0;
  minimap.reset();
}

/**
 * 암전 → 교체 → 개방.
 *
 * 첫 진입은 이미 검은 화면이므로 암전을 건너뛴다.
 */
function goto(next, { first = false } = {}) {
  clearFocus();

  const prepare = async () => {
    state = { ...state, ...next };
    // 체험관 표시는 로비 층에서만 뜻이 있다. 작품 층으로 나가면 지운다.
    // 안 지우면 state 에 남아서 작품 주소에 `&w=1` 이 따라붙는다.
    if (!isLobbyTier(state.tier)) state.workshop = false;
    applyWorld();
    camera.forceZoom(restZoom * OPEN_FROM);
    hash.set(state);
    hash.flush();
    // 개방이 끝난 뒤의 줌으로 준비한다. 지금 줌(줌인)으로 하면 열린 화면에
    // 빈 칸이 남는다. 실제로 그 버그가 있었다.
    //
    // preheat 은 아직 못 그린 개수를 돌려준다. 그 값과 이 기기의 한 장 시간으로
    // 이번 개방의 길이를 정한다.
    // 로비의 물건도 커튼 뒤에서 준비한다. 개방 뒤에 툭 나타나면 안 된다.
    await prepareLobby();

    const missing = await stage.preheat({ zoom: restZoom });
    curtain.setOpen(openDurationFor(missing));

    // 개방이 시작될 때 줌을 몰 권리를 되찾는다. 앞선 개방에서 손이 가져갔을 수 있다.
    openDrivesZoom = true;
    dirty = true;
  };

  if (first) curtain.arrive(prepare, () => hint.show());
  else curtain.travel(prepare);
}

/**
 * 무작위 자리로.
 *
 * 층을 주지 않으면 **지금 층 안에서** 옮긴다. 무작위 버튼이 그렇게 쓴다.
 * 층을 주면 그 층의 무작위 자리로 간다. 층 모달이 그렇게 쓴다.
 */
function jumpRandom(tier = state.tier) {
  // 로비는 순환 공간이 작으므로 무작위로 던지지 않고 가운데로 보낸다.
  // 64x64 안에서 "무작위"는 뜻이 없고, 로비는 헤매는 곳이 아니다.
  if (isLobbyTier(tier)) {
    // 체험관에 있었다면 로비로 나온다. "로비로 간다" 가 체험관 가운데로 가는
    // 것이면 나오는 길이 문 하나로 줄어든다.
    goto({ tier, ...lobbyHome(), workshop: false });
    return;
  }
  const [x, y] = randomCoordinate(axisBitsFor(tier));
  goto({ tier, x, y });
}

// ── 전시물 고르기 ────────────────────────────────────────────────────────

function openSheetAt(i, j) {
  // 로비에는 작품이 없으므로 작품 정보를 열지 않는다.
  // 나중에 여기에 큐레이터와 체험관 포털이 들어온다.
  if (isLobbyTier(state.tier)) return;

  sheetCell = { i, j };
  const [x, y] = stage.coordOf(i, j);
  const key = stage.keyOf(i, j);
  const bitmap = tiles.get(key);

  if (!bitmap) {
    // 아직 안 그려졌다. 도착하면 다시 부른다.
    wantedForSheet = key;
    tiles.want(
      [{ key, i, j, tier: state.tier, locality: state.locality }],
      stage.coordOf,
    );
    return;
  }

  const code = coordinatesToCode(x, y, localityMix(state.locality, spec.axisBits), spec.axisBits);
  sheet.show({ tier: state.tier, locality: state.locality, x, y, code, bitmap });
}

function focusCell(i, j, { reading = false } = {}) {
  camera.moveTo(i, j);
  stage.setFocus({ i, j });
  stage.setDim(1);
  if (reading && camera.target.zoom < READING_CELL) camera.zoomTo(READING_CELL);
  openSheetAt(i, j);
  dirty = true;
}

/**
 * 고른 것을 놓는다. 어두워진 것이 풀리고 시트가 닫힌다.
 *
 * 시트를 함께 닫는 이유. 시트는 "고른 전시물의 정보" 다. 고른 것이 없는데
 * 제목 줄이 남아 있으면 화면이 거짓말을 한다.
 */
function clearFocus() {
  if (!stage.focus && !sheet.open) return;
  stage.setFocus(null);
  stage.setDim(0);
  sheet.close();
  wantedForSheet = null;
  dirty = true;
}

// ── 입력 ─────────────────────────────────────────────────────────────────

const input = createInput({
  element: canvas,
  camera,
  stage,
  isBlocked: () => curtain.busy,
  onTap: (i, j, screenX, screenY) => {
    keyboardMode = false;
    document.body.dataset.keyboard = '0';

    // 로비에는 작품이 없다. 대신 놓인 물건이 눌린다.
    if (isLobbyTier(state.tier)) {
      const object = stage.lobbyObjectAt(screenX, screenY);
      if (object) tapLobbyObject(object);
      return;
    }

    // 고른 것을 한 번 더 누르면 놓는다. 누른 곳이 어디든 토글로 읽힌다.
    const focus = stage.focus;
    if (focus && focus.i === i && focus.j === j) {
      clearFocus();
      return;
    }
    focusCell(i, j);
  },
  // 손이 미술관을 움직이기 시작하면 고른 것을 놓는다.
  // 돌아다니는 중에 한 작품만 밝은 채로 남으면 방해가 된다.
  onDragStart: () => {
    hint.hide();
    clearFocus();
  },
  // 카메라를 건드릴 때마다 다시 그린다. 이것이 없으면 드래그가 뚝뚝 끊긴다.
  onChange: () => {
    dirty = true;
  },
  // 개방 중에 손이 줌했다. 줌 몰기를 손에 넘긴다. 이유는 openDrivesZoom 참조.
  onZoom: () => {
    if (curtain.phase === PHASE.OPEN) openDrivesZoom = false;
  },
  onGestureEnd: () => {
    hash.flush();
    dirty = true;
  },
});

// 손을 대는 순간에는 접기만 한다. 아직 탭인지 끌기인지 모른다.
// 실제로 끌기 시작하면 onDragStart 가 포커스까지 놓는다.
canvas.addEventListener('pointerdown', () => {
  sheet.collapse();
});

// ── 키보드 ───────────────────────────────────────────────────────────────

const ARROWS = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * 지금 눌려 있는 방향키.
 *
 * keydown 이벤트 하나는 키 하나만 알려 준다. 그래서 그 키만 보면 두 방향을 함께
 * 눌러도 마지막 것만 먹고 대각선으로 가지 않는다. 눌린 것을 모아 두고 **합쳐서**
 * 한 걸음을 만든다.
 *
 * 운영체제의 키 반복은 마지막 키에 대해서만 오지만, 반복이 올 때마다 이 집합
 * 전체를 다시 읽으므로 대각선이 유지된다.
 */
const heldArrows = new Set();

/** 눌린 방향키를 합친 한 걸음. 좌우나 상하를 함께 누르면 서로 지운다. */
function arrowStep() {
  let dx = 0;
  let dy = 0;
  for (const key of heldArrows) {
    const [mx, my] = ARROWS[key];
    dx += mx;
    dy += my;
  }
  return [dx, dy];
}

/**
 * 눌린 것을 모두 놓는다.
 *
 * 창이 포커스를 잃으면 keyup 이 오지 않는다. 그대로 두면 키가 눌린 채로 남아
 * 돌아왔을 때 엉뚱한 대각선이 된다. 실제로 Alt+Tab 으로 재현된다.
 */
function releaseArrows() {
  heldArrows.clear();
}

window.addEventListener('keyup', event => {
  heldArrows.delete(event.key);
});
window.addEventListener('blur', releaseArrows);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) releaseArrows();
});

window.addEventListener('keydown', event => {
  // 모달이 열려 있으면 그것이 먼저 닫힌다.
  if (event.key === 'Escape' && (search.isOpen || languagePicker.isOpen || floorPicker.isOpen)) {
    search.close();
    languagePicker.close();
    floorPicker.close();
    event.preventDefault();
    return;
  }
  // 글자를 입력하는 중에는 미술관 조작을 받지 않는다.
  if (event.target instanceof HTMLInputElement) return;

  if (event.key === 'Escape') {
    // 시트가 한 단계씩 접히고, 다 접히면 고른 것도 놓는다.
    if (sheet.escape()) {
      if (!sheet.open) clearFocus();
      event.preventDefault();
    }
    return;
  }

  if (event.key in ARROWS) {
    if (curtain.busy) return;
    event.preventDefault();
    heldArrows.add(event.key);

    // 마주보는 두 방향을 함께 누르면 서로 지워서 갈 곳이 없다.
    const [dx, dy] = arrowStep();
    if (dx === 0 && dy === 0) return;

    hint.hide();
    keyboardMode = true;
    document.body.dataset.keyboard = '1';

    // 고른 것이 없으면 화면 중앙에서 출발한다.
    const from = stage.focus ?? { i: Math.round(camera.x), j: Math.round(camera.y) };
    focusCell(from.i + dx, from.j + dy, { reading: true });
    return;
  }

  if (event.key === 'r' || event.key === 'R') {
    if (event.metaKey || event.ctrlKey) return; // 새로고침을 막지 않는다
    jumpRandom();
  }
});

document.getElementById('btn-random').addEventListener('click', () => jumpRandom());
document.getElementById('btn-search').addEventListener('click', () => search.open());
document.getElementById('btn-floor').addEventListener('click', () => floorPicker.open());
document.getElementById('btn-language').addEventListener('click', () => languagePicker.open());

window.addEventListener('resize', resize);

// 옛 `#` 링크를 주소창에 붙였을 때만 일어난다. 표준형은 `?a=` 이고 그것을
// 붙이면 페이지가 새로 뜨므로 이벤트가 필요 없다.
window.addEventListener('hashchange', () => {
  const next = readLegacyHash();
  if (!next) return;
  const same =
    next.tier === state.tier &&
    next.locality === state.locality &&
    next.x === state.x &&
    next.y === state.y;
  // 같은 자리라면 옮길 것이 없다. 주소창만 표준형으로 정리한다.
  if (same) {
    hash.normalize(state);
    return;
  }
  goto(next); // goto 안의 hash.set 이 해시를 지우고 ?a= 로 바꾼다
});

/**
 * 뒤로 · 앞으로.
 *
 * 우리는 `replaceState` 만 쓰므로 관람 중에 항목이 쌓이지는 않는다. 그런데 새 탭이
 * 아닌 같은 탭에서 링크를 눌러 들어오거나(Ctrl 없이 누른 로비의 그림) 브라우저가
 * 되돌려 놓으면, 주소창은 옛 자리를 가리키는데 화면은 그대로 남는다. 그때 주소를
 * 다시 읽어 그 자리로 간다.
 */
window.addEventListener('popstate', () => {
  const next = readState();
  const same =
    next.tier === state.tier &&
    next.locality === state.locality &&
    next.x === state.x &&
    next.y === state.y &&
    Boolean(next.workshop) === Boolean(state.workshop);
  if (same) return;
  goto(next);
});

/**
 * 뒤로 가기로 이 페이지가 **되살아났을 때**(bfcache).
 *
 * 브라우저는 페이지를 얼려 두었다가 그대로 되살린다. 그런데 얼어 있는 동안
 * 캔버스의 픽셀을 놓아 버리는 경우가 있고, 그러면 미니맵이 빈 칸으로 돌아온다.
 * 지도는 "같은 그림이면 다시 그리지 않는다" 로 값을 아끼므로, 아무도 다시
 * 그려 달라고 하지 않는다. 그 증상이 "뒤로 가기를 누르면 지도가 안 뜬다" 였다.
 *
 * 되살아났으면 크기를 다시 재고 지도와 화면을 다시 그리게 한다.
 */
window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  minimap.resize();
  mapDirty = true;
  dirty = true;
});

// 탭을 다시 보게 되었을 때도 같은 이유로 한 번 다시 그린다. 얼려 두는 동안
// 캔버스를 비우는 브라우저가 있다.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  minimap.resize();
  mapDirty = true;
  dirty = true;
});

// ── 프레임 루프 ──────────────────────────────────────────────────────────

let last = performance.now();

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  input.update();
  curtain.update(dt);

  if (curtain.phase === PHASE.OPEN) {
    if (openDrivesZoom) {
      // 개방과 줌아웃이 한 몸으로 움직인다. 스프링과 싸우지 않게 직접 몬다.
      const t = curtain.openProgress;
      const eased = 1 - Math.pow(1 - t, 2.2);
      camera.forceZoom(restZoom * (OPEN_FROM + (1 - OPEN_FROM) * eased));
    } else {
      // 손이 줌을 가져갔다. 커튼은 계속 열리고 카메라는 평소처럼 따라간다.
      camera.update(dt);
    }
    dirty = true;
  } else if (camera.update(dt)) {
    dirty = true;
  }

  // 고른 것이 앞으로 나오고 나머지가 어두워지는 애니메이션. 카메라와 같은 시계다.
  if (stage.animate(dt)) dirty = true;

  paintCurtain();

  if (dirty) {
    const prefetch = input.dragging ? 1 : 2;
    const missing = stage.draw({ prefetch });
    dirty = missing > 0 || !camera.settled;
  }

  // 중앙 칸이 바뀔 때만 URL 을 건드린다. 층 16 의 좌표는 3212비트여서
  // 프레임마다 만들면 그것만으로 예산을 먹는다.
  if (curtain.phase === PHASE.CLEAR) {
    const i = Math.round(camera.x);
    const j = Math.round(camera.y);
    if (!lastCenter || lastCenter.i !== i || lastCenter.j !== j) {
      lastCenter = { i, j };
      const [cx, cy] = stage.coordOf(i, j);
      hash.set({ ...state, x: cx, y: cy }, { paused: input.dragging || input.pinching });
      // 미니맵의 가운데도 이 칸이다. 좌표는 여기서만 만든다 — 프레임마다
      // 만들면 층 16 에서 그것만으로 예산을 먹는다(위 주석과 같은 이유).
      mapSpot = { x: cx, y: cy };
      mapDirty = true;
    }

    // 지도를 다시 그릴 때를 여기서 가린다.
    //
    // **프레임마다 부르면 안 된다.** 지도를 그리는 값이 싸지 않고(층 32에서 한
    // 장 80ms), 예전에 이 자리에서 매 프레임 갱신을 걸어 미술관이 멈춘 적이
    // 있다. 다시 그릴 이유는 둘뿐이다: 칸이 바뀌었거나, 보이는 범위가 눈에
    // 띄게 달라졌거나.
    if (mapSpot) {
      const across = stage.view.width / camera.zoom;
      const zoomed = lastAcross <= 0 || Math.abs(across - lastAcross) / lastAcross > 0.03;
      if (mapDirty || zoomed) {
        mapDirty = false;
        lastAcross = across;
        minimap.update({
          tier: state.tier,
          locality: state.locality,
          x: mapSpot.x,
          y: mapSpot.y,
          across,
          cell: { i, j },
          objects: stage.lobbyObjects,
        });
      }
    }
  }

  requestAnimationFrame(frame);
}

// ── 시작 ─────────────────────────────────────────────────────────────────

applyStaticText();
onLanguageChange(() => applyStaticText());
applyTheme();
resize();
if (state.broken) toast(t('toast.brokenUrl'));
goto(state, { first: true });
requestAnimationFrame(frame);

attachDebug({ camera, curtain, tiles, stage, sheet, getState: () => state });

// 오프라인 지원. 시연장 와이파이가 죽어도 관람이 계속된다.
// 개발 중에는 붙이지 않는다. 캐시가 고친 파일을 가린다.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      /* 지원하지 않는 환경도 있다. 없어도 관람에는 지장이 없다. */
    });
  });
}

// 개발용 손잡이. D5 의 ?debug=1 패널이 이 자리를 대신한다.
Object.assign(window, {
  __museum: {
    get state() {
      return {
        ...state,
        x: String(state.x),
        y: String(state.y),
        // 체험관에 있는가. 없을 때 undefined 로 새지 않게 여기서 굳힌다.
        workshop: Boolean(state.workshop),
      };
    },
    get camera() {
      return {
        x: camera.x,
        y: camera.y,
        zoom: camera.zoom,
        target: camera.target,
        // 층별 줌 한계. 화면 검사가 층마다 달라지는 것을 본다.
        bounds: camera.zoomBounds,
      };
    },
    get tiles() {
      return tiles.stats;
    },
    // 전시실. 화면 검사가 좌표 → 방 배정을 직접 확인한다.
    rooms: { ROOMS, CLUSTER_SPAN, roomOf },
    /** 로비에 놓인 물건. 화면 검사가 자리와 개수를 직접 본다. */
    get lobby() {
      return stage.lobbyObjects.map(object => ({
        id: object.id,
        kind: object.kind,
        x: object.x,
        y: object.y,
        size: object.size,
        hasImage: Boolean(object.bitmap),
        action: object.action ?? null,
      }));
    },
    /** 미니맵. 화면 검사가 갱신이 도는지와 캐시가 사는지를 본다. */
    get minimap() {
      return minimap.stats;
    },
    /** 지도 방식을 검사와 자(bench)가 직접 바꾼다. */
    setMinimapMode(mode) {
      minimap.setMode(mode);
      mapDirty = true;
    },
    /** 팜플렛. 열림 상태와 점의 자리를 화면 검사가 본다. */
    get pamphlet() {
      const dot = document.getElementById('pamphlet-dot');
      return {
        state: pamphlet.state,
        dot: { left: dot.style.left, top: dot.style.top },
        floors: [...document.querySelectorAll('#pamphlet-floors button')].map(button => ({
          tier: button.dataset.tier ?? null,
          workshop: button.dataset.workshop === '1',
          current: button.getAttribute('aria-current') === 'true',
          text: button.textContent,
        })),
      };
    },
    get curtain() {
      return {
        phase: curtain.phase,
        open: curtain.openProgress,
        dim: curtain.dimProgress,
        // 이번 개방의 길이(ms). 기기 속도에 따라 달라지므로 검사가 직접 본다.
        duration: curtain.openDuration,
        drivesZoom: openDrivesZoom,
      };
    },
    /**
     * 고른 것과 어둡게 하는 정도. 화면 검사가 이것을 본다.
     *
     * dim 은 지금 값이고 dimTarget 은 목표값이다. 애니메이션이 붙었으므로
     * "놓았는가" 를 물을 때는 cell 이나 dimTarget 을 봐야 한다.
     */
    get focus() {
      return {
        cell: stage.focus,
        dim: stage.dim,
        dimTarget: stage.dimTarget,
        lift: stage.liftNow,
        lifting: stage.liftCount,
        liftScale: stage.liftScale,
      };
    },
    get sheet() {
      return { state: sheet.state, title: sheet.artwork?.info?.title ?? null };
    },
    get keyboardMode() {
      return keyboardMode;
    },
    jumpRandom,
    goto,
    focusCell,
    // 화면 검사가 로비 물건의 눌리는 자리를 직접 확인한다.
    stage: { lobbyObjectAt: (x, y) => stage.lobbyObjectAt(x, y) },
    // 화면 검사가 토스트의 머무는 시간과 남은 시간 표시를 직접 확인한다.
    toast,
  },
});
