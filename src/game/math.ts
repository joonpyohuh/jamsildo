export const TAU = Math.PI * 2;

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export const dist = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(bx - ax, by - ay);

export const angleTo = (ax: number, ay: number, bx: number, by: number): number => Math.atan2(by - ay, bx - ax);

/** a → b 의 최단 각도 차 (-π..π) */
export const angleDiff = (a: number, b: number): number => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

export const rand = (lo: number, hi: number): number => lo + Math.random() * (hi - lo);

export const pick = <T>(items: readonly T[]): T => {
  const item = items[Math.floor(Math.random() * items.length)];
  if (item === undefined) throw new Error('pick: empty list');
  return item;
};

export const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);

export const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** 방마다 바닥 무늬가 고정되도록 쓰는 시드 난수 */
export const seeded = (seed: number): (() => number) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
