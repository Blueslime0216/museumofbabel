// 성능 측정 — 로드맵 4장의 수치를 실제 값으로 채운다
//
// 이 값을 모르고 만들면 나중에 구조를 뒤집어야 할 수 있다. 그래서 잰다.
//
// 여기서 재는 것
//   전시물 하나의 렌더 시간 (워커가 보고한 순수 계산 시간)
//   커튼 대기 시간과 그 사이에 그린 개수
//   투영 시간 (그림 하나를 주소로 옮기는 데 걸리는 시간)
//   드래그 중 프레임 수
//   최소 줌에서 동시 표시 개수
//   비트맵 캐시가 쓰는 메모리 (Chromium 의 JS 힙 기준. 참고값이다)
//
// 여기서 재지 못하는 것 — 실제 기기가 필요하다
//   휴대폰의 실제 렌더 · 투영 시간
//   iOS 에서 핀치가 페이지 줌으로 새는지
//   iOS 의 replaceState 빈도 제한
//
// 사용법
//   npm run build && npm run preview     다른 터미널에서
//   node tools/measure.mjs [주소]

import { chromium } from 'playwright-core';

const target = process.argv[2] ?? 'http://127.0.0.1:4173/';

const browser = await chromium.launch({
  channel: 'msedge',
  args: ['--enable-precise-memory-info'],
});

const rows = [];
const note = (name, value, detail = '') => rows.push({ name, value, detail });

async function openPage(size) {
  const page = await browser.newPage(
    size === 'mobile'
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width: 1280, height: 860 } },
  );

  // 커튼의 단계 전환 시각을 기록한다. 페이지가 뜨기 전에 심어야 한다.
  await page.addInitScript(() => {
    window.__marks = [];
    const watch = () => {
      if (window.__museum) {
        const phase = window.__museum.curtain.phase;
        const last = window.__marks[window.__marks.length - 1];
        if (!last || last.phase !== phase) {
          window.__marks.push({ phase, at: performance.now() });
        }
      }
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });

  await page.goto(target, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__museum, null, { timeout: 20000 });
  return page;
}

const settled = page =>
  page.waitForFunction(() => window.__museum.curtain.open >= 0.999, null, { timeout: 25000 });

// ── 화면마다 ─────────────────────────────────────────────────────────────

for (const size of ['mobile', 'desktop']) {
  const page = await openPage(size);
  await settled(page);
  await page.waitForTimeout(500);

  const first = await page.evaluate(() => {
    const marks = window.__marks;
    const hold = marks.find(m => m.phase === 'hold');
    const open = marks.find(m => m.phase === 'open');
    return {
      holdMs: hold && open ? Math.round(open.at - hold.at) : null,
      stats: window.__museum.tiles,
      zoom: window.__museum.camera.zoom,
      bounds: window.__museum.camera.zoomBounds ?? null,
    };
  });

  note(`${size} 커튼 대기`, `${first.holdMs} ms`, `그 사이 ${first.stats.rendered}장`);
  note(
    `${size} 전시물 하나 렌더`,
    `${first.stats.avgMs.toFixed(2)} ms`,
    `워커가 보고한 순수 계산 시간`,
  );
  note(
    `${size} 첫 화면 처리량`,
    `${(first.holdMs / Math.max(1, first.stats.rendered)).toFixed(2)} ms/장`,
    `워커 여러 개로 나눈 실효값`,
  );

  // 최소 줌에서 동시 표시 개수
  const wide = await page.evaluate(() => {
    const before = window.__museum.camera.zoom;
    window.__museum.camera.target; // 접근만
    return { before };
  });
  await page.mouse.move(200, 400);
  for (let i = 0; i < 24; i++) await page.mouse.wheel(0, 400);
  await page.waitForTimeout(1200);
  const zoomedOut = await page.evaluate(() => {
    const canvas = document.getElementById('stage');
    const rect = canvas.getBoundingClientRect();
    const { zoom } = window.__museum.camera;
    return {
      zoom,
      count: (Math.ceil(rect.width / zoom) + 1) * (Math.ceil(rect.height / zoom) + 1),
      cache: window.__museum.tiles.size,
      heapMb: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
    };
  });
  note(
    `${size} 최소 줌`,
    `${zoomedOut.zoom.toFixed(0)} px`,
    `동시 표시 약 ${zoomedOut.count}장 · 캐시 ${zoomedOut.cache}장`,
  );
  note(`${size} JS 힙`, zoomedOut.heapMb === null ? '측정 불가' : `${zoomedOut.heapMb} MB`, `${wide.before.toFixed(0)}px → ${zoomedOut.zoom.toFixed(0)}px 까지 줌아웃한 뒤`);

  // 최소 줌에서 가만히 두었을 때 계속 다시 그리고 다시 요청하는지 본다.
  // 목록이 캐시보다 크면 missing 이 0 이 안 되어 영원히 태운다.
  const idleBefore = await page.evaluate(() => window.__museum.tiles);
  await page.waitForTimeout(1500);
  const idleAfter = await page.evaluate(() => window.__museum.tiles);
  note(
    `${size} 가만히 둘 때 낭비`,
    `${idleAfter.rendered - idleBefore.rendered}장/1.5초`,
    `버린 것 ${idleAfter.evicted - idleBefore.evicted}장 · 0 이어야 한다`,
  );

  // 드래그 중 프레임 수
  await page.evaluate(() => {
    window.__frames = 0;
    const tick = () => {
      window.__frames++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const cx = size === 'mobile' ? 195 : 640;
  const cy = size === 'mobile' ? 420 : 430;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const started = Date.now();
  await page.evaluate(() => {
    window.__frames = 0;
  });
  for (let i = 1; i <= 40; i++) {
    await page.mouse.move(cx - i * 8, cy - i * 4);
    await page.waitForTimeout(12);
  }
  const elapsed = Date.now() - started;
  const frames = await page.evaluate(() => window.__frames);
  await page.mouse.up();
  note(
    `${size} 드래그 중 프레임`,
    `${Math.round((frames * 1000) / elapsed)} fps`,
    `${frames}프레임 / ${elapsed}ms`,
  );

  await page.close();
}

// ── 투영 ─────────────────────────────────────────────────────────────────

{
  const page = await openPage('mobile');
  await settled(page);
  await page.mouse.click(195, 400);
  await page.waitForTimeout(600);
  await page.click('#sheet-peek');
  await page.waitForTimeout(400);

  // 좌표가 없는 그림을 만든다 (디버그 다운로드)
  const download = page.waitForEvent('download');
  await page.click('#btn-download', { modifiers: ['Alt', 'Shift'] });
  const file = await download;
  const path = `${process.env.TEMP ?? '/tmp'}/museum-measure.png`;
  await file.saveAs(path);

  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.click('#btn-search');

  const at = Date.now();
  await page.setInputFiles('#search-file', path);
  await page.waitForSelector('#compare:not([hidden])', { timeout: 60000 });
  note('투영 (층 8)', `${Date.now() - at} ms`, '올린 순간부터 비교 화면이 뜰 때까지');
  await page.close();
}

await browser.close();

// ── 결과 ─────────────────────────────────────────────────────────────────

const width = Math.max(...rows.map(r => r.name.length));
for (const { name, value, detail } of rows) {
  console.log(`${name.padEnd(width)}  ${String(value).padStart(11)}   ${detail}`);
}
console.log('\n실기가 필요한 것: 휴대폰 렌더·투영 시간 · iOS 핀치 · iOS replaceState 제한');
