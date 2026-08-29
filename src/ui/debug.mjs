// 개발자 패널 — ?debug=1 일 때만 존재한다
//
// 요구사항 13장. 관람객은 볼 일이 없다. 발표에서 필요하면 주소에 붙여 쓴다.
// UI 를 최소한으로 두는 원칙과 부딪히지 않도록 아예 만들지 않는 쪽을 골랐다.

const REFRESH_MS = 250;

export function attachDebug({ camera, curtain, tiles, stage, sheet, getState }) {
  if (new URLSearchParams(location.search).get('debug') !== '1') return null;

  const panel = document.createElement('pre');
  panel.className = 'debug-panel';
  panel.setAttribute('aria-hidden', 'true');
  document.body.append(panel);

  let frames = 0;
  let fps = 0;
  let mark = performance.now();

  const count = () => {
    frames++;
    const now = performance.now();
    if (now - mark >= 500) {
      fps = Math.round((frames * 1000) / (now - mark));
      frames = 0;
      mark = now;
    }
    requestAnimationFrame(count);
  };
  requestAnimationFrame(count);

  const short = value => {
    const text = String(value);
    return text.length > 14 ? `${text.slice(0, 8)}…${text.slice(-4)}` : text;
  };

  setInterval(() => {
    const state = getState();
    const { width, height } = stage.view;
    const across = Math.ceil(width / camera.zoom) * Math.ceil(height / camera.zoom);
    const stats = tiles.stats;
    panel.textContent = [
      `fps      ${fps}`,
      `floor    ${state.tier} × ${state.tier}   locality ${state.locality}`,
      `zoom     ${camera.zoom.toFixed(1)}  (${camera.zoomBounds.min.toFixed(0)}–${camera.zoomBounds.max.toFixed(0)})`,
      `visible  ~${across}`,
      `cache    ${stats.size}  pending ${stats.pending}`,
      `rendered ${stats.rendered}  evicted ${stats.evicted}`,
      `curtain  ${curtain.phase}  open ${curtain.openProgress.toFixed(2)}`,
      `sheet    ${sheet.state}`,
      `x        ${short(state.x)}`,
      `y        ${short(state.y)}`,
    ].join('\n');
  }, REFRESH_MS);

  return panel;
}
