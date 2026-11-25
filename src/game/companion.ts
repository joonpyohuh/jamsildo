/**
 * 처음부터 함께 걷는 하얀 정령. 정령 슬롯과 별개로, 윤슬 옆 바닥을 걸으며 알아서 평타를 쏜다.
 */
import { dist } from './math';
import { FORMS, type Target } from './forms';
import { fromRows, type Sprite } from './sprites';

export interface Companion { x: number; y: number; facing: 1 | -1; moving: boolean; walkT: number; cd: number; shotT: number }

/** 피해는 첫 무기(단검)의 기본 피해와 같고, 강화를 받지 않는다 */
export const COMPANION = {
  damage: FORMS.dagger.damage, cooldown: 0.62, reach: 190, knockback: 30, shotSpeed: 280, shotLife: 1,
  /** 쏘는 높이(발에서부터) */
  muzzle: 6,
} as const;

const FOLLOW = { side: 20, stop: 3, start: 12, speed: 70, catchUp: 4 } as const;
const SHOT_POSE = 0.16;

export const newCompanion = (x: number, y: number): Companion => ({ x: x - FOLLOW.side, y, facing: 1, moving: false, walkT: 0, cd: COMPANION.cooldown, shotT: 0 });

/** 윤슬의 등 뒤 자리로 걸어간다. 멀어질수록 빨라지고, 가까우면 선다. */
export function walkCompanion(c: Companion, owner: { x: number; y: number; facing: number }, dt: number): void {
  c.cd = Math.max(0, c.cd - dt);
  c.shotT = Math.max(0, c.shotT - dt);
  const tx = owner.x - owner.facing * FOLLOW.side, ty = owner.y + 2, gap = dist(c.x, c.y, tx, ty);
  c.moving = gap > (c.moving ? FOLLOW.stop : FOLLOW.start);
  if (!c.moving) return;
  const step = Math.min(gap, Math.max(FOLLOW.speed, gap * FOLLOW.catchUp) * dt);
  c.x += ((tx - c.x) / gap) * step;
  c.y += ((ty - c.y) / gap) * step;
  c.walkT += dt;
  if (c.shotT <= 0 && Math.abs(tx - c.x) > 1) c.facing = tx < c.x ? -1 : 1;
}

/** 쏠 수 있으면 사거리 안의 가장 가까운 대상을 돌려주고 재사용 시간을 건다 */
export function aimCompanion<T extends Target>(c: Companion, targets: readonly T[]): T | null {
  if (c.cd > 0) return null;
  let target: T | null = null, nearest: number = COMPANION.reach;
  for (const t of targets) {
    const edge = dist(c.x, c.y, t.x, t.y) - t.r;
    if (edge < nearest) { nearest = edge; target = t; }
  }
  if (!target) return null;
  c.cd = COMPANION.cooldown;
  c.shotT = SHOT_POSE;
  c.facing = target.x < c.x ? -1 : 1;
  return target;
}

/* 오른쪽을 보는 흰 정령 (12×11) */
const PALETTE = { w: '#ffffff', s: '#cfd5de', d: '#98a0ad', e: '#14161b' } as const;
const BODY = [
  '...ww..ww...',
  '...ww..ww...',
  '..wwwwwwww..',
  '.swwwwwwwww.',
  '.swwwwwewew.',
  'sswwwwwewew.',
  'sswwwwwwwww.',
  '.sswwwwwww..',
  '..ssssssss..',
] as const;
const FRAMES: readonly Sprite[] = [
  ['...dd..dd...', '...dd..dd...'],
  ['..dd....dd..', '..d......d..'],
  ['....dddd....', '.....dd.....'],
].map(legs => fromRows([...BODY, ...legs], PALETTE));

export function companionSprite(c: Companion): Sprite {
  return FRAMES[c.moving ? 1 + (Math.floor(c.walkT * 9) % 2) : 0]!;
}
