/**
 * 몸의 움직임. pixelfx의 act(poses: [시각, 자세, "snap"])와 같은 문법을 스프라이트 변형에 쓴다.
 * pixelfx 기본 몸(회색 더미) 대신 윤슬과 그늘의 원화를 그대로 두고, 자세만 옮겨 온다.
 * 값은 전부 '앞쪽' 기준이다. 실제 화면 방향은 aimed()가 정한다.
 */
import type { FormId } from './forms';

export interface Pose {
  /** 앞으로 나간 거리(px) */
  push: number;
  /** 떠오른 높이(px) */
  lift: number;
  sx: number;
  sy: number;
  /** 발을 축으로 앞으로 기운 정도 (1이면 45도) */
  lean: number;
}

/** 화면에 바로 쓰는 자세 */
export interface ScreenPose { ox: number; oy: number; sx: number; sy: number; lean: number }

type Key = readonly [t: number, pose: Partial<Pose>, snap?: 'snap'];
type Track = readonly Key[];

const REST: Pose = { push: 0, lift: 0, sx: 1, sy: 1, lean: 0 };

/** 시각 t의 자세. snap 키는 직전 자세를 붙들고 있다가 그 순간 뛰어넘는다. */
function sample(track: Track, t: number): Pose {
  let prev: Key = [0, {}];
  for (const key of track) {
    if (t < key[0]) {
      if (key[2] === 'snap') return { ...REST, ...prev[1] };
      const k = (t - prev[0]) / Math.max(0.0001, key[0] - prev[0]);
      const a = { ...REST, ...prev[1] }, b = { ...REST, ...key[1] };
      return {
        push: a.push + (b.push - a.push) * k, lift: a.lift + (b.lift - a.lift) * k,
        sx: a.sx + (b.sx - a.sx) * k, sy: a.sy + (b.sy - a.sy) * k, lean: a.lean + (b.lean - a.lean) * k,
      };
    }
    prev = key;
  }
  return { ...REST, ...prev[1] };
}

/** 앞쪽 기준 자세를 화면 방향으로 돌린다. 세로 방향은 3/4 시점이라 절반만 움직인다. */
function aimed(p: Pose, dirX: number, dirY: number, amp = 1): ScreenPose {
  const side = dirX < 0 ? -1 : 1;
  return {
    ox: Math.round(p.push * dirX * amp),
    oy: Math.round(p.push * dirY * 0.5 * amp - p.lift * amp),
    sx: 1 + (p.sx - 1) * amp,
    sy: 1 + (p.sy - 1) * amp,
    lean: p.lean * side * amp,
  };
}

/* ── 윤슬 ── */

/** 공격 한 번이 몸에 남는 시간. 판정(swing)보다 길어서 회복 자세까지 보인다. */
export const ATTACK_TIME = 0.3;

const ATTACK: Readonly<Record<FormId, Track>> = {
  sword: [
    [0, { push: -2, lean: -0.16, sx: 1.05, sy: 0.95 }],
    [0.12, { push: 4, lean: 0.3, sx: 1.1, sy: 0.92 }, 'snap'],
    [0.6, { push: 2, lean: 0.14, sx: 1.03, sy: 0.98 }],
    [1, {}],
  ],
  dagger: [
    [0, { push: 3, lean: 0.24, sx: 1.14, sy: 0.9 }],
    [0.45, { push: 1, lean: 0.08 }],
    [1, {}],
  ],
  knuckle: [
    [0, { push: -2, lean: -0.1, sx: 0.93, sy: 1.06 }],
    [0.14, { push: 5, lean: 0.26, sx: 1.16, sy: 0.88 }, 'snap'],
    [0.55, { push: 2, lean: 0.1 }],
    [1, {}],
  ],
  bow: [
    [0, { push: -1, lean: -0.05, sy: 1.03 }],
    [0.3, { push: -3, lean: -0.16, sx: 1.06, sy: 0.95 }, 'snap'],
    [1, {}],
  ],
};

const CAST: Track = [
  [0, { lift: 1, sx: 0.94, sy: 1.1 }],
  [0.12, { lift: 2, sx: 0.92, sy: 1.12 }],
  [0.2, { sx: 1.1, sy: 0.92 }, 'snap'],
  [0.38, {}],
];

const HURT: Track = [
  [0, { push: -3, lean: -0.28, sx: 0.92, sy: 1.08 }],
  [0.6, { push: -1, lean: -0.1 }],
  [1, {}],
];

export function attackPose(form: FormId, k: number, dirX: number, dirY: number): ScreenPose {
  return aimed(sample(ATTACK[form], k), dirX, dirY);
}

export function castPose(t: number, facing: number): ScreenPose {
  return aimed(sample(CAST, t), facing, 0);
}

export function hurtPose(k: number, facing: number): ScreenPose {
  return aimed(sample(HURT, k), facing, 0);
}

/** 두 걸음에 한 번 튀고, 가는 쪽으로 몸이 쏠린다. walkT 0.2초마다 발이 닿는다. */
export function walkPose(walkT: number, facing: number): ScreenPose {
  const h = Math.abs(Math.sin(walkT * Math.PI * 5));
  return aimed({ ...REST, lift: h * 1.6, lean: 0.1, sy: 1 + h * 0.03, sx: 1 - h * 0.02 }, facing, 0);
}

/** 대시: 가는 방향으로 늘어난다. 세로로 달리면 세로로 늘어난다. */
export function dashPose(dirX: number): ScreenPose {
  const across = Math.abs(dirX);
  return {
    ox: 0, oy: 0,
    sx: 1 + 0.24 * across - 0.12 * (1 - across),
    sy: 1 - 0.14 * across + 0.2 * (1 - across),
    lean: 0.36 * dirX,
  };
}

/* ── 그늘 ── */

export type EnemyAction = 'telegraph' | 'strike' | 'hurt' | 'move' | 'idle';

export interface EnemyMotion {
  action: EnemyAction;
  kind: 'bother' | 'heavy' | 'gloom' | 'alarm';
  /** 이 동작이 시작되고 흐른 시간 */
  t: number;
  clock: number;
  /** 개체마다 박자가 어긋나게 하는 값 */
  phase: number;
  /** 윤슬 쪽 단위 벡터 */
  dirX: number;
  dirY: number;
  boss: boolean;
}

const TELEGRAPH_TIME = 0.4;

/** 종류마다 걸음이 다르다. 짜증은 튀고, 무거운 것은 짓밟고, 떠 있는 것은 흐르고, 알람은 떤다. */
function gait(m: EnemyMotion): Pose {
  const c = m.clock + m.phase;
  if (m.kind === 'heavy') {
    const s = Math.sin(c * 5);
    return { ...REST, lift: Math.abs(s) * 1.5, lean: s * 0.1, sx: 1 + Math.abs(s) * 0.03, sy: 1 - Math.abs(s) * 0.03 };
  }
  if (m.kind === 'gloom') {
    const s = Math.sin(c * 4);
    return { ...REST, lean: 0.1 + s * 0.05, sx: 1 - s * 0.04, sy: 1 + s * 0.05 };
  }
  if (m.kind === 'alarm') {
    return { ...REST, lift: Math.abs(Math.sin(c * 9)) * 2, lean: Math.sin(c * 18) * 0.1 };
  }
  const k = (c * 3.2) % 1, h = Math.sin(k * Math.PI);
  // 땅에 닿는 앞 구간은 눌리고, 공중에선 늘어난다
  return k < 0.14
    ? { ...REST, sx: 1.12, sy: 0.88 }
    : { ...REST, lift: h * 4, lean: 0.12, sx: 1 - h * 0.08, sy: 1 + h * 0.1 };
}

export function enemyPose(m: EnemyMotion): ScreenPose {
  const amp = m.boss ? 0.5 : 1;
  if (m.action === 'telegraph') {
    const k = Math.min(1, m.t / TELEGRAPH_TIME);
    return aimed({ ...REST, push: -2.5 * k, lean: -0.14 * k, sx: 1 + 0.14 * k, sy: 1 - 0.14 * k }, m.dirX, m.dirY, amp);
  }
  if (m.action === 'strike') return aimed({ ...REST, push: 3, lean: 0.26, sx: 1.14, sy: 0.9 }, m.dirX, m.dirY, amp);
  if (m.action === 'hurt') return aimed({ ...REST, push: -2, lean: -0.2, sx: 0.94, sy: 1.06 }, m.dirX, m.dirY, amp);
  if (m.action === 'move') return aimed(gait(m), m.dirX, m.dirY, amp);
  const s = Math.sin((m.clock + m.phase) * 2.4);
  return aimed({ ...REST, sx: 1 - s * 0.025, sy: 1 + s * 0.03 }, m.dirX, m.dirY, amp);
}
