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
//
// ── 문법을 조건문으로 맞추지 않는다 ─────────────────────────────────────
//
// 낱말을 틀에 끼우는 방식이라 언어마다 걸리는 곳이 다르다. 걸릴 때마다 예외를
// 두는 대신 **애초에 걸리지 않는 틀과 낱말만 쓴다.**
//
//   한국어   조사를 쓰지 않는다. "{A}과 {B}" 는 받침에 따라 과/와가 갈린다.
//            가운뎃점과 쉼표로만 잇는다.
//   러시아어 명사를 모두 남성으로 골랐다. 형용사가 성에 따라 어미를 바꾸므로
//            섞으면 "Тихий простор" 와 "Тихая ниша" 를 가려 써야 한다.
//            색 이름은 격 변화를 피하려고 콜론 · 줄표 · 괄호 뒤에 세운다.
//   일본어   형용사를 모두 연체형으로 적었다. 그대로 명사에 붙는다.
//   중국어   형용사에 "的" 를 붙여 두었다. 어느 명사에나 붙는다.
//
// 표의 크기는 언어마다 같아야 한다 (색 12 · 무채색 8 · 형용사 32 · 명사 32 ·
// 형식 8). 코드워드의 자리에서 뽑는 번호가 그 크기를 전제하기 때문이다.
// 하나라도 어긋나면 같은 좌표가 언어에 따라 다른 자리에서 나온다.
// `test/label.test.mjs` 가 크기를 직접 센다.

import { tierSpec, decodeFields, toBase36, roomOf, ROOMS } from './codec.mjs';
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
  ja: [
    '藍', '菫色', '藤色', '臙脂', '緋色', '錆色',
    '琥珀', '黄土', '苔色', '緑青', '青磁', '浅葱',
  ],
  zh: [
    '靛蓝', '紫罗兰', '藕紫', '胭脂', '绛红', '铁锈',
    '琥珀', '赭石', '橄榄', '铜绿', '青瓷', '水鸭青',
  ],
  ru: [
    'Индиго', 'Аметист', 'Мальва', 'Кармин', 'Багрец', 'Ржавчина',
    // «Медянка» без «ярь-» — это змея. Пигмент называется «ярь-медянка».
    'Янтарь', 'Охра', 'Олива', 'Ярь-медянка', 'Селадон', 'Бирюза',
  ],
};

/** 채도가 낮을 때 쓰는 무채색 이름. 어두운 것부터 여덟 개. */
const NEUTRALS = {
  en: ['Soot', 'Char', 'Slate', 'Pewter', 'Ash', 'Bone', 'Ivory', 'Chalk'],
  ko: ['그믐', '숯', '청회', '백랍', '잿빛', '상아', '백지', '서리'],
  // 「生成り」の送り仮名を落とすと「せいせい」と読まれる。
  ja: ['煤色', '墨', '青鈍', '錫色', '灰', '生成り', '象牙', '白磁'],
  zh: ['煤黑', '焦墨', '石板灰', '锡白', '烟灰', '骨白', '象牙', '白垩'],
  ru: ['Сажа', 'Уголь', 'Сланец', 'Олово', 'Пепел', 'Кость', 'Слоновая кость', 'Мел'],
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
  // 연체形。そのまま名詞に付く。
  ja: [
    '静かな', '壊れた', '折れた', '隣り合う', '遠い', '繰り返す', '垂直の', '水平の',
    '途切れた', '立つ', '落ちる', '重なる', '空ろな', '密な', '浅い', '遅い',
    '早い', '未完の', '仮の', '執拗な', '無言の', '割れた', '内包する', '裏返しの',
    '傾いた', '吊られた', 'さまよう', '固定の', '消えた', '混み合う', '狭い', '果てしない',
  ],
  // 都带「的」，接哪个名词都成。
  // 单音节加「的」读起来薄（「浅的野」），所以都用双音节。
  zh: [
    '安静的', '破碎的', '折叠的', '相邻的', '遥远的', '重复的', '垂直的', '水平的',
    '断裂的', '站立的', '坠落的', '重叠的', '中空的', '稠密的', '浅浅的', '迟来的',
    '早来的', '未完的', '临时的', '执拗的', '沉默的', '分开的', '内嵌的', '翻转的',
    '倾斜的', '悬挂的', '游荡的', '固定的', '空置的', '拥挤的', '狭窄的', '无尽的',
  ],
  // Мужской род, именительный падеж. Существительные ниже — тоже мужского рода.
  ru: [
    'Тихий', 'Разбитый', 'Сложенный', 'Смежный', 'Далёкий', 'Повторяющийся', 'Вертикальный', 'Горизонтальный',
    'Прерванный', 'Стоящий', 'Падающий', 'Удвоенный', 'Полый', 'Плотный', 'Неглубокий', 'Поздний',
    'Ранний', 'Незаконченный', 'Временный', 'Упорный', 'Безмолвный', 'Разделённый', 'Вложенный', 'Обращённый',
    'Наклонный', 'Подвешенный', 'Блуждающий', 'Закреплённый', 'Пустой', 'Тесный', 'Узкий', 'Бесконечный',
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
  // 「閾」は閾値で見る字で、敷居の意味では読みにくい。
  // 「水槽」は今の日本語では魚を飼う器なので「貯水槽」にした。
  ja: [
    '野', '通路', '間', '段', '敷居', '隙', '層', '調べ',
    '仕切り', '格子', '廊', '断片', '余白', '囲い', '子午線', '序列',
    '広間', '玄関', '台地', '台帳', '壁面', '柱', '書庫', '軒',
    '壁龕', '貯水槽', '城壁', '柱廊', '柵', '聖遺物箱', '別館', '円堂',
  ],
  // 单字站不住的都补成双音节（野→原野、台→露台、缝→缝隙、韵→韵律、檐→檐口）。
  // 「层」在这个应用里是楼层，所以 Register 换成「音域」，免得两个意思撞上。
  zh: [
    '原野', '通道', '间隔', '露台', '门槛', '缝隙', '音域', '韵律',
    '隔断', '格栅', '走廊', '碎片', '留白', '围栏', '子午线', '序列',
    '内室', '前厅', '高台', '账册', '立面', '柱', '书库', '檐口',
    '壁龛', '水窖', '城墙', '柱廊', '木栅', '圣物匣', '别馆', '圆厅',
  ],
  // Все — мужского рода. Иначе прилагательные выше пришлось бы согласовывать.
  // «Покой» в единственном числе читается как «спокойствие», поэтому «Чертог».
  // «Водоём» — это водная гладь, а не цистерна: «Резервуар».
  ru: [
    'Простор', 'Проход', 'Интервал', 'Уступ', 'Порог', 'Просвет', 'Регистр', 'Ритм',
    'Простенок', 'Переплёт', 'Коридор', 'Фрагмент', 'Отступ', 'Двор', 'Меридиан', 'Ряд',
    'Чертог', 'Вестибюль', 'Ярус', 'Реестр', 'Фасад', 'Столб', 'Архив', 'Карниз',
    'Альков', 'Резервуар', 'Вал', 'Портик', 'Частокол', 'Ковчег', 'Флигель', 'Зал',
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
  ja: [
    ({ a, b }) => (b ? `${a}と${b}の構成` : `${a}の構成`),
    ({ a }) => `${a}の習作`,
    ({ adjective, noun }) => `${adjective}${noun}`,
    ({ noun, a }) => `${noun}、${a}`,
    ({ adjective, noun }) => `無題（${adjective}${noun}）`,
    ({ a, noun }) => `${a}の${noun}`,
    ({ a }) => `${a}の配置`,
    ({ noun, a, b, adjective }) => (b ? `${noun}・${a}・${b}` : `${adjective}${noun}`),
  ],
  zh: [
    ({ a, b }) => (b ? `${a}与${b}的构成` : `${a}的构成`),
    ({ a }) => `${a}习作`,
    ({ adjective, noun }) => `${adjective}${noun}`,
    ({ noun, a }) => `${noun}，${a}`,
    ({ adjective, noun }) => `无题（${adjective}${noun}）`,
    ({ a, noun }) => `${a}${noun}`,
    ({ a }) => `${a}的布置`,
    // 가운뎃점은 U+00B7 이다. 일본어의 U+30FB 를 쓰면 가나 블록에 들어간다.
    ({ noun, a, b, adjective }) => (b ? `${noun}·${a}·${b}` : `${adjective}${noun}`),
  ],
  // 낱말은 대문자로 저장해 두었다. 시트의 "색" 칸에 홀로 설 때 그것이 맞다.
  // 제목 안에서는 첫 낱말만 대문자로 남기는 것이 러시아어 관례이므로 여기서
  // 내려 쓴다. 색 이름은 콜론 · 줄표 · 괄호 뒤에 세워 격 변화를 피한다.
  ru: [
    ({ a, b }) => (b ? `Композиция: ${low(a)} и ${low(b)}` : `Композиция: ${low(a)}`),
    ({ a }) => `Этюд: ${low(a)}`,
    ({ adjective, noun }) => `${adjective} ${low(noun)}`,
    ({ noun, a }) => `${noun} — ${low(a)}`,
    ({ adjective, noun }) => `Без названия (${low(adjective)} ${low(noun)})`,
    ({ a, noun }) => `${noun} (${low(a)})`,
    ({ a }) => `Расположение: ${low(a)}`,
    ({ noun, a, b, adjective }) =>
      b ? `${noun} · ${low(a)} · ${low(b)}` : `${adjective} ${low(noun)}`,
  ],
};

/** 첫 글자를 내려 쓴다. 러시아어 제목 안에서 쓴다. */
function low(word) {
  return word.charAt(0).toLowerCase() + word.slice(1);
}

/**
 * 제목 낱말 표. 검사가 크기와 낱말을 직접 본다 (`test/label.test.mjs`).
 *
 * 앱은 이것을 쓰지 않는다. 내보내는 이유는 하나다. 표의 크기가 어긋나면
 * 언어에 따라 제목이 다른 자리에서 나오는데, 좌표를 뽑아 보는 방식으로는
 * 32개 중 하나가 빈 것을 놓치기 쉽다. 세어 보는 편이 확실하다.
 */
export const TITLE_WORDS = {
  hues: HUES,
  neutrals: NEUTRALS,
  adjectives: ADJECTIVES,
  nouns: NOUNS,
  forms: FORMS,
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

  // 전시실. 코드워드가 아니라 **좌표**에서 나온다.
  //
  // 그래서 이 값만은 code 로 계산할 수 없다. 같은 코드워드가 다른 자리에 있으면
  // 다른 방이고, 따라서 다른 그림이다. 전시실을 좌표에서 유도하기로 한 결과다.
  const roomIndex = roomOf(x, y);

  return {
    title,
    accession,
    quant,
    bytes: spec.byteLength,
    bits: spec.totalBits,
    zones: spec.blockCount,
    palette: { primary, secondary },
    room: { index: roomIndex, total: ROOMS.length, id: ROOMS[roomIndex].name },
  };
}
