// 층에 들어가는 값. 어디서 시간을 쓰는지 나눠 본다.
//   npm run preview          다른 터미널에서
//   node tools/bench-enter.mjs [주소]
import { chromium } from 'playwright-core';

const target = process.argv[2] ?? 'http://127.0.0.1:4173/';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
await page.goto(target, { waitUntil: 'commit' });
await page.waitForFunction(() => window.__museum, null, { timeout: 20000 });
await page.waitForFunction(() => window.__museum.curtain.phase === 'clear', null, { timeout: 30000 });

async function enter(label, go) {
  const before = await page.evaluate(() => ({ ...window.__museum.tiles }));
  const started = Date.now();
  await page.evaluate(go);
  // 커튼이 움직이기 시작하고, 다시 맑아질 때까지
  await page.waitForFunction(() => window.__museum.curtain.phase !== 'clear', null, { timeout: 20000 });
  const travelled = Date.now();
  await page.waitForFunction(() => window.__museum.curtain.phase === 'clear', null, { timeout: 60000 });
  const done = Date.now();
  const after = await page.evaluate(() => ({
    tiles: { ...window.__museum.tiles },
    duration: window.__museum.curtain.duration,
    cells: window.innerWidth / window.__museum.camera.zoom,
  }));

  console.log(
    `${label.padEnd(12)} 전체 ${String(done - started).padStart(5)}ms  ` +
      `(암전까지 ${travelled - started}ms · 개방 ${after.duration}ms)  ` +
      `타일 ${after.tiles.drawn - (before.drawn ?? 0)}장 그림 · 평균 ${after.tiles.avgMs?.toFixed?.(2) ?? '?'}ms  ` +
      `화면에 ${after.cells.toFixed(0)}칸`,
  );
}

await enter('층 8', () => window.__museum.jumpRandom(8));
await enter('층 32', () => window.__museum.jumpRandom(32));
await enter('로비', () => window.__museum.jumpRandom(0));
await enter('층 8 (다시)', () => window.__museum.jumpRandom(8));
await enter('로비 (다시)', () => window.__museum.jumpRandom(0));

console.log('\n타일 통계:', JSON.stringify(await page.evaluate(() => window.__museum.tiles)));
await browser.close();
