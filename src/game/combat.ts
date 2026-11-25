import type { Element } from './config';
import type { BossId, StatusId } from './campaign';

export type Statuses = Partial<Record<StatusId, number>>;
export function tickStatuses(status: Statuses, dt: number): void {
  for (const key of Object.keys(status) as StatusId[]) status[key] = Math.max(0, (status[key] ?? 0) - dt);
}
export interface BossState {
  id: BossId; main: boolean; phase: number; elapsed: number; last: string; pattern: string;
  flags: Set<string>; stagger: number; invulnerable: boolean; splitAt: number; reviveAt: number;
  scale: number; safeX: number; safeY: number; qte: number; qteTime: number;
  /** 중간 보스: 다음 피해 바닥까지 남은 시간 */
  hazard: number;
}
export function newBoss(id: BossId, main: boolean): BossState {
  return { id, main, phase: 0, elapsed: 0, last: '', pattern: '', flags: new Set(), stagger: 0,
    invulnerable: false, splitAt: 0, reviveAt: 0, scale: 1, safeX: 0, safeY: 0, qte: 0, qteTime: 0, hazard: 3 };
}
export interface Zone {
  shape: 'circle' | 'cone' | 'line' | 'rect' | 'ring' | 'screen' | 'wall';
  x: number; y: number; r: number; angle: number; width: number; length: number;
  warning: number; life: number; age: number; tick: number; damage: number;
  owner: 'player' | 'enemy'; element: Element; status?: StatusId; effect?: 'heal' | 'slow' | 'dark' | 'light' | 'pull' | 'prison';
  safe?: { x: number; y: number; r: number }; hp?: number; grow?: number; source?: number;
  rotate?: number;
  /** 바닥 모양: hazard = 밟으면 아픈 바닥, 나머지는 공격 예고 */
  look?: 'hazard';
  stopEnergy?:boolean;
  /** 판정이 중심에서 끝까지 번지는 시간(초). 없으면 처음부터 전체 크기다. */
  spread?: number;
  /** 번지는 판정에 이미 맞은 그늘 */
  reached?: Set<number>;
  /** 다 번졌을 때의 크기 */
  full?: { r: number; width: number; length: number };
}

/** 나이에 맞춰 판정 크기를 키운다. 벽은 긴 쪽으로만 자란다. */
export function spreadZone(zone: Zone): void {
  if (zone.spread === undefined) return;
  zone.reached ??= new Set();
  const full = (zone.full ??= { r: zone.r, width: zone.width, length: zone.length });
  const t = Math.min(1, (zone.age - zone.warning) / zone.spread), k = 1 - (1 - t) * (1 - t);
  zone.r = full.r * k;
  zone.length = zone.shape === 'wall' && full.width > full.length ? full.length : full.length * k;
  if (zone.shape === 'wall' && full.width > full.length) zone.width = full.width * k;
}
export function contains(zone: Zone, x: number, y: number): boolean {
  if (zone.safe && Math.hypot(x - zone.safe.x, y - zone.safe.y) <= zone.safe.r) return false;
  const dx = x - zone.x, dy = y - zone.y;
  if (zone.shape === 'screen') return true;
  if (zone.shape === 'rect' || zone.shape === 'wall') return Math.abs(dx) <= zone.width / 2 && Math.abs(dy) <= zone.length / 2;
  if (zone.shape === 'ring') return Math.abs(Math.hypot(dx, dy) - zone.r) <= zone.width;
  if (zone.shape === 'cone') {
    const difference = Math.atan2(Math.sin(Math.atan2(dy, dx) - zone.angle), Math.cos(Math.atan2(dy, dx) - zone.angle));
    return Math.hypot(dx, dy) <= zone.r && Math.abs(difference) <= Math.PI / 4;
  }
  if (zone.shape === 'line') {
    const along = dx * Math.cos(zone.angle) + dy * Math.sin(zone.angle);
    const across = -dx * Math.sin(zone.angle) + dy * Math.cos(zone.angle);
    return along >= 0 && along <= zone.length && Math.abs(across) <= zone.width;
  }
  return Math.hypot(dx, dy) <= zone.r;
}
