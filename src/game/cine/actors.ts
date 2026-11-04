/**
 * 오프닝 인물·소품 도트. 전부 1배 픽셀 (게임 화면과 섞어도 크기가 같다).
 * 윤슬: 원화(yunseul.png) — 흑발, 앞머리가 한쪽 눈을 덮음, 검정 반팔, 회색 조거, 흰 밑창 검정 운동화.
 * 세나: 원화(sena.png) — 은발 단발, 앞머리, 파란 눈, 흰 오프숄더 원피스, 맨발.
 */
import { fromRows } from '../sprites';
import { Pix, hex, rim, bayer } from './pix';

type Canvas = HTMLCanvasElement;

/* ═══════════════ 허윤슬 (측면, 오른쪽을 봄, 16×41) ═══════════════ */

const Y_PAL = {
  h: '#141319', H: '#2b2a35',
  s: '#e6c6aa', S: '#b88f76', e: '#17161d', m: '#9c6a5e',
  t: '#1d1c23', T: '#2e2d38', u: '#111015', c: '#0b0b0f',
  j: '#6f7179', J: '#50525a', k: '#8b8d95',
  b: '#131317', w: '#e4e4e8',
} as const;

const Y_HEAD = [
  '.....hhhhhh.....',
  '...hhhhhhhhhh...',
  '..hhhhHHHhhhhh..',
  '.hhhhHHhhhhhhhh.',
  '.hhhhhhhhhhhhhh.',
  '.hhhhhhhhhhhhhhh',
  '.hhhhhhhhhhhhhhh',
  '.hhhhhhhhhhhhhh.',
  '.hhhhhhhhhsshhhh',
  '.hhhhhhhhssshhs.',
  '..hhhhhhSssseess',
  '..hhhhhhSsssssss',
  '...hhhhhSssssss.',
  '...hhhhSSssmss..',
  '....hhhSSsss....',
  '.......SSs......',
];

const Y_TORSO = [
  '.....tcccct.....',
  '....tttttttT....',
  '...ttttttttTt...',
  '...tttttttttT...',
  '...tttttttttT...',
  '...uttttttttT...',
  '...uttttttttT...',
  '...uttttttttT...',
  '...uttttttttT...',
  '...uttttttttT...',
  '...uuuuuuuuuu...',
];

const Y_LEGS = {
  stand: [
    '...jjjjjjjjjj...',
    '...jjjjjjjjjk...',
    '...jjjJjjjjjk...',
    '...jjjJjjjjjk...',
    '...jjjJjjjjjk...',
    '....jjJjjjjjk...',
    '....jjJJjjjjk...',
    '....jjjJjjjjk...',
    '....jjjJ.jjjj...',
    '....jjjJ.jjjj...',
    '....JJJJ.JJJJ...',
    '....bbbb.bbbbb..',
    '...bbwbb.bbwbbb.',
    '...wwwww.wwwwww.',
  ],
  stride: [
    '...jjjjjjjjjj...',
    '...jjjjjjjjjjk..',
    '..jjjJjjjjjjjk..',
    '..jjjJJjjjjjjjk.',
    '.jjjj.JJjjjjjjk.',
    '.jjj...JJjjjjjk.',
    'jjjJ....Jjjjjjjk',
    'jjJ......jjjjjjk',
    'jJJ.......jjjjjk',
    'JJ........jjjjjj',
    'JJ........JJJJJJ',
    'bb........bbbbbb',
    'bbw.......bbwbbb',
    'ww........wwwwww',
  ],
  pass: [
    '...jjjjjjjjjj...',
    '...jjjjjjjjjk...',
    '...jjjJjjjjjk...',
    '...jjjJJjjjjk...',
    '...jjj.JJjjjk...',
    '...jjj..Jjjjk...',
    '..jjj...jjjjk...',
    '..jjJ...jjjjk...',
    '.JJJ....jjjjj...',
    '.bbb....jjjjj...',
    'bbbw....JJJJJ...',
    'ww......bbbbbb..',
    '........bbwbbbb.',
    '........wwwwwww.',
  ],
} as const;

/** 팔: 어깨(8, 17) 기준. hand = 손 위치 (스프라이트 좌표) */
const Y_ARMS = {
  down: {
    rows: ['tTT.', 'tTTT', 'utTT', 'uTTT', '.sS.', '.sS.', '.sS.', '.sS.', '.ss.', '.SS.'],
    hand: [10, 25] as const,
  },
  reach: {
    rows: ['tTT.........', 'tTTTTsssssss', 'utTTTsssssSs', 'uTTT........'],
    hand: [19, 19] as const,
  },
  hold: {
    rows: ['tTT.....', 'tTTT....', 'utTT....', 'uTTTs...', '..sSss..', '...sSsss', '.....sss'],
    hand: [21, 23] as const,
  },
} as const;

export type YLegs = keyof typeof Y_LEGS;
export type YArm = keyof typeof Y_ARMS;

export interface YunseulPose {
  canvas: Canvas;
  /** 손 위치 (캔버스 좌표) */
  hand: readonly [number, number];
}

const Y_W = 24;
export const YUN_H = 41;
const yCache = new Map<string, YunseulPose>();

/** 윤슬 한 장. 발밑 중앙 = (8, 41). 빛 방향(rimDir)으로 가장자리에 림라이트. */
export function yunseul(legs: YLegs, arm: YArm, rimColor: string | null = null, rimDir = 1): YunseulPose {
  const key = `${legs}:${arm}:${rimColor ?? ''}:${rimDir}`;
  const hit = yCache.get(key);
  if (hit) return hit;
  const p = new Pix(Y_W, YUN_H);
  p.stamp(fromRows(Y_HEAD, Y_PAL), 0, 0);
  p.stamp(fromRows(Y_TORSO, Y_PAL), 0, 16);
  p.stamp(fromRows(Y_LEGS[legs], Y_PAL), 0, 27);
  const a = Y_ARMS[arm];
  p.stamp(fromRows(a.rows, Y_PAL), 8, 17);
  let canvas = p.commit();
  if (rimColor) canvas = rim(canvas, rimColor, rimDir, 0);
  const pose = { canvas, hand: a.hand };
  yCache.set(key, pose);
  return pose;
}

export const YUN_FOOT_X = 8;

/** 걷기: 보폭 → 지나감 → 보폭 → 지나감 */
export const WALK: readonly YLegs[] = ['stride', 'pass', 'stride', 'pass'];

/* 누운 윤슬 (침대 옆모습, 머리가 왼쪽, 얼굴은 천장) */
const LYING_OPEN = [
  '............ss......',
  '.......hHh.sSSs.....',
  '....hhHHhhhhsssss...',
  '..hhHhhhhhhsesssss..',
  '.hhhhhhhhhhssssssms.',
  'hhhhhhhhhhhSsssssss.',
  'hhhhhhhhhhhSSsssssS.',
  'hhhhhhhhhhhhSSSssS..',
  '.hhhhhhhhhhhh.SSSS..',
  '..hhhhhhhhhh........',
  '....hhhhhh..........',
];
const LYING_SHUT = LYING_OPEN.map((r) => r.replace('e', 'S'));
export const LYING = {
  open: fromRows(LYING_OPEN, Y_PAL),
  shut: fromRows(LYING_SHUT, Y_PAL),
};

/* ═══════════════ 세나 (웅크림, 왼쪽을 봄, 18×21) ═══════════════ */

const S_PAL = {
  w: '#eef1f7', W: '#b9c1d2', v: '#8891a8',
  s: '#f3ddcf', S: '#d9b6a6', e: '#4d6bd6', p: '#eaa6a6',
  d: '#f6f7fb', x: '#cfd5e2', X: '#a3abc0',
} as const;

export const SENA_CROUCH = fromRows([
  '......wwwww.......',
  '....wwwwwwwww.....',
  '...wwwWwwwwwwW....',
  '..wwwWwwwwwwwwW...',
  '..wwwwwwwwwwwwWv..',
  '..wwwwwwwwwwwwWv..',
  '..wwwwwwwwwWwwWv..',
  '..sseswwWwwwwWWv..',
  '..ssssswWwwwwWvv..',
  '..spssswWWwwWWv...',
  '...sssSWvWWWvv....',
  '....xddddddx......',
  '..ssddddddddx.....',
  '.sSsdddddddddx....',
  '.ddddddddddddxx...',
  '.dddddddddddxxx...',
  'ddddddddddddxxxx..',
  'dxddddddddxxxxxX..',
  'xxxdddddxxxxxxXXX.',
  '.XXXXxxxxxxxxXXX..',
  '..ss..sS..........',
], S_PAL);

/* ═══════════════ 세나의 형태 (은빛) ═══════════════ */

const W_PAL = { w: '#ffffff', x: '#b7bfcc', v: '#8891a8', g: '#3a3f4c' } as const;

export const DAGGER = fromRows([
  '...v.......',
  'gggvwwwwwww',
  '...vxxxxxx.',
], W_PAL);

export const SWORD = fromRows([
  '....v.................',
  'ggggvwwwwwwwwwwwwwwwww',
  'ggggvxxxxxxxxxxxxxxxx.',
  '....v.................',
], W_PAL);

export const BOW = fromRows([
  'ww....',
  '.ww...',
  '..w...',
  '..xw..',
  '..x.w.',
  '..x.w.',
  '..x..w',
  '..x..w',
  'ggx..g',
  '..x..w',
  '..x..w',
  '..x.w.',
  '..x.w.',
  '..xw..',
  '..w...',
  '.ww...',
  'ww....',
], W_PAL);

/* ═══════════════ 그늘 (먹 덩어리, 절차 생성) ═══════════════ */

export interface ShadeLook {
  body: string;
  deep: string;
  rim: string;
  eye: string;
}

export const SHADE_UNSEEN: ShadeLook = { body: '#08090d', deep: '#0d0f15', rim: '#1c1f28', eye: '#2a2e38' };
export const SHADE_INDIGO: ShadeLook = { body: '#140c2c', deep: '#21154a', rim: '#7a5ee0', eye: '#e8e2ff' };

/** 4프레임 꿈틀거리는 그늘. 발밑 중앙 = (w/2, h). */
export function makeShade(seed: number, w: number, h: number, look: ShadeLook): Canvas[] {
  let s = seed * 9301 + 49297;
  const rnd = (): number => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const tendrils = Array.from({ length: 3 + Math.floor(rnd() * 3) }, () => ({
    x: 0.2 + rnd() * 0.6, len: 0.25 + rnd() * 0.3, ph: rnd() * Math.PI * 2, r: 0.07 + rnd() * 0.05,
  }));
  const headX = 0.42 + rnd() * 0.16;
  const frames: Canvas[] = [];
  for (let f = 0; f < 4; f += 1) {
    const ph = (f / 4) * Math.PI * 2;
    const p = new Pix(w, h);
    const body = hex(look.body);
    const deep = hex(look.deep);
    const field = (x: number, y: number): number => {
      const u = x / w;
      const v = y / h;
      // 바닥에 퍼진 몸통
      let k = 1 - ((u - 0.5) / 0.48) ** 2 - ((v - 0.86) / 0.3) ** 2;
      // 머리
      const hx = headX + Math.sin(ph) * 0.02;
      k = Math.max(k, 1 - ((u - hx) / 0.3) ** 2 - ((v - 0.5) / 0.3) ** 2);
      // 위로 흔들리는 촉수
      for (const t of tendrils) {
        const top = 0.42 - t.len;
        if (v < top || v > 0.6) continue;
        const sway = Math.sin(ph + t.ph + v * 6) * 0.04;
        const r = t.r * (0.4 + ((v - top) / (0.6 - top)) * 0.6);
        k = Math.max(k, 1 - ((u - t.x - sway) / r) ** 2);
      }
      return k;
    };
    p.each(0, 0, w, h, (x, y) => {
      const k = field(x + 0.5, y + 0.5);
      if (k <= 0) return null;
      return k > 0.55 && 0.5 > bayer(x, y) ? deep : body;
    });
    let c = rim(p.commit(), look.rim, 1, -1);
    // 눈: 머리 높이에 두 점
    const ctx = c.getContext('2d');
    if (ctx) {
      const ex = Math.round((headX + Math.sin(ph) * 0.02) * w);
      const ey = Math.round(h * 0.48);
      ctx.fillStyle = look.eye;
      ctx.fillRect(ex - 3, ey, 2, 2);
      ctx.fillRect(ex + 2, ey, 2, 2);
    }
    c = rim(c, look.rim, -1, 0);
    frames.push(c);
  }
  return frames;
}

/* ═══════════════ 소품 ═══════════════ */

/** 탁상 알람시계 (옆모습, 12×9). 숫자는 그릴 때 따로 켠다. */
export const ALARM = fromRows([
  '.a........a.',
  'aaaaaaaaaaaa',
  'abbbbbbbbbba',
  'abccccccccba',
  'abccccccccba',
  'abccccccccba',
  'abbbbbbbbbba',
  'aaaaaaaaaaaa',
  '.a........a.',
], { a: '#2a2d36', b: '#1a1c22', c: '#0c0d10' });

export const CUP = fromRows([
  'cccccc.',
  'cddddcc',
  'cddddc.c',
  'cddddcc',
  '.cccc..',
], { c: '#5c6270', d: '#3c414c' });

export const PILLS = fromRows([
  '.ggg.',
  'wwwww',
  'wpwww',
  'wwwww',
  'wwwpw',
  '.www.',
], { g: '#4a4f5a', w: '#8a909c', p: '#6a707c' });
