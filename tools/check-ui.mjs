// 화면 검사 — 기계가 볼 수 있는 것만 본다
//
// 무엇을 지키는가
//   1. 연기 검사    페이지가 뜨고 캔버스에 실제 픽셀이 있다
//   2. 시트 기하    요구사항 7장의 규칙. 목업에서 실제로 깨졌던 것들이다
//   3. 전환         암전 → 교체 → 개방 순서와, 암전 중 줌이 멈추는 것
//   4. 무늬 유지    새로고침해도 UI 색이 바뀌지 않는다
//   5. 왕복         내려받은 PNG 를 올리면 정확히 제자리로 온다
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

  // 시트 기하 — peek
  const cx = size === 'mobile' ? 195 : 500;
  const cy = size === 'mobile' ? 400 : 420;
  await page.mouse.click(cx, cy);
  await page.waitForFunction(
    () => document.getElementById('sheet').dataset.state === 'peek',
    null,
    { timeout: 5000 },
  );
  await page.waitForTimeout(450);

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

  // 시트 기하 — expanded
  await page.click('#sheet-peek');
  await page.waitForTimeout(500);
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
  check('층이 낮은 것부터 세 개다', floors.map(f => f.tier).join(',') === '4,8,16');
  check('층마다 이름과 격자 크기가 있다', floors.every(f => /\d+\s*×\s*\d+/.test(f.text)), floors[0]?.text);
  check('지금 층이 표시된다', floors.filter(f => f.current).length === 1);

  // 1층으로 옮긴다. 자리도 바뀌어야 한다.
  const before = await page.evaluate(() => location.hash);
  await page.click('#floor-list .lang[data-tier="4"]');
  await traveled(page);
  const afterFloor = await page.evaluate(() => ({
    tier: window.__museum.state.tier,
    hash: location.hash,
  }));
  check('층을 고르면 그 층으로 간다', afterFloor.tier === 4, `tier ${afterFloor.tier}`);
  check('층을 옮기면 자리도 바뀐다', afterFloor.hash !== before);
  check(
    '낮은 층은 주소가 짧다',
    afterFloor.hash.length < before.length,
    `${before.length}자 → ${afterFloor.hash.length}자`,
  );

  // 무작위 버튼은 층을 유지한다
  await page.click('#btn-random');
  await traveled(page);
  const afterRandom = await page.evaluate(() => ({
    tier: window.__museum.state.tier,
    hash: location.hash,
  }));
  check('무작위는 지금 층 안에서 옮긴다', afterRandom.tier === 4, `tier ${afterRandom.tier}`);
  check('무작위가 자리를 바꾼다', afterRandom.hash !== afterFloor.hash);

  // 찾기의 층 선택
  await page.click('#btn-search');
  await page.waitForTimeout(250);
  const segments = await page.evaluate(() =>
    [...document.querySelectorAll('#search-floor-row .segment')].map(b => Number(b.dataset.tier)),
  );
  check('찾기에도 층 선택이 있다', segments.join(',') === '4,8,16');

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
  await page.fill('#search-text', '#v1.4.4.abc.def');
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
  const elsewhere = await page.evaluate(() => location.hash);
  check('무작위 점프가 자리를 옮긴다', elsewhere !== chosen);

  await page.click('#btn-search');
  await page.setInputFiles('#search-file', saved);
  await traveled(page);
  const returned = await page.evaluate(() => location.hash);
  check('내려받아 올리면 제자리로 온다', returned === chosen, `${returned.slice(0, 24)}…`);

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

await browser.close();
rmSync(temp, { recursive: true, force: true });

// ── 결과 ─────────────────────────────────────────────────────────────────

for (const { name, ok, detail } of results) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} 통과`);
process.exit(failed === 0 ? 0 : 1);
