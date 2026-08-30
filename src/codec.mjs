// 코덱 단일 관문
//
// 앱은 본체 모듈을 직접 import 하지 않고 반드시 이 파일을 거친다.
//
//   이유
//     - 코덱 경로가 바뀌면 이 파일 하나만 고친다
//     - 이 앱이 본체의 무엇을 쓰는지 한눈에 보인다
//     - 재구현이 아니라 재수출임이 코드로 드러난다
//
// 여기에 로직을 쓰지 마라. 재수출만 한다.
// 계산이 필요하면 본체에 넣고 여기서 다시 수출한다.
//
// vendor/codec 은 tools/sync-codec.mjs 가 본체에서 복사한 것이며
// 해시로 원본과의 일치가 강제된다. 직접 편집하면 검사가 실패한다.
//
// 복사는 열세 개를 다 하지만 여기서 여는 것은 아홉 개다.
// 나머지 넷(app · gallery · export · render)은 본체 조작판의 UI 배선이므로
// 이 앱이 쓸 일이 없다.

// ── 명세 · 진법 표 · 양자화 표 ───────────────────────────────────────────
export {
  VERSION as CODEC_VERSION,
  CANVAS,
  TIERS,
  DEFAULT_TIER,
  HEADER_LOW_FIELDS,
  HEADER_HIGH_FIELDS,
  HEADER_FIELDS,
  BLOCK_FIELDS,
  MODE_NAMES,
  LOBBY_TIER,
  LOBBY_AXIS_BITS,
  ADDRESSABLE_TIERS,
  isLobbyTier,
  axisBitsFor,
  AMP_MULT,
  LUMA_DC_STEP,
  AC_STEP,
  CHROMA_STEP,
  DC_BIAS,
  CHROMA_BIAS,
  buildSpec,
  tierSpec,
} from './vendor/codec/spec.mjs';

// ── 혼합 진법 ────────────────────────────────────────────────────────────
export { spaceSize, codeToBytes, bytesToCode } from './vendor/codec/radix.mjs';

// ── 좌표 ─────────────────────────────────────────────────────────────────
export {
  LOCALITY_LEVELS,
  DEFAULT_LOCALITY,
  localityMix,
  localityWidth,
  axisSize,
  axisMask,
  wrap,
  coordinatesToCode,
  codeToCoordinates,
  step as stepCoordinate,
  randomCoordinate,
  shortenNumber,
} from './vendor/codec/space.mjs';

// ── 기저 테이블 ──────────────────────────────────────────────────────────
export { BASIS_SIZE, BASIS_COUNT } from './vendor/codec/basis.mjs';

// ── URL 규격 ─────────────────────────────────────────────────────────────
export {
  URL_VERSION,
  toBase36,
  fromBase36,
  formatHash,
  parseHash,
  defaultState,
} from './vendor/codec/url.mjs';

// ── 디코더 ───────────────────────────────────────────────────────────────
export {
  CHROMA,
  createFrame,
  decodeFields,
  encodeFields,
  renderCode,
} from './vendor/codec/codec.mjs';

// ── 전시실 ───────────────────────────────────────────────────────────────
// 같은 주소를 다르게 읽는 방식. 좌표에서 유도되므로 주소에 아무 것도 담기지 않는다.
export {
  ROOMS,
  MODE_SETS,
  CLUSTER_SPAN,
  roomOf,
  styleAt,
  roomStyle,
  roomIndexByName,
} from './vendor/codec/rooms.mjs';

// ── 투영기 ───────────────────────────────────────────────────────────────
// 그림에서 주소로 가는 방향. 규격이 아니라 편의이며 그래서 유일하게
// 부동소수점을 쓴다. 대신 결과 픽셀은 정수 디코더가 낸 것이다.
export { projectRgba } from './vendor/codec/project.mjs';
