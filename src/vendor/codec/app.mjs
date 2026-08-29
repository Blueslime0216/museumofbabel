// UI 배선
//
// 이 파일은 상태를 들고 있고, 다른 모듈을 연결하는 일만 한다.
// 수학과 코덱은 여기에 없다.

import { CANVAS, TIERS, tierSpec, MODE_NAMES, HEADER_FIELDS } from './spec.mjs';
import { LOCALITY_LEVELS, localityWidth, randomCoordinate, axisSize } from './space.mjs';
import { createRenderer } from './render.mjs';
import { createGallery } from './gallery.mjs';
import { formatHash, parseHash, defaultState } from './url.mjs';
import { exportCurrent, describeExportSupport } from './export.mjs';
import { projectImage } from './project.mjs';

const el = id => document.getElementById(id);

const ui = {
  status: el('status'),
  tier: el('tier'),
  tierHint: el('tierHint'),
  locality: el('locality'),
  localityTicks: el('localityTicks'),
  localityHint: el('localityHint'),
  random: el('random'),
  copyLink: el('copyLink'),
  export: el('export'),
  drop: el('drop'),
  file: el('file'),
  gallery: el('gallery'),
  track: el('track'),
  current: el('current'),
  currentCaption: el('currentCaption'),
  addressInfo: el('addressInfo'),
  uploadSource: el('uploadSource'),
  uploadSourceCaption: el('uploadSourceCaption'),
  uploadResult: el('uploadResult'),
  uploadResultCaption: el('uploadResultCaption'),
  projectionNote: el('projectionNote'),
  perfInfo: el('perfInfo'),
  headerInfo: el('headerInfo'),
  modeMap: el('modeMap'),
  modeLegend: el('modeLegend'),
  clearCache: el('clearCache'),
  toast: el('toast'),
};

const renderer = createRenderer({ cacheLimit: 96 });
const currentCtx = ui.current.getContext('2d', { alpha: false });
const uploadCtx = ui.uploadResult.getContext('2d', { alpha: false });

let state = defaultState();
let sourceUrl = null;

// 모드 시각화용 색. 8종이 서로 구별되게만 하면 된다.
const MODE_COLORS = [
  '#4a4a55',
  '#7cc4ff',
  '#ffcf70',
  '#8bd97f',
  '#ff8fbf',
  '#b39dff',
  '#67d5c4',
  '#ff9a6c',
];

// ── 표시 도우미 ──────────────────────────────────────────

function setStatus(kind, text) {
  ui.status.dataset.kind = kind;
  ui.status.textContent = text;
}

let toastTimer = 0;
function toast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2200);
}

function shorten(value, head = 10, tail = 8) {
  const text = String(value);
  if (text.length <= head + tail + 1) return text;
  return `${text.slice(0, head)}…${text.slice(-tail)}`;
}

function fillList(target, rows) {
  target.replaceChildren();
  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    target.append(dt, dd);
  }
}

// ── 조작부 채우기 ────────────────────────────────────────

function buildControls() {
  for (const tier of TIERS) {
    const spec = tierSpec(tier);
    const option = document.createElement('option');
    option.value = String(tier);
    option.textContent = `${tier} × ${tier} · ${spec.blockCount}구역`;
    ui.tier.append(option);
  }

  ui.locality.max = String(LOCALITY_LEVELS.length - 1);
  for (let i = 0; i < LOCALITY_LEVELS.length; i++) {
    const option = document.createElement('option');
    option.value = String(i);
    option.label = LOCALITY_LEVELS[i].label;
    ui.localityTicks.append(option);
  }

  ui.modeLegend.replaceChildren();
  for (let mode = 0; mode < MODE_NAMES.length; mode++) {
    const li = document.createElement('li');
    const swatch = document.createElement('i');
    swatch.style.background = MODE_COLORS[mode];
    li.append(swatch, document.createTextNode(MODE_NAMES[mode]));
    ui.modeLegend.append(li);
  }
}

function syncControls() {
  ui.tier.value = String(state.tier);
  ui.locality.value = String(state.locality);

  const spec = tierSpec(state.tier);
  ui.tierHint.textContent = `주소 ${spec.byteLength}바이트 · 구역 ${spec.blockPx}px · 전체 2^${spec.totalBits}`;

  const level = LOCALITY_LEVELS[state.locality];
  const width = localityWidth(state.locality, spec.axisBits);
  ui.localityHint.textContent = `${level.label} · 계수 폭 ${width}비트 / ${spec.axisBits}`;
}

// ── 현재 작품 표시 ───────────────────────────────────────

function updateCurrent() {
  const { tier, locality, x, y } = state;
  const spec = tierSpec(tier);

  currentCtx.putImageData(renderer.imageDataFor(tier, locality, x, y), 0, 0);
  ui.currentCaption.textContent = `좌표 (${shorten(x)}, ${shorten(y)})`;

  const code = renderer.codeFor(tier, locality, x, y);
  fillList(ui.addressInfo, [
    ['x', String(x)],
    ['y', String(y)],
    ['층', `${tier} × ${tier}`],
    ['한 걸음', LOCALITY_LEVELS[locality].label],
    ['코드 길이', `${spec.byteLength} 바이트 (${spec.totalBits} 비트)`],
    ['축 크기', `2^${spec.axisBits}`],
    ['전체 작품 수', `2^${spec.totalBits}`],
    ['코드워드', shorten(code, 14, 12)],
    ['URL 길이', `${location.hash.length}자`],
  ]);

  updateDevPanel();
}

function updateDevPanel() {
  const perf = renderer.snapshot();
  fillList(ui.perfInfo, [
    ['렌더 횟수', String(perf.renders)],
    ['캐시 적중', String(perf.hits)],
    ['마지막 렌더', `${perf.lastMs.toFixed(2)} ms`],
    ['평균 렌더', `${perf.averageMs.toFixed(2)} ms`],
    ['캐시 보관', `${perf.cached} / ${perf.cacheLimit}`],
    ['네트워크 요청', '0건'],
  ]);

  const fields = renderer.fieldsFor(state.tier, state.locality, state.x, state.y);
  fillList(
    ui.headerInfo,
    HEADER_FIELDS.map(field => [field.name, String(fields.header[field.name])]),
  );

  const spec = tierSpec(state.tier);
  ui.modeMap.style.gridTemplateColumns = `repeat(${spec.tier}, 1fr)`;
  ui.modeMap.replaceChildren();
  for (let i = 0; i < spec.blockCount; i++) {
    const cell = document.createElement('i');
    cell.style.background = MODE_COLORS[fields.mode[i]];
    ui.modeMap.append(cell);
  }
}

// ── 상태 변경 ────────────────────────────────────────────

function writeHash() {
  const hash = formatHash(state);
  history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
}

function moveTo(x, y, { fromGallery = false } = {}) {
  state.x = x;
  state.y = y;
  writeHash();
  if (!fromGallery) gallery.reset({ x, y });
  updateCurrent();
}

function reconfigure(next) {
  state = { ...state, ...next };
  syncControls();
  writeHash();
  gallery.reset(state);
  updateCurrent();
}

// ── 미술관 ───────────────────────────────────────────────

const gallery = createGallery({
  element: ui.gallery,
  track: ui.track,
  renderer,
  onCenterChange(x, y) {
    state.x = x;
    state.y = y;
    writeHash();
    updateCurrent();
  },
  onCellPick(x, y) {
    moveTo(x, y);
    toast('그 작품으로 이동했습니다');
  },
});

// ── 버튼 ─────────────────────────────────────────────────

ui.tier.addEventListener('change', () => {
  const tier = Number(ui.tier.value);
  const spec = tierSpec(tier);
  // 층이 바뀌면 축 크기가 달라진다. 좌표를 새 축에 맞춰 자른다.
  const size = axisSize(spec.axisBits);
  reconfigure({ tier, x: state.x % size, y: state.y % size });
  toast(`${tier} × ${tier} 층으로 옮겼습니다`);
});

ui.locality.addEventListener('input', () => {
  reconfigure({ locality: Number(ui.locality.value) });
});

ui.random.addEventListener('click', () => {
  const spec = tierSpec(state.tier);
  // 축 크기가 2의 거듭제곱이라 모듈로 편향이 없다. 실패할 수 없다.
  const [x, y] = randomCoordinate(spec.axisBits);
  moveTo(x, y);
  setStatus('ready', '이 미술관에는 빈 벽이 없습니다');
  toast('무작위 좌표로 이동했습니다');
});

ui.copyLink.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    toast('주소를 복사했습니다');
  } catch {
    toast('클립보드를 쓸 수 없습니다. 주소창을 직접 복사해 주세요');
  }
});

ui.export.addEventListener('click', async () => {
  setStatus('working', '이미지를 만들고 있습니다');
  try {
    const result = await exportCurrent({
      rgba: renderer.rgbaFor(state.tier, state.locality, state.x, state.y),
      size: CANVAS,
      filename: `babel-${state.tier}-${state.locality}-${state.x}-${state.y}`,
    });
    setStatus('ready', '준비됨');
    toast(
      result.type === 'image/avif'
        ? 'AVIF로 내보냈습니다'
        : `AVIF를 만들 수 없어 ${result.label}로 내보냈습니다`,
    );
  } catch (error) {
    console.error(error);
    setStatus('error', '내보내기 실패');
    toast('내보내기에 실패했습니다');
  }
});

ui.clearCache.addEventListener('click', () => {
  renderer.clear();
  gallery.redrawAll();
  updateCurrent();
  toast('캐시를 비웠습니다. 그림은 동일해야 합니다');
});

// ── 업로드 ───────────────────────────────────────────────

async function acceptFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    toast('이미지 파일을 골라 주세요');
    return;
  }

  setStatus('working', '가장 가까운 좌표를 찾고 있습니다');
  ui.projectionNote.hidden = false;

  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  sourceUrl = URL.createObjectURL(file);
  ui.uploadSource.src = sourceUrl;
  ui.uploadSource.hidden = false;
  ui.uploadSourceCaption.textContent = `${file.name} · ${formatBytes(file.size)}`;

  try {
    const bitmap = await createImageBitmap(file);
    const started = performance.now();
    const result = await projectImage(bitmap, state.tier, state.locality);
    const elapsed = performance.now() - started;
    bitmap.close?.();

    ui.uploadResult.hidden = false;
    uploadCtx.putImageData(new ImageData(result.rgba, CANVAS, CANVAS), 0, 0);
    ui.uploadResultCaption.textContent = `투영 결과 · 세기 ${result.quant} · ${elapsed.toFixed(0)}ms`;

    moveTo(result.x, result.y);
    setStatus('ready', '투영한 좌표로 이동했습니다');
    toast('가장 가까운 작품을 찾았습니다');
  } catch (error) {
    console.error(error);
    setStatus('error', '투영 실패');
    toast('이미지를 읽을 수 없습니다');
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1048576).toFixed(2)} MiB`;
}

ui.drop.addEventListener('click', () => ui.file.click());
ui.drop.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    ui.file.click();
  }
});
ui.file.addEventListener('click', () => {
  ui.file.value = '';
});
ui.file.addEventListener('change', () => {
  const file = ui.file.files?.[0];
  if (file) acceptFile(file);
});

for (const name of ['dragenter', 'dragover']) {
  ui.drop.addEventListener(name, event => {
    event.preventDefault();
    ui.drop.classList.add('over');
  });
}
for (const name of ['dragleave', 'drop']) {
  ui.drop.addEventListener(name, event => {
    event.preventDefault();
    ui.drop.classList.remove('over');
  });
}
ui.drop.addEventListener('drop', event => {
  const file = event.dataTransfer?.files?.[0];
  if (file) acceptFile(file);
});

document.addEventListener('paste', event => {
  const file = [...(event.clipboardData?.files ?? [])].find(f => f.type.startsWith('image/'));
  if (file) acceptFile(file);
});

// ── 시작 ─────────────────────────────────────────────────

function restore() {
  if (!location.hash) return false;
  try {
    state = parseHash(location.hash, tier => tierSpec(tier).axisBits);
    return true;
  } catch (error) {
    // 조용히 실패하지 않는다. 알리고 원점으로 복구한다.
    console.warn(error);
    toast(`${error.message}. 처음 위치로 돌아갑니다`);
    history.replaceState(null, '', location.pathname + location.search);
    state = defaultState();
    return false;
  }
}

function start() {
  buildControls();
  const restored = restore();
  syncControls();
  writeHash();
  gallery.reset(state);
  updateCurrent();

  setStatus('ready', restored ? '좌표를 복원했습니다' : '준비됨');
  describeExportSupport().then(label => {
    ui.export.title = `내보내기 형식: ${label}`;
  });

  window.addEventListener('hashchange', () => {
    // 뒤로 가기 등으로 해시가 바뀌면 따라간다
    try {
      const next = parseHash(location.hash, tier => tierSpec(tier).axisBits);
      state = next;
      syncControls();
      gallery.reset(state);
      updateCurrent();
    } catch {
      /* 형식이 아니면 무시한다 */
    }
  });
}

start();
