import { IMPLEMENTED_ELEMENTS, type Element } from './config';
import { pick } from './math';

export type Dir = 'n' | 's' | 'e' | 'w';
export const DIR_KEYS: readonly Dir[] = ['n', 's', 'e', 'w'];
export const DIRS: Readonly<Record<Dir, { dx: number; dy: number; opp: Dir }>> = {
  n: { dx: 0, dy: -1, opp: 's' },
  s: { dx: 0, dy: 1, opp: 'n' },
  e: { dx: 1, dy: 0, opp: 'w' },
  w: { dx: -1, dy: 0, opp: 'e' },
};

/** 1장 1차 몬스터: 귀찮음 / 힘듦 / 우울감. 보스: 알람 */
export type EnemyKind = 'bother' | 'heavy' | 'gloom' | 'alarm';
/** 일반방 / 정령방 / 보스방 */
export type RoomKind = 'normal' | 'spirit' | 'boss' | 'home';

/** 씬 8: 윤슬의 방. 스테이지 격자 밖에 있고, 현관으로 나가면 시작방으로 이어진다. */
export function makeHomeRoom(): Room {
  return {
    gx: 99, gy: 99, kind: 'home', depth: -1,
    doors: { n: false, s: false, e: false, w: false },
    wave: [], cleared: true, marks: [], seed: 42,
  };
}

/** 마주한 그늘이 남기는 바닥 흔적. 상처는 사라지지 않는다. */
export interface FloorMark {
  x: number;
  y: number;
  w: number;
}

export interface Room {
  gx: number;
  gy: number;
  kind: RoomKind;
  depth: number;
  doors: Record<Dir, boolean>;
  wave: EnemyKind[];
  cleared: boolean;
  marks: FloorMark[];
  seed: number;
}

export interface Stage {
  rooms: Room[];
  start: Room;
  /** 이 스테이지 정령방의 속성. 보스도 같은 속성이 된다. */
  element: Element;
}

/** 시작방에서 멀어질수록 구성이 조금씩 무거워진다 */
const NORMAL_WAVES: readonly (readonly EnemyKind[])[] = [
  ['bother', 'bother', 'bother'],
  ['bother', 'bother', 'heavy'],
  ['gloom', 'gloom', 'bother', 'heavy'],
];
/** 정령방: 정령을 지키는 그늘 */
const SPIRIT_WAVE: readonly EnemyKind[] = ['bother', 'gloom', 'bother'];

const ROOM_COUNT = 5;

interface Cell {
  x: number;
  y: number;
}

const key = (x: number, y: number): string => `${x},${y}`;

/**
 * 방 5개(일반 3 + 정령 1 + 보스 1)를 격자에 랜덤 배치.
 * 보스방: 막다른 방, 시작방에서 2칸 이상. 정령방: 남은 막다른 방이 있으면 그곳, 없으면 시작방이 아닌 아무 방.
 */
export function generateStage(): Stage {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const cells: Cell[] = [{ x: 0, y: 0 }];
    const occupied = new Set<string>([key(0, 0)]);

    while (cells.length < ROOM_COUNT) {
      const base = pick(cells);
      const d = DIRS[pick(DIR_KEYS)];
      const nx = base.x + d.dx;
      const ny = base.y + d.dy;
      if (!occupied.has(key(nx, ny))) {
        occupied.add(key(nx, ny));
        cells.push({ x: nx, y: ny });
      }
    }

    const depth = new Map<string, number>([[key(0, 0), 0]]);
    const queue: Cell[] = [{ x: 0, y: 0 }];
    for (let i = 0; i < queue.length; i += 1) {
      const c = queue[i];
      if (!c) break;
      const cd = depth.get(key(c.x, c.y)) ?? 0;
      for (const k of DIR_KEYS) {
        const nx = c.x + DIRS[k].dx;
        const ny = c.y + DIRS[k].dy;
        if (occupied.has(key(nx, ny)) && !depth.has(key(nx, ny))) {
          depth.set(key(nx, ny), cd + 1);
          queue.push({ x: nx, y: ny });
        }
      }
    }

    const depthOf = (c: Cell): number => depth.get(key(c.x, c.y)) ?? 0;
    const neighborCount = (c: Cell): number =>
      DIR_KEYS.filter((k) => occupied.has(key(c.x + DIRS[k].dx, c.y + DIRS[k].dy))).length;

    const bossCandidates = cells.slice(1).filter((c) => neighborCount(c) === 1 && depthOf(c) >= 2);
    if (bossCandidates.length === 0) continue;
    const maxDepth = Math.max(...bossCandidates.map(depthOf));
    const bossCell = pick(bossCandidates.filter((c) => depthOf(c) === maxDepth));

    const rest = cells.slice(1).filter((c) => c !== bossCell);
    const deadEnds = rest.filter((c) => neighborCount(c) === 1);
    const spiritCell = pick(deadEnds.length > 0 ? deadEnds : rest);
    const normals = cells.filter((c) => c !== bossCell && c !== spiritCell).sort((a, b) => depthOf(a) - depthOf(b));

    const makeRoom = (c: Cell, kind: RoomKind, wave: readonly EnemyKind[]): Room => ({
      gx: c.x,
      gy: c.y,
      kind,
      depth: depthOf(c),
      doors: {
        n: occupied.has(key(c.x, c.y - 1)),
        s: occupied.has(key(c.x, c.y + 1)),
        e: occupied.has(key(c.x + 1, c.y)),
        w: occupied.has(key(c.x - 1, c.y)),
      },
      wave: [...wave],
      cleared: wave.length === 0,
      marks: [],
      seed: Math.floor(Math.random() * 1e9),
    });

    const rooms = normals.map((c, i) => makeRoom(c, 'normal', NORMAL_WAVES[i] ?? []));
    rooms.push(makeRoom(spiritCell, 'spirit', SPIRIT_WAVE));
    rooms.push(makeRoom(bossCell, 'boss', ['alarm']));
    const start = rooms[0];
    if (!start) continue;
    return { rooms, start, element: pick(IMPLEMENTED_ELEMENTS) };
  }
  throw new Error('stage generation failed');
}

export function neighborOf(stage: Stage, room: Room, dir: Dir): Room | undefined {
  const d = DIRS[dir];
  return stage.rooms.find((r) => r.gx === room.gx + d.dx && r.gy === room.gy + d.dy);
}
