// 층 — 관람객이 쓰는 이름과 코덱의 티어를 잇는다
//
// 코덱은 "티어" 라고 부르고 그 값은 구역 격자의 한 변이다 (4 · 8 · 16).
// 관람객에게 4 나 16 은 아무 뜻이 없다. 그래서 1층 · 2층 · 3층으로 부른다.
// 낮은 층이 거칠고 주소가 짧다. 높은 층이 세밀하고 주소가 길다.
//
// 이 대응을 한 곳에만 둔다. 층 모달과 찾기 모달이 같은 목록을 쓴다.

import { TIERS, tierSpec, formatHash } from './codec.mjs';
import { t } from './i18n/index.mjs';

/** 낮은 층부터. 층 번호는 1부터 센다. */
export const FLOORS = TIERS.slice()
  .sort((a, b) => a - b)
  .map((tier, index) => {
    const spec = tierSpec(tier);
    return {
      tier,
      level: index + 1,
      grid: `${tier} × ${tier}`,
      zones: spec.blockCount,
      bytes: spec.byteLength,
      /** 이 층의 주소가 몇 자인가. 층을 고르는 데 실제로 쓰이는 정보다. */
      hashLength: formatHash({
        tier,
        locality: 4,
        x: (1n << BigInt(spec.axisBits)) - 1n,
        y: (1n << BigInt(spec.axisBits)) - 1n,
      }).length,
    };
  });

export function floorFor(tier) {
  return FLOORS.find(floor => floor.tier === tier) ?? FLOORS[0];
}

/** "2층" 또는 "Floor 2". */
export function floorName(tier) {
  return t('floor.name', { level: floorFor(tier).level });
}
