import { defineConfig } from 'vite';

// 프레임워크는 없다. Vite 는 개발 서버 · 워커 번들 · 정적 산출물만 담당한다.
export default defineConfig({
  // 상대 경로로 빌드한다. 어느 경로에 올려도 그대로 돈다.
  base: './',
  build: {
    outDir: 'dist',
    // 코덱이 정수 연산과 BigInt 를 쓴다. 낮은 타깃으로 내리면 BigInt 가 깨진다.
    target: 'es2022',
    assetsInlineLimit: 4096,
  },
  worker: {
    format: 'es',
  },
  server: {
    // 시연 준비에 휴대폰으로 봐야 한다. 랜에도 열어 둔다.
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
});
