// 벽 라벨 — 코드워드에서 작품 제목과 소장품 번호를 만든다
//
// 요구사항 7장.
//   좌표로 생성된 그림에는 설명할 내용이 원래 없다. 기술 수치만 늘어놓으면
//   미술관이 아니라 개발자 도구가 된다. 그래서 제목을 만든다.
//
//   저장소도 서버도 없다. 같은 좌표는 언제나 같은 제목이 된다.
//   색 이름은 실제 팔레트 필드에서 뽑으므로 **제목의 색이 그림의 색과 맞는다.**
//
// 단어는 건축과 전시 용어로 골랐다. 한국어판은 직역하면 어색해지므로 따로 짓는다.

import { tierSpec, decodeFields, toBase36 } from './codec.mjs';

/** Cb·Cr 각도에 대응하는 색 이름. 0도가 파랑, 반시계로 돈다. */
const HUES = [
  'Indigo',
  'Violet',
  'Mauve',
  'Carmine',
  'Crimson',
  'Rust',
  'Amber',
  'Ochre',
  'Olive',
  'Verdigris',
  'Celadon',
  'Teal',
];

/** 채도가 낮을 때 쓰는 무채색 이름. 어두운 것부터. */
const NEUTRALS = ['Soot', 'Char', 'Slate', 'Pewter', 'Ash', 'Bone', 'Ivory', 'Chalk'];

const ADJECTIVES = [
  'Quiet', 'Broken', 'Folded', 'Adjacent', 'Distant', 'Recurring', 'Vertical', 'Horizontal',
  'Interrupted', 'Standing', 'Falling', 'Doubled', 'Hollow', 'Dense', 'Shallow', 'Late',
  'Early', 'Unfinished', 'Provisional', 'Persistent', 'Silent', 'Divided', 'Nested', 'Reversed',
  'Slanted', 'Suspended', 'Wandering', 'Fixed', 'Vacant', 'Crowded', 'Narrow', 'Endless',
];

const NOUNS = [
  'Field', 'Passage', 'Interval', 'Terrace', 'Threshold', 'Aperture', 'Register', 'Cadence',
  'Partition', 'Lattice', 'Corridor', 'Fragment', 'Margin', 'Enclosure', 'Meridian', 'Sequence',
  'Chamber', 'Vestibule', 'Plateau', 'Ledger', 'Facade', 'Column', 'Archive', 'Cornice',
  'Alcove', 'Cistern', 'Rampart', 'Portico', 'Palisade', 'Reliquary', 'Annex', 'Rotunda',
];

/**
 * 크로마 한 쌍을 색 이름으로.
 *
 * cb 가 크면 파랑, cr 가 크면 빨강 쪽이다. 중앙에서 멀지 않으면 무채색으로 본다.
 */
function colorName(cb, cr, center, luma01) {
  const db = cb - center;
  const dr = cr - center;
  if (Math.hypot(db, dr) < center * 0.22) {
    return NEUTRALS[Math.min(NEUTRALS.length - 1, Math.floor(luma01 * NEUTRALS.length))];
  }
  let angle = Math.atan2(dr, db) / (Math.PI * 2);
  if (angle < 0) angle += 1;
  return HUES[Math.floor(angle * HUES.length) % HUES.length];
}

/**
 * 좌표의 작품 정보. 코드워드만 보고 만든다. 렌더와 무관하다.
 */
export function describe({ tier, x, y, code }) {
  const spec = tierSpec(tier);
  const fields = decodeFields(spec, code);
  const { quant, baseLuma, baseCb, baseCr } = fields.header;

  const luma01 = baseLuma / 63;
  const primary = colorName(baseCb, baseCr, 7.5, luma01);
  const secondary = colorName(fields.cb[0], fields.cr[0], 8, luma01);

  // 제목 형식과 단어는 코드워드의 서로 다른 자리에서 뽑는다.
  const pick = (shift, size) => Number((code >> BigInt(shift)) & BigInt(size - 1));
  const adjective = ADJECTIVES[pick(31, 32)];
  const noun = NOUNS[pick(43, 32)];
  const form = pick(59, 8);

  const both = primary === secondary ? null : secondary;
  const title = [
    both ? `Composition in ${primary} and ${both}` : `Composition in ${primary}`,
    `Study in ${primary}`,
    `${adjective} ${noun}`,
    `${noun} with ${primary}`,
    `Untitled (${adjective} ${noun})`,
    `${primary} ${noun}`,
    `Arrangement in ${primary}`,
    both ? `${noun} in ${primary} and ${both}` : `${adjective} ${noun}`,
  ][form];

  // 소장품 번호. 층과 좌표 축약만 쓴다. 국소성 단계는 관람객에게 뜻이 없다.
  const x36 = toBase36(x);
  const y36 = toBase36(y);
  const accession = `${tier}-${x36.slice(-3)}${y36.slice(-3)}`;

  return {
    title,
    accession,
    quant,
    bytes: spec.byteLength,
    bits: spec.totalBits,
    zones: spec.blockCount,
    palette: { primary, secondary },
  };
}
