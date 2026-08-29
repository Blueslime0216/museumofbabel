// UI 무늬 — 표면마다 실제 좌표 하나를 렌더해 배경으로 깐다
//
// 요구사항 10장.
//   단색이 아니다. UI 와 작품이 같은 코덱에서 나온다는 사실이 화면에 드러난다.
//   구역 경계와 구역 안의 8×8 기저 무늬가 그대로 커진다.
//
// 색이 방문 하나 동안 유지되는 이유
//   같은 방문 안에서 색이 바뀌면 다른 사이트에 온 것처럼 느껴진다.
//   sessionStorage 가 정확히 그 경계를 갖는다. 같은 탭 새로고침에는 남고
//   탭을 닫으면 사라진다. 별도 판정 로직이 필요 없다.
//
// 저장하는 것은 그림이 아니라 좌표다. 코덱이 결정적이므로 같은 좌표는 같은 그림이다.

import {
  tierSpec,
  localityMix,
  coordinatesToCode,
  randomCoordinate,
  createFrame,
  renderCode,
  toBase36,
  fromBase36,
} from './codec.mjs';

/** 구역이 32px 이다. 층 4 는 덩어리로 보이고 층 16 은 노이즈로 흩어진다. */
const TIER = 8;
const LOCALITY = 4;

const STORE_KEY = 'mob.surfaces.v1';

/**
 * 무늬를 받는 표면.
 *
 * flatten 은 무늬를 얼마나 눌러 둘 것인가다. 0 이면 원본, 1 이면 단색.
 * 본문이 올라가는 면은 크게 눌러 대비를 확보하고, 글자가 적은 면은 색을 살린다.
 */
const SURFACES = [
  { name: 'pill', flatten: 0.1 },
  { name: 'sheet', flatten: 0.28 },
  { name: 'peek', flatten: 0.2 },
  { name: 'plate', flatten: 0.1 },
  { name: 'btn', flatten: 0.16 },
  { name: 'btn-primary', flatten: 0.16 },
  { name: 'menu', flatten: 0.2 },
  { name: 'modal', flatten: 0.28 },
  { name: 'field', flatten: 0.2 },
  { name: 'toast', flatten: 0.16 },
  { name: 'curtain-edge', flatten: 0.1 },
];

/**
 * 무늬가 균일한 좌표는 버린다.
 *
 * 층 8 작품 중에는 변화가 거의 없는 것도 있다. 그것을 깔면 단색처럼 보여서
 * "UI 도 미술관에서 나왔다" 는 것이 전달되지 않는다. 목업에서 걸러내지 않아
 * 어떤 판은 그냥 색면이었다.
 */
const MIN_SPREAD = 26; // 채널 표준편차의 최솟값
const MAX_TRIES = 12;

const spec = tierSpec(TIER);
const mix = localityMix(LOCALITY, spec.axisBits);
let frame = null;

function toLinear(v) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function contrast(a, b) {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** 평균 휘도와 밝기의 흩어짐. 글자색 판정과 균일함 판정에 쓴다. */
export function measure(rgba) {
  let lumaSum = 0;
  let lumaSq = 0;
  let linearSum = 0;
  const count = rgba.length / 4;

  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    const y = (r * 77 + g * 151 + b * 28) >> 8; // 0..255, 표시용 밝기
    lumaSum += y;
    lumaSq += y * y;
    linearSum += 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  }

  const meanLuma = lumaSum / count;
  const spread = Math.sqrt(Math.max(0, lumaSq / count - meanLuma * meanLuma));
  const relative = linearSum / count;
  return { spread, relative };
}

/** 배경 위에 얹을 글자색. 대비가 큰 쪽을 고른다. */
export function inkFor(relativeLuminance) {
  return contrast(relativeLuminance, 0) >= contrast(relativeLuminance, 1) ? '#000000' : '#ffffff';
}

function renderAt(x, y) {
  if (!frame) frame = createFrame(spec);
  renderCode(spec, coordinatesToCode(x, y, mix, spec.axisBits), frame);
  return frame.rgba;
}

/** 무늬로 쓸 만한 좌표를 뽑는다. 균일한 것은 버린다. */
function pickSeed() {
  let best = null;
  for (let tries = 0; tries < MAX_TRIES; tries++) {
    const [x, y] = randomCoordinate(spec.axisBits);
    const { spread, relative } = measure(renderAt(x, y));
    if (!best || spread > best.spread) best = { x, y, spread, relative };
    if (spread >= MIN_SPREAD) break;
  }
  return best;
}

function seedToText([x, y]) {
  return `${toBase36(x)}.${toBase36(y)}`;
}

function textToSeed(text) {
  const [a, b] = String(text).split('.');
  return [fromBase36(a), fromBase36(b)];
}

function loadSeeds() {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (saved?.v !== 1 || saved.tier !== TIER || saved.locality !== LOCALITY) return null;
    if (!Array.isArray(saved.seeds) || saved.seeds.length !== SURFACES.length) return null;
    return saved.seeds.map(textToSeed);
  } catch {
    // 읽을 수 없으면 조용히 새로 뽑는다. 사용자에게 알릴 일이 아니다.
    return null;
  }
}

function saveSeeds(seeds) {
  try {
    sessionStorage.setItem(
      STORE_KEY,
      JSON.stringify({
        v: 1,
        tier: TIER,
        locality: LOCALITY,
        seeds: seeds.map(seedToText),
      }),
    );
  } catch {
    /* 저장이 막혀 있어도 이번 방문에는 문제가 없다 */
  }
}

/**
 * 표면마다 무늬를 배정하고 CSS 변수로 심는다.
 *
 * 심는 변수 세 개.
 *   --bg-<name>    배경 그림 (data URL)
 *   --on-<name>    글자색 (검정 또는 흰색)
 *   --edge-<name>  글자 테두리색 (글자색의 반대)
 *
 * 같은 방문에서 다시 부르면 저장된 좌표를 그대로 쓴다. 그래서 새로고침이나
 * 자리 이동으로 색이 바뀌지 않는다.
 */
export function applyTheme({ reroll = false } = {}) {
  const root = document.documentElement;
  const saved = reroll ? null : loadSeeds();
  const seeds = [];

  SURFACES.forEach((surface, index) => {
    let x;
    let y;
    let relative;

    if (saved) {
      [x, y] = saved[index];
      relative = measure(renderAt(x, y)).relative;
    } else {
      const picked = pickSeed();
      x = picked.x;
      y = picked.y;
      relative = picked.relative;
    }
    seeds.push([x, y]);

    const ink = inkFor(relative);
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.putImageData(new ImageData(renderAt(x, y), 256, 256), 0, 0);

    // 글자색의 반대쪽으로 눌러서 대비를 확보한다. 무늬는 남는다.
    ctx.fillStyle = ink === '#000000'
      ? `rgba(255,255,255,${surface.flatten})`
      : `rgba(0,0,0,${surface.flatten})`;
    ctx.fillRect(0, 0, 256, 256);

    root.style.setProperty(`--bg-${surface.name}`, `url("${canvas.toDataURL('image/png')}")`);
    root.style.setProperty(`--on-${surface.name}`, ink);
    root.style.setProperty(`--edge-${surface.name}`, ink === '#000000' ? '#ffffff' : '#000000');
  });

  saveSeeds(seeds);
  return seeds.map(seedToText);
}
