/**
 * 오프닝 (씬 1~7). 사운드 없음.
 * 화면은 전부 1배 픽셀. 그라데이션·빛·페이드는 베이어 디더 (src/game/cine/*).
 * 색 흐름: 씬 1~4 회청색 → 씬 5 세나의 은빛 → 씬 6 처음으로 선명한 색.
 * 위아래 레터박스, 자막은 아래 띠 안. 세나 대사에는 표정 얼굴이 함께 뜬다.
 *
 * 씬 8(윤슬의 방)은 실제로 걸어다니는 게임 방이라 game.ts에서 drawHomeRoom()을 쓴다.
 */
import { CX, FLOOR, VIEW_H, VIEW_W, WALL_CAP, WALL_TOP } from './config';
import { TAU, clamp, easeInOut, easeOut, rand, seeded } from './math';
import { pixelEllipse } from './fx';
import { SPRITES, fromRows, glow } from './sprites';
import { PixelLayer } from './pixelfx';
import type { Expr } from './lines';

/** 씬 2의 기상 동작 */
const RISE_TIME = 3, RISE_FRAMES = 6;
import { bayer, blit, ditherFade } from './cine/pix';
import {
  BOW, DAGGER, LYING, SENA_CROUCH, SHADE_INDIGO, SHADE_UNSEEN, SWORD, WALK, YUN_FOOT_X, YUN_H,
  makeShade, yunseul, type YunseulPose,
} from './cine/actors';
import {
  BR, BRIDGE_DAWN, BRIDGE_VIVID, DOOR, LB, OY, PIC_BOT, PIC_TOP, ROOM, WORLD_W,
  buildBridge, buildDoorFrame, buildMemory, buildPanorama, buildReeds, buildRoom, type PanoLayers,
} from './cine/backdrops';

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string): void {
  ctx.fillStyle = c;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function putGlow(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, r: number, a: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = a;
  ctx.drawImage(glow(color, r), Math.round(x - r), Math.round(y - r));
  ctx.restore();
}

/* ═══════════════ 윤슬의 방 (씬 2, 4, 8) ═══════════════ */

/** 방 배치: 게임의 바닥 영역(FLOOR)과 같은 좌표 → 씬 8에서 그대로 걸어다닌다 */
export const HOME = {
  bed: { x: FLOOR.x + 14, y: FLOOR.y + 18, w: 78, h: 128 },
  curtain: { x: CX - 40, w: 80 },
  entrance: { x: FLOOR.x + FLOOR.w - 84, y: FLOOR.y + FLOOR.h - 34, w: 70, h: 34 },
  door: { x: FLOOR.x + FLOOR.w - 70, w: 42 },
} as const;

const PILLS = fromRows(['.ccc.', '.ccc.', 'wwwww', 'wpwww', 'wwwww', 'wwwww', 'wwwpw', '.www.'], {
  c: '#6f7480', w: '#d4d8de', p: '#9aa0aa',
});
const POUCH = fromRows(['.kkkkkk.', 'bbbbbbbb', 'bBBBBBBb', 'bBttttBb', 'bBttttBb', 'bBBBBBBb', 'bbbbbbbb', '.bbbbbb.'], {
  k: '#77706a', b: '#958c80', B: '#a89e91', t: '#c8c0b2',
});

export interface HomeLook {
  /** 커튼 틈 폭 (1 = 가느다란 한 줄) */
  sliver: number;
  /** 침대 위 윤슬: 'awake' 천장 보기, 'covered' 이불을 머리끝까지, null 비어 있음 */
  sleeper: 'awake' | 'covered' | null;
  blink: boolean;
  /** 뒤척임 (-1..1) */
  toss: number;
}

/** 탑다운 원룸. 왼쪽 침대, 오른쪽 아래 현관, 위쪽 닫힌 커튼. 바닥엔 빈 컵, 약통, 선식 봉지. */
export function drawHomeRoom(ctx: CanvasRenderingContext2D, look: HomeLook): void {
  // 벽
  rect(ctx, 0, 0, VIEW_W, VIEW_H, '#131419');
  // 바닥 장판
  rect(ctx, FLOOR.x, FLOOR.y, FLOOR.w, FLOOR.h, '#25272d');
  for (let y = FLOOR.y + 12; y < FLOOR.y + FLOOR.h; y += 12) rect(ctx, FLOOR.x, y, FLOOR.w, 1, '#212329');
  const rnd = seeded(42);
  for (let i = 0; i < 40; i += 1) rect(ctx, FLOOR.x + rnd() * FLOOR.w, FLOOR.y + rnd() * FLOOR.h, 1, 1, '#2b2d34');
  // 위쪽 벽 앞면 + 걸레받이
  rect(ctx, FLOOR.x, WALL_CAP, FLOOR.w, WALL_TOP - WALL_CAP, '#1a1c22');
  for (let x = FLOOR.x + 6; x < FLOOR.x + FLOOR.w; x += 12) rect(ctx, x, WALL_CAP + 2, 1, WALL_TOP - WALL_CAP - 8, '#1d1f26');
  rect(ctx, FLOOR.x, WALL_TOP - 5, FLOOR.w, 5, '#24262d');
  rect(ctx, FLOOR.x, FLOOR.y, FLOOR.w, 3, 'rgba(0,0,0,0.35)');
  // 바닥 테두리
  rect(ctx, FLOOR.x - 1, WALL_CAP - 1, FLOOR.w + 2, 1, '#2b2e36');
  rect(ctx, FLOOR.x - 1, WALL_CAP, 1, VIEW_H - WALL_CAP - 15, '#2b2e36');
  rect(ctx, FLOOR.x + FLOOR.w, WALL_CAP, 1, VIEW_H - WALL_CAP - 15, '#2b2e36');
  rect(ctx, FLOOR.x - 1, FLOOR.y + FLOOR.h, FLOOR.w + 2, 1, '#2b2e36');

  // 닫힌 커튼, 가운데 틈
  const cu = HOME.curtain;
  rect(ctx, cu.x - 4, WALL_CAP + 1, cu.w + 8, 1, '#3a3e48');
  rect(ctx, cu.x, WALL_CAP + 2, cu.w, WALL_TOP - WALL_CAP - 8, '#353844');
  for (let x = cu.x + 2; x < cu.x + cu.w; x += 4) rect(ctx, x, WALL_CAP + 2, 1, WALL_TOP - WALL_CAP - 8, '#2c2f39');
  const sw = Math.max(1, Math.round(look.sliver));
  rect(ctx, CX - Math.floor(sw / 2), WALL_CAP + 3, sw, WALL_TOP - WALL_CAP - 10, look.sliver > 1.5 ? '#e8d2a8' : '#b9c0cc');
  // 틈으로 들어온 빛줄기 (바닥)
  ctx.save();
  ctx.globalAlpha = 0.05 + look.sliver * 0.025;
  ctx.fillStyle = look.sliver > 1.5 ? '#f0d8a8' : '#c8d0dc';
  ctx.beginPath();
  ctx.moveTo(CX - sw, WALL_TOP);
  ctx.lineTo(CX + sw, WALL_TOP);
  ctx.lineTo(CX + 30 + sw * 6, FLOOR.y + 130);
  ctx.lineTo(CX + 10 - sw * 2, FLOOR.y + 130);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // 현관: 타일, 신발, 문
  const en = HOME.entrance;
  rect(ctx, en.x, en.y, en.w, en.h, '#1c1d22');
  for (let x = en.x; x < en.x + en.w; x += 10) rect(ctx, x, en.y, 1, en.h, '#222329');
  for (let y = en.y; y < en.y + en.h; y += 10) rect(ctx, en.x, y, en.w, 1, '#222329');
  rect(ctx, en.x, en.y, en.w, 2, '#30323a');
  rect(ctx, en.x + 12, en.y + 14, 6, 3, '#16171b');
  rect(ctx, en.x + 19, en.y + 15, 6, 3, '#16171b');
  rect(ctx, en.x + 13, en.y + 15, 1, 1, '#c9ccd3');
  rect(ctx, en.x + 20, en.y + 16, 1, 1, '#c9ccd3');
  const dr = HOME.door;
  rect(ctx, dr.x, FLOOR.y + FLOOR.h, dr.w, VIEW_H - FLOOR.y - FLOOR.h, '#2c2e35');
  rect(ctx, dr.x - 2, FLOOR.y + FLOOR.h, 2, VIEW_H - FLOOR.y - FLOOR.h, '#3a3d46');
  rect(ctx, dr.x + dr.w, FLOOR.y + FLOOR.h, 2, VIEW_H - FLOOR.y - FLOOR.h, '#3a3d46');
  rect(ctx, dr.x + dr.w - 8, FLOOR.y + FLOOR.h + 6, 3, 2, '#7d828c');

  // 바닥의 물건: 빈 컵, 약통, 선식 봉지
  ctx.drawImage(SPRITES.props.cup, HOME.bed.x + HOME.bed.w + 22, FLOOR.y + 120);
  ctx.drawImage(PILLS, HOME.bed.x + HOME.bed.w + 34, FLOOR.y + 128);
  ctx.drawImage(POUCH, HOME.bed.x + HOME.bed.w + 12, FLOOR.y + 136);

  drawBed(ctx, look);
}

function drawBed(ctx: CanvasRenderingContext2D, look: HomeLook): void {
  const b = HOME.bed;
  rect(ctx, b.x + 2, b.y + b.h, b.w, 3, 'rgba(0,0,0,0.35)');
  rect(ctx, b.x, b.y, b.w, b.h, '#33363e');
  rect(ctx, b.x + 3, b.y + 3, b.w - 6, b.h - 6, '#4b4f58');
  // 베개
  rect(ctx, b.x + 10, b.y + 8, b.w - 20, 18, '#7c808a');
  rect(ctx, b.x + 10, b.y + 22, b.w - 20, 4, '#6a6e78');
  const hx = b.x + b.w / 2 + look.toss * 2;
  const hy = b.y + 20;
  const blanketTop = look.sleeper === 'covered' ? b.y + 12 : b.y + 36;
  // 이불
  rect(ctx, b.x + 3, blanketTop, b.w - 6, b.y + b.h - 3 - blanketTop, '#3e4452');
  rect(ctx, b.x + 3, blanketTop, b.w - 6, 3, '#525968');
  for (let y = blanketTop + 14; y < b.y + b.h - 6; y += 16) rect(ctx, b.x + 8, y, b.w - 16, 1, '#363b48');
  if (!look.sleeper) return;
  // 이불 속 몸 (불룩)
  pixelEllipse(ctx, b.x + b.w / 2 + look.toss * 4, b.y + 74, 16, 34, '#454b5a');
  pixelEllipse(ctx, b.x + b.w / 2 + look.toss * 4 - 4, b.y + 70, 8, 22, '#4b5262');
  if (look.sleeper === 'covered') {
    // 이불 끝으로 머리카락만 조금
    rect(ctx, hx - 5, blanketTop - 2, 10, 2, '#0e0f12');
    return;
  }
  // 천장을 보는 얼굴 (위에서 본 머리)
  pixelEllipse(ctx, hx, hy - 3, 8, 6, '#0e0f12');
  pixelEllipse(ctx, hx, hy + 2, 6, 5, '#c0b0a2');
  rect(ctx, hx - 6, hy - 2, 5, 3, '#0e0f12'); // 한쪽 눈을 덮는 앞머리
  if (look.blink) {
    rect(ctx, hx + 1, hy + 2, 3, 1, '#8a7d72');
  } else {
    rect(ctx, hx + 2, hy + 1, 1, 2, '#1a1a1e');
  }
  rect(ctx, hx - 1, hy + 5, 3, 1, '#9e8f83');
}

/** 씬 8: 현관이 은은하게 빛난다 ("저기로 가면 된다") */
export function drawEntranceGlow(ctx: CanvasRenderingContext2D, t: number): void {
  const dr = HOME.door;
  const a = 0.25 + (Math.sin(t * 2.4) * 0.5 + 0.5) * 0.35;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = '#e8d2a8';
  ctx.fillRect(dr.x, FLOOR.y + FLOOR.h, dr.w, 2);
  ctx.globalAlpha = a * 0.6;
  ctx.fillRect(dr.x - 2, FLOOR.y + FLOOR.h - 4, dr.w + 4, 1);
  ctx.restore();
  putGlow(ctx, '#e8d2a8', dr.x + dr.w / 2, FLOOR.y + FLOOR.h, 34, a * 0.5);
}

/* ═══════════════ 텍스트 흐름 ═══════════════ */

interface Line {
  text: string;
  /** 세나 대사: 『』, 은색, 출력 2배 빠름, 표정 얼굴 */
  sena?: Expr;
  /** 이 줄이 시작되기 전 비워두는 시간 (연출이 들어가는 자리) */
  delay?: number;
}

interface Clock {
  /** 씬 시작부터 흐른 시간 */
  t: number;
  /** 현재 줄 번호 (모든 줄이 끝나면 lines.length) */
  li: number;
  /** 현재 줄이 시작된(대기 포함) 뒤 흐른 시간 */
  lt: number;
}

interface Scene {
  lines: readonly Line[];
  /** 마지막 줄 뒤 다음 씬까지 */
  post: number;
  draw: (ctx: CanvasRenderingContext2D, c: Clock) => void;
}

const CHAR_TIME = 0.05;
const HOLD_TIME = 1.5;

type Phase = 'delay' | 'typing' | 'hold' | 'post';

/* ═══════════════ 공용 ═══════════════ */

/** 계속 깔리는 어둡기. 디더로 덮으면 화면 전체가 망사처럼 보여서 이건 단색 반투명으로. */
function dim(ctx: CanvasRenderingContext2D, k: number, color = '#000000'): void {
  if (k <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, k);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.restore();
}

function letterbox(ctx: CanvasRenderingContext2D): void {
  rect(ctx, 0, 0, VIEW_W, LB + OY, '#000000');
  rect(ctx, 0, PIC_BOT + OY, VIEW_W, VIEW_H - PIC_BOT - OY, '#000000');
}

/** 윤슬을 발밑 기준으로. 손 위치를 돌려준다. */
function drawYun(ctx: CanvasRenderingContext2D, pose: YunseulPose, x: number, foot: number, flip: boolean): [number, number] {
  const w = pose.canvas.width;
  const dx = Math.round(flip ? x - (w - 1 - YUN_FOOT_X) : x - YUN_FOOT_X);
  const dy = Math.round(foot - YUN_H);
  blit(ctx, pose.canvas, dx, dy, flip);
  const hx = flip ? dx + (w - 1 - pose.hand[0]) : dx + pose.hand[0];
  return [hx, dy + pose.hand[1]];
}

/** 3×5 숫자 (알람시계 07:00) */
const DIGIT: Readonly<Record<string, readonly string[]>> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '7': ['###', '..#', '..#', '.#.', '.#.'],
};
function clockDigits(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  let cx = x;
  for (const ch of ['0', '7', ':', '0', '0']) {
    if (ch === ':') {
      rect(ctx, cx, y + 1, 1, 1, color);
      rect(ctx, cx, y + 3, 1, 1, color);
      cx += 2;
      continue;
    }
    const g = DIGIT[ch] ?? [];
    g.forEach((row, j) => {
      for (let i = 0; i < row.length; i += 1) if (row[i] === '#') rect(ctx, cx + i, y + j, 1, 1, color);
    });
    cx += 4;
  }
}

/** 은빛 반짝임: 십자 */
function sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, big: boolean, color = '#ffffff'): void {
  rect(ctx, x - 1, y, 3, 1, color);
  rect(ctx, x, y - 1, 1, 3, color);
  if (big) {
    rect(ctx, x - 3, y, 1, 1, color);
    rect(ctx, x + 3, y, 1, 1, color);
    rect(ctx, x, y - 3, 1, 1, color);
    rect(ctx, x, y + 3, 1, 1, color);
  }
}

/** 디더 후광 (반투명 대신 점) */
function halo(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, strength: number): void {
  ctx.fillStyle = color;
  const x0 = Math.round(x - r);
  const y0 = Math.round(y - r);
  for (let j = 0; j <= r * 2; j += 1) {
    for (let i = 0; i <= r * 2; i += 1) {
      const d = Math.hypot(i - r, j - r) / r;
      if (d < 1 && strength * (1 - d) * (1 - d) > bayer(x0 + i, y0 + j)) ctx.fillRect(x0 + i, y0 + j, 1, 1);
    }
  }
}

/** 땅에서 솟아오르는 그늘 (rise 0..1 만큼만 보인다) */
function drawRising(ctx: CanvasRenderingContext2D, spr: HTMLCanvasElement, x: number, foot: number, rise: number): void {
  if (rise <= 0) return;
  const h = Math.round(spr.height * Math.min(1, rise));
  if (h <= 0) return;
  ctx.drawImage(spr, 0, 0, spr.width, h, Math.round(x - spr.width / 2), Math.round(foot - h), spr.width, h);
}

/* ═══════════════ 오프닝 ═══════════════ */

interface Bit { x: number; y: number; vx: number; vy: number; life: number; c: string }

type Eyes = 'open' | 'shut' | 'covered' | 'empty';

export class Opening {
  private si = 0;
  private t = 0;
  private li = 0;
  private lt = 0;
  private phase: Phase = 'delay';
  private shown = 0;
  private holdT = 0;
  private postT = 0;
  private done = false;
  private bits: Bit[] = [];
  private shakeT = 0;
  private readonly scenes: readonly Scene[];
  private riseAt = -1;
  private readonly px = new PixelLayer();

  /* 미리 구운 배경 (무거운 건 그 씬에 처음 들어갈 때) */
  private readonly roomLit = buildRoom(1);
  private readonly roomDim = buildRoom(0.45);
  private pano: PanoLayers | null = null;
  private bridgeDawn: ReturnType<typeof buildBridge> | null = null;
  private bridgeVivid: ReturnType<typeof buildBridge> | null = null;
  private reedsDawn: HTMLCanvasElement | null = null;
  private reedsVivid: HTMLCanvasElement | null = null;
  private doorFrame: HTMLCanvasElement | null = null;
  private memories: HTMLCanvasElement[] = [];
  private readonly unseen = [makeShade(3, 40, 30, SHADE_UNSEEN), makeShade(8, 52, 36, SHADE_UNSEEN), makeShade(14, 34, 44, SHADE_UNSEEN)];
  private readonly indigo = [makeShade(5, 34, 30, SHADE_INDIGO), makeShade(9, 30, 28, SHADE_INDIGO), makeShade(12, 46, 38, SHADE_INDIGO), makeShade(17, 26, 34, SHADE_INDIGO)];

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly textEl: HTMLElement,
    private readonly onFace: (face: Expr | null) => void,
    private readonly onDone: () => void,
  ) {
    this.scenes = this.buildScenes();
    this.textEl.textContent = '';
    this.onFace(null);
  }

  get finished(): boolean {
    return this.done;
  }

  /** 개발용: 특정 씬의 특정 줄 시점으로 바로 간다 */
  jump(si: number, li: number, lt = 0, t = lt): void {
    this.si = Math.max(0, Math.min(this.scenes.length - 1, si));
    this.li = li;
    this.lt = lt;
    this.t = t;
    this.phase = 'delay';
    this.shown = 0;
    this.bits = [];
    this.px.clear();
  }

  /** 터치: 줄 즉시 완성 → 한 번 더: 다음 줄 */
  tap(): void {
    if (this.done) return;
    const line = this.scene.lines[this.li];
    if (this.phase === 'typing' && line) {
      this.shown = line.text.length;
      this.phase = 'hold';
      this.holdT = 0;
    } else if (this.phase === 'hold') {
      this.nextLine();
    } else if (this.phase === 'delay') {
      this.phase = 'typing';
      this.shown = 0;
    } else if (this.phase === 'post') {
      this.nextScene();
    }
    this.renderText();
  }

  skip(): void {
    if (this.done) return;
    this.finish();
  }

  private get scene(): Scene {
    const s = this.scenes[this.si] ?? this.scenes[this.scenes.length - 1];
    if (!s) throw new Error('no scenes');
    return s;
  }

  private finish(): void {
    this.done = true;
    this.textEl.textContent = '';
    this.textEl.classList.remove('is-sena');
    this.onFace(null);
    this.onDone();
  }

  private nextLine(): void {
    this.li += 1;
    this.lt = 0;
    this.shown = 0;
    if (this.li >= this.scene.lines.length) {
      this.phase = 'post';
      this.postT = 0;
    } else {
      this.phase = 'delay';
    }
  }

  private nextScene(): void {
    this.si += 1;
    if (this.si >= this.scenes.length) {
      this.finish();
      return;
    }
    this.t = 0;
    this.li = 0;
    this.lt = 0;
    this.shown = 0;
    this.phase = 'delay';
    this.bits = [];
    this.px.clear();
  }

  update(dt: number): void {
    if (this.done) return;
    this.t += dt;
    this.lt += dt;
    this.shakeT = Math.max(0, this.shakeT - dt);
    const line = this.scene.lines[this.li];
    switch (this.phase) {
      case 'delay':
        if (line && this.lt >= (line.delay ?? 0.4)) {
          this.phase = 'typing';
          this.shown = 0;
        }
        break;
      case 'typing':
        if (line) {
          this.shown += dt / (line.sena ? CHAR_TIME / 2 : CHAR_TIME);
          if (this.shown >= line.text.length) {
            this.shown = line.text.length;
            this.phase = 'hold';
            this.holdT = 0;
          }
        }
        break;
      case 'hold':
        this.holdT += dt;
        if (this.holdT >= HOLD_TIME) this.nextLine();
        break;
      case 'post':
        this.postT += dt;
        if (this.postT >= this.scene.post) this.nextScene();
        break;
    }
    for (const b of this.bits) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vy += 160 * dt;
      b.vx *= Math.exp(-3 * dt);
      b.life -= dt;
    }
    this.bits = this.bits.filter((b) => b.life > 0);
    this.px.update(dt, dt);
    this.renderText();
  }

  private renderText(): void {
    if (this.done) return;
    const line = this.scene.lines[this.li];
    const showing = line && (this.phase === 'typing' || this.phase === 'hold');
    if (!showing || !line) {
      if (this.textEl.textContent !== '') this.textEl.textContent = '';
      this.onFace(null);
      return;
    }
    const body = line.text.slice(0, Math.floor(this.shown));
    const text = line.sena ? `『${body}${this.phase === 'hold' ? '』' : ''}` : body;
    if (this.textEl.textContent !== text) this.textEl.textContent = text;
    this.textEl.classList.toggle('is-sena', !!line.sena);
    this.onFace(line.sena ?? null);
  }

  render(): void {
    if (this.done) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    rect(ctx, 0, 0, VIEW_W, VIEW_H, '#000000');
    ctx.translate(0, OY);
    if (this.shakeT > 0) ctx.translate(Math.round(rand(-2, 2)), Math.round(rand(-2, 2)));
    this.scene.draw(ctx, { t: this.t, li: this.li, lt: this.lt });
    for (const b of this.bits) {
      if (b.life < 0.3 && b.life * 3 < bayer(Math.round(b.x), Math.round(b.y))) continue;
      rect(ctx, b.x, b.y, 1, 1, b.c);
    }
    this.px.draw(ctx);
    ctx.restore();
    letterbox(ctx);
  }

  /** 그늘이 픽셀로 흩어진다 */
  private scatter(x: number, y: number, n: number): void {
    for (let i = 0; i < n; i += 1) {
      const a = rand(0, TAU);
      const v = rand(40, 160);
      const r = i % 4;
      this.bits.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 70, life: rand(0.4, 1.0),
        c: r === 0 ? '#7a5ee0' : r === 1 ? '#e8e2ff' : '#21154a',
      });
    }
    this.shakeT = 1 / 30;
  }

  /* ── 방 그리기 (씬 1·2·4) ── */

  private drawRoom(ctx: CanvasRenderingContext2D, t: number, lit: boolean, eyes: Eyes, toss: number, clock: boolean): void {
    ctx.drawImage(lit ? this.roomLit : this.roomDim, 0, 0);
    const H = ROOM.head;
    if (eyes === 'covered') {
      // 이불을 머리끝까지: 베개 위로 불룩한 이불 + 삐져나온 머리카락
      rect(ctx, H.x + 3, H.y + 2, 22, 10, '#2b3346');
      rect(ctx, H.x + 5, H.y, 19, 2, '#2b3346');
      rect(ctx, H.x + 5, H.y, 19, 1, '#3a4560');
      rect(ctx, H.x, H.y + 6, 4, 3, '#141319');
      rect(ctx, H.x + 1, H.y + 9, 3, 1, '#2b2a35');
    } else {
      if (eyes !== 'empty') ctx.drawImage(eyes === 'open' ? LYING.open : LYING.shut, Math.round(H.x + toss), H.y);
    }
    if (clock) this.drawClock(ctx, t);
  }

  /** 07:00. 1초 주기로 깜빡이는 앰버 (이 오프닝의 유일한 따뜻한 색) */
  private drawClock(ctx: CanvasRenderingContext2D, t: number): void {
    const on = t % 1 < 0.62;
    if (on) halo(ctx, ROOM.clock.x + 6, ROOM.clock.y + 4, 12, '#4a3420', 0.5);
    rect(ctx, ROOM.clock.x + 1, ROOM.clock.y + 2, 10, 5, '#0c0d10');
    clockDigits(ctx, ROOM.clock.x + 1, ROOM.clock.y + 2, on ? '#e0a458' : '#4a321c');
  }

  /** 씬 2 끝: 상체를 천천히 일으켜(6프레임) 침대 가장자리에 앉았다가 일어선다 */
  private drawRising(ctx: CanvasRenderingContext2D, t: number): void {
    if (this.riseAt < 0) this.riseAt = t;
    const k = clamp((t - this.riseAt) / RISE_TIME, 0, 1), step = Math.ceil(k * RISE_FRAMES) / RISE_FRAMES;
    const standing = t - this.riseAt > RISE_TIME + 2, spr = SPRITES.yunseul[0];
    this.drawRoom(ctx, t, true, 'empty', 0, true);
    dim(ctx, 0.25);
    ctx.save();
    ctx.translate(ROOM.head.x + 14, ROOM.head.y + (standing ? 26 : 22));
    ctx.rotate((1 - step) * Math.PI / 2);
    // 앉은 동안은 고개를 숙인다
    if (k >= 1 && !standing) ctx.scale(1, 0.86);
    ctx.drawImage(spr, -Math.round(spr.width / 2), -spr.height);
    ctx.restore();
  }

  /* ── 씬 구성 ── */

  private buildScenes(): readonly Scene[] {
    const blinkAt = (t: number): boolean => t % 2.4 < 0.14;
    const eyesAt = (t: number): Eyes => (blinkAt(t) ? 'shut' : 'open');

    /* 씬 1 · 알람: 어둠 속 숫자만 → 방이 아주 천천히 드러난다 */
    const s1: Scene = {
      lines: [{ text: '오늘도, 일어나기 싫은 아침.', delay: 1.8 }],
      post: 2.0,
      draw: (ctx, c) => {
        const reveal = c.li >= 1 ? 1 : clamp((c.t - 1.6) / 3.2, 0, 1);
        this.drawRoom(ctx, c.t, false, eyesAt(c.t), 0, false);
        dim(ctx, 1 - reveal * 0.5);
        this.drawClock(ctx, c.t);
      },
    };

    /* 씬 2 · 방: 넓게 → 이름이 뜨는 순간 얼굴 쪽 2배 클로즈업으로 컷 */
    const s2: Scene = {
      lines: [
        { text: '허윤슬, 24살.', delay: 3.4 },
        { text: '우울증 진단을 받고, 2년째 이 방에 있다.', delay: 0.6 },
        { text: '"으윽.."', delay: 0.8 },
      ],
      post: RISE_TIME + 2.4,
      draw: (ctx, c) => {
        if (c.li >= 2) { this.drawRising(ctx, c.t); return; }
        const close = c.li >= 1 || c.lt >= 1.6;
        // 두 번째 줄: 일어나려다 마는 뒤척임 (1px 갔다가 돌아온다)
        const toss = c.li === 0 && c.lt > 2 && c.lt < 3 ? 1 : 0;
        if (!close) {
          this.drawRoom(ctx, c.t, true, eyesAt(c.t), 0, true);
          dim(ctx, 0.4);
          return;
        }
        ctx.save();
        ctx.translate(VIEW_W / 2, 141);
        ctx.scale(2, 2);
        ctx.translate(-ROOM.head.x - 34, -ROOM.head.y);
        this.drawRoom(ctx, c.t, true, eyesAt(c.t), toss, true);
        ctx.restore();
        dim(ctx, 0.2);
      },
    };

    /* 씬 3 · 세계: 새벽의 잠실도를 옆으로 훑는다 */
    const s3: Scene = {
      lines: [
        { text: '전쟁 이후, 세계는 총과 화약을 버렸다.', delay: 1.4 },
        { text: '남은 건 칼과 활, 그리고 정령술뿐.', delay: 0.4 },
        { text: "물길이 바뀌어 섬이 된 이곳을, 사람들은 '잠실도'라 부른다.", delay: 0.4 },
      ],
      post: 1.0,
      draw: (ctx, c) => {
        if (!this.pano) this.pano = buildPanorama();
        const P = this.pano;
        const cam = easeInOut(clamp(c.t / 15, 0, 1)) * (WORLD_W - VIEW_W);
        ctx.drawImage(P.sky, 0, 0);
        // 물결: 수평선 아래 반사광이 천천히 흔들린다
        for (let i = 0; i < 46; i += 1) {
          const r = seeded(i * 7 + 3);
          const y = 152 + Math.floor(r() * 60);
          const x = (((r() * VIEW_W - cam * 0.8 + Math.sin(c.t * 0.9 + i) * 3) % VIEW_W) + VIEW_W) % VIEW_W;
          const near = y < 166;
          rect(ctx, x, y, 3 + Math.floor(r() * (near ? 10 : 5)), 1, near ? '#8a7064' : '#2c3446');
        }
        ctx.drawImage(P.far, -Math.round(cam * P.k.far), 0);
        ctx.drawImage(P.island, -Math.round(cam * P.k.island), 0);
        // 산책로의 사람들: 허리춤의 칼이 가끔 반짝
        const ox = -Math.round(cam * P.k.island);
        for (let i = 0; i < 7; i += 1) {
          const span = P.walk.x1 - P.walk.x0;
          const dir = i % 2 === 0 ? 1 : -1;
          const u = (((i * 0.137 + c.t * 0.012 * dir) % 1) + 1) % 1;
          const wx = P.walk.x0 + u * span + ox;
          if (wx < -4 || wx > VIEW_W + 4) continue;
          const wy = P.walk.y;
          const step = Math.floor(c.t * 4 + i) % 2;
          rect(ctx, wx, wy - 8, 3, 3, '#0a0c12');
          rect(ctx, wx, wy - 5, 3, 3, '#0d1018');
          rect(ctx, wx + step, wy - 2, 1, 2, '#0a0c12');
          rect(ctx, wx + 2 - step, wy - 2, 1, 2, '#0a0c12');
          if (i % 3 === 0 && Math.floor(c.t * 2 + i) % 3 === 0) rect(ctx, wx + (dir > 0 ? 3 : -1), wy - 4, 1, 1, '#dfe6f0');
          if (i === 4) rect(ctx, wx - 2, wy - 6, 2, 1, '#6a7488');
        }
        // "정령술": 강물에서 불·물·나무 빛이 떠오른다
        if (c.li === 1) {
          const pts: readonly [number, string, string][] = [[158, '#ff8a2a', '#8a3a1a'], [322, '#5eb0ff', '#1e4a7a'], [492, '#8fdc6a', '#2a5a2a']];
          pts.forEach(([x, col, deep], i) => {
            const k = clamp((c.lt - 0.4 - i * 0.35) / 2.6, 0, 1);
            if (k <= 0 || k >= 1) return;
            const y = Math.round(206 - easeOut(k) * 70);
            const fade = Math.sin(k * Math.PI);
            halo(ctx, x, y, 10, deep, fade * 0.9);
            for (let tr = 1; tr < 6; tr += 1) {
              if (fade > tr * 0.15) rect(ctx, x + Math.round(Math.sin(c.t * 5 + tr)), y + tr * 3, 1, 1, deep);
            }
            sparkle(ctx, x, y, Math.floor(c.t * 6 + i) % 2 === 0, col);
          });
        }
        ctx.drawImage(P.front, -Math.round(cam * P.k.front), 0);
        // 방 밖으로 빠져나오듯 어둠에서 녹아 나온다
        ditherFade(ctx, '#000000', 1 - easeOut(clamp(c.t / 1.4, 0, 1)));
      },
    };

    /* 씬 4 · 그늘: 침대 주변 바닥에서 검은 것들이 스며 오른다. 아무도 못 본다. */
    const s4: Scene = {
      lines: [
        { text: "오래된 상처는, 정령처럼 굳어 '그늘'이 된다.", delay: 1.2 },
        { text: '아무도 볼 수 없다.', delay: 0.4 },
        { text: '그저 이유 없이, 몸이 무거울 뿐.', delay: 0.4 },
      ],
      post: 1.4,
      draw: (ctx, c) => {
        const last = c.li >= 2;
        const pull = last ? clamp((c.lt - 0.8) / 0.5, 0, 1) : 0;
        this.drawRoom(ctx, c.t, false, pull >= 1 ? 'covered' : eyesAt(c.t), 0, true);
        const f = Math.floor(c.t * 5) % 4;
        const spots: readonly [number, number, number, number][] = [
          // 그늘 번호, x, 발밑, 나타나는 시각
          [0, 172, ROOM.floor + 6, 0.3], [1, 276, ROOM.floor + 14, 0.9], [2, 398, ROOM.floor + 4, 1.6], [0, 342, ROOM.floor + 24, 2.4],
        ];
        spots.forEach(([k, x, foot, at]) => {
          const spr = this.unseen[k]?.[f];
          if (!spr) return;
          const rise = clamp((c.t - at) / 2.2, 0, 1) * (0.75 + Math.sin(c.t * 1.3 + x) * 0.08);
          drawRising(ctx, spr, x, foot, rise);
        });
        // 윤슬 위로 드리운 무게: 이불 위에 낮게 깔린 먹이 점점 짙어진다
        const weight = clamp((c.t - 1) / 6, 0, 1) * 0.55 + (last ? 0.25 * clamp(c.lt / 1.2, 0, 1) : 0);
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(286, ROOM.bed.top - 4, 100, 18, 0, 0, TAU);
        ctx.clip();
        dim(ctx, weight * 0.8, '#05060a');
        ctx.restore();
        dim(ctx, 0.25 + (last ? 0.2 * clamp(c.lt / 1.5, 0, 1) : 0));
      },
    };

    /* 씬 5 · 만남: 올림픽대교 아래, 새벽 */
    const s5: Scene = {
      lines: [
        { text: '그날 아침, 다리 밑에서 버려진 무언가를 만났다.', delay: 3.6 },
        { text: '……아. 망했다.', sena: 'troubled', delay: 3.0 },
        { text: '하필이면, 제일 우울해 보이는 인간이랑 이어졌어.', sena: 'flat', delay: 0.3 },
      ],
      post: 1.2,
      draw: (ctx, c) => {
        if (!this.bridgeDawn) this.bridgeDawn = buildBridge(BRIDGE_DAWN);
        if (!this.reedsDawn) this.reedsDawn = buildReeds(BRIDGE_DAWN, 4);
        const B = this.bridgeDawn;
        ctx.drawImage(B.back, 0, 0);
        const foot = BR.foot;
        const senaX = 414;
        // 윤슬: 왼쪽에서 천천히 걸어 들어와 멈춘다
        const walkK = c.li === 0 ? clamp(c.lt / 3.4, 0, 1) : 1;
        const yx = Math.round(-16 + easeOut(walkK) * 370);
        const walking = walkK < 1;
        const legs = walking ? WALK[Math.floor((yx + 16) / 7) % WALK.length] ?? 'stand' : 'stand';
        const meet = c.li === 1 ? c.lt : c.li > 1 ? 99 : -1;
        const reach = clamp(meet / 1.0, 0, 1);
        const joined = meet >= 1.1;

        ctx.drawImage(this.reedsDawn, senaX - 38, foot - 38);
        if (!joined) {
          halo(ctx, senaX, foot - 11, 15, '#7e8698', 0.3);
          blit(ctx, SENA_CROUCH, senaX - 9, foot - SENA_CROUCH.height + 1);
          // 은빛 머리카락이 새벽빛에 반짝
          const tw = Math.floor(c.t * 2.5) % 3;
          if (tw === 0) sparkle(ctx, senaX - 2, foot - 19, true);
          else if (tw === 1) sparkle(ctx, senaX + 3, foot - 17, false, '#dfe6f0');
          if (reach > 0) {
            // 세나의 손이 올라온다
            rect(ctx, senaX - 11, foot - 9 - Math.round(reach * 5), 3, 2, '#f3ddcf');
            rect(ctx, senaX - 10, foot - 7 - Math.round(reach * 5), 2, 3, '#d9b6a6');
          }
        }
        const rimC = '#8f96a6';
        if (!joined) {
          drawYun(ctx, yunseul(legs, reach > 0 ? 'reach' : 'down', rimC), yx, foot, false);
        } else {
          // 손에 은빛 단검. 가끔 1px 꿈틀거린다.
          const [hx, hy] = drawYun(ctx, yunseul('stand', 'hold', rimC), yx, foot, false);
          const wig = Math.floor(c.t * 6) % 4 === 0 ? -1 : 0;
          halo(ctx, hx + 4, hy, 10, '#9aa3b8', 0.5);
          blit(ctx, DAGGER, hx - 3, hy - 1 + wig);
          if (Math.floor(c.t * 3) % 4 === 0) sparkle(ctx, hx + 7, hy - 1 + wig, false);
        }
        ctx.drawImage(B.front, 0, 0);
        // 손이 닿는 순간: 화면 전체 흰색 0.3초 → 디더로 빠진다
        if (meet >= 1.0 && meet < 1.3) ditherFade(ctx, '#ffffff', 1);
        else if (meet >= 1.3 && meet < 1.9) ditherFade(ctx, '#ffffff', 1 - (meet - 1.3) / 0.6);
        ditherFade(ctx, '#000000', 1 - easeOut(clamp(c.t / 1.2, 0, 1)));
      },
    };

    /* 씬 6 · 첫 대면: 색이 처음으로 선명해지고, 남보라 그늘들이 솟는다 */
    const shades: readonly { k: number; x: number; foot: number; at: number; dies: number }[] = [
      { k: 0, x: 404, foot: BR.foot + 2, at: 0.2, dies: 0.95 }, // 가까운 그늘 → 단검
      { k: 1, x: 248, foot: BR.foot, at: 0.5, dies: 1.5 }, // 몰려온 그늘 → 장검
      { k: 2, x: 286, foot: BR.foot + 4, at: 0.7, dies: 1.5 },
      { k: 3, x: 526, foot: BR.bank + 8, at: 1.0, dies: 2.6 }, // 멀리 → 활
    ];
    let fired: boolean[] = [];
    const s6: Scene = {
      lines: [
        { text: '보여? 저게 너 붙잡고 있던 거야.', sena: 'angry', delay: 2.4 },
        { text: '팔만 휘둘러. 나머진 내가 해.', sena: 'smile', delay: 3.4 },
      ],
      post: 1.2,
      draw: (ctx, c) => {
        if (c.t < 0.05) fired = [];
        if (!this.bridgeVivid) this.bridgeVivid = buildBridge(BRIDGE_VIVID);
        if (!this.reedsVivid) this.reedsVivid = buildReeds(BRIDGE_VIVID, 4);
        const B = this.bridgeVivid;
        ctx.drawImage(B.back, 0, 0);
        ctx.drawImage(this.reedsVivid, 376, BR.foot - 38);
        const foot = BR.foot;
        // 처음으로 그늘을 보고 한 걸음 물러선다
        const back = c.li === 0 ? easeOut(clamp((c.lt - 0.5) / 0.5, 0, 1)) : 1;
        const yx = 354 - Math.round(back * 16);
        const demo = c.li === 1 ? c.lt : c.li > 1 ? 99 : -1;
        let weapon: 'dagger' | 'sword' | 'bow' = 'dagger';
        if (demo >= 1.05 && demo < 2.0) weapon = 'sword';
        else if (demo >= 2.0) weapon = 'bow';

        const f = Math.floor(c.t * 6) % 4;
        shades.forEach((s) => {
          if (demo >= s.dies) return;
          const spr = this.indigo[s.k]?.[f];
          if (!spr) return;
          drawRising(ctx, spr, s.x, s.foot, easeOut(clamp((c.t - s.at) / 0.8, 0, 1)));
        });

        const rimC = '#f0a070';
        const facingLeft = weapon === 'sword' && demo < 1.7;
        const pose = yunseul(back > 0 && back < 1 ? 'pass' : 'stand', demo >= 0 ? 'hold' : 'down', rimC, facingLeft ? -1 : 1);
        const [hx, hy] = drawYun(ctx, pose, yx, foot, facingLeft);
        if (demo >= 0) {
          if (weapon === 'dagger') {
            const stab = demo >= 0.25 && demo < 0.9 ? (Math.floor(demo * 14) % 2) * 4 : 0;
            halo(ctx, hx + 6, hy, 9, '#6a5ab0', 0.5);
            blit(ctx, DAGGER, hx - 3 + stab, hy - 1);
          } else if (weapon === 'sword') {
            blit(ctx, SWORD, facingLeft ? hx - SWORD.width + 4 : hx - 4, hy - 2, facingLeft);
          } else {
            blit(ctx, BOW, hx - 1, hy - 9);
            const fly = clamp((demo - 2.15) / 0.4, 0, 1);
            const target = shades[3];
            if (fly > 0 && fly < 1 && target) {
              const ax = hx + 5 + (target.x - hx - 5) * fly;
              const ay = hy + (target.foot - 16 - hy) * fly;
              rect(ctx, ax - 10, ay, 10, 1, '#ffffff');
              rect(ctx, ax - 14, ay, 3, 1, '#9aa3c0');
            }
          }
        }
        // 타격: 이펙트 + 1프레임 흔들림 + 그늘이 픽셀로 흩어진다
        const once = (n: number, at: number, run: () => void): void => {
          if (demo >= at && !fired[n]) {
            fired[n] = true;
            run();
          }
        };
        once(0, 0.3, () => this.px.thrust(hx - 6, foot - 12, 0, 36));
        once(1, 0.95, () => {
          const s = shades[0];
          if (s) { this.px.hitSpark(s.x, s.foot, 26, 0); this.scatter(s.x, s.foot - 14, 34); }
        });
        once(2, 1.2, () => this.px.swordSlash(yx, foot - 12, Math.PI, 30));
        once(3, 1.5, () => {
          for (const i of [1, 2]) {
            const s = shades[i];
            if (s) { this.px.hitSpark(s.x, s.foot, 30, Math.PI); this.scatter(s.x, s.foot - 16, 30); }
          }
        });
        once(4, 2.6, () => {
          const s = shades[3];
          if (s) { this.px.crit(s.x, s.foot, 30, 0); this.scatter(s.x, s.foot - 16, 30); }
        });
        ctx.drawImage(B.front, 0, 0);
        // 새벽 회청색에서 선명한 색으로: 흰 번쩍임에서 풀린다
        ditherFade(ctx, '#ffffff', 1 - clamp(c.t / 0.7, 0, 1));
      },
    };

    /* 씬 7 · 목표: 문 네 개. 아래로 내려가며 하나씩 열린다. 마지막 문은 잠겨 있다. */
    const s7: Scene = {
      lines: [
        { text: '가장 최근의 상처부터, 가장 오래된 상처까지.', delay: 2.6 },
        { text: '이기는 게 아니다. 마주하는 것이다.', delay: 1.4 },
      ],
      post: 1.8,
      draw: (ctx, c) => this.drawDoors(ctx, c),
    };

    return [s1, s2, s3, s4, s5, s6, s7];
  }

  private drawDoors(ctx: CanvasRenderingContext2D, c: Clock): void {
    if (!this.doorFrame) this.doorFrame = buildDoorFrame();
    if (this.memories.length === 0) this.memories = [0, 1, 2, 3].map(buildMemory);
    const frame = this.doorFrame;
    rect(ctx, 0, 0, VIEW_W, VIEW_H, '#040406');
    const openAt = (i: number): number => 2.4 + i * 1.7;
    const camY = easeInOut(clamp((c.t - 2.0) / 7.6, 0, 1)) * DOOR.gap * 3;
    ctx.save();
    ctx.translate(0, -Math.round(camY));
    for (let i = 0; i < 4; i += 1) {
      const appear = clamp((c.t - i * 0.45) / 0.6, 0, 1);
      if (appear <= 0) continue;
      const x = Math.round(VIEW_W / 2 - DOOR.w / 2);
      const top = DOOR.top + i * DOOR.gap;
      ctx.drawImage(frame, x - 20, top - 3);
      const open = i < 3 ? easeOut(clamp((c.t - openAt(i)) / 0.8, 0, 1)) : 0;
      // 문 안쪽 기억 (열린 만큼만 보인다)
      const mem = this.memories[i];
      if (mem && open > 0) ctx.drawImage(mem, x, top);
      // 문짝: 왼쪽 경첩으로 안쪽으로 열린다 → 폭이 줄어든다
      const leaf = Math.max(3, Math.round(DOOR.w * (1 - open * 0.9)));
      rect(ctx, x, top, leaf, DOOR.h, '#191b22');
      if (leaf > 10) {
        rect(ctx, x + 4, top + 6, leaf - 8, 38, '#1e2029');
        rect(ctx, x + 4, top + 50, leaf - 8, 42, '#1e2029');
      }
      rect(ctx, x + leaf - 1, top, 1, DOOR.h, '#2c2f39');
      if (leaf > 14) rect(ctx, x + leaf - 9, top + 48, 3, 3, '#6b707a');
      if (open > 0) {
        // 열린 문에서 아래 계단으로 빛이 쏟아진다
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x + leaf, top + DOOR.h + 5);
        ctx.lineTo(x + DOOR.w, top + DOOR.h + 5);
        ctx.lineTo(x + DOOR.w + 26, top + DOOR.h + 64);
        ctx.lineTo(x + leaf - 26, top + DOOR.h + 64);
        ctx.closePath();
        ctx.clip();
        ditherFade(ctx, '#6a6458', 0.45 * open);
        ctx.restore();
      } else if (i < 3) {
        // 닫힌 문 아래 틈으로 새는 빛
        rect(ctx, x + 2, top + DOOR.h + 1, DOOR.w - 4, 1, '#3a3832');
      }
      if (i === 3) {
        // 잠긴 문: 사슬 X + 자물쇠. 열려는 순간 덜컹.
        const jolt = c.t > openAt(3) && c.t < openAt(3) + 0.5 ? (Math.floor(c.t * 30) % 2 === 0 ? 1 : -1) : 0;
        for (let k = 0; k < DOOR.w; k += 3) {
          const col = k % 6 === 0 ? '#5a5e68' : '#3c3f48';
          rect(ctx, x + k + jolt, top + 14 + Math.round(k * 1.1), 2, 2, col);
          rect(ctx, x + k + jolt, top + 14 + Math.round((DOOR.w - k) * 1.1), 2, 2, col);
        }
        const lx = x + DOOR.w / 2 - 5 + jolt;
        const ly = top + 44;
        rect(ctx, lx + 2, ly - 5, 6, 1, '#7d828c');
        rect(ctx, lx + 2, ly - 5, 1, 5, '#7d828c');
        rect(ctx, lx + 7, ly - 5, 1, 5, '#7d828c');
        rect(ctx, lx, ly, 10, 9, '#8a8f99');
        rect(ctx, lx, ly, 10, 1, '#b4b9c2');
        rect(ctx, lx + 4, ly + 3, 2, 3, '#1a1b20');
      }
      if (appear < 1) {
        // 등장: 어둠에서 디더로
        ctx.save();
        ctx.beginPath();
        ctx.rect(x - 24, top - 6, DOOR.w + 48, DOOR.h + 76);
        ctx.clip();
        ditherFade(ctx, '#040406', 1 - appear);
        ctx.restore();
      }
    }
    ctx.restore();
    // 위아래 가장자리를 어둠에 묻는다
    ditherFade(ctx, '#040406', 0.5, 0, PIC_TOP, VIEW_W, 20);
    ditherFade(ctx, '#040406', 0.5, 0, PIC_BOT - 20, VIEW_W, 20);
  }
}
