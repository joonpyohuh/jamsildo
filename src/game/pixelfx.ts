/**
 * pixelfx(https://github.com/patch-gg/pixelfx, MIT) 연결부.
 * 효과는 각자 color(불투명 픽셀) + light(가산 빛) 두 버퍼에 그리고, 여기서 한 장으로 합쳐 캔버스에 올린다.
 * 원본 효과는 측면 시점 기준(발밑 원점, 오른쪽을 봄)이라 탑다운 각도는 좌우 반전 + 약한 기울기로만 옮긴다.
 */
import { VIEW_H, VIEW_W } from './config';
import {
  clearFrame, composite, createFrame, createFx,
  type PxActor, type PxInstance, type PxModule, type PxOptions,
} from '../vendor/pixelfx/core/index.js';
import * as swordSlash from '../vendor/pixelfx/fx/melee/sword-slash.js';
import * as thrust from '../vendor/pixelfx/fx/melee/thrust.js';
import * as hitSpark from '../vendor/pixelfx/fx/impacts/hit-spark.js';
import * as bluntHit from '../vendor/pixelfx/fx/impacts/blunt-hit.js';
import * as critHit from '../vendor/pixelfx/fx/impacts/crit-hit.js';
import * as impactFrame from '../vendor/pixelfx/fx/impacts/impact-frame.js';
import * as soulRise from '../vendor/pixelfx/fx/spawn/soul-rise.js';
import * as collectBurst from '../vendor/pixelfx/fx/pickups/collect-burst.js';
import * as fireball from '../vendor/pixelfx/fx/fire/fireball.js';
import * as fireRing from '../vendor/pixelfx/fx/fire/fire-ring.js';
import * as burning from '../vendor/pixelfx/fx/status/burning.js';
import * as haste from '../vendor/pixelfx/fx/status/haste.js';

/* 팔레트: 원본의 파랑·주황·분홍을 잠실도 팔레트(은빛 + 온기 하나)로 다시 칠한다. 어두움 → 밝음. */
const SENA_7 = ['#14161b', '#2a2e36', '#4a4f59', '#7d828c', '#b4b9c2', '#e2e5ea', '#ffffff'];
const SENA_8 = ['#0e1015', '#1d2027', '#33373f', '#5a606b', '#8d939d', '#bfc4cc', '#e6e9ee', '#ffffff'];
const SENA_SPARKS = ['#ffffff', '#e6e9ee', '#bfc4cc', '#8d939d'];
const SOUL_7 = ['#0e1015', '#22252c', '#3a3e46', '#6b707a', '#a9aeb6', '#dcdfe4', '#ffffff'];
const WARM_8 = ['#1a1006', '#3a240c', '#6b4416', '#a8692a', '#e0a458', '#f0c88a', '#fbe8c8', '#ffffff'];
const INK_PAPER = ['#07080b', '#7d828c', '#ffffff'];
/** 불의 정령: pixelfx 기본 불 램프 그대로 (어두움 → 흰 불) */
const FIRE_9 = ['#4a1712', '#8a1f17', '#c9281f', '#f2561d', '#ff8a2a', '#ffc23d', '#ffe26b', '#fff3a6', '#ffffff'];
const FIRE_7 = ['#4a1712', '#c9281f', '#f2561d', '#ff8a2a', '#ffc23d', '#ffe26b', '#ffffff'];

interface Live {
  fx: PxInstance;
  /** 히트스톱·슬로모와 무관하게 실제 시간으로 흐르는지 */
  realtime: boolean;
}

/** 탑다운 각도 → 원본 효과의 좌우 반전 + 기울기 */
export function facing(angle: number, maxTilt = 0.7): { flip: boolean; angle: number } {
  const c = Math.cos(angle);
  const flip = c < 0;
  let a = flip ? angle + Math.PI : angle;
  a = Math.atan2(Math.sin(a), Math.cos(a));
  return { flip, angle: Math.max(-maxTilt, Math.min(maxTilt, a)) };
}

/** 원본 효과의 로컬 방향(반전 기준)으로 바꾼 타격 각도 */
function localAim(angle: number, flip: boolean): number {
  const a = flip ? Math.PI - angle : angle;
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** 스프라이트의 불투명 픽셀로 효과용 몸(actor)을 만든다. 발밑이 원점. */
export function actorFromSprite(spr: HTMLCanvasElement): PxActor {
  const ctx = spr.getContext('2d');
  const w = spr.width;
  const h = spr.height;
  const data = new Uint8Array(w * h);
  if (ctx) {
    const px = ctx.getImageData(0, 0, w, h).data;
    for (let i = 0; i < w * h; i += 1) data[i] = (px[i * 4 + 3] ?? 0) > 0 ? 1 : 0;
  }
  const x = -Math.floor(w / 2);
  const y = -h;
  return { mask: { w, h, data }, x, y, w, h, k: 1, head: [0, y], chest: [0, Math.round(y * 0.6)] };
}

export class PixelLayer {
  private readonly frame = createFrame(VIEW_W, VIEW_H);
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly img: ImageData;
  private live: Live[] = [];
  private seed = 1;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = VIEW_W;
    this.canvas.height = VIEW_H;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
    this.img = ctx.createImageData(VIEW_W, VIEW_H);
  }

  private spawn(mod: PxModule, o: PxOptions, realtime = false): PxInstance {
    this.seed = (this.seed * 1103515245 + 12345) % 2147483647;
    const fx = createFx(mod, { seed: this.seed % 997, ...o });
    this.live.push({ fx, realtime });
    return fx;
  }

  clear(): void {
    this.live = [];
  }

  update(dtGame: number, dtReal: number): void {
    for (const l of this.live) l.fx.update(l.realtime ? dtReal : dtGame);
    this.live = this.live.filter((l) => !l.fx.done());
  }

  draw(target: CanvasRenderingContext2D): void {
    if (this.live.length === 0) return;
    clearFrame(this.frame);
    for (const l of this.live) l.fx.draw(this.frame);
    composite(this.frame, this.img.data, null, 1);
    this.ctx.putImageData(this.img, 0, 0);
    target.drawImage(this.canvas, 0, 0);
  }

  /* ── 세나의 형태별 공격 ── */

  /** 장검: 기울어진 초승달. 발밑 원점 → 가슴 높이에 맞추려고 12px 내려 놓는다. */
  swordSlash(x: number, footY: number, aim: number, radius: number): void {
    this.spawn(swordSlash, { x, y: footY + 12, ...facing(aim), palette: SENA_7, sparks: SENA_SPARKS, radius, light: 0.7 });
  }

  /** 단검: 손에서 뻗는 찌르기 다발 */
  thrust(x: number, footY: number, aim: number, reach: number): void {
    this.spawn(thrust, { x, y: footY + 8, ...facing(aim, 0.9), palette: SENA_7, sparks: SENA_SPARKS, reach, light: 0.6 });
  }

  /** 너클: 둔탁한 타격 */
  blunt(x: number, y: number, height: number): void {
    this.spawn(bluntHit, {
      x, y: y + height, palette: SENA_7, warm: '#cdd7ea', dust: '#6b707a', clod: '#3a3e46', height, light: 0.5,
    });
  }

  /* ── 맞는 순간 ── */

  hitSpark(x: number, footY: number, height: number, blow: number): void {
    const { flip } = facing(blow);
    this.spawn(hitSpark, { x, y: footY, flip, palette: SENA_7, height, aim: localAim(blow, flip), light: 0.8 });
  }

  /** 방의 마지막 일격 */
  crit(x: number, footY: number, height: number, blow: number): void {
    const { flip } = facing(blow);
    this.spawn(critHit, { x, y: footY, flip, palette: SENA_8, height, aim: localAim(blow, flip), light: 0.8 });
  }

  /** 보스 피니시: 흰 프레임과 먹선. 슬로모와 상관없이 실제 시간으로. */
  impactFrame(x: number, y: number): void {
    this.spawn(impactFrame, { x, y, palette: INK_PAPER }, true);
  }

  /* ── 마주함: 그늘의 옅은 사본이 떠오른다 ── */

  soul(x: number, footY: number, body: PxActor, height: number): void {
    this.spawn(soulRise, { x, y: footY, actor: body, palette: SOUL_7, height, light: 0.6 });
  }

  /* ── 불의 정령 스킬 ── */

  /** 날아가는 불덩이. 반환된 핸들의 options.x/y를 매 프레임 옮기고, 끝나면 stop(). */
  fireball(x: number, y: number, angle: number, radius = 4): PxInstance {
    return this.spawn(fireball, { x, y, angle, palette: FIRE_9, radius, light: 0.8 });
  }

  /** 불덩이가 터지는 자리 (hit-spark의 원래 불 팔레트) */
  fireHit(x: number, footY: number, height: number, blow: number): void {
    const { flip } = facing(blow);
    this.spawn(hitSpark, { x, y: footY, flip, height, aim: localAim(blow, flip), light: 1 });
  }

  /** W 시전: 발밑에서 퍼지는 불고리 */
  fireRing(x: number, footY: number, reach: number): void {
    this.spawn(fireRing, { x, y: footY, palette: FIRE_9, reach, light: 0.7 });
  }

  /** W 지속: 몸에 두른 불 (윤슬 실루엣을 따라 붙는다). 핸들로 위치를 따라가게 하고 끝나면 stop(). */
  burning(x: number, footY: number, body: PxActor): PxInstance {
    return this.spawn(burning, { x, y: footY, actor: body, palette: FIRE_9, light: 0.7 });
  }

  /** E 지속: 불꽃 잔상과 속도선 */
  haste(x: number, footY: number, body: PxActor, flip: boolean): PxInstance {
    return this.spawn(haste, { x, y: footY, flip, actor: body, palette: FIRE_7, dust: '#6b4a3a', light: 0.6 });
  }

  /* ── 온기 ── */

  warmth(x: number, y: number): void {
    this.spawn(collectBurst, { x, y, palette: WARM_8, light: 0.45 });
  }
}
