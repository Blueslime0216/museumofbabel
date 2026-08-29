// 벽 라벨 — 코드워드에서 작품 제목과 소장품 번호를 만든다
//
// 요구사항 7장.
//   좌표로 생성된 그림에는 설명할 내용이 원래 없다. 기술 수치만 늘어놓으면
//   미술관이 아니라 개발자 도구가 된다. 그래서 제목을 만든다.
//
//   저장소도 서버도 없다. 같은 좌표는 언제나 같은 제목이 된다.
//   색 이름은 실제 팔레트 필드에서 뽑으므로 **제목의 색이 그림의 색과 맞는다.**
//
// 언어마다 단어를 따로 짓는다. 직역하면 어색하다.
//   한국어 제목 형식은 조사를 쓰지 않는다. "{A}과 {B}" 처럼 쓰면 받침에 따라
//   과/와가 갈려서 단어를 넣는 순간 문법이 깨진다. 가운뎃점과 쉼표로 잇는다.

import { tierSpec, decodeFields, toBase36 } from './codec.mjs';
import { language } from './i18n/index.mjs';

/** Cb·Cr 각도에 대응하는 색 이름. 0도가 파랑, 반시계로 돈다. 열두 개. */
const HUES = {
  en: [
    'Indigo', 'Violet', 'Mauve', 'Carmine', 'Crimson', 'Rust',
    'Amber', 'Ochre', 'Olive', 'Verdigris', 'Celadon', 'Teal',
  ],
  ko: [
    '쪽빛', '보라', '연자주', '연지', '다홍', '녹슨빛',
    '호박빛', '황토', '올리브', '녹청', '청자빛', '물빛',
  ],
};

/** 채도가 낮을 때 쓰는 무채색 이름. 어두운 것부터 여덟 개. */
const NEUTRALS = {
  en: ['Soot', 'Char', 'Slate', 'Pewter', 'Ash', 'Bone', 'Ivory', 'Chalk'],
  ko: ['그믐', '숯', '청회', '백랍', '잿빛', '상아', '백지', '서리'],
};

const ADJECTIVES = {
  en: [
    'Quiet', 'Broken', 'Folded', 'Adjacent', 'Distant', 'Recurring', 'Vertical', 'Horizontal',
    'Interrupted', 'Standing', 'Falling', 'Doubled', 'Hollow', 'Dense', 'Shallow', 'Late',
    'Early', 'Unfinished', 'Provisional', 'Persistent', 'Silent', 'Divided', 'Nested', 'Reversed',
    'Slanted', 'Suspended', 'Wandering', 'Fixed', 'Vacant', 'Crowded', 'Narrow', 'Endless',
  ],
  ko: [
    '고요한', '부서진', '접힌', '맞닿은', '먼', '되풀이되는', '곧은', '누운',
    '끊긴', '선', '떨어지는', '겹친', '빈', '촘촘한', '얕은', '늦은',
    '이른', '미완의', '임시의', '끈질긴', '말없는', '갈라진', '품은', '뒤집힌',
    '기운', '매달린', '떠도는', '붙박인', '지워진', '붐비는', '좁은', '끝없는',
  ],
};

const NOUNS = {
  en: [
    'Field', 'Passage', 'Interval', 'Terrace', 'Threshold', 'Aperture', 'Register', 'Cadence',
    'Partition', 'Lattice', 'Corridor', 'Fragment', 'Margin', 'Enclosure', 'Meridian', 'Sequence',
    'Chamber', 'Vestibule', 'Plateau', 'Ledger', 'Facade', 'Column', 'Archive', 'Cornice',
    'Alcove', 'Cistern', 'Rampart', 'Portico', 'Palisade', 'Reliquary', 'Annex', 'Rotunda',
  ],
  ko: [
    '들', '통로', '사이', '단', '문턱', '틈', '층계', '가락',
    '칸막이', '격자', '복도', '조각', '여백', '울', '자오선', '차례',
    '방', '현관', '고원', '대장', '벽면', '기둥', '서고', '처마',
    '벽감', '저수조', '성벽', '주랑', '울짱', '성물함', '별관', '원형실',
  ],
};

/**
 * 제목 형식 여덟 가지.
 *
 * 한국어는 조사를 쓰지 않는다. 단어를 넣는 순간 받침에 따라 문법이 깨지기 때문이다.
 * 가운뎃점과 쉼표만으로 잇는다. 그래도 현대미술 제목처럼 읽힌다.
 */
const FORMS = {
  en: [
    ({ a, b }) => (b ? `Composition in ${a} and ${b}` : `Composition in ${a}`),
    ({ a }) => `Study in ${a}`,
    ({ adjective, noun }) => `${adjective} ${noun}`,
    ({ noun, a }) => `${noun} with ${a}`,
    ({ adjective, noun }) => `Untitled (${adjective} ${noun})`,
    ({ a, noun }) => `${a} ${noun}`,
    ({ a }) => `Arrangement in ${a}`,
    ({ noun, a, b, adjective }) => (b ? `${noun} in ${a} and ${b}` : `${adjective} ${noun}`),
  ],
  ko: [
    ({ a, b }) => (b ? `${a} · ${b} 구성` : `${a} 구성`),
    ({ a }) => `${a} 습작`,
    ({ adjective, noun }) => `${adjective} ${noun}`,
    ({ noun, a }) => `${noun}, ${a}`,
    ({ adjective, noun }) => `무제 (${adjective} ${noun})`,
    ({ a, noun }) => `${a} ${noun}`,
    ({ a }) => `${a} 배치`,
    ({ noun, a, b, adjective }) => (b ? `${noun} · ${a} · ${b}` : `${adjective} ${noun}`),
  ],
};

/** 사전에 없는 언어는 영어로 떨어진다. 조용히 비지 않는다. */
function tableFor(source, lang) {
  return source[lang] ?? source.en;
}

/**
 * 크로마 한 쌍을 색 이름으로.
 *
 * cb 가 크면 파랑, cr 가 크면 빨강 쪽이다. 중앙에서 멀지 않으면 무채색으로 본다.
 */
function colorName(cb, cr, center, luma01, lang) {
  const neutrals = tableFor(NEUTRALS, lang);
  const hues = tableFor(HUES, lang);

  const db = cb - center;
  const dr = cr - center;
  if (Math.hypot(db, dr) < center * 0.22) {
    return neutrals[Math.min(neutrals.length - 1, Math.floor(luma01 * neutrals.length))];
  }
  let angle = Math.atan2(dr, db) / (Math.PI * 2);
  if (angle < 0) angle += 1;
  return hues[Math.floor(angle * hues.length) % hues.length];
}

/**
 * 좌표의 작품 정보. 코드워드만 보고 만든다. 렌더와 무관하다.
 *
 * lang 을 주지 않으면 지금 언어를 쓴다. 테스트는 명시해서 부른다.
 */
export function describe({ tier, x, y, code, lang = language() }) {
  const spec = tierSpec(tier);
  const fields = decodeFields(spec, code);
  const { quant, baseLuma, baseCb, baseCr } = fields.header;

  const luma01 = baseLuma / 63;
  const primary = colorName(baseCb, baseCr, 7.5, luma01, lang);
  const secondary = colorName(fields.cb[0], fields.cr[0], 8, luma01, lang);

  // 제목 형식과 단어는 코드워드의 서로 다른 자리에서 뽑는다.
  const pick = (shift, size) => Number((code >> BigInt(shift)) & BigInt(size - 1));
  const parts = {
    a: primary,
    b: primary === secondary ? null : secondary,
    adjective: tableFor(ADJECTIVES, lang)[pick(31, 32)],
    noun: tableFor(NOUNS, lang)[pick(43, 32)],
  };
  const forms = tableFor(FORMS, lang);
  const title = forms[pick(59, 8)](parts);

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
