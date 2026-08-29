// 주소 하나를 PNG 로 — 서버 쪽
//
// 코덱은 순수 계산이다. 브라우저도 캔버스도 필요 없다. 테스트가 이미 Node 에서
// 같은 함수를 부르고 있으므로 여기서도 그대로 돈다.
//
// 확대는 최근접이다. 구역 경계가 이 작품의 본질이라 흐리게 하면 안 된다.
// 정수배로만 확대한다. 그래서 경계가 픽셀에 딱 맞는다.

import {
  CANVAS,
  TIERS,
  tierSpec,
  coordinatesToCode,
  localityMix,
  createFrame,
  renderCode,
  parseHash,
  formatHash,
} from '../../src/codec.mjs';
import { stampAddress } from '../../src/png.mjs';
import { encodePng } from './png-encode.mjs';

const axisBitsFor = tier => tierSpec(tier).axisBits;

/** 링크 카드에 넣을 크기. 256 의 정수배여야 한다. */
export const CARD_SIZE = 1024;

/**
 * 주소 문자열을 읽는다. `#` 이 있어도 없어도 받는다.
 *
 * 읽을 수 없으면 null. 던지지 않는다. 부르는 쪽이 400 을 돌려준다.
 */
export function readAddress(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed || trimmed.length > 4000) return null;
  const at = trimmed.indexOf('#');
  const candidate = at >= 0 ? trimmed.slice(at) : `#${trimmed}`;
  try {
    const state = parseHash(candidate, axisBitsFor);
    if (!TIERS.includes(state.tier)) return null;
    return state;
  } catch {
    return null;
  }
}

/** 주소를 표준형 문자열로. `#` 을 뗀 형태다 (쿼리에 넣기 위해). */
export const addressText = state => formatHash(state).slice(1);

/**
 * 전시물 한 장을 PNG 버퍼로.
 *
 * tEXt 청크에 주소를 적어 둔다. 카드에서 그림만 저장한 사람이 그것을 데모의
 * 찾기에 올리면 정확히 이 자리로 온다. 우리가 이미 쓰고 있는 규약이다.
 */
export function renderArtworkPng(state, size = CARD_SIZE) {
  const scale = Math.max(1, Math.round(size / CANVAS));
  const side = CANVAS * scale;

  const spec = tierSpec(state.tier);
  const frame = createFrame(spec);
  renderCode(
    spec,
    coordinatesToCode(state.x, state.y, localityMix(state.locality, spec.axisBits), spec.axisBits),
    frame,
  );

  // RGBA → RGB, 그리고 정수배 최근접 확대를 한 번에 한다.
  const rgb = Buffer.alloc(side * side * 3);
  for (let y = 0; y < side; y++) {
    const sourceRow = (y / scale) | 0;
    for (let x = 0; x < side; x++) {
      const source = (sourceRow * CANVAS + ((x / scale) | 0)) * 4;
      const target = (y * side + x) * 3;
      rgb[target] = frame.rgba[source];
      rgb[target + 1] = frame.rgba[source + 1];
      rgb[target + 2] = frame.rgba[source + 2];
    }
  }

  return Buffer.from(stampAddress(encodePng(rgb, side, side), formatHash(state)));
}
