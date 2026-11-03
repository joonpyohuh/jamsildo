import { COLOR } from './config';

export type Sprite = HTMLCanvasElement;

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  return [c, ctx];
}

export function fromRows(rows: readonly string[], palette: Readonly<Record<string, string>>): Sprite {
  const w = Math.max(...rows.map((r) => r.length));
  const [c, ctx] = makeCanvas(w, rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const color = palette[row.charAt(x)];
      if (color) {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  });
  return c;
}

/* ── 허윤슬 (16×25) ─────────────────────────────────
   오른쪽을 보는 3/4 시점. 흑발 앞머리가 한쪽 눈을 덮는다.
   원화(yunseul.png) 기준: 검정 반팔 티, 회색 조거, 흰 줄 들어간 검정 운동화. */
const YUNSEUL_PALETTE = {
  h: '#0e0f12',
  H: '#2a2e37',
  s: '#d2b8a0',
  S: '#a88c76',
  e: '#0e0f12',
  g: '#1d1e23',
  G: '#121317',
  l: '#2c2e35',
  w: '#1d1e23',
  p: '#6e7179',
  P: '#4e5159',
  k: '#16171b',
  K: '#dcdfe4',
} as const;

const YUNSEUL_UPPER = [
  '......hhhh......',
  '....hhhhhhhh....',
  '...hhhHHhhhhh...',
  '..hhhHhhhhhhhh..',
  '..hhhhhhhhhhhhh.',
  '..hhhhhhhhhhhhh.',
  '..hhhhhhhhhhshh.',
  '..hhhhhhhssshhh.',
  '...hhhhhsssesh..',
  '...hhhhssssssS..',
  '....hhhSsssss...',
  '......SSss......',
  '....GGggggwG....',
  '...GggggggwgG...',
  '..GgglgggggwgG..',
  '..GgglggggggggG.',
  '..GgglggggggggG.',
  '..sGglggggggGGs.',
  '..sGggggggggGGs.',
  '...GGGGGGGGGG...',
  '....pppppPpp....',
] as const;

const LEGS_STAND = ['....ppP..pPp....', '....ppP..ppP....', '....ppP..ppP....', '...kkkK.kkkK....'];
const LEGS_STRIDE_A = ['....ppP..pPp....', '...ppP....ppP...', '...ppP.....ppP..', '..kkkK.....kkkK.'];
const LEGS_STRIDE_B = ['....ppP..pPp....', '....ppP...ppP...', '...ppP....ppP...', '..kkkK....kkkK..'];

const yunseul = (legs: readonly string[]): Sprite => fromRows([...YUNSEUL_UPPER, ...legs], YUNSEUL_PALETTE);

/* ── 그늘: 절차적 덩어리 ─────────────────────────────
   잉크 몸통, 위에서 떨어지는 빛을 받은 윗테두리, 나머지 테두리, 밝은 눈. */
interface BlobSpec {
  w: number;
  h: number;
  inside: (x: number, y: number) => boolean;
  eyes: readonly (readonly [number, number])[];
  tears?: readonly (readonly [number, number])[];
}

function blob(spec: BlobSpec): Sprite {
  const { w, h } = spec;
  const [c, ctx] = makeCanvas(w, h);
  const m = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && spec.inside(x + 0.5, y + 0.5);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!m(x, y)) continue;
      const top = !m(x, y - 1);
      const edge = top || !m(x - 1, y) || !m(x + 1, y) || !m(x, y + 1);
      const nearTop = !m(x, y - 2) || !m(x, y - 3);
      let color: string = COLOR.ink;
      if (edge) color = top && y < h * 0.7 ? COLOR.inkLight : COLOR.inkRim;
      else if (nearTop) color = COLOR.inkMid;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  ctx.fillStyle = COLOR.pale;
  for (const [x, y] of spec.eyes) ctx.fillRect(x, y, 1, 1);
  ctx.fillStyle = COLOR.dim;
  for (const [x, y] of spec.tears ?? []) ctx.fillRect(x, y, 1, 1);
  return c;
}

const ellipse = (cx: number, cy: number, rx: number, ry: number) => (x: number, y: number): boolean =>
  ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

/** 귀찮음: 늘어진 덩어리, 반쯤 감긴 눈, 바닥으로 녹아내림 */
const BOTHER = blob({
  w: 20,
  h: 16,
  inside: (x, y) => {
    if (y <= 13 && ellipse(10, 8, 9.6, 6.6)(x, y)) return true;
    const drip = (dx: number, len: number): boolean => Math.abs(x - dx) < 1 && y > 12 && y < 13 + len;
    return drip(4.5, 2) || drip(9.5, 3) || drip(15.5, 1.5);
  },
  eyes: [[5, 8], [6, 8], [7, 8], [12, 8], [13, 8], [14, 8]],
});

/** 힘듦: 무겁게 웅크린 돔, 낮게 깔린 작은 눈 */
const HEAVY = blob({
  w: 28,
  h: 24,
  inside: (x, y) => {
    if (y <= 21 && ellipse(14, 13, 13.6, 11.2)(x, y)) return true;
    const foot = (fx: number): boolean => x >= fx && x <= fx + 4 && y > 20 && y <= 23;
    return foot(5) || foot(19);
  },
  eyes: [[9, 16], [10, 16], [17, 16], [18, 16]],
});

/** 우울감: 떠다니는 물방울, 아래로 흐르는 눈 */
const GLOOM = blob({
  w: 14,
  h: 20,
  inside: (x, y) => {
    if (ellipse(7, 13, 6.6, 6.4)(x, y)) return true;
    if (y < 1 || y > 13) return false;
    const half = (6.4 * (y - 1)) / 12;
    return Math.abs(x - 7) <= half;
  },
  eyes: [[4, 12], [4, 13], [9, 12], [9, 13]],
  tears: [[4, 15], [9, 16]],
});

/* ── 알람 ─────────────────────────────────────────
   자명종 모양 그늘. 마주하고 나면 '그냥 자명종'으로 돌아온다. */
interface ClockPalette {
  body: string;
  mid: string;
  rim: string;
  light: string;
  face: string;
}

interface ClockGeometry {
  size: number;
  cx: number;
  cy: number;
  r: number;
  bellDx: number;
  bellY: number;
  bellR: number;
  bellCut: number;
  tick: number;
  hand: number;
}

const BIG_CLOCK: ClockGeometry = {
  size: 45, cx: 22, cy: 25, r: 15, bellDx: 13, bellY: 9, bellR: 7, bellCut: 13, tick: 11, hand: 7,
};
const SMALL_CLOCK: ClockGeometry = {
  size: 19, cx: 9, cy: 11, r: 6, bellDx: 6, bellY: 4, bellR: 3.2, bellCut: 6, tick: 4, hand: 3,
};

function clock(g: ClockGeometry, p: ClockPalette): Sprite {
  const [c, ctx] = makeCanvas(g.size, g.size);
  const set = (x: number, y: number, color: string): void => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 1, 1);
  };
  const shade = (d: number, r: number, y: number, cy: number): string => {
    if (d > r - 1) return y < cy - r * 0.3 ? p.light : p.rim;
    if (d > r - 3 && y < cy) return p.mid;
    return p.body;
  };

  for (const side of [-1, 1]) {
    const bx = g.cx + side * g.bellDx;
    for (let y = 0; y <= g.bellCut; y += 1) {
      for (let x = 0; x < g.size; x += 1) {
        const d = Math.hypot(x - bx, y - g.bellY);
        if (d <= g.bellR) set(x, y, shade(d, g.bellR, y, g.bellY));
      }
    }
  }
  const hammerTop = Math.round(g.bellY - g.bellR);
  for (let y = hammerTop; y < hammerTop + 4; y += 1) set(g.cx, y, p.rim);
  set(g.cx - 1, hammerTop, p.rim);
  set(g.cx + 1, hammerTop, p.rim);

  for (let y = 0; y < g.size; y += 1) {
    for (let x = 0; x < g.size; x += 1) {
      const d = Math.hypot(x - g.cx, y - g.cy);
      if (d <= g.r + 0.3) set(x, y, shade(d, g.r, y, g.cy));
    }
  }
  const legY = g.cy + g.r;
  for (const side of [-1, 1]) {
    const lx = g.cx + side * Math.round(g.r * 0.6);
    set(lx, legY, p.rim);
    set(lx + side, legY + 1, p.rim);
    if (g.size > 30) set(lx + side * 2, legY + 2, p.rim);
  }
  // 눈금 12개, 바늘 둘
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2;
    const major = i % 3 === 0;
    if (!major && g.size < 30) continue;
    set(Math.round(g.cx + Math.cos(a) * g.tick), Math.round(g.cy + Math.sin(a) * g.tick), major ? p.face : p.light);
  }
  set(g.cx, g.cy, p.face);
  for (let i = 1; i <= g.hand; i += 1) set(g.cx, g.cy - i, p.face);
  for (let i = 1; i <= Math.max(1, g.hand - 2); i += 1) set(g.cx + i, g.cy + Math.round(i * 0.4), p.face);
  return c;
}

/* ── 불의 정령 (13×16) ─────────────────────────────
   최대한 귀엽게: 동그란 아랫배, 까만 콩 눈, 볼터치, ω 입. 끝이 좌우로 흔들린다. */
const FIRE_SPIRIT_PALETTE = {
  o: '#8a1f17',
  r: '#e0402a',
  O: '#ff8a2a',
  y: '#ffc23d',
  Y: '#ffe680',
  k: '#1a0a08',
  p: '#ff6f7a',
} as const;

const FIRE_SPIRIT_BODY = [
  '..orOyyyyOro.',
  '.orOyyYYyyOo.',
  '.oOyyYYYYyyOo',
  'oOyykyyykyyOo',
  'oOpykyyykypOo',
  'oOyyykykyyyOo',
  '.oOyyykyyyOo.',
  '..oOyyyyyOo..',
  '...ooOOOoo...',
  '.....ooo.....',
] as const;

const FIRE_SPIRIT_A = fromRows([
  '......o......',
  '.....oro.....',
  '.....oOro....',
  '....orOOo....',
  '....oOyOro...',
  '...orOyyOro..',
  ...FIRE_SPIRIT_BODY,
], FIRE_SPIRIT_PALETTE);

const FIRE_SPIRIT_B = fromRows([
  '.....o.......',
  '....oro......',
  '....orOo.....',
  '....oOOro....',
  '...orOyOo....',
  '...orOyyOro..',
  ...FIRE_SPIRIT_BODY,
], FIRE_SPIRIT_PALETTE);

/* ── HUD 하트 (9×8): 맞으면 반 칸씩 ── */
const HEART_ROWS = [
  '.rr...rr.',
  'rLrr.rrrr',
  'rLrrrrrrr',
  'rrrrrrrrd',
  '.rrrrrrd.',
  '..rrrrd..',
  '...rrd...',
  '....d....',
] as const;
const HEART = fromRows(HEART_ROWS, { r: COLOR.heart, L: COLOR.heartLight, d: COLOR.heartShade });
const HEART_EMPTY = fromRows(HEART_ROWS, { r: COLOR.heartEmpty, L: COLOR.heartEmpty, d: COLOR.heartEmpty });

/* ── 1장 소품: 집. 오래 치우지 않은 방. ── */
const PROP_PALETTE = {
  a: '#23262d',
  b: '#2e323a',
  c: '#3a3e46',
  d: '#4a4f59',
  e: '#5a606b',
  f: '#7d828c',
} as const;

const PROPS = {
  books: fromRows([
    '.cccccccccc.',
    '.dddddddddd.',
    'bbbbbbbbbbb.',
    'aaaaaaaaaaa.',
    '..ccccccccc.',
    '..eeeeeeeee.',
    '..aaaaaaaaa.',
  ], PROP_PALETTE),
  cup: fromRows([
    'eeeeee',
    'efffff',
    'effffe',
    '.dffd.',
    '.dddd.',
  ], PROP_PALETTE),
  laundry: fromRows([
    '....cccc........',
    '..ccddddcc.bbb..',
    '.cddddddddcbbbb.',
    'cdddddddddddbbbc',
    'bbbbbbbbbbbbbbbb',
  ], PROP_PALETTE),
  can: fromRows([
    '.ff.',
    'eeee',
    'dddd',
    'dddd',
    'cccc',
  ], PROP_PALETTE),
} as const;

export type PropId = keyof typeof PROPS;
export const PROP_IDS: readonly PropId[] = ['books', 'cup', 'laundry', 'can'];

export const SPRITES = {
  /** [서기, 걸음A, 서기, 걸음B] */
  yunseul: [yunseul(LEGS_STAND), yunseul(LEGS_STRIDE_A), yunseul(LEGS_STAND), yunseul(LEGS_STRIDE_B)] as const,
  bother: BOTHER,
  heavy: HEAVY,
  gloom: GLOOM,
  alarm: clock(BIG_CLOCK, { body: COLOR.ink, mid: COLOR.inkMid, rim: COLOR.inkRim, light: COLOR.inkLight, face: COLOR.pale }),
  /** 불 속성 알람: 달아오른 쇠 */
  alarmFire: clock(BIG_CLOCK, { body: '#1f0907', mid: '#3d110c', rim: '#c9281f', light: '#ff8a2a', face: '#ffe26b' }),
  plainClock: clock(SMALL_CLOCK, { body: '#7d828c', mid: '#8d929b', rim: '#4d525b', light: '#a9aeb6', face: '#e4e6ea' }),
  fireSpirit: [FIRE_SPIRIT_A, FIRE_SPIRIT_B] as const,
  heart: HEART,
  heartEmpty: HEART_EMPTY,
  props: PROPS,
} as const;

const tintCache = new Map<Sprite, Map<string, Sprite>>();

/** 실루엣을 단색으로 칠한 사본 (피격 섬광, 잔상, 마주한 뒤의 옅은 모습) */
export function tint(src: Sprite, color: string): Sprite {
  let byColor = tintCache.get(src);
  if (!byColor) {
    byColor = new Map();
    tintCache.set(src, byColor);
  }
  const cached = byColor.get(color);
  if (cached) return cached;
  const [c, ctx] = makeCanvas(src.width, src.height);
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  byColor.set(color, c);
  return c;
}

const glowCache = new Map<string, Sprite>();

/** 가산 합성용 둥근 빛 */
export function glow(color: string, radius: number): Sprite {
  const key = `${color}|${radius}`;
  const cached = glowCache.get(key);
  if (cached) return cached;
  const size = radius * 2;
  const [c, ctx] = makeCanvas(size, size);
  const g = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
  g.addColorStop(0, color);
  g.addColorStop(0.35, `${color}66`);
  g.addColorStop(1, `${color}00`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  glowCache.set(key, c);
  return c;
}
