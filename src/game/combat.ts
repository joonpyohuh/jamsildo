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
