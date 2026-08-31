// 화면 검사 — 기계가 볼 수 있는 것만 본다
//
// 무엇을 지키는가
//   1. 연기 검사    페이지가 뜨고 캔버스에 실제 픽셀이 있다
//   2. 시트 기하    요구사항 7장의 규칙. 목업에서 실제로 깨졌던 것들이다
//   3. 전환         암전 → 교체 → 개방 순서와, 암전 중 줌이 멈추는 것
//   4. 무늬 유지    새로고침해도 UI 색이 바뀌지 않는다
//   5. 왕복         내려받은 PNG 를 올리면 정확히 제자리로 온다
//   6. 언어         영어로 바꾸면 어느 표면에도 한글이 남지 않는다
//
// 사람이 봐야 하는 것(감각과 흐름)은 여기서 보지 않는다.
//
// 사용법
//   npm run preview          다른 터미널에서
//   node tools/check-ui.mjs [주소]

import { chromium } from 'playwright-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatHash, parseHash, fromBase36, VERSION_MARKER } from '../src/codec.mjs';

/**
 * 시험용 주소를 상태에서 만든다.
 *
 * 글자로 적어 두면 형식이 바뀔 때 검사가 통째로 썩는다. v2 → v3 에서 실제로
 * 그랬다. 주소의 모양을 단정하는 검사는 판 표식과 진법까지만 본다.
 */
const addressOf = (tier, locality = 4) =>
  formatHash({ tier, locality, x: fromBase36('abc'), y: fromBase36('def') }).slice(1);

/** URL 의 `?a=` 를 꺼내 상태로 읽는다. 층이 비트에 접혀 있으므로 정규식으로는 못 본다. */
function stateInUrl(url) {
  const found = /[?&]a=([^&#\s]+)/.exec(url);
  if (!found) return null;
  try {
    return parseHash(`#${decodeURIComponent(found[1])}`);
  } catch {
    return null;
  }
}

const target = process.argv[2] ?? 'http://127.0.0.1:4173/';
const shots = process.argv.includes('--shots');

const results = [];
let failed = 0;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failed++;
}

const browser = await chromium.launch({ channel: 'msedge' });
const temp = mkdtempSync(join(tmpdir(), 'museum-check-'));

/**
 * 화면 하나를 열고 개방이 끝날 때까지 기다린다.
 *
 * 주소 없이 들어오면 **로비**다. 아래 검사 대부분은 작품 층을 전제하므로(전시물을
 * 누르고 시트를 열고 픽셀을 견준다) 열자마자 작품 층으로 옮긴다. 로비 자체를
 * 보는 검사만 `lobby: true` 로 열어 그 이동을 건너뛴다.
 */
async function openPage(size, { lobby = false } = {}) {
  const page = await browser.newPage(
    size === 'mobile'
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width: 1280, height: 860 } },
  );
  const errors = [];
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', error => errors.push(String(error)));
  page.errors = errors;

  await page.goto(target, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__museum, null, { timeout: 20000 });

  if (!lobby) {
    await page.waitForFunction(() => window.__museum.curtain.phase === 'clear', null, {
      timeout: 30000,
    });
    await page.evaluate(() => window.__museum.jumpRandom(8));
    await page.waitForFunction(() => window.__museum.curtain.phase === 'clear', null, {
      timeout: 30000,
    });
  }
  return page;
}

const settled = page =>
  page.waitForFunction(() => window.__museum.curtain.open >= 0.999, null, { timeout: 25000 });

/**
 * 주소창에 적힌 주소. 표준형은 `?a=C…` 이다 (hash.mjs 참조).
 *
 * `#` 을 뗀 형태로 돌려준다. 시트가 보여 주는 주소와 견주기 쉽게.
 */
const addressInUrl = page =>
  page.evaluate(() => new URLSearchParams(location.search).get('a') ?? '');

/** 자리 옮김을 기다린다. 커튼이 움직이기 시작하는 것을 먼저 본다. */
async function traveled(page) {
  await page.waitForFunction(() => window.__museum.curtain.phase !== 'clear', null, {
    timeout: 20000,
  });
  await settled(page);
  await page.waitForTimeout(250);
}

// ── 1 · 2 · 3 — 화면마다 ─────────────────────────────────────────────────

for (const size of ['mobile', 'desktop']) {
  const page = await openPage(size);
  await settled(page);
  await page.waitForTimeout(400);

  // 연기: 캔버스에 벽 색이 아닌 픽셀이 있다
  const painted = await page.evaluate(() => {
    const canvas = document.getElementById('stage');
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let lit = 0;
    for (let i = 0; i < data.length; i += 4004) {
      if (data[i] > 40 || data[i + 1] > 40 || data[i + 2] > 40) lit++;
    }
    return lit;
  });
  check(`${size}: 격자에 그림이 있다`, painted > 20, `밝은 표본 ${painted}개`);

  // 무늬가 심겼다
  const themed = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--bg-sheet').length,
  );
  check(`${size}: UI 무늬가 심겼다`, themed > 100, `${themed}자`);

  // 암전 중에는 줌이 멈춘다
  await page.click('#btn-random');
  await page.waitForFunction(() => window.__museum.curtain.phase === 'dim', null, { timeout: 5000 });
  const zoomA = await page.evaluate(() => window.__museum.camera.zoom);
  await page.waitForTimeout(150);
  const zoomB = await page.evaluate(() => window.__museum.camera.zoom);
  check(`${size}: 암전 중 줌이 멈춘다`, Math.abs(zoomA - zoomB) < 0.01, `${zoomA} → ${zoomB}`);
  await traveled(page);

  // 고르면 어느 상태로 열리는가. 휴대폰은 제목 줄만, PC 는 펼침.
  const cx = size === 'mobile' ? 195 : 500;
  const cy = size === 'mobile' ? 400 : 420;
  const opensTo = size === 'mobile' ? 'peek' : 'expanded';

  await page.mouse.click(cx, cy);
  await page.waitForFunction(
    () => document.getElementById('sheet').dataset.state !== 'hidden',
    null,
    { timeout: 5000 },
  );
  await page.waitForTimeout(450);
  check(
    `${size}: 고르면 ${opensTo === 'peek' ? '제목 줄만 보인다' : '곧바로 펼쳐진다'}`,
    (await page.evaluate(() => document.getElementById('sheet').dataset.state)) === opensTo,
  );

  // 시트 기하 — peek. PC 는 펼쳐진 채로 열리므로 손잡이를 눌러 접는다.
  if (size !== 'mobile') {
    await page.click('#sheet-grip');
    await page.waitForTimeout(450);
    check(
      `${size}: 손잡이를 누르면 접힌다`,
      (await page.evaluate(() => document.getElementById('sheet').dataset.state)) === 'peek',
    );
  }

  const peek = await page.evaluate(() => {
    const sheet = document.getElementById('sheet');
    const rect = sheet.getBoundingClientRect();
    const style = getComputedStyle(sheet);
    return {
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      visible: Math.round(window.innerHeight - rect.top),
      peekPx: Number.parseFloat(style.getPropertyValue('--peek')),
      padPx: Number.parseFloat(style.getPropertyValue('--pad')),
      innerHeight: window.innerHeight,
      title: document.getElementById('peek-title').textContent,
      bodyVisible: getComputedStyle(document.getElementById('sheet-body')).visibility,
    };
  });

  // 목업의 진짜 버그는 "시트가 바닥에서 떠서 아래에 틈이 생기는 것" 이었다.
  // --peek 이 실제 시트 높이보다 커서 translateY 가 음수가 됐기 때문이다.
  // 보이는 높이만 재면 그 버그를 놓친다. 아래 끝을 봐야 잡힌다.
  check(
    `${size}: 시트 아래에 틈이 없다`,
    peek.bottom >= peek.innerHeight - 1,
    `아래 끝 ${peek.bottom} · 화면 ${peek.innerHeight}`,
  );
  // 제목 줄이 잘리지도, 본문이 비치지도 않는다.
  check(
    `${size}: peek 이 제목 줄만 보여 준다`,
    peek.visible >= peek.peekPx - 2 && peek.visible <= peek.peekPx + peek.padPx + 8,
    `보임 ${peek.visible}px · --peek ${peek.peekPx}px`,
  );
  check(`${size}: peek 에서 본문이 감춰진다`, peek.bodyVisible === 'hidden');
  check(`${size}: peek 에 제목이 있다`, peek.title.length > 2 && peek.title !== '—', peek.title);

  // 시트 기하 — expanded. 다시 펼친다.
  // 휴대폰은 제목 줄을 누르고, PC 는 손잡이를 누른다 (같은 것을 다시 누르는 셈).
  await page.click(size === 'mobile' ? '#sheet-peek' : '#sheet-grip');
  await page.waitForTimeout(500);
  if (size !== 'mobile') {
    check(
      `${size}: 손잡이를 다시 누르면 펼쳐진다`,
      (await page.evaluate(() => document.getElementById('sheet').dataset.state)) === 'expanded',
    );
  }
  const expanded = await page.evaluate(() => {
    const sheet = document.getElementById('sheet');
    const body = document.getElementById('sheet-body');
    const plate = document.querySelector('.plate canvas');
    const rect = sheet.getBoundingClientRect();
    return {
      bottom: Math.round(rect.bottom),
      innerHeight: window.innerHeight,
      scrollWidth: body.scrollWidth,
      clientWidth: body.clientWidth,
      plateW: Math.round(plate.getBoundingClientRect().width),
      plateH: Math.round(plate.getBoundingClientRect().height),
      addressLen: document.getElementById('address').textContent.length,
    };
  });
  const wantsBottom = size === 'mobile' ? expanded.innerHeight : expanded.innerHeight - 18;
  check(
    `${size}: 펼친 시트가 제자리에 앉는다`,
    Math.abs(expanded.bottom - wantsBottom) <= 3,
    `아래 끝 ${expanded.bottom} · 기대 ${wantsBottom}`,
  );
  // 스크롤바가 나타나며 내용 너비를 줄이지 않는다
  check(
    `${size}: 본문 너비가 스크롤바에 밀리지 않는다`,
    expanded.scrollWidth === expanded.clientWidth,
    `${expanded.scrollWidth} vs ${expanded.clientWidth}`,
  );
  check(
    `${size}: 큰 그림이 정사각형이다`,
    Math.abs(expanded.plateW - expanded.plateH) <= 1,
    `${expanded.plateW}×${expanded.plateH}`,
  );
  check(`${size}: 주소가 채워졌다`, expanded.addressLen > 40, `${expanded.addressLen}자`);

  // 떠 있는 버튼이 시트에 가리지 않는다
  const controls = await page.evaluate(() => {
    const rect = document.getElementById('controls').getBoundingClientRect();
    const sheet = document.getElementById('sheet').getBoundingClientRect();
    const hidden = getComputedStyle(document.getElementById('controls')).opacity === '0';
    return { rect, sheet, hidden };
  });
  const overlaps =
    !controls.hidden &&
    controls.rect.right > controls.sheet.left &&
    controls.rect.left < controls.sheet.right &&
    controls.rect.bottom > controls.sheet.top &&
    controls.rect.top < controls.sheet.bottom;
  check(`${size}: 버튼이 펼친 시트와 겹치지 않는다`, !overlaps);

  if (shots) {
    await page.screenshot({ path: `! - dev/shots/check-${size}.png` });
  }
  check(`${size}: 콘솔 오류가 없다`, page.errors.length === 0, page.errors.join(' / '));
  await page.close();
}

// ── 3.4 — 고른 것을 놓는 두 경로 ─────────────────────────────────────────

{
  const page = await openPage('desktop');
  await settled(page);
  await page.waitForTimeout(300);

  /**
   * 화면 구석의 평균 밝기. 고른 것이 있으면 나머지가 어두워진다.
   *
   * **카메라가 움직이면 이 값을 견줄 수 없다.** 고르면 카메라가 그 전시물로
   * 옮겨 가므로 구석에 다른 그림이 온다. 어두운 그림 자리에 밝은 그림이 오면
   * 어두워졌는데도 값이 커진다. 실제로 그렇게 흔들렸다.
   * 그래서 픽셀 비교는 **카메라가 멈춘 한 자리에서만** 한다. 카메라가 움직이는
   * 경로(끌기)는 stage 의 dim 값을 직접 본다.
   */
  const cornerLuma = () =>
    page.evaluate(() => {
      const canvas = document.getElementById('stage');
      const ctx = canvas.getContext('2d');
      const w = Math.round(canvas.width * 0.22);
      const h = Math.round(canvas.height * 0.22);
      const { data } = ctx.getImageData(0, 0, w, h);
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
      return Math.round(sum / (data.length / 4) / 3);
    });
  const sheetState = () => page.evaluate(() => document.getElementById('sheet').dataset.state);
  const focusOf = () => page.evaluate(() => window.__museum.focus);

  /**
   * 고른 전시물이 **평소 크기 바깥으로 삐져나온 만큼**을 센다.
   *
   * 평소 그림의 반지름은 zoom×0.94/2 다. 그 바로 바깥에 줄을 하나 긋고 밝은
   * 픽셀을 센다. 커지지 않았다면 그 줄은 전시물 사이의 벽이라 어둡다.
   *
   * 네 변을 다 재서 가장 큰 값을 쓴다. 그림의 한쪽 끝이 우연히 어두울 수 있지만
   * 네 변이 전부 어두울 일은 없다. 밝기에 기대는 단정을 이렇게 묶는다.
   */
  const edgeBleed = () =>
    page.evaluate(() => {
      const canvas = document.getElementById('stage');
      const ctx = canvas.getContext('2d');
      const dpr = canvas.width / canvas.getBoundingClientRect().width;
      const zoom = window.__museum.camera.zoom * dpr;
      const { data, width } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;

      const at = (zoom * 0.94) / 2 + zoom * 0.006; // 평소 테두리 바로 바깥
      const half = Math.round((zoom * 0.94) / 2) - 3;
      const lit = (x, y) => {
        const i = (Math.round(y) * width + Math.round(x)) * 4;
        return data[i] + data[i + 1] + data[i + 2] > 120;
      };

      let best = 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        let count = 0;
        for (let t = -half; t <= half; t += 2) {
          const x = cx + dx * at + (dx ? 0 : t);
          const y = cy + dy * at + (dy ? 0 : t);
          if (lit(x, y)) count++;
        }
        best = Math.max(best, count);
      }
      return best;
    });

  /**
   * 그림자를 재기 위한 표본. 고른 상태와 놓은 상태에서 각각 같은 픽셀을 읽는다.
   *
   * `band` 은 고른 것 위쪽 옆 작품을 가로지르는 줄이다. `at` 은 고른 것의
   * 테두리에서 칸 간격 몇 배만큼 떨어졌는지다.
   * `calibration` 은 그림자가 절대 닿지 않는 자리다. 아래에서 보정에 쓴다.
   *
   * 놓을 때 카메라가 움직이지 않으므로 두 번 다 같은 픽셀을 읽는다.
   */
  const shadowProbe = () =>
    page.evaluate(() => {
      const canvas = document.getElementById('stage');
      const ctx = canvas.getContext('2d');
      const dpr = canvas.width / canvas.getBoundingClientRect().width;
      const zoom = window.__museum.camera.zoom;
      const { data, width } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const midX = Math.round(canvas.width / 2);
      const midY = Math.round(canvas.height / 2);
      const lumaAt = (x, y) => {
        const i = (Math.round(y) * width + Math.round(x)) * 4;
        return data[i] + data[i + 1] + data[i + 2];
      };

      // 고른 것의 테두리(커진 상태)에서 시작해 위쪽 옆 작품의 끝까지.
      // 옆 작품의 그림이 이 구간에 온전히 들어 있다 (0.53 ~ 1.47 칸).
      const edge = zoom * 0.541;
      const band = [];
      for (let step = 1; step <= 92; step += 1) {
        const y = midY - (edge + (zoom * step) / 100) * dpr;
        for (let dx = -24; dx <= 24; dx += 4) {
          band.push({ at: step / 100, luma: lumaAt(midX + dx * dpr, y) });
        }
      }

      // 보정용. 화면 위쪽 띠는 고른 것에서 두 칸 넘게 떨어져 있다.
      const calibration = [];
      for (let y = 8; y < canvas.height * 0.18; y += 5) {
        for (let x = 8; x < canvas.width; x += 17) calibration.push(lumaAt(x, y));
      }
      return { band, calibration };
    });

  // 프레임마다 크기를 적어 둔다. 애니메이션이 몇 프레임에 걸쳐 있는지 본다.
  const startTrace = () =>
    page.evaluate(() => {
      window.__trace = [];
      const tick = () => {
        const f = window.__museum.focus;
        window.__trace.push([f.lift, f.lifting]);
        if (window.__trace.length < 150) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

  // 고른다. 카메라가 그 전시물로 옮겨 가 멈출 때까지 기다린다.
  await startTrace();
  await page.mouse.click(500, 420);
  await page.waitForTimeout(900);
  const dimmed = await cornerLuma();
  const shadowOn = await shadowProbe();
  // PC 라서 펼쳐진 채로 열린다
  check('고르면 시트가 열린다', (await sheetState()) === 'expanded');
  check('고르면 어둡게 하기가 켜진다', (await focusOf()).dimTarget === 1);

  // ── 커지는 애니메이션 ─────────────────────────────────────────────────
  {
    const trace = (await page.evaluate(() => window.__trace)).map(([lift]) => lift);
    const grown = await focusOf();
    const between = trace.filter(v => v > 0.05 && v < 0.95).length;
    let biggestStep = 0;
    let backwards = 0;
    for (let i = 1; i < trace.length; i++) {
      biggestStep = Math.max(biggestStep, trace[i] - trace[i - 1]);
      if (trace[i] < trace[i - 1] - 1e-9) backwards++;
    }

    check('고른 것이 끝까지 커진다', grown.lift === 1, `크기 ${grown.lift}`);
    check(
      '커지는 동안 중간 크기를 지난다',
      between >= 4,
      `중간값 ${between}프레임 · 한 프레임 최대 ${biggestStep.toFixed(3)}`,
    );
    check('커지는 도중에 되돌아가지 않는다', backwards === 0, `${backwards}회`);
    check('커진 만큼이 화면에 나온다', (await edgeBleed()) > 8, `삐져나온 픽셀 ${await edgeBleed()}개`);
  }

  // ── 옮길 때 둘이 함께 움직인다 ────────────────────────────────────────
  {
    await startTrace();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(700);
    const trace = await page.evaluate(() => window.__trace);
    const both = trace.filter(([, lifting]) => lifting === 2).length;
    const after = await focusOf();

    check(
      '옮기면 떠난 칸과 새 칸이 함께 움직인다',
      both >= 4,
      `두 칸이 함께 움직인 프레임 ${both}개`,
    );
    check('옮긴 뒤에는 한 칸만 남는다', after.lifting === 1 && after.lift === 1);
  }

  if (shots) await page.screenshot({ path: '! - dev/shots/check-focus.png' });

  // 다시 원래 칸으로 돌아온다. 아래 픽셀 비교가 같은 자리에서 이루어져야 한다.
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(700);

  // 같은 것을 한 번 더 누르면 놓는다. 고른 것은 이미 가운데로 와 있다.
  // 놓을 때 카메라는 움직이지 않는다. 그래서 앞뒤 픽셀을 그대로 견줄 수 있다.
  await page.mouse.click(640, 430);
  await page.waitForTimeout(500);
  const released = await cornerLuma();
  const shadowOff = await shadowProbe();
  const afterRelease = await focusOf();
  check('고르면 나머지가 어두워진다', dimmed < released, `어두울 때 ${dimmed} · 놓은 뒤 ${released}`);
  check(
    '같은 것을 다시 누르면 놓는다',
    afterRelease.cell === null && afterRelease.dimTarget === 0,
  );
  check('놓으면 커진 것도 되돌아간다', afterRelease.lift === 0, `크기 ${afterRelease.lift}`);
  check('놓으면 시트가 닫힌다', (await sheetState()) === 'hidden');

  // ── 그림자 ────────────────────────────────────────────────────────────
  //
  // **밝기를 그냥 나누면 안 된다.** 어둡게 하기는 곱셈이 아니라 아핀 변환이다
  // (검정에 가까운 벽색을 alpha 로 얹으므로 `k·원본 + c` 가 된다). c 때문에
  // 어두운 그림에서 비율이 커진다. 처음에 나눗셈으로 짰다가 그림에 따라
  // 0.79 와 0.89 사이를 오가며 흔들렸다.
  //
  // 그래서 그림자가 닿지 않는 자리에서 k 와 c 를 먼저 맞춘다(최소제곱). 그러면
  // "그림자가 없었다면 이 픽셀이 얼마였을까" 를 그림 내용과 무관하게 알 수 있다.
  // 실제 값을 그 예측으로 나눈 것이 남은 밝기, 즉 1 - 그림자 진하기다.
  {
    const pairs = shadowOff.calibration
      .map((plain, index) => [plain, shadowOn.calibration[index]])
      .filter(([plain]) => plain > 30); // 벽만 있는 자리는 기울기를 못 알려 준다

    const n = pairs.length;
    const sx = pairs.reduce((a, [p]) => a + p, 0);
    const sy = pairs.reduce((a, [, f]) => a + f, 0);
    const sxx = pairs.reduce((a, [p]) => a + p * p, 0);
    const sxy = pairs.reduce((a, [p, f]) => a + p * f, 0);
    const k = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const c = (sy - k * sx) / n;

    /** 그 구간에서 그림자가 남긴 밝기의 비율. 1 이면 그림자가 없다. */
    const kept = (from, to) => {
      const picked = shadowOff.band
        .map((plain, index) => ({ at: plain.at, plain: plain.luma, lit: shadowOn.band[index].luma }))
        .filter(s => s.at >= from && s.at <= to && k * s.plain + c > 60);
      if (!picked.length) return null;
      const predicted = picked.reduce((a, s) => a + (k * s.plain + c), 0);
      const actual = picked.reduce((a, s) => a + s.lit, 0);
      return actual / predicted;
    };

    // 그림자가 닿는 거리는 칸 간격의 0.30 이다.
    const near = kept(0.02, 0.16); // 그림자 안
    const mid = kept(0.45, 0.9); // 그림자 밖. 같은 옆 작품의 반대쪽 끝이다

    check(
      '고른 것 뒤로 옆 작품에 그림자가 진다',
      near !== null && near < 0.8,
      `가까이 남은 밝기 ${near?.toFixed(3)} (보정 k=${k.toFixed(3)} c=${c.toFixed(1)})`,
    );
    check(
      '그림자가 옆 작품을 3분의 1쯤에서 놓아 준다',
      mid !== null && mid > 0.92,
      `먼 쪽 남은 밝기 ${mid?.toFixed(3)}`,
    );
  }

  // 끌기 시작하면 놓는다.
  //
  // 여기서는 dim 의 **목표값**을 본다. 애니메이션이 붙었으므로 지금 값은
  // 아직 줄어드는 중이다. "놓았는가" 는 목표값과 고른 칸이 답한다.
  await page.mouse.click(500, 300);
  await page.waitForTimeout(700);
  check('다시 고르면 다시 어두워진다', (await focusOf()).dimTarget === 1);
  await page.mouse.move(640, 430);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(640 - i * 10, 430 - i * 4);
  const duringDrag = await focusOf();
  const sheetDuringDrag = await sheetState();
  await page.mouse.up();
  check(
    '끌기 시작하면 놓는다',
    duringDrag.cell === null && duringDrag.dimTarget === 0,
    `고른 칸 ${JSON.stringify(duringDrag.cell)} · dim 목표 ${duringDrag.dimTarget}`,
  );
  check('끌기 시작하면 시트가 닫힌다', sheetDuringDrag === 'hidden');

  // 6px 문턱 아래의 흔들림은 탭으로 남는다
  await page.mouse.click(500, 300);
  await page.waitForTimeout(700);
  await page.mouse.move(640, 430);
  await page.mouse.down();
  await page.mouse.move(642, 431);
  await page.waitForTimeout(120);
  const tiny = await sheetState();
  await page.mouse.up();
  check('작은 흔들림은 끌기로 보지 않는다', tiny !== 'hidden', `시트 ${tiny}`);

  check('포커스 작업에서 콘솔 오류가 없다', page.errors.length === 0, page.errors.join(' / '));
  await page.close();
}

// ── 3.5 — 층 ─────────────────────────────────────────────────────────────

{
  const page = await openPage('mobile');
  await settled(page);

  const order = await page.evaluate(() =>
    [...document.querySelectorAll('#controls .pill')].map(button => button.id),
  );
  check(
    '떠 있는 버튼 순서가 검색 · 층 · 무작위다',
    order.join(',') === 'btn-search,btn-floor,btn-random',
    order.join(' → '),
  );

  await page.click('#btn-floor');
  await page.waitForTimeout(300);
  const floors = await page.evaluate(() =>
    [...document.querySelectorAll('#floor-list .lang')].map(button => ({
      tier: Number(button.dataset.tier),
      text: button.textContent,
      current: button.getAttribute('aria-current') === 'true',
    })),
  );
  // 0층이 로비, 그 위가 작품 층이다.
  check('로비가 첫째고 작품 층이 오름차순이다', floors.map(f => f.tier).join(',') === '0,4,8,16,32');
  check('층마다 이름과 격자 크기가 있다', floors.every(f => /\d+\s*×\s*\d+/.test(f.text)), floors[0]?.text);
  check('지금 층이 표시된다', floors.filter(f => f.current).length === 1);

  // 1층으로 옮긴다. 자리도 바뀌어야 한다.
  const before = await addressInUrl(page);
  await page.click('#floor-list .lang[data-tier="4"]');
  await traveled(page);
  const afterFloor = {
    tier: await page.evaluate(() => window.__museum.state.tier),
    address: await addressInUrl(page),
  };
  check('층을 고르면 그 층으로 간다', afterFloor.tier === 4, `tier ${afterFloor.tier}`);
  check('층을 옮기면 자리도 바뀐다', afterFloor.address !== before);
  check(
    '낮은 층은 주소가 짧다',
    afterFloor.address.length < before.length,
    `${before.length}자 → ${afterFloor.address.length}자`,
  );

  // 무작위 버튼은 층을 유지한다
  await page.click('#btn-random');
  await traveled(page);
  const afterRandom = {
    tier: await page.evaluate(() => window.__museum.state.tier),
    address: await addressInUrl(page),
  };
  check('무작위는 지금 층 안에서 옮긴다', afterRandom.tier === 4, `tier ${afterRandom.tier}`);
  check('무작위가 자리를 바꾼다', afterRandom.address !== afterFloor.address);

  // ── 층별 줌 예산과 깊이 비네트 ──────────────────────────────────────
  //
  // 깊은 층은 한 장을 그리는 데 더 오래 걸린다. 그래서 멀리 보지 못하게 막는다.
  // 그러지 않으면 끌 때 가장자리에 아직 그리지 못한 검은 칸이 보인다.
  const perFloor = [];
  for (const tier of [4, 8, 16, 32]) {
    await page.click('#btn-floor');
    await page.waitForTimeout(200);
    await page.click(`#floor-list .lang[data-tier="${tier}"]`);
    await traveled(page);
    perFloor.push(
      await page.evaluate(() => ({
        tier: window.__museum.state.tier,
        min: window.__museum.camera.bounds.min,
        max: window.__museum.camera.bounds.max,
        zoom: window.__museum.camera.zoom,
        depth: getComputedStyle(document.body).getPropertyValue('--depth').trim(),
      })),
    );
  }

  check(
    '층이 깊어질수록 최소 줌이 커진다',
    perFloor.every((f, i) => i === 0 || f.min > perFloor[i - 1].min),
    perFloor.map(f => `${f.tier}:${f.min.toFixed(0)}`).join(' '),
  );
  check(
    '최대 줌은 층과 무관하게 같다',
    perFloor.every(f => Math.abs(f.max - perFloor[0].max) < 0.5),
    perFloor.map(f => `${f.tier}:${f.max.toFixed(0)}`).join(' '),
  );
  check(
    '입장 줌이 층마다 다르고 그 층의 한계 안에 있다',
    perFloor.every(f => f.zoom >= f.min - 0.5 && f.zoom <= f.max + 0.5) &&
      perFloor[perFloor.length - 1].zoom > perFloor[0].zoom,
    perFloor.map(f => `${f.tier}:${f.zoom.toFixed(0)}`).join(' '),
  );
  check(
    '깊이 비네트는 가장 깊은 층에만 켜진다',
    perFloor.slice(0, -1).every(f => f.depth === '0') &&
      perFloor[perFloor.length - 1].depth === '1',
    perFloor.map(f => `${f.tier}:${f.depth}`).join(' '),
  );

  // ── 전시실 ──────────────────────────────────────────────────────────
  //
  // 전시실은 좌표에서 유도된다. 주소에 담기지 않으므로, 같은 코드워드가
  // 어디에 있느냐에 따라 다른 그림이 되어야 한다.
  {
    const rooms = await page.evaluate(() => {
      const m = window.__museum;
      const seen = new Map();
      // 씨앗 간격만큼 떨어진 자리들을 훑어 여러 방을 만난다
      for (let i = 0; i < 40; i++) {
        const x = BigInt(i) * m.rooms.CLUSTER_SPAN + 12345n;
        const index = m.rooms.roomOf(x, 67890n);
        seen.set(index, m.rooms.ROOMS[index].name);
      }
      return {
        total: m.rooms.ROOMS.length,
        distinct: seen.size,
        names: [...seen.values()].slice(0, 4),
        base: m.rooms.ROOMS[0].name,
        // 같은 좌표는 늘 같은 방
        stable: m.rooms.roomOf(999n, 111n) === m.rooms.roomOf(999n, 111n),
      };
    });
    check('전시실 목록이 브라우저에 있다', rooms.total >= 20, `${rooms.total}종`);
    check('기준 전시실이 첫째다', rooms.base === 'BASE', rooms.base);
    check('걸으면 여러 전시실을 만난다', rooms.distinct >= 8, `${rooms.distinct}종 만남`);
    check('같은 좌표는 늘 같은 전시실이다', rooms.stable === true);

    // 실제로 그림이 달라지는지. 같은 층에서 아주 멀리 떨어진 두 자리를 비교한다.
    const differs = await page.evaluate(async () => {
      const m = window.__museum;
      const span = m.rooms.CLUSTER_SPAN;
      // 서로 다른 방인 두 좌표를 찾는다
      let a = null;
      let b = null;
      for (let i = 0; i < 200 && (a === null || b === null); i++) {
        const x = BigInt(i) * span + 555n;
        const index = m.rooms.roomOf(x, 777n);
        if (a === null) a = { x, index };
        else if (index !== a.index) b = { x, index };
      }
      return a && b ? { roomA: a.index, roomB: b.index } : null;
    });
    check(
      '멀리 떨어진 자리는 다른 전시실이다',
      differs !== null && differs.roomA !== differs.roomB,
      differs ? `${differs.roomA} vs ${differs.roomB}` : '못 찾음',
    );
  }

  // ── 로비 (0층) ──────────────────────────────────────────────────────
  //
  // 작품이 없는 층이다. 코드워드도 전시실도 없고, 축이 작아 걸으면 순환한다.
  {
    await page.click('#btn-floor');
    await page.waitForTimeout(200);
    await page.click('#floor-list .lang[data-tier="0"]');
    await traveled(page);

    const inLobby = await page.evaluate(() => ({
      tier: window.__museum.state.tier,
      address: location.search,
    }));
    check('로비로 갈 수 있다', inLobby.tier === 0, `tier ${inLobby.tier}`);
    // 층이 비트에 접혀 있으므로 주소를 실제로 읽어서 확인한다
    check(
      '로비 주소가 0층이다',
      stateInUrl(inLobby.address)?.tier === 0,
      inLobby.address.slice(0, 32),
    );

    // 작품 정보를 열 수 없다. 로비에는 작품이 없다.
    await page.click('#stage', { position: { x: 200, y: 200 } });
    await page.waitForTimeout(350);
    const sheetState = await page.evaluate(
      () => document.getElementById('sheet').dataset.state,
    );
    check('로비에서는 작품 정보가 열리지 않는다', sheetState === 'hidden', sheetState);

    // 순환. 축이 6비트라 64칸이면 제자리다.
    const wrapped = await page.evaluate(() => {
      const m = window.__museum;
      const before = m.state;
      // 방향키로 오른쪽으로 64번 (한 칸씩)
      return { x: before.x, y: before.y };
    });
    check('로비 좌표가 순환 범위 안이다', BigInt(wrapped.x) < 64n && BigInt(wrapped.y) < 64n,
      `${wrapped.x}, ${wrapped.y}`);

    // 다시 작품 층으로 나온다
    await page.click('#btn-floor');
    await page.waitForTimeout(200);
    await page.click('#floor-list .lang[data-tier="8"]');
    await traveled(page);
    check(
      '로비에서 작품 층으로 돌아온다',
      (await page.evaluate(() => window.__museum.state.tier)) === 8,
    );
  }

  // 찾기의 층 선택
  await page.click('#btn-search');
  await page.waitForTimeout(250);
  const segments = await page.evaluate(() =>
    [...document.querySelectorAll('#search-floor-row .segment')].map(b => Number(b.dataset.tier)),
  );
  // 로비는 없다. 찾기는 작품을 찾는 것이고 로비에는 작품이 없다.
  check('찾기의 층 선택에 로비가 없다', segments.join(',') === '4,8,16,32', segments.join(','));

  await page.click('#search-floor-row .segment[data-tier="16"]');
  await page.fill('#search-text', 'abc,def');
  await page.click('#btn-go');
  await traveled(page);
  check(
    '좌표만 넣으면 고른 층으로 간다',
    (await page.evaluate(() => window.__museum.state.tier)) === 16,
  );

  // 전체 해시는 고른 층을 이긴다
  await page.click('#btn-search');
  await page.waitForTimeout(200);
  await page.click('#search-floor-row .segment[data-tier="16"]');
  await page.fill('#search-text', `#${addressOf(4)}`);
  await page.click('#btn-go');
  await traveled(page);
  check(
    '주소에 층이 있으면 그것이 이긴다',
    (await page.evaluate(() => window.__museum.state.tier)) === 4,
  );

  // 찾기의 전시실 선택
  //
  // 투영까지 돌리지는 않는다(층 4 도 몇 초 걸린다). 고르는 부분만 본다.
  // "그 방에 정말 떨어지는가" 는 코덱 본체의 test/project.test.mjs 가 방 31개
  // 전부에 대해 좌표와 픽셀을 직접 확인한다. 여기서 겹쳐 볼 이유가 없다.
  await page.click('#btn-search');
  await page.waitForTimeout(250);

  const rooms = await page.evaluate(() => ({
    total: window.__museum.rooms.ROOMS.length,
    chips: [...document.querySelectorAll('#search-room-row .segment')].map(b => b.dataset.room),
    current: document.querySelector('#search-room-row .segment[aria-current="true"]')?.dataset
      .room,
  }));

  check(
    '전시실 선택에 방이 전부 있다',
    rooms.chips.length === rooms.total,
    `${rooms.chips.length}칸 / 방 ${rooms.total}개`,
  );
  // "어디든" 은 두지 않는다. 방을 강제하지 않으면 좌표가 아무 방에 떨어지고
  // 그 방이 자기 방식으로 읽어서 올린 그림과 평균 10배 멀어진다(실측).
  check('전시실 기본값이 기준 전시실이다', rooms.current === '0', String(rooms.current));

  // 칸에는 번호만 있고, 고른 방의 이름이 아래에 따로 나온다
  {
    const shown = await page.evaluate(() => ({
      name: document.getElementById('search-room-name').textContent.trim(),
      label: document
        .querySelector('#search-room-row .segment[data-room="26"]')
        ?.getAttribute('aria-label'),
    }));
    check('고른 전시실의 이름이 나온다', shown.name.length > 0, shown.name);
    check(
      '칸마다 이름이 aria-label 로 붙어 있다',
      Boolean(shown.label) && shown.label.length > 0,
      shown.label,
    );

    // 다른 방을 고르면 이름도 따라간다
    await page.click('#search-room-row .segment[data-room="26"]');
    await page.waitForTimeout(150);
    const after = await page.evaluate(() =>
      document.getElementById('search-room-name').textContent.trim(),
    );
    check('방을 바꾸면 이름도 바뀐다', after !== shown.name && after === shown.label, `${shown.name} → ${after}`);
  }

  await page.click('#search-room-row .segment[data-room="4"]');
  await page.waitForTimeout(100);
  check(
    '전시실을 누르면 그 방이 골라진다',
    (await page.evaluate(
      () =>
        document.querySelector('#search-room-row .segment[aria-current="true"]')?.dataset.room,
    )) === '4',
  );

  check('층 작업에서 콘솔 오류가 없다', page.errors.length === 0, page.errors.join(' / '));
  await page.close();
}

// ── 3.6 — 무늬 표면이 요소를 덮는다 ──────────────────────────────────────

{
  const page = await openPage('desktop');
  await settled(page);

  // 토스트가 타일보다 넓어지면 양쪽 끝이 배경 없이 비친다. 실제로 그랬다.
  const toast = await page.evaluate(() => {
    const host = document.getElementById('toasts');
    const element = document.createElement('div');
    element.className = 'toast surface';
    element.textContent =
      'Could not copy. The address is shown below. This is a deliberately very long message.';
    host.append(element);
    const rect = element.getBoundingClientRect();
    const tile = Number.parseFloat(getComputedStyle(element).backgroundSize);
    element.remove();
    return { width: Math.round(rect.width), height: Math.round(rect.height), tile };
  });
  check(
    '긴 토스트도 무늬 타일 안에 들어간다',
    toast.tile >= toast.width && toast.tile >= toast.height,
    `${toast.width}×${toast.height} · 타일 ${toast.tile}px`,
  );
  await page.close();
}

// ── 4 — 무늬가 방문 동안 유지된다 ────────────────────────────────────────

{
  const page = await openPage('mobile');
  await settled(page);
  const read = () =>
    page.evaluate(() => ({
      bg: getComputedStyle(document.documentElement).getPropertyValue('--bg-sheet'),
      seeds: sessionStorage.getItem('mob.surfaces.v1'),
    }));

  const first = await read();
  await page.click('#btn-random');
  await traveled(page);
  const afterJump = await read();
  check('점프해도 무늬가 그대로다', first.bg === afterJump.bg);

  await page.reload({ waitUntil: 'commit' });
  await page.waitForFunction(() => window.__museum, null, { timeout: 20000 });
  await settled(page);
  const afterReload = await read();
  check('새로고침해도 무늬가 그대로다', first.bg === afterReload.bg);
  check('저장된 것은 좌표뿐이다', (first.seeds?.length ?? 0) < 6000, `${first.seeds?.length}바이트`);
  await page.close();
}

// ── 5 — 내려받아 올리면 제자리 ───────────────────────────────────────────

{
  const page = await openPage('mobile');
  await settled(page);
  await page.mouse.click(195, 400);
  await page.waitForTimeout(600);
  await page.click('#sheet-peek');
  await page.waitForTimeout(400);
  const chosen = await page.evaluate(() => document.getElementById('address').textContent);

  const download = page.waitForEvent('download');
  await page.click('#btn-download');
  await page.waitForTimeout(250);
  await page.click('.menu-item[data-size="256"]');
  const file = await download;
  const saved = join(temp, 'roundtrip.png');
  await file.saveAs(saved);
  check('파일 이름이 짧다', file.suggestedFilename().length < 60, file.suggestedFilename());

  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.click('#btn-random');
  await traveled(page);
  const elsewhere = await addressInUrl(page);
  check('무작위 점프가 자리를 옮긴다', elsewhere !== chosen.replace(/^#/, ''));

  await page.click('#btn-search');
  await page.setInputFiles('#search-file', saved);
  await traveled(page);
  const returned = await addressInUrl(page);
  check(
    '내려받아 올리면 제자리로 온다',
    returned === chosen.replace(/^#/, ''),
    `${returned.slice(0, 24)}…`,
  );

  // 읽을 수 없는 입력은 알리고 모달을 닫지 않는다
  await page.click('#btn-search');
  await page.fill('#search-text', 'not an address');
  await page.click('#btn-go');
  await page.waitForTimeout(250);
  const toasted = await page.locator('.toast').count();
  const stillOpen = await page.isVisible('#scrim-search');
  check('읽을 수 없는 입력을 알린다', toasted > 0);
  check('알린 뒤 모달을 닫지 않는다', stillOpen);
  await page.close();
}

// ── 5.2 — 올린 그림을 층마다 다시 찾는다 ─────────────────────────────────
//
// 층을 바꾸면 다시 올리게 하지 않는다. 같은 그림이 층마다 어디에 있는지
// 견주는 것이 이 미술관에서 가장 재미있는 조작이기 때문이다.

{
  const page = await openPage('desktop');
  await settled(page);

  // 도장이 없는 파일을 얻는다. Alt+Shift+클릭이 디버그 내려받기다.
  // 도장이 있으면 청크를 읽고 곧바로 가 버려서 투영을 타지 않는다.
  // PC 는 고르면 곧바로 펼쳐진다. 제목 줄을 누를 필요가 없다.
  await page.mouse.click(500, 420);
  await page.waitForTimeout(800);

  const download = page.waitForEvent('download');
  await page.click('#btn-download', { modifiers: ['Alt', 'Shift'] });
  const file = await download;
  const plain = join(temp, 'unstamped.png');
  await file.saveAs(plain);

  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // 지금 층(2층)에서 투영한다
  await page.click('#btn-search');
  await page.waitForTimeout(250);
  await page.setInputFiles('#search-file', plain);
  await page.waitForSelector('#compare:not([hidden])', { timeout: 45000 });
  check('도장 없는 그림은 투영으로 찾는다', await page.isVisible('#compare'));

  // 층을 1층으로 바꾼다. 다시 올리지 않는다.
  //
  // "앞 결과를 지웠다가 다시 보여 준다" 를 시간을 재서 확인하면 안 된다.
  // 1층 투영은 빨라서 잠깐 뒤에 보면 이미 새 결과가 떠 있다. 대신 속성이
  // 바뀐 순서를 기록한다. 빠르든 느리든 순서는 같다.
  await page.evaluate(() => {
    window.__compareLog = [];
    const target = document.getElementById('compare');
    new MutationObserver(() => window.__compareLog.push(target.hidden)).observe(target, {
      attributes: true,
      attributeFilter: ['hidden'],
    });
  });

  await page.click('#search-floor-row .segment[data-tier="4"]');
  await page.waitForSelector('#compare:not([hidden])', { timeout: 45000 });
  const compareLog = await page.evaluate(() => window.__compareLog);

  check(
    '층을 바꾸면 앞 결과를 지운 뒤 새로 찾는다',
    compareLog[0] === true && compareLog.at(-1) === false,
    `숨김 여부가 ${JSON.stringify(compareLog)} 순으로 바뀌었다`,
  );
  check('다시 올리지 않아도 새 층에서 다시 찾는다', await page.isVisible('#compare'));

  await page.click('#btn-go');
  await traveled(page);
  check(
    '그 결과가 바꾼 층의 자리다',
    (await page.evaluate(() => window.__museum.state.tier)) === 4,
    `tier ${await page.evaluate(() => window.__museum.state.tier)}`,
  );

  // 전시실을 골라서 찾으면 **정말로** 그 방 안의 자리를 준다.
  //
  // 여기가 이 기능의 알맹이다. room 을 워커까지 못 넘기면 아무 말 없이 무시되고
  // "고른 방에서 찾았다" 가 조용히 거짓이 된다. 그래서 화면에서 끝까지 확인한다.
  const WANTED = 7;
  await page.click('#btn-search');
  await page.waitForTimeout(250);
  await page.click('#search-floor-row .segment[data-tier="4"]');
  await page.click(`#search-room-row .segment[data-room="${WANTED}"]`);
  await page.setInputFiles('#search-file', plain);
  await page.waitForSelector('#compare:not([hidden])', { timeout: 60000 });
  await page.click('#btn-go');
  await traveled(page);

  // state 는 좌표를 문자열로 내보낸다(BigInt 는 직렬화되지 않는다). 되돌려서 쓴다.
  const landed = await page.evaluate(() => {
    const m = window.__museum;
    return m.rooms.roomOf(BigInt(m.state.x), BigInt(m.state.y));
  });
  check('고른 전시실 안의 자리를 준다', landed === WANTED, `방 ${landed} (원한 것 ${WANTED})`);

  check('층을 바꿔 찾는 동안 콘솔 오류가 없다', page.errors.length === 0, page.errors.join(' / '));
  await page.close();
}

// ── 5.5 — 주소창은 `?a=` 하나로 통일된다 ─────────────────────────────────
//
// 링크 카드에 그림이 뜨려면 주소가 서버까지 가야 한다. 프래그먼트는 서버로
// 가지 않으므로 표준형을 쿼리로 옮겼다. 둘을 같이 남기면 주소가 두 배로
// 길어지므로 해시는 반드시 사라져야 한다.

{
  const page = await openPage('desktop');
  await settled(page);
  await page.waitForTimeout(300);

  const url = await page.evaluate(() => location.href);
  check(
    '주소창이 ?a= 형태다',
    new RegExp(`\\?a=${VERSION_MARKER}[0-9A-Za-z]+$`).test(url),
    url.slice(0, 60),
  );
  // 읽히는 구조가 남지 않았는가. 점으로 나뉜 칸도, 판 이름도 없어야 한다.
  // (`v` 는 62진수의 한 자리이므로 주소 안에 나오는 것 자체는 정상이다.
  //  금지할 것은 맨 앞의 `v2.` 같은 접두사뿐이다.)
  const body = /[?&]a=([^&#]*)/.exec(url)?.[1] ?? '';
  check('주소에 점으로 나뉜 칸이 없다', !body.includes('.'), body.slice(0, 40));
  check('주소가 판 이름으로 시작하지 않는다', !/^v\d/.test(body), body.slice(0, 40));
  check('주소창에 해시가 없다', !url.includes('#'), url.slice(-40));

  // 복사 버튼이 주는 것이 바로 그 형태여야 한다
  await page.mouse.click(500, 420);
  await page.waitForTimeout(800);
  const shown = await page.evaluate(() => document.getElementById('address').textContent);
  const copied = await page.evaluate(() => {
    // 클립보드 권한 없이도 확인하려고 가로챈다
    let taken = null;
    const real = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = text => {
      taken = text;
      return Promise.resolve();
    };
    document.getElementById('btn-copy').click();
    navigator.clipboard.writeText = real;
    return taken;
  });
  check(
    '복사 버튼이 ?a= 링크를 준다',
    copied?.includes(`?a=${shown.replace(/^#/, '')}`),
    (copied ?? '없다').slice(0, 60),
  );

  // 옛 `#` 링크를 붙이면 그 자리로 가고 주소창이 정리된다
  const legacy = await page.evaluate(() => document.getElementById('address').textContent);
  await page.evaluate(() => window.__museum.jumpRandom());
  await traveled(page);
  await page.evaluate(h => {
    location.hash = h;
  }, legacy);
  await traveled(page);
  const after = await page.evaluate(() => location.href);
  check(
    '옛 # 링크가 ?a= 로 바뀐다',
    !after.includes('#') && after.includes(`?a=${legacy.replace(/^#/, '')}`),
    after.slice(-50),
  );

  check('주소 작업에서 콘솔 오류가 없다', page.errors.length === 0, page.errors.join(' / '));
  await page.close();
}

// ── 6 — 언어를 바꾸면 남는 것이 없다 ─────────────────────────────────────
//
// 아이폰에서 "영어로 바꿨는데 모달이 한국어로 남는다" 는 신고가 있었다.
// 화면에 그려 두고 다시 채우지 않는 자리가 있으면 이렇게 된다.
// 그래서 한국어로 들어간 뒤 영어로 바꾸고, 모든 표면을 열어 한글을 찾는다.

{
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'ko-KR', // 한국어로 시작하게 만든다
  });
  const errors = [];
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', error => errors.push(String(error)));

  await page.goto(target, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__museum, null, { timeout: 20000 });
  // 주소 없이 들어오면 로비다. 여기서는 작품 제목과 시트를 봐야 하므로 옮긴다.
  await page.waitForFunction(() => window.__museum.curtain.phase === 'clear', null, {
    timeout: 30000,
  });
  await page.evaluate(() => window.__museum.jumpRandom(8));
  await settled(page);
  await page.waitForTimeout(300);

  // 페이지 안에 한글 찾기를 심는다. 보이는 것만 본다.
  await page.addScriptTag({
    content: `window.__hangul = () => {
      const found = [];
      const hangul = /[가-힣]/;
      const seen = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = seen.nextNode(); node; node = seen.nextNode()) {
        const text = (node.nodeValue || '').trim();
        if (!text || !hangul.test(text)) continue;
        const element = node.parentElement;
        if (!element) continue;
        // 언어 목록의 자국어 표기는 일부러 그 나라 글자로 둔다
        if (element.closest('.lang-native')) continue;
        if (!element.checkVisibility({ checkVisibilityCSS: true })) continue;
        found.push((element.id ? '#' + element.id : element.tagName.toLowerCase()) + ': ' + text.slice(0, 44));
      }
      for (const element of document.querySelectorAll('[aria-label]')) {
        const value = element.getAttribute('aria-label') || '';
        if (hangul.test(value)) found.push('aria-label ' + (element.id || element.tagName.toLowerCase()) + ': ' + value.slice(0, 44));
      }
      return found;
    };`,
  });

  const startedKorean = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    hangul: window.__hangul().length,
  }));
  check(
    '한국어 기기는 한국어로 시작한다',
    startedKorean.lang === 'ko' && startedKorean.hangul > 0,
    `lang=${startedKorean.lang} · 한글 ${startedKorean.hangul}곳`,
  );

  // 한국어 상태에서 시트를 열어 둔다. 언어를 바꿀 때 이미 그려진 자리가 있어야
  // 다시 채우지 않는 버그가 드러난다.
  await page.mouse.click(195, 400);
  await page.waitForTimeout(600);
  await page.click('#sheet-peek');
  await page.waitForTimeout(400);
  const koreanTitle = await page.evaluate(() => document.getElementById('plaque-title').textContent);
  check('한국어 제목이 한글이다', /[가-힣]/.test(koreanTitle), koreanTitle);

  // 기록에 전시실이 있다. 전시실은 좌표에서 나오므로 이 줄이 없으면
  // 관람객은 자기가 어느 방에 있는지 알 방법이 전혀 없다.
  {
    const record = await page.evaluate(() => {
      const pairs = [];
      const list = document.getElementById('record');
      const dts = [...list.querySelectorAll('dt')];
      const dds = [...list.querySelectorAll('dd')];
      for (let i = 0; i < dts.length; i++) {
        pairs.push([dts[i].textContent, dds[i]?.textContent ?? '']);
      }
      return pairs;
    });
    const room = record.find(([key]) => key === '전시실');
    check('기록에 전시실이 있다', room !== undefined, record.map(r => r[0]).join(' · '));

    // `이름 · 번호` 형태다. 이름만 두면 찾기 모달(번호로 고른다)과 이어지지 않고,
    // 번호만 두면 기억에 남지 않는다.
    const parts = (room?.[1] ?? '').split('·').map(s => s.trim());
    check(
      '전시실이 이름과 번호를 함께 보여 준다',
      parts.length === 2 && parts[0].length > 0 && /^\d+$/.test(parts[1]),
      room?.[1],
    );
    check(
      '전시실 이름이 한글이다',
      /[가-힣]/.test(parts[0] ?? ''),
      parts[0],
    );
    const index = Number(parts[1]);
    const total = await page.evaluate(() => window.__museum.rooms.ROOMS.length);
    check('전시실 번호가 범위 안이다', index >= 1 && index <= total, `${index} / ${total}`);

    // 좌표에서 유도한 방과 시트에 적힌 방이 같은가. 어긋나면 안내판이 거짓말이다.
    const derived = await page.evaluate(() => {
      const m = window.__museum;
      const at = m.rooms.roomOf(BigInt(m.state.x), BigInt(m.state.y));
      return { at, name: m.rooms.ROOMS[at].name };
    });
    check(
      '시트의 전시실이 좌표에서 유도한 것과 같다',
      index - 1 === derived.at,
      `시트 ${index - 1} · 좌표 ${derived.at} (${derived.name})`,
    );
  }

  // 영어로 바꾼다
  await page.click('#btn-language');
  await page.waitForTimeout(250);
  await page.click('#lang-list .lang[data-lang="en"]');
  await page.waitForTimeout(350);

  check(
    '바꾸면 html lang 이 따라온다',
    (await page.evaluate(() => document.documentElement.lang)) === 'en',
  );

  const englishTitle = await page.evaluate(() =>
    document.getElementById('plaque-title').textContent,
  );
  check(
    '열려 있던 시트의 제목이 영어로 바뀐다',
    !/[가-힣]/.test(englishTitle) && englishTitle !== koreanTitle,
    `${koreanTitle} → ${englishTitle}`,
  );

  // ── 나중에 넣은 세 언어 ────────────────────────────────────────────────
  //
  // 사전만 만들고 label.mjs 의 낱말 표를 잊으면 **화면은 번역되는데 제목만
  // 영어로 남는다.** 단위 검사가 낱말 표를 세지만, 실제로 고른 뒤에 벽 라벨이
  // 그 언어로 바뀌는지는 여기서만 보인다.
  {
    const listed = await page.$$eval('#lang-list .lang', nodes =>
      nodes.map(node => node.dataset.lang),
    );
    check(
      '언어 목록이 다섯 개다',
      listed.join(',') === 'en,ko,ja,zh,ru',
      listed.join(',') || '없다',
    );

    const SCRIPTS = {
      ja: /[\u3040-\u30ff\u3400-\u9fff]/,
      zh: /[\u3400-\u9fff]/,
      ru: /[\u0400-\u04ff]/,
    };
    for (const [code, script] of Object.entries(SCRIPTS)) {
      await page.click('#btn-language');
      await page.waitForTimeout(220);
      await page.click(`#lang-list .lang[data-lang="${code}"]`);
      await page.waitForTimeout(320);
      const state = await page.evaluate(() => ({
        lang: document.documentElement.lang,
        title: document.getElementById('plaque-title').textContent,
        copy: document.querySelector('#btn-copy')?.textContent ?? '',
      }));
      check(
        `${code} 로 바꾸면 제목까지 그 언어가 된다`,
        state.lang === code &&
          script.test(state.title) &&
          !/[A-Za-z]/.test(state.title) &&
          script.test(state.copy),
        `lang=${state.lang} · ${state.title} · ${state.copy}`,
      );
    }

    // 아래 검사들은 영어를 전제한다. 돌려 놓는다.
    await page.click('#btn-language');
    await page.waitForTimeout(220);
    await page.click('#lang-list .lang[data-lang="en"]');
    await page.waitForTimeout(320);
  }

  /** 표면 하나를 열고 한글이 남았는지 본다. */
  async function scan(label, before) {
    if (before) await before();
    const found = await page.evaluate(() => window.__hangul());
    check(`영어로 바꾼 뒤 ${label}에 한글이 없다`, found.length === 0, found.join(' / '));
  }

  await scan('펼친 시트');

  // 펼친 시트는 휴대폰 화면에서 버튼을 덮는다. 접고 놓는다.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  await scan('찾기 모달', async () => {
    await page.click('#btn-search');
    await page.waitForTimeout(300);
  });
  await scan('층 모달', async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await page.click('#btn-floor');
    await page.waitForTimeout(300);
  });
  await scan('언어 모달', async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await page.click('#btn-language');
    await page.waitForTimeout(300);
  });
  await scan('토스트', async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    // 읽을 수 없는 주소를 넣어 토스트를 띄운다
    await page.click('#btn-search');
    await page.waitForTimeout(250);
    await page.fill('#search-text', 'not an address');
    await page.click('#btn-go');
    await page.waitForTimeout(300);
  });
  await scan('내려받기 메뉴', async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    // 시트를 다시 열어야 내려받기 버튼에 닿는다
    await page.mouse.click(195, 400);
    await page.waitForTimeout(600);
    await page.click('#sheet-peek');
    await page.waitForTimeout(400);
    await page.click('#btn-download');
    await page.waitForTimeout(250);
  });

  // 새로고침 뒤에도 영어다. 저장이 막힌 환경이면 여기서 드러난다.
  await page.reload({ waitUntil: 'commit' });
  await page.waitForFunction(() => window.__museum, null, { timeout: 20000 });
  await settled(page);
  await page.waitForTimeout(300);
  await page.addScriptTag({
    content: `window.__hangul = () => {
      const found = [];
      const hangul = /[가-힣]/;
      const seen = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = seen.nextNode(); node; node = seen.nextNode()) {
        const text = (node.nodeValue || '').trim();
        if (!text || !hangul.test(text)) continue;
        const element = node.parentElement;
        if (!element || element.closest('.lang-native')) continue;
        if (!element.checkVisibility({ checkVisibilityCSS: true })) continue;
        found.push((element.id ? '#' + element.id : element.tagName.toLowerCase()) + ': ' + text.slice(0, 44));
      }
      return found;
    };`,
  });
  const afterReload = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    found: window.__hangul(),
  }));
  check(
    '새로고침해도 영어로 남는다',
    afterReload.lang === 'en' && afterReload.found.length === 0,
    `lang=${afterReload.lang} · ${afterReload.found.join(' / ')}`,
  );

  check('언어 작업에서 콘솔 오류가 없다', errors.length === 0, errors.join(' / '));
  await page.close();
}

// ── 5.6 — 조작과 알림의 잔가지 ───────────────────────────────────────────
//
// 자기 페이지에서 돌린다. 앞의 검사들이 카메라 자리에 기대고 있어서, 그 흐름
// 안에 끼워 넣으면 뒤의 픽셀 비교를 흔든다.

{
  const page = await openPage('desktop');
  await settled(page);

  // 방향키 두 개를 함께 누르면 대각선으로 간다
  //
  // keydown 이벤트 하나는 키 하나만 알려 준다. 그래서 예전에는 두 방향을 함께
  // 눌러도 마지막 것만 먹었다. `down` 으로 누른 채로 두어야 그 상태를 만든다.
  {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(450);
    const from = await page.evaluate(() => window.__museum.focus.cell);

    await page.keyboard.down('ArrowRight');
    await page.keyboard.down('ArrowDown');
    await page.waitForTimeout(450);
    const to = await page.evaluate(() => window.__museum.focus.cell);
    await page.keyboard.up('ArrowDown');
    await page.keyboard.up('ArrowRight');

    check(
      '방향키 두 개를 함께 누르면 대각선으로 간다',
      to.i > from.i && to.j > from.j,
      `(${from.i}, ${from.j}) → (${to.i}, ${to.j})`,
    );
  }

  // 마주보는 두 방향은 서로 지운다
  //
  // 먼저 누른 키는 단독으로 눌린 것이므로 한 칸 가는 것이 맞다. 확인할 것은
  // **둘을 함께 쥐고 있는 동안** 키 반복이 와도 더 움직이지 않는다는 것이다.
  {
    await page.keyboard.down('ArrowLeft');
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(250);
    const held = await page.evaluate(() => window.__museum.focus.cell);
    await page.waitForTimeout(700); // 키 반복이 여러 번 올 만큼
    const still = await page.evaluate(() => window.__museum.focus.cell);
    await page.keyboard.up('ArrowLeft');
    await page.keyboard.up('ArrowRight');

    check(
      '좌우를 함께 쥐고 있으면 더 움직이지 않는다',
      still.i === held.i && still.j === held.j,
      `(${held.i}, ${held.j}) → (${still.i}, ${still.j})`,
    );
  }

  // 토스트: 문구가 길면 더 오래 머물고, 남은 시간이 보인다
  {
    const lives = await page.evaluate(() => {
      // toast.mjs 의 계산을 화면에서 직접 부를 수는 없으므로, 실제로 띄워
      // --toast-life 를 읽는다. 값이 CSS 변수로 나오는 것 자체가 계약이다.
      const host = document.getElementById('toasts');
      const spawn = message => {
        const before = host.childElementCount;
        window.__museum.toast(message);
        const element = host.children[before];
        const life = getComputedStyle(element).getPropertyValue('--toast-life').trim();
        const bar = element.querySelector('.toast-progress');
        const width = bar ? bar.getBoundingClientRect().width : 0;
        return { life: Number.parseInt(life, 10), hasBar: Boolean(bar), width };
      };
      const short = spawn('짧다');
      const long = spawn(
        '이것은 일부러 아주 길게 쓴 문구다. 다 읽을 시간을 주는지 보려고 늘려 두었다.',
      );
      return { short, long };
    });

    check(
      '토스트에 남은 시간 표시가 있다',
      lives.short.hasBar && lives.short.width > 0,
      `너비 ${Math.round(lives.short.width)}px`,
    );
    check(
      '긴 문구가 더 오래 머문다',
      lives.long.life > lives.short.life,
      `${lives.short.life}ms → ${lives.long.life}ms`,
    );
    check(
      '토스트가 예전 고정값(2.4초)보다 오래 머문다',
      lives.short.life >= 2600,
      `${lives.short.life}ms`,
    );
  }

  // 언어 칸이 `이름 (자국어)` 한 줄이고 가운데 있다
  {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await page.click('#btn-language');
    await page.waitForTimeout(250);

    const langs = await page.$$eval('#lang-list .lang', nodes =>
      nodes.map(node => {
        const box = node.getBoundingClientRect();
        const label = node.querySelector('.lang-label');
        const inner = label.getBoundingClientRect();
        return {
          code: node.dataset.lang,
          text: node.textContent.trim(),
          // 좌우 여백이 비슷하면 가운데 있다
          offCentre: Math.abs(
            inner.left - box.left - (box.right - inner.right),
          ),
          fontSize: Number.parseFloat(getComputedStyle(node).fontSize),
          // 위아래 여백이 비슷하면 세로로도 가운데 있다
          offMiddle: Math.abs(inner.top - box.top - (box.bottom - inner.bottom)),
        };
      }),
    );

    const korean = langs.find(l => l.code === 'ko');
    const english = langs.find(l => l.code === 'en');

    check('언어 칸이 `이름 (자국어)` 한 줄이다', korean.text === 'Korean (한국어)', korean.text);
    check(
      '두 표기가 같은 언어는 괄호를 붙이지 않는다',
      english.text === 'English',
      english.text,
    );
    check(
      '언어 칸의 글자가 가로세로 모두 가운데다',
      langs.every(l => l.offCentre <= 2 && l.offMiddle <= 3),
      langs.map(l => `${l.code} ${l.offCentre.toFixed(1)}/${l.offMiddle.toFixed(1)}`).join(' · '),
    );
    check(
      '언어 칸의 글자가 예전보다 크다',
      korean.fontSize >= 16,
      `${korean.fontSize}px`,
    );
  }

  check('잔가지 검사에서 콘솔 오류가 없다', page.errors.length === 0, page.errors.join(' / '));
  await page.close();
}

// ── 5.7 — 개방이 기기 속도에 맞고, 인트로 중 줌이 어긋나지 않는다 ────────

{
  const page = await openPage('desktop');
  await settled(page);

  // 개방 길이가 최소(400ms) 이상 최대(1400ms) 이하다
  {
    const seen = [];
    await page.click('#btn-random');
    // 개방에 들어선 순간의 길이를 잡는다
    await page.waitForFunction(() => window.__museum.curtain.phase === 'open', null, {
      timeout: 20000,
    });
    seen.push(await page.evaluate(() => window.__museum.curtain.duration));
    await traveled(page);

    check(
      '개방 길이가 400~1400ms 안이다',
      seen[0] >= 400 && seen[0] <= 1400,
      `${seen[0]}ms`,
    );
  }

  // 깊은 층은 한 장이 더 오래 걸리므로 개방이 더 길거나 같다
  {
    const durationAt = async tier => {
      await page.click('#btn-floor');
      await page.waitForTimeout(200);
      await page.click(`#floor-list .lang[data-tier="${tier}"]`);
      await page.waitForFunction(() => window.__museum.curtain.phase === 'open', null, {
        timeout: 60000,
      });
      const ms = await page.evaluate(() => window.__museum.curtain.duration);
      await traveled(page);
      return ms;
    };

    const shallow = await durationAt(4);
    const deep = await durationAt(32);
    check(
      '깊은 층이 더 천천히 열린다',
      deep >= shallow,
      `층4 ${shallow}ms · 층32 ${deep}ms`,
    );
  }

  // 인트로 중에 휠로 줌하면 개방이 줌 몰기를 손에 넘긴다
  //
  // 넘기지 않으면 zoomAround 가 옮긴 x·y 만 남고 줌은 forceZoom 이 되돌려서,
  // 화면 가운데가 아닌 곳을 중심으로 줌한 것처럼 보인다. 실제 버그였다.
  {
    await page.click('#btn-random');
    await page.waitForFunction(() => window.__museum.curtain.phase === 'open', null, {
      timeout: 20000,
    });

    const owned = await page.evaluate(() => window.__museum.curtain.drivesZoom);
    const before = await page.evaluate(() => window.__museum.camera);

    // 화면 가운데에서 줌한다. 가운데를 붙잡았으므로 x·y 가 움직이면 안 된다.
    const box = await page.evaluate(() => ({
      w: window.innerWidth,
      h: window.innerHeight,
    }));
    await page.mouse.move(box.w / 2, box.h / 2);
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(120);

    const handed = await page.evaluate(() => window.__museum.curtain.drivesZoom);
    const after = await page.evaluate(() => window.__museum.camera);

    check('개방이 처음에는 줌을 몬다', owned === true);
    check('인트로 중 손이 줌하면 줌 몰기를 넘긴다', handed === false);
    check(
      '가운데를 붙잡고 줌하면 중심이 움직이지 않는다',
      Math.abs(after.x - before.x) < 0.05 && Math.abs(after.y - before.y) < 0.05,
      `(${before.x.toFixed(3)}, ${before.y.toFixed(3)}) → (${after.x.toFixed(3)}, ${after.y.toFixed(3)})`,
    );
    check('손이 줌한 만큼 실제로 줌이 커졌다', after.zoom > before.zoom, `${before.zoom.toFixed(1)} → ${after.zoom.toFixed(1)}`);

    await traveled(page);
    // 다음 여행에서는 개방이 다시 줌을 몬다
    await page.click('#btn-random');
    await page.waitForFunction(() => window.__museum.curtain.phase === 'open', null, {
      timeout: 20000,
    });
    check(
      '다음 여행에서 개방이 줌 몰기를 되찾는다',
      (await page.evaluate(() => window.__museum.curtain.drivesZoom)) === true,
    );
    await traveled(page);
  }

  check('개방 검사에서 콘솔 오류가 없다', page.errors.length === 0, page.errors.join(' / '));
  await page.close();
}

// ── 5.8 — 로비는 격자가 아니라 자유 배치다 ───────────────────────────────

{
  const page = await openPage('desktop', { lobby: true });
  await settled(page);

  // 주소 없이 들어오면 로비 가운데다
  {
    const state = await page.evaluate(() => window.__museum.state);
    check('주소 없이 들어오면 로비로 온다', state.tier === 0, `층 ${state.tier}`);
    check('로비의 가운데에서 시작한다', state.x === '32' && state.y === '32', `(${state.x}, ${state.y})`);
  }

  // 가운데에 표지가 있다
  {
    const objects = await page.evaluate(() => window.__museum.lobby);
    const logo = objects.find(object => object.id === 'logo');
    check('로비에 물건이 놓여 있다', objects.length >= 12, `${objects.length}개`);
    check('가운데에 표지가 있다', logo !== undefined && logo.x === 32 && logo.y === 32);
    check('표지의 그림이 실려 있다', logo?.hasImage === true);
    // 표지만 진짜 이미지다. 나머지는 주소로 그린다.
    check('표지는 눌러도 아무 일이 없다', logo?.action === null, String(logo?.action));
  }

  // 물건은 칸에 맞지 않는다. 격자에 맞으면 전시물처럼 보인다.
  {
    const sizes = await page.evaluate(() =>
      window.__museum.lobby.map(object => object.size),
    );
    check('물건이 한 칸보다 크다', sizes.every(size => size > 1), sizes.join(' · '));
    check(
      '물건이 격자에 딱 맞지 않는다',
      (await page.evaluate(() =>
        window.__museum.lobby.some(object => object.x % 1 !== 0 || object.y % 1 !== 0),
      )) === true,
    );
  }

  // 오늘의 그림과 체험관 문
  {
    const objects = await page.evaluate(() => window.__museum.lobby);
    const today = objects.filter(object => object.id.startsWith('today-'));
    const workshop = objects.find(object => object.id === 'workshop');

    check('오늘의 그림이 열 장 걸려 있다', today.length === 10, `${today.length}장`);
    check(
      '오늘의 그림이 모두 그려졌다',
      today.every(object => object.hasImage),
      `${today.filter(o => o.hasImage).length}/${today.length}`,
    );
    check('오늘의 그림은 누르면 그 자리로 간다', today.every(o => o.action === 'artwork'));
    check('체험관 문이 있다', workshop !== undefined && workshop.hasImage === true);
    // 문에 걸린 그림도 주소다. 진짜 이미지는 표지 하나뿐이다.
    check(
      '표지만 진짜 이미지다',
      objects.filter(object => object.kind === 'logo').length === 1,
      objects.map(o => o.kind).join(' · '),
    );
  }

  // 체험관은 아직 문만 있다. 누르면 그 사실을 알린다.
  //
  // 누를 자리를 로비 좌표로 계산하면 안 된다. 화면의 칸 번호는 기준점에 대한
  // 상대값이라 로비 좌표와 다르다. 표지가 화면 가운데 있다는 것만 쓰고, 문은
  // 표지에서 11칸 아래라는 **상대 거리**로 찾는다. 상대 거리는 두 좌표계에서 같다.
  {
    const aim = await page.evaluate(() => {
      const zoom = window.__museum.camera.zoom;
      return [window.innerWidth / 2, window.innerHeight / 2 + 11 * zoom];
    });

    const found = await page.evaluate(
      ([x, y]) => window.__museum.stage.lobbyObjectAt(x, y)?.id ?? null,
      aim,
    );
    check('표지 아래 11칸에 체험관 문이 있다', found === 'workshop', String(found));

    // 문을 누르면 체험관으로 들어간다.
    await page.mouse.click(aim[0], aim[1]);
    await traveled(page);

    const inside = await page.evaluate(() => ({
      workshop: window.__museum.state.workshop,
      tier: window.__museum.state.tier,
      search: location.search,
      ids: window.__museum.lobby.map(object => object.id),
      images: window.__museum.lobby.every(object => object.hasImage),
    }));
    check('체험관 문을 누르면 체험관에 들어간다', inside.workshop === true, String(inside.workshop));
    // 체험관은 로비와 같은 층이다. "로비에 있는 방" 이라는 설정이 이것이다.
    check('체험관도 로비와 같은 층이다', inside.tier === 0, String(inside.tier));
    check(
      '체험관이 주소에 w=1 로 남는다',
      /[?&]w=1(?:&|$)/.test(inside.search),
      inside.search,
    );
    check(
      '체험관에는 QR 포털과 나가는 문이 있다',
      inside.ids.length === 2 && inside.ids.includes('qr') && inside.ids.includes('exit'),
      inside.ids.join(','),
    );
    // 체험관에는 이미지 파일이 없다. 두 장 다 주소에서 그린 것이다.
    check('체험관의 그림이 모두 그려졌다', inside.images === true);

    // 가운데의 QR 포털을 누르면 아직 준비 중임을 알린다. 별도 페이지가 없다.
    const before = await page.locator('.toast').count();
    const middle = await page.evaluate(() => [window.innerWidth / 2, window.innerHeight / 2]);
    await page.mouse.click(middle[0], middle[1]);
    await page.waitForTimeout(600);
    const after = await page.locator('.toast').count();
    check('QR 포털을 누르면 준비 중임을 알린다', after > before, `토스트 ${before} → ${after}`);

    // 새로고침해도 체험관에 남는다. 주소가 좌표만이 아니라 방까지 담는다는 뜻이다.
    await page.reload({ waitUntil: 'commit' });
    await page.waitForFunction(() => window.__museum, null, { timeout: 20000 });
    await page.waitForFunction(() => window.__museum.curtain.phase === 'clear', null, {
      timeout: 30000,
    });
    const again = await page.evaluate(() => window.__museum.state.workshop);
    check('새로 열어도 체험관에 남는다', again === true, String(again));

    // 나가는 문으로 로비에 돌아온다. 문은 도착 자리에서 11칸 아래다.
    const door = await page.evaluate(() => {
      const zoom = window.__museum.camera.zoom;
      return [window.innerWidth / 2, window.innerHeight / 2 + 11 * zoom];
    });
    await page.mouse.click(door[0], door[1]);
    await traveled(page);
    const back = await page.evaluate(() => ({
      workshop: window.__museum.state.workshop,
      search: location.search,
      logo: window.__museum.lobby.some(object => object.kind === 'logo'),
    }));
    check('나가는 문으로 로비에 돌아온다', back.workshop === false, String(back.workshop));
    check('로비로 돌아오면 주소에서 w 가 빠진다', !/[?&]w=/.test(back.search), back.search);
    check('로비로 돌아오면 표지가 다시 있다', back.logo === true);
  }

  // 화면에 로비가 넓게 보인다. 물건 하나가 화면을 덮으면 장소로 읽히지 않는다.
  {
    const view = await page.evaluate(() => {
      const camera = window.__museum.camera;
      return { zoom: camera.zoom, cells: window.innerWidth / camera.zoom };
    });
    check(
      '로비가 한 화면에 여러 칸 보인다',
      view.cells > 14 && view.cells < 64,
      `${view.cells.toFixed(1)}칸 (줌 ${view.zoom.toFixed(1)})`,
    );
  }

  // 순환. 64칸 옆으로 가도 같은 표지가 보인다.
  {
    const hit = await page.evaluate(() => {
      const centre = [window.innerWidth / 2, window.innerHeight / 2];
      return window.__museum.stage.lobbyObjectAt(centre[0], centre[1])?.id ?? null;
    });
    check('가운데를 누르면 표지가 잡힌다', hit === 'logo', String(hit));

    // 카메라 좌표로 64칸 옮긴다. 로비 좌표(32) 로 계산하면 안 된다 — 화면의 칸
    // 번호는 기준점(baseX)에 대한 상대값이고 로비 좌표와 같지 않다.
    const camera = await page.evaluate(() => ({
      x: window.__museum.camera.x,
      y: window.__museum.camera.y,
    }));
    await page.evaluate(
      ([x, y]) => window.__museum.focusCell(Math.round(x) + 64, Math.round(y)),
      [camera.x, camera.y],
    );
    await page.waitForTimeout(1200);
    const wrapped = await page.evaluate(() => {
      const centre = [window.innerWidth / 2, window.innerHeight / 2];
      return window.__museum.stage.lobbyObjectAt(centre[0], centre[1])?.id ?? null;
    });
    check('64칸을 걸으면 같은 표지를 다시 만난다', wrapped === 'logo', String(wrapped));
  }

  // 로비에서는 작품 시트가 열리지 않는다. 작품이 없으므로 열 것이 없다.
  {
    await page.mouse.click(200, 200);
    await page.waitForTimeout(400);
    const sheet = await page.evaluate(() => window.__museum.sheet.state);
    check('로비에서는 작품 시트가 열리지 않는다', sheet === 'hidden', String(sheet));
  }

  // ── 5.9 미니맵 ────────────────────────────────────────────────────────
  //
  // 지도가 거짓말을 하는지는 눈으로 알 수 없다. 색이 늘 그럴듯하게 나온다.
  // 그래서 그려진 픽셀을 직접 세고, 로비와 작품 층이 다른 방식으로 그려지는지
  // 본다(로비는 물건, 작품 층은 주소에서 읽은 색).

  /** 지도 캔버스의 픽셀을 읽어 서로 다른 색이 몇 가지인지 센다. */
  const mapColours = target =>
    target.evaluate(() => {
      const canvas = document.querySelector('#minimap canvas');
      const ctx = canvas.getContext('2d');
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const seen = new Set();
      for (let at = 0; at < data.length; at += 4) {
        seen.add((data[at] << 16) | (data[at + 1] << 8) | data[at + 2]);
      }
      return { colours: seen.size, width: canvas.width };
    });

  {
    const box = await page.locator('#minimap').boundingBox();
    check('미니맵이 좌상단에 있다', box !== null && box.x < 40 && box.y < 40, JSON.stringify(box));
    check('미니맵이 정사각형이다', box !== null && Math.abs(box.width - box.height) < 1);

    const lobbyMap = await page.evaluate(() => window.__museum.minimap);
    check('로비에서도 지도가 그려진다', lobbyMap.painted > 0, `${lobbyMap.painted}번`);
    // 로비에는 작품이 없으므로 주소에서 색을 읽을 일이 없다. 읽으면 헛일이다.
    check('로비 지도는 주소를 읽지 않는다', lobbyMap.cached === 0, `${lobbyMap.cached}칸`);

    const lobbyPixels = await mapColours(page);
    check(
      '로비 지도에 물건이 찍혀 있다',
      lobbyPixels.colours >= 2,
      `${lobbyPixels.colours}가지 색`,
    );

    // 작품 층으로 옮기면 지도가 그 층의 색으로 바뀐다.
    await page.evaluate(() => window.__museum.jumpRandom(8));
    await page.waitForFunction(() => window.__museum.curtain.phase === 'clear', null, {
      timeout: 30000,
    });
    await page.waitForTimeout(400);

    const floorMap = await page.evaluate(() => window.__museum.minimap);
    check(
      '작품 층에서는 주소에서 색을 읽는다',
      floorMap.cached === 33 * 33,
      `${floorMap.cached}칸`,
    );

    const floorPixels = await mapColours(page);
    // 단색이면 색을 못 읽은 것이다. 실제 층은 칸마다 기준 색이 다르다.
    check(
      '작품 층 지도가 여러 색으로 채워진다',
      floorPixels.colours >= 20,
      `${floorPixels.colours}가지 색`,
    );

    // 지도는 버튼이다. 팜플렛은 아직 없으므로 그 사실을 알린다.
    const before = await page.locator('.toast').count();
    await page.locator('#minimap').click();
    await page.waitForTimeout(600);
    const after = await page.locator('.toast').count();
    check('미니맵을 누르면 알림이 뜬다', after > before, `토스트 ${before} → ${after}`);
  }

  check('로비 검사에서 콘솔 오류가 없다', page.errors.length === 0, page.errors.join(' / '));
  await page.close();
}

await browser.close();
rmSync(temp, { recursive: true, force: true });

// ── 결과 ─────────────────────────────────────────────────────────────────

for (const { name, ok, detail } of results) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} 통과`);
process.exit(failed === 0 ? 0 : 1);
