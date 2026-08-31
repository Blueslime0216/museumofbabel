// 프레임 값을 잰다. 미니맵이 예산을 먹는지 눈이 아니라 숫자로 본다.
//
//   npm run preview          다른 터미널에서
//   node tools/bench-frames.mjs [주소]
import { chromium } from 'playwright-core';

const target = process.argv[2] ?? 'http://127.0.0.1:4173/';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
await page.goto(target, { waitUntil: 'commit' });
await page.waitForFunction(() => window.__museum, null, { timeout: 20000 });
await page.waitForFunction(() => window.__museum.curtain.phase === 'clear', null, { timeout: 30000 });

/** 프레임 간격을 모으면서 화면을 끈다. */
async function walk(label) {
  await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    const tick = now => {
      window.__frames.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const before = await page.evaluate(() => window.__museum.minimap.spent);
  await page.mouse.move(640, 430);
  await page.mouse.down();
  for (let step = 0; step < 40; step++) {
    await page.mouse.move(640 - step * 12, 430 - step * 6);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(200);

  const { frames, spent, mode } = await page.evaluate(() => ({
    frames: window.__frames.slice(2),
    spent: window.__museum.minimap.spent,
    mode: window.__museum.minimap.mode,
  }));
  frames.sort((a, b) => a - b);
  const at = q => frames[Math.min(frames.length - 1, Math.floor(frames.length * q))];
  console.log(
    `${label.padEnd(18)} 프레임 ${frames.length}개  중간 ${at(0.5).toFixed(1)}ms  95% ${at(0.95).toFixed(1)}ms  최악 ${at(1).toFixed(1)}ms` +
      `  |  지도에 쓴 시간 ${(spent - before).toFixed(1)}ms (${mode})`,
  );
}

await walk('로비');

for (const tier of [8, 32]) {
  await page.evaluate(t => window.__museum.jumpRandom(t), tier);
  await page.waitForFunction(() => window.__museum.curtain.phase === 'clear', null, { timeout: 30000 });
  await walk(`층 ${tier} · 색`);

  await page.evaluate(() => window.__museum.setMinimapMode?.('rooms'));
  await page.waitForTimeout(300);
  await walk(`층 ${tier} · 전시실`);
  await page.evaluate(() => window.__museum.setMinimapMode?.('colour'));
  await page.waitForTimeout(300);
}

await browser.close();
