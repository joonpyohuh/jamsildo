import { IMPLEMENTED_ELEMENTS, type Element } from './config';
import { pick } from './math';
import { LEVELS, type BossId } from './campaign';

export type Dir = 'n' | 's' | 'e' | 'w';
export const DIR_KEYS: readonly Dir[] = ['n', 's', 'e', 'w'];
export const DIRS: Readonly<Record<Dir, { dx: number; dy: number; opp: Dir }>> = {
  n: { dx: 0, dy: -1, opp: 's' },
  s: { dx: 0, dy: 1, opp: 'n' },
  e: { dx: 1, dy: 0, opp: 'w' },
  w: { dx: -1, dy: 0, opp: 'e' },
};

/** 행동 계열. 장별 외형과 보스 명세는 campaign 데이터에서 고른다. */
export type EnemyKind = 'bother' | 'heavy' | 'gloom' | 'alarm';
/** 일반방 / 정령방 / 보스방 */
export type RoomKind = 'normal' | 'spirit' | 'boss' | 'home' | 'rest' | 'shop' | 'hard' | 'memory';

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
  rewarded?: boolean;
  /** 상점에서 이미 산 품목 */
  bought?: string[];
  /** 상점 진열, 하드방 보상: 정해지면 다시 들어와도 같다 */
  goods?: string[];
  prize?: string;
}

export interface Stage {
  rooms: Room[];
  start: Room;
  /** 이 스테이지 정령방의 속성. 보스도 같은 속성이 된다. */
  element: Element;
  number: number;
  chapter: number;
  within: number;
  boss: Room;
  bossId: BossId;
}

/** 저장 파일도 외부 입력이다. 연결이 끊기거나 변조된 지도는 복원하지 않는다. */
export function restoreStage(number: number, rooms: Room[], element: Element): Stage {
  const stage = generateStage(number);
  if (!Array.isArray(rooms) || rooms.length !== (number === 1 ? 5 : 7) || !IMPLEMENTED_ELEMENTS.includes(element)) throw new Error('invalid saved map');
  const kinds = ['normal', 'spirit', 'boss', 'rest', 'shop', 'hard', 'memory'];
  const coordinates = new Set<string>();
  for (const room of rooms) {
    if (!room || !Number.isInteger(room.gx) || !Number.isInteger(room.gy) || Math.abs(room.gx) > 7 || Math.abs(room.gy) > 7 ||
      !kinds.includes(room.kind) || !Number.isFinite(room.seed) || !Number.isInteger(room.depth) || room.depth < 0 || room.depth > 7 ||
      typeof room.cleared !== 'boolean' || (room.rewarded !== undefined && typeof room.rewarded !== 'boolean') ||
      (room.bought !== undefined && !Array.isArray(room.bought)) ||
      !Array.isArray(room.wave) || room.wave.length > 10 || room.wave.some(kind => !['bother','heavy','gloom','alarm'].includes(kind)) ||
      !room.doors || DIR_KEYS.some(dir => typeof room.doors[dir] !== 'boolean') || coordinates.has(`${room.gx},${room.gy}`)) throw new Error('invalid saved room');
    coordinates.add(`${room.gx},${room.gy}`);
    room.marks = []; // 바닥 잔상은 저장 용량에 포함하지 않는다.
  }
  const start = rooms.find(room => room.gx === 0 && room.gy === 0);
  const bosses = rooms.filter(room => room.kind === 'boss');
  if (!start || bosses.length !== 1 || rooms.filter(room => room.kind === 'spirit').length !== 1) throw new Error('invalid saved rooms');
  Object.assign(stage, { rooms, start, boss: bosses[0]!, element });
  const visited = new Set([start]);
  for (const room of visited) for (const dir of DIR_KEYS) if (room.doors[dir]) {
    const next = neighborOf(stage, room, dir);
    if (!next || !next.doors[DIRS[dir].opp]) throw new Error('invalid saved doorway');
    visited.add(next);
  }
  if (visited.size !== rooms.length) throw new Error('disconnected saved map');
  return stage;
}

/** 시작방에서 멀어질수록 구성이 조금씩 무거워진다 */
const NORMAL_WAVES: readonly (readonly EnemyKind[])[] = [
  ['bother', 'bother', 'bother', 'gloom'],
  ['bother', 'bother', 'heavy', 'gloom'],
  ['gloom', 'gloom', 'bother', 'heavy', 'bother'],
];
interface Cell {
  x: number;
  y: number;
}

const key = (x: number, y: number): string => `${x},${y}`;

/**
 * 첫 스테이지 5개, 이후 7개 방. 보스와 정령방 역할은 서로 다른 셀에 고정한다.
 * 상점은 스테이지마다 하나. 2스테이지부터는 휴식·하드·기억방이 하나씩 번갈아 붙는다.
 * 보스방: 막다른 방, 시작방에서 2칸 이상. 정령방: 남은 막다른 방이 있으면 그곳, 없으면 시작방이 아닌 아무 방.
 */
export function generateStage(number = 1): Stage {
  if (!Number.isInteger(number) || number < 1 || number > 20) throw new RangeError('stage must be 1..20');
  const level = LEVELS[number - 1]!;
  const roomCount = number === 1 ? 5 : 7;
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const cells: Cell[] = attempt === 499
      ? [{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:3,y:0},{x:1,y:1},{x:1,y:-1},{x:2,y:1}].slice(0, roomCount)
      : [{ x: 0, y: 0 }];
    const occupied = new Set(cells.map(c => key(c.x, c.y)));
    let growthTries = 0;

    while (cells.length < roomCount && growthTries++ < 1000) {
      const base = pick(cells);
      const d = DIRS[pick(DIR_KEYS)];
      const nx = base.x + d.dx;
      const ny = base.y + d.dy;
      if (!occupied.has(key(nx, ny))) {
        occupied.add(key(nx, ny));
        cells.push({ x: nx, y: ny });
      }
    }
    if (cells.length !== roomCount) continue;

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

    const rooms = normals.map((c, i) => makeRoom(c, 'normal', NORMAL_WAVES[Math.min(i, 2)] ?? []));
    const shop = rooms[rooms.length - 1]!;
    shop.kind = 'shop'; shop.wave = []; shop.cleared = true;
    if (number > 1) {
      const special = rooms[rooms.length - 2]!;
      special.kind = (['rest', 'hard', 'memory'] as const)[(number - 2) % 3]!;
      special.wave = special.kind === 'hard' ? ['alarm'] : [];
      special.cleared = special.wave.length === 0;
    }
    rooms.push(makeRoom(spiritCell, 'spirit', ['alarm']));
    const boss = makeRoom(bossCell, 'boss', ['alarm']);
    rooms.push(boss);
    const start = rooms[0];
    if (!start) continue;
    return { rooms, start, boss, number, chapter: level.chapter, within: level.within, bossId: level.boss,
      element: IMPLEMENTED_ELEMENTS[(number - 1) % IMPLEMENTED_ELEMENTS.length]! };
  }
  throw new Error('stage generation failed');
}

export function neighborOf(stage: Stage, room: Room, dir: Dir): Room | undefined {
  const d = DIRS[dir];
  return stage.rooms.find((r) => r.gx === room.gx + d.dx && r.gy === room.gy + d.dy);
}
