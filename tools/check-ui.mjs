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

/** 화면 하나를 열고 개방이 끝날 때까지 기다린다. */
async function openPage(size) {
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
  return page;
}

const settled = page =>
  page.waitForFunction(() => window.__museum.curtain.open >= 0.999, null, { timeout: 25000 });

/**
 * 주소창에 적힌 주소. 표준형은 `?a=v2.8.4.…` 이다 (hash.mjs 참조).
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
  check('층이 낮은 것부터 오름차순이다', floors.map(f => f.tier).join(',') === '4,8,16,32');
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

  // 찾기의 층 선택
  await page.click('#btn-search');
  await page.waitForTimeout(250);
  const segments = await page.evaluate(() =>
    [...document.querySelectorAll('#search-floor-row .segment')].map(b => Number(b.dataset.tier)),
  );
  check('찾기에도 층 선택이 있다', segments.join(',') === '4,8,16,32');

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
  await page.fill('#search-text', '#v2.4.4.abc.def');
  await page.click('#btn-go');
  await traveled(page);
  check(
    '주소에 층이 있으면 그것이 이긴다',
    (await page.evaluate(() => window.__museum.state.tier)) === 4,
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
  check('주소창이 ?a= 형태다', /\?a=v2\.\d+\.\d+\./.test(url), url.slice(0, 60));
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

await browser.close();
rmSync(temp, { recursive: true, force: true });

// ── 결과 ─────────────────────────────────────────────────────────────────

for (const { name, ok, detail } of results) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} 통과`);
process.exit(failed === 0 ? 0 : 1);
