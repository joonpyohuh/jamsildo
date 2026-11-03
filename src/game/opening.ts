/**
 * 오프닝 (씬 1~7). 사운드 없음.
 * 화면은 전부 코드로 그린 도트. 텍스트는 DOM(#cineText)에 한 글자씩.
 * 색 흐름: 씬 1~4 회청색 → 씬 5 세나의 은빛 → 씬 6 처음으로 선명한 색.
 *
 * 씬 8(윤슬의 방)은 실제로 걸어다니는 게임 방이라 game.ts에서 drawHomeRoom()을 쓴다.
 */
import { CX, FLOOR, VIEW_H, VIEW_W, WALL_CAP, WALL_TOP } from './config';
import { TAU, clamp, easeInOut, easeOut, rand, seeded } from './math';
import { pixelEllipse, pixelLine, plot } from './fx';
import { SPRITES, fromRows, glow, tint, type Sprite } from './sprites';

/* ═══════════════ 텍스트 흐름 ═══════════════ */

interface Line {
  text: string;
  /** 세나 대사: 『』, 은색, 출력 2배 빠름 */
  sena?: boolean;
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

/* ═══════════════ 공용 그리기 ═══════════════ */

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string): void {
  ctx.fillStyle = c;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** 게임 스프라이트를 정수배로 키워 그린다 (발밑 기준) */
function blitScaled(ctx: CanvasRenderingContext2D, spr: Sprite, x: number, footY: number, k: number, flip = false, alpha = 1): void {
  const w = spr.width * k;
  const h = spr.height * k;
  const dx = Math.round(x - w / 2);
  const dy = Math.round(footY - h);
  ctx.save();
  ctx.globalAlpha = alpha;
  if (flip) {
    ctx.translate(dx + w, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(spr, 0, 0, w, h);
  } else {
    ctx.drawImage(spr, dx, dy, w, h);
  }
  ctx.restore();
}

function vignette(ctx: CanvasRenderingContext2D, strength: number): void {
  const g = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.3, VIEW_W / 2, VIEW_H / 2, VIEW_W * 0.62);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
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

/* ═══════════════ 씬 3: 잠실도 전경 ═══════════════ */

const WORLD_W = 920;
const WORLD_H = 420;
const ISLAND = { x: 470, y: 215, rx: 230, ry: 135 } as const;

function drawWorld(ctx: CanvasRenderingContext2D, c: Clock, spirits: boolean): void {
  const camX = easeInOut(clamp(c.t / 13, 0, 1)) * (WORLD_W - VIEW_W);
  const camY = 70 + Math.sin(c.t * 0.3) * 6;
  ctx.save();
  ctx.translate(-Math.round(camX), -Math.round(camY));

  // 한강
  rect(ctx, 0, 0, WORLD_W, WORLD_H, '#1b2230');
  ctx.fillStyle = '#232c3d';
  for (let i = 0; i < 90; i += 1) {
    const r = seeded(i * 13);
    const x = (r() * WORLD_W + c.t * 6) % WORLD_W;
    const y = r() * WORLD_H;
    ctx.fillRect(Math.round(x), Math.round(y), 4 + Math.round(r() * 6), 1);
  }
  // 섬
  pixelEllipse(ctx, ISLAND.x, ISLAND.y + 4, ISLAND.rx + 4, ISLAND.ry + 4, '#3a3f45');
  pixelEllipse(ctx, ISLAND.x, ISLAND.y, ISLAND.rx, ISLAND.ry, '#2c3136');
  // 동네: 낮은 건물들
  const rb = seeded(7);
  for (let i = 0; i < 70; i += 1) {
    const a = rb() * TAU;
    const d = Math.sqrt(rb()) * 0.78;
    const x = ISLAND.x + Math.cos(a) * ISLAND.rx * d;
    const y = ISLAND.y + Math.sin(a) * ISLAND.ry * d;
    const w = 6 + Math.round(rb() * 12);
    const h = 5 + Math.round(rb() * 9);
    rect(ctx, x + 2, y + 2, w, h, '#22262b');
    rect(ctx, x, y, w, h, rb() < 0.3 ? '#454a52' : '#3b4047');
    if (rb() < 0.4) rect(ctx, x + 1, y + 1, 1, 1, '#6a6f78');
  }
  // 섬을 두르는 산책로
  ctx.fillStyle = '#5a6068';
  for (let i = 0; i < 900; i += 1) {
    const a = (i / 900) * TAU;
    ctx.fillRect(Math.round(ISLAND.x + Math.cos(a) * (ISLAND.rx - 12)), Math.round(ISLAND.y + Math.sin(a) * (ISLAND.ry - 10)), 2, 1);
  }
  // 끊어진 다리: 교각과 끊긴 상판
  for (let i = 0; i < 8; i += 1) {
    const x = ISLAND.x - 150 - i * 34;
    const y = ISLAND.y - 120 - i * 14;
    rect(ctx, x, y, 6, 6, '#4a4f57');
    rect(ctx, x + 1, y + 6, 4, 2, '#2a3040');
    if (i !== 3 && i !== 4) rect(ctx, x - 14, y - 4, 32, 4, '#565c66');
  }
  for (let i = 0; i < 6; i += 1) {
    const x = ISLAND.x + 170 + i * 36;
    const y = ISLAND.y + 100 + i * 12;
    rect(ctx, x, y, 6, 6, '#4a4f57');
    if (i !== 2) rect(ctx, x - 14, y - 4, 32, 4, '#565c66');
  }
  // 산책로의 행인들: 허리에 단검, 한 명은 손목에 석궁
  const walkers = [0.2, 2.1, 4.4];
  walkers.forEach((base, i) => {
    const a = base + c.t * 0.035 * (i % 2 === 0 ? 1 : -1);
    const x = ISLAND.x + Math.cos(a) * (ISLAND.rx - 12);
    const y = ISLAND.y + Math.sin(a) * (ISLAND.ry - 10);
    const step = Math.floor(c.t * 4 + i) % 2;
    rect(ctx, x - 1, y - 7, 3, 2, '#0e0f12');
    rect(ctx, x - 1, y - 5, 3, 3, i === 1 ? '#5a5f6a' : '#4a4f5a');
    rect(ctx, x - 1 + step, y - 2, 1, 2, '#2c2f36');
    rect(ctx, x + 1 - step, y - 2, 1, 2, '#2c2f36');
    rect(ctx, x + 2, y - 3, 1, 2, '#c9ccd3');
    if (i === 2) rect(ctx, x - 3, y - 5, 2, 1, '#9aa0aa');
  });
  ctx.restore();

  // "정령술": 강물 위로 불·물·나무 빛이 잠깐 반짝
  if (spirits) {
    const k = clamp(c.lt - 0.6, 0, 2.4);
    const a = k <= 0 ? 0 : Math.sin((k / 2.4) * Math.PI);
    const pts: readonly [number, number, string][] = [[118, 60, '#ff8a2a'], [252, 236, '#5eb0ff'], [398, 52, '#8fdc6a']];
    pts.forEach(([x, y, col], i) => {
      const tw = a * (0.7 + 0.3 * Math.sin(c.t * 9 + i * 2));
      if (tw <= 0.02) return;
      putGlow(ctx, col, x, y, 14, tw * 0.7);
      ctx.globalAlpha = tw;
      rect(ctx, x - 1, y - 1, 3, 3, col);
      rect(ctx, x, y - 3, 1, 7, col);
      rect(ctx, x - 3, y, 7, 1, col);
      ctx.globalAlpha = 1;
    });
  }
  vignette(ctx, 0.5);
}

/* ═══════════════ 씬 5·6: 올림픽대교 아래 ═══════════════ */

const SENA_CROUCH = fromRows([
  '....wwwww.....',
  '...wwwwwww....',
  '..wwWwwwWww...',
  '..wwssssWw....',
  '..wWskskWw....',
  '...wsssW......',
  '..dddddddd....',
  '.dddddddddd...',
  'ddDddddddddD..',
  'dddDdddddddds.',
  '.dddddddddDd..',
  '..DDDD..DDD...',
], { w: '#eef0f3', W: '#c3c9d4', s: '#e6d4c6', k: '#9a8f88', d: '#f2f4f8', D: '#c7ccd6' });

interface Bridge {
  /** 0 = 새벽 회청색, 1 = 첫 대면의 선명한 색 */
  vivid: number;
}

function drawBridge(ctx: CanvasRenderingContext2D, t: number, b: Bridge): void {
  const v = b.vivid;
  const mix = (a: string, c: string): string => (v > 0.5 ? c : a);
  rect(ctx, 0, 0, VIEW_W, VIEW_H, mix('#151820', '#120f22'));
  // 새벽빛 (오른쪽에서)
  const g = ctx.createLinearGradient(VIEW_W, 0, 160, 0);
  g.addColorStop(0, v > 0.5 ? 'rgba(232,160,110,0.35)' : 'rgba(120,135,160,0.28)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, 210);
  // 다리 상판 아랫면과 보
  rect(ctx, 0, 0, VIEW_W, 46, mix('#2a2e38', '#2a2440'));
  for (let x = 10; x < VIEW_W; x += 40) rect(ctx, x, 0, 6, 46, mix('#232631', '#211c36'));
  rect(ctx, 0, 46, VIEW_W, 2, mix('#3a3f4b', '#4a3f6a'));
  // 교각
  for (const px of [90, 360]) {
    rect(ctx, px, 48, 28, 120, mix('#30343f', '#2c2846'));
    rect(ctx, px, 48, 4, 120, mix('#3b404c', '#3a3460'));
    rect(ctx, px + 24, 48, 4, 120, mix('#262a33', '#221e38'));
  }
  // 풀숲
  rect(ctx, 0, 150, VIEW_W, 70, mix('#253029', '#1b3a33'));
  const rg = seeded(3);
  for (let i = 0; i < 160; i += 1) {
    const x = rg() * VIEW_W;
    const y = 150 + rg() * 66;
    const sway = Math.round(Math.sin(t * 2 + x * 0.1));
    rect(ctx, x + sway, y - 3, 1, 3, mix('#2f3c33', '#2a5a48'));
  }
  // 강
  rect(ctx, 0, 218, VIEW_W, 52, mix('#1a2232', '#1c2a52'));
  ctx.fillStyle = mix('#2a3448', '#3a5a9a');
  for (let i = 0; i < 40; i += 1) {
    const r = seeded(i * 31);
    const x = (r() * VIEW_W + t * 10) % VIEW_W;
    ctx.fillRect(Math.round(x), Math.round(222 + r() * 44), 5 + Math.round(r() * 8), 1);
  }
}

/** 풀숲 덤불 (세나가 쓰러져 있던 자리) */
function drawBush(ctx: CanvasRenderingContext2D, x: number, y: number, vivid: boolean): void {
  pixelEllipse(ctx, x - 14, y - 4, 14, 8, vivid ? '#1f4a3a' : '#2a372e');
  pixelEllipse(ctx, x + 12, y - 5, 15, 9, vivid ? '#24523f' : '#2e3c32');
  pixelEllipse(ctx, x, y - 9, 12, 9, vivid ? '#2a5c47' : '#334236');
}

/* ═══════════════ 그늘 (씬 4·6) ═══════════════ */

interface Bit { x: number; y: number; vx: number; vy: number; life: number; c: string }

/** 씬 6의 진한 남보라 그늘: 잉크 몸 + 남보라 테두리 */
function drawIndigoShade(ctx: CanvasRenderingContext2D, spr: Sprite, x: number, foot: number, k: number, rise: number): void {
  if (rise <= 0) return;
  const rim = tint(spr, '#6a52d0');
  const body = tint(spr, '#24184d');
  pixelEllipse(ctx, x, foot, spr.width * k * 0.5 * rise, 3, 'rgba(60,40,140,0.45)');
  for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
    blitScaled(ctx, rim, x + ox * k, foot + oy * k - (1 - rise) * 0, k, false, rise);
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, VIEW_W, foot);
  ctx.clip();
  blitScaled(ctx, body, x, foot + (1 - rise) * spr.height * k, k, false, 1);
  blitScaled(ctx, spr, x, foot + (1 - rise) * spr.height * k, k, false, 0.35);
  ctx.restore();
}

/* ═══════════════ 씬 7: 문 네 개 ═══════════════ */

function drawDoorScene(ctx: CanvasRenderingContext2D, c: Clock): void {
  rect(ctx, 0, 0, VIEW_W, VIEW_H, '#050506');
  const spacing = 150;
  // 카메라: 열린 문을 따라 아래로
  const openAt = (i: number): number => 2.4 + i * 1.6;
  let focus = 0;
  for (let i = 0; i < 4; i += 1) if (c.t > openAt(i) - 0.6) focus = i;
  const camY = easeInOut(clamp((c.t - 2.0) / 7.2, 0, 1)) * spacing * 3 - 10;
  ctx.save();
  ctx.translate(0, -Math.round(Math.min(camY, focus * spacing + 10)));

  for (let i = 0; i < 4; i += 1) {
    const appear = clamp((c.t - i * 0.45) / 0.5, 0, 1);
    if (appear <= 0) continue;
    const cx = VIEW_W / 2;
    const top = 60 + i * spacing;
    const w = 74;
    const h = 104;
    const x = cx - w / 2;
    ctx.globalAlpha = appear;
    // 내려가는 계단 선
    if (i > 0) for (let s = 0; s < 6; s += 1) rect(ctx, cx - 20 + s * 2, top - 44 + s * 7, 40 - s * 4, 1, '#1a1b20');
    // 문 안쪽: 실루엣
    rect(ctx, x, top, w, h, '#0c0c10');
    drawSilhouette(ctx, i, x, top, w, h);
    // 문짝: 열리면 안쪽으로 접힌다. 4번 문은 잠긴 채.
    const open = i < 3 ? easeOut(clamp((c.t - openAt(i)) / 0.7, 0, 1)) : 0;
    const leaf = Math.round(w * (1 - open * 0.86));
    rect(ctx, x, top, leaf, h, '#26272e');
    rect(ctx, x + leaf - 2, top, 2, h, '#33343c');
    rect(ctx, x + leaf - 10, top + h / 2, 3, 3, '#6b707a');
    if (open < 1) {
      // 문 틈 사이로 새는 빛 (실루엣이 비친다)
      rect(ctx, x + leaf, top, 1, h, '#4a4c56');
    }
    if (i === 3) {
      // 자물쇠
      const lx = x + w - 16;
      const ly = top + h / 2 - 4;
      const shake = c.t > openAt(3) ? Math.round(Math.sin(c.t * 40) * (c.t < openAt(3) + 0.4 ? 1 : 0)) : 0;
      rect(ctx, lx + shake, ly, 7, 6, '#7d828c');
      rect(ctx, lx + 1 + shake, ly - 3, 5, 3, '#5a5f69');
      rect(ctx, lx + 2 + shake, ly - 2, 3, 2, '#0c0c10');
    }
    // 문틀
    rect(ctx, x - 3, top - 3, w + 6, 3, '#3a3c44');
    rect(ctx, x - 3, top, 3, h, '#3a3c44');
    rect(ctx, x + w, top, 3, h, '#3a3c44');
    // 번호
    rect(ctx, cx - 1, top - 10, 3, 3, i === 3 ? '#4a4c56' : '#8a8f99');
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/** 문마다 비치는 장면 (회색 선 실루엣) */
function drawSilhouette(ctx: CanvasRenderingContext2D, i: number, x: number, y: number, w: number, _h: number): void {
  const c = '#3a3c46';
  const d = '#24252c';
  switch (i) {
    case 0: // 침대와 이불
      rect(ctx, x + 12, y + 50, w - 24, 34, c);
      rect(ctx, x + 14, y + 52, w - 28, 8, '#4a4c56');
      rect(ctx, x + 14, y + 62, w - 28, 20, d);
      rect(ctx, x + 12, y + 84, 3, 10, c);
      rect(ctx, x + w - 15, y + 84, 3, 10, c);
      break;
    case 1: // 캠퍼스 건물과 금 간 거울
      rect(ctx, x + 8, y + 26, 28, 60, c);
      for (let r = 0; r < 5; r += 1) for (let k = 0; k < 3; k += 1) rect(ctx, x + 11 + k * 8, y + 30 + r * 11, 4, 5, d);
      pixelEllipse(ctx, x + 54, y + 52, 10, 16, c);
      pixelEllipse(ctx, x + 54, y + 52, 8, 14, '#0c0c10');
      pixelLine(ctx, x + 50, y + 40, x + 56, y + 52, c);
      pixelLine(ctx, x + 56, y + 52, x + 52, y + 64, c);
      pixelLine(ctx, x + 56, y + 52, x + 60, y + 58, c);
      break;
    case 2: // 교실 책상들
      for (let r = 0; r < 3; r += 1) {
        for (let k = 0; k < 3; k += 1) {
          rect(ctx, x + 8 + k * 21, y + 34 + r * 22, 15, 8, c);
          rect(ctx, x + 10 + k * 21, y + 42 + r * 22, 2, 5, d);
          rect(ctx, x + 19 + k * 21, y + 42 + r * 22, 2, 5, d);
        }
      }
      break;
    case 3: // 식탁과 작은 아이 그림자
      rect(ctx, x + 10, y + 56, w - 20, 8, c);
      rect(ctx, x + 12, y + 64, 3, 16, d);
      rect(ctx, x + w - 15, y + 64, 3, 16, d);
      for (let k = 0; k < 3; k += 1) rect(ctx, x + 14 + k * 18, y + 46, 8, 10, d);
      pixelEllipse(ctx, x + 54, y + 80, 3, 3, '#1b1c22');
      rect(ctx, x + 51, y + 83, 7, 10, '#1b1c22');
      break;
  }
}

/* ═══════════════ 오프닝 ═══════════════ */

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

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly textEl: HTMLElement,
    private readonly onDone: () => void,
  ) {
    this.scenes = this.buildScenes();
    this.textEl.textContent = '';
  }

  get finished(): boolean {
    return this.done;
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
    this.renderText();
  }

  private renderText(): void {
    if (this.done) return;
    const line = this.scene.lines[this.li];
    const showing = line && (this.phase === 'typing' || this.phase === 'hold');
    if (!showing || !line) {
      if (this.textEl.textContent !== '') this.textEl.textContent = '';
      return;
    }
    const body = line.text.slice(0, Math.floor(this.shown));
    const text = line.sena ? `『${body}${this.phase === 'hold' ? '』' : ''}` : body;
    if (this.textEl.textContent !== text) this.textEl.textContent = text;
    this.textEl.classList.toggle('is-sena', !!line.sena);
  }

  render(): void {
    if (this.done) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    if (this.shakeT > 0) ctx.translate(Math.round(rand(-2, 2)), Math.round(rand(-2, 2)));
    this.scene.draw(ctx, { t: this.t, li: this.li, lt: this.lt });
    for (const b of this.bits) {
      ctx.globalAlpha = Math.min(1, b.life * 2);
      rect(ctx, b.x, b.y, 2, 2, b.c);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /** 그늘이 픽셀로 흩어진다 */
  private scatter(x: number, y: number, n: number): void {
    for (let i = 0; i < n; i += 1) {
      const a = rand(0, TAU);
      const v = rand(40, 150);
      this.bits.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: rand(0.4, 0.9), c: i % 3 === 0 ? '#6a52d0' : '#24184d' });
    }
    this.shakeT = 1 / 30;
  }

  /* ── 씬 구성 ── */

  private buildScenes(): readonly Scene[] {
    const blinkAt = (t: number): boolean => t % 2 < 0.12;

    /* 씬 1 · 알람 */
    const s1: Scene = {
      lines: [{ text: '오늘도, 일어나기 싫은 아침.', delay: 1.6 }],
      post: 2.2,
      draw: (ctx, c) => {
        rect(ctx, 0, 0, VIEW_W, VIEW_H, '#000000');
        if (c.li >= 1) {
          // 검정에서 아주 천천히 밝아지다가, 어둑한 채로 멈춘다
          const k = clamp(c.lt / 2, 0, 1) * 0.55;
          ctx.globalAlpha = k;
          drawHomeRoom(ctx, { sliver: 1, sleeper: 'awake', blink: false, toss: 0 });
          ctx.globalAlpha = 1;
        }
      },
    };

    /* 씬 2 · 방 */
    const s2: Scene = {
      lines: [
        { text: '허윤슬, 24살.', delay: 1.4 },
        { text: '우울증 진단을 받고, 2년째 이 방에 있다.', delay: 0.6 },
      ],
      post: 1.0,
      draw: (ctx, c) => {
        // 침대 쪽으로 아주 천천히 줌인
        const z = 1 + easeInOut(clamp(c.t / 10, 0, 1)) * 0.35;
        const fx = HOME.bed.x + HOME.bed.w / 2;
        const fy = HOME.bed.y + 40;
        // "일어나려다 마는" 뒤척임: 두 번째 줄 동안 한 번
        const toss = c.li === 1 ? Math.sin(clamp((c.lt - 1.2) / 1.2, 0, 1) * Math.PI) : 0;
        ctx.save();
        ctx.translate(fx, fy);
        ctx.scale(z, z);
        ctx.translate(-fx, -fy);
        ctx.globalAlpha = 0.55;
        rect(ctx, 0, 0, VIEW_W, VIEW_H, '#000');
        drawHomeRoom(ctx, { sliver: 1, sleeper: 'awake', blink: blinkAt(c.t), toss });
        ctx.restore();
        ctx.globalAlpha = 0.45;
        rect(ctx, 0, 0, VIEW_W, VIEW_H, '#05060a');
        ctx.globalAlpha = 1;
        vignette(ctx, 0.5);
      },
    };

    /* 씬 3 · 세계 */
    const s3: Scene = {
      lines: [
        { text: '전쟁 이후, 세계는 총과 화약을 버렸다.', delay: 1.2 },
        { text: '남은 건 칼과 활, 그리고 정령술뿐.', delay: 0.4 },
        { text: "물길이 바뀌어 섬이 된 이곳을, 사람들은 '잠실도'라 부른다.", delay: 0.4 },
      ],
      post: 1.0,
      draw: (ctx, c) => {
        drawWorld(ctx, c, c.li === 1);
        // 방 창문을 통과하듯 위로 빠져나가는 첫 1초
        if (c.t < 1) {
          ctx.globalAlpha = 1 - easeOut(c.t);
          rect(ctx, 0, 0, VIEW_W, VIEW_H, '#0b0c10');
          ctx.globalAlpha = 1;
        }
      },
    };

    /* 씬 4 · 그늘 */
    const s4: Scene = {
      lines: [
        { text: "오래된 상처는, 정령처럼 굳어 '그늘'이 된다.", delay: 1.0 },
        { text: '아무도 볼 수 없다.', delay: 0.4 },
        { text: '그저 이유 없이, 몸이 무거울 뿐.', delay: 0.4 },
      ],
      post: 1.2,
      draw: (ctx, c) => {
        const last = c.li >= 2;
        const pull = last ? clamp((c.lt - 0.8) / 0.8, 0, 1) : 0;
        drawHomeRoom(ctx, { sliver: 1, sleeper: pull >= 1 ? 'covered' : 'awake', blink: blinkAt(c.t), toss: 0 });
        // 침대 주변 바닥의 검은 얼룩들 (반투명하게 꿈틀)
        const b = HOME.bed;
        const blobs: readonly [number, number, number][] = [
          [b.x + b.w + 10, b.y + 30, 12], [b.x + b.w + 6, b.y + 92, 16], [b.x + 40, b.y + b.h + 12, 18],
          [b.x + b.w + 30, b.y + b.h - 6, 10], [b.x + 10, b.y + b.h + 20, 9],
        ];
        blobs.forEach(([x, y, r], i) => {
          const wob = Math.sin(c.t * 1.6 + i * 1.3);
          ctx.globalAlpha = 0.5 + wob * 0.1;
          pixelEllipse(ctx, x + wob * 1.5, y, r + wob, r * 0.55, '#07080b');
          pixelEllipse(ctx, x + wob * 1.5, y - 1, r * 0.6, r * 0.3, '#0e1015');
        });
        // 윤슬 위로 늘어진 그림자 하나
        const dark = 0.42 + (last ? 0.3 * clamp(c.lt / 1.2, 0, 1) : 0);
        ctx.globalAlpha = dark + Math.sin(c.t * 1.1) * 0.04;
        pixelEllipse(ctx, b.x + b.w / 2, b.y + 60 + Math.sin(c.t) * 2, 30, 46, '#07080b');
        pixelEllipse(ctx, b.x + b.w / 2 + 14, b.y + 30, 8, 5, '#07080b');
        ctx.globalAlpha = 1;
        ctx.globalAlpha = 0.45;
        rect(ctx, 0, 0, VIEW_W, VIEW_H, '#05060a');
        ctx.globalAlpha = 1;
        vignette(ctx, 0.75);
      },
    };

    /* 씬 5 · 만남 */
    const s5: Scene = {
      lines: [
        { text: '그날 아침, 다리 밑에서 버려진 무언가를 만났다.', delay: 3.4 },
        { text: '……아. 망했다.', sena: true, delay: 3.0 },
        { text: '하필이면, 제일 우울해 보이는 인간이랑 이어졌어.', sena: true, delay: 0.3 },
      ],
      post: 1.0,
      draw: (ctx, c) => {
        drawBridge(ctx, c.t, { vivid: 0 });
        const foot = 196;
        const senaX = 318;
        // 윤슬: 느리게 걸어 들어와 멈춘다
        const walkK = c.li === 0 ? clamp(c.lt / 3.2, 0, 1) : 1;
        const yx = -20 + easeOut(walkK) * 290;
        const walking = walkK < 1;
        const frame = walking ? (Math.floor(c.t * 5) % 4) as 0 | 1 | 2 | 3 : 0;
        // 손을 잡는 순간 (두 번째 줄 대기 시간)
        const meet = c.li === 1 ? c.lt : c.li > 1 ? 99 : -1;
        const reach = clamp(meet / 1.0, 0, 1);
        const joined = meet >= 1.1;

        drawBush(ctx, senaX, foot + 2, false);
        if (!joined) {
          blitScaled(ctx, SENA_CROUCH, senaX, foot - 2, 2, true);
          // 은빛 머리카락: 2프레임 반짝임
          if (Math.floor(c.t * 3) % 2 === 0) {
            plot(ctx, senaX + 4, foot - 22, '#ffffff');
            plot(ctx, senaX + 6, foot - 24, '#ffffff');
            putGlow(ctx, '#e8eef8', senaX, foot - 18, 18, 0.25);
          }
          if (reach > 0) {
            // 세나의 손이 올라온다
            rect(ctx, senaX - 14, foot - 10 - reach * 6, 4, 2, '#e6d4c6');
          }
        }
        blitScaled(ctx, SPRITES.yunseul[frame], yx, foot, 2);
        if (reach > 0 && !joined) {
          // 윤슬이 손을 내민다
          const hx = yx + 10;
          const hy = foot - 18;
          pixelLine(ctx, hx, hy, hx + reach * 22, hy - reach * 2, '#d2b8a0');
          pixelLine(ctx, hx, hy + 1, hx + reach * 22, hy - reach * 2 + 1, '#a88c76');
        }
        if (joined) {
          // 손에 은빛 단검. 살짝 꿈틀거린다.
          const wig = Math.sin(c.t * 7) * 0.12;
          const hx = yx + 8;
          const hy = foot - 18;
          const a = -0.5 + wig;
          pixelLine(ctx, hx, hy, hx + Math.cos(a) * 16, hy + Math.sin(a) * 16, '#eef0f3');
          pixelLine(ctx, hx + 1, hy + 1, hx + Math.cos(a) * 14 + 1, hy + Math.sin(a) * 14 + 1, '#9aa0aa');
          putGlow(ctx, '#e8eef8', hx + 6, hy - 4, 14, 0.4);
        }
        // 손을 잡는 순간 화면 전체가 흰색으로 0.3초
        if (meet >= 1.0 && meet < 1.3) {
          ctx.globalAlpha = 1 - (meet - 1.0) / 0.3 * 0.2;
          rect(ctx, 0, 0, VIEW_W, VIEW_H, '#ffffff');
          ctx.globalAlpha = 1;
        } else if (meet >= 1.3 && meet < 1.8) {
          ctx.globalAlpha = 0.8 * (1 - (meet - 1.3) / 0.5);
          rect(ctx, 0, 0, VIEW_W, VIEW_H, '#ffffff');
          ctx.globalAlpha = 1;
        }
        vignette(ctx, 0.45);
      },
    };

    /* 씬 6 · 첫 대면 */
    const shades: readonly { spr: Sprite; x: number; foot: number; k: number; at: number; dies: number }[] = [
      { spr: SPRITES.bother, x: 330, foot: 200, k: 2, at: 0.2, dies: 0.95 }, // 가까운 그늘 → 단검
      { spr: SPRITES.bother, x: 150, foot: 192, k: 2, at: 0.5, dies: 1.45 }, // 몰려온 그늘 → 장검
      { spr: SPRITES.heavy, x: 196, foot: 206, k: 2, at: 0.7, dies: 1.45 },
      { spr: SPRITES.gloom, x: 430, foot: 150, k: 2, at: 1.0, dies: 2.55 }, // 멀리 → 활
    ];
    let demoFired = [false, false, false];
    const s6: Scene = {
      lines: [
        { text: '보여? 저게 너 붙잡고 있던 거야.', sena: true, delay: 2.4 },
        { text: '팔만 휘둘러. 나머진 내가 해.', sena: true, delay: 3.2 },
      ],
      post: 1.2,
      draw: (ctx, c) => {
        if (c.t < 0.05) demoFired = [false, false, false];
        drawBridge(ctx, c.t, { vivid: 1 });
        const foot = 196;
        // 처음으로 그늘을 보고 뒤로 물러선다
        const back = c.li === 0 ? easeOut(clamp((c.lt - 0.4) / 0.6, 0, 1)) : 1;
        const yx = 270 - back * 22;
        const demo = c.li === 1 ? c.lt : c.li > 1 ? 99 : -1;

        // 데모 컷의 무기
        let weapon: 'dagger' | 'sword' | 'bow' = 'dagger';
        if (demo >= 1.0 && demo < 2.0) weapon = 'sword';
        else if (demo >= 2.0) weapon = 'bow';

        shades.forEach((s) => {
          const rise = clamp((c.t - s.at) / 0.7, 0, 1);
          const dead = demo >= s.dies;
          if (!dead) drawIndigoShade(ctx, s.spr, s.x, s.foot, s.k, rise);
        });

        blitScaled(ctx, SPRITES.yunseul[0], yx, foot, 2, back > 0 && demo < 0);
        const hx = yx + 8;
        const hy = foot - 18;
        // 세나: 밝은 은빛
        if (weapon === 'dagger') {
          const stab = demo >= 0.2 && demo < 0.95 ? Math.abs(Math.sin(demo * 26)) * 10 : 0;
          pixelLine(ctx, hx, hy, hx + 12 + stab, hy, '#ffffff');
          pixelLine(ctx, hx, hy + 1, hx + 10 + stab, hy + 1, '#aab2c0');
          if (stab > 0) {
            pixelLine(ctx, hx + 18 + stab, hy - 6, hx + 40, hy - 2, '#ffffff');
            pixelLine(ctx, hx + 18 + stab, hy + 6, hx + 40, hy + 2, '#dfe6f0');
          }
        } else if (weapon === 'sword') {
          const k = clamp((demo - 1.05) / 0.35, 0, 1);
          const a = -Math.PI * 0.8 + k * Math.PI * 2.1;
          pixelLine(ctx, yx, hy, yx + Math.cos(a) * 30, hy + Math.sin(a) * 20, '#ffffff');
          if (k > 0 && k < 1) {
            ctx.strokeStyle = 'rgba(238,240,243,0.85)';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.ellipse(yx, hy + 4, 46, 26, 0, a - 1.6, a);
            ctx.stroke();
            putGlow(ctx, '#e8eef8', yx, hy, 50, 0.35 * (1 - k));
          }
        } else {
          // 활
          pixelLine(ctx, hx + 4, hy - 9, hx + 9, hy, '#ffffff');
          pixelLine(ctx, hx + 9, hy, hx + 4, hy + 9, '#ffffff');
          pixelLine(ctx, hx + 4, hy - 9, hx + 4, hy + 9, '#aab2c0');
          const fly = clamp((demo - 2.15) / 0.35, 0, 1);
          if (fly > 0 && fly < 1) {
            const target = shades[3];
            if (target) {
              const tx = target.x;
              const ty = target.foot - 20;
              const ax = hx + (tx - hx) * fly;
              const ay = hy + (ty - hy) * fly;
              pixelLine(ctx, ax - 12, ay + 2, ax, ay, '#ffffff');
            }
          }
        }

        // 각 타격: 1프레임 흔들림 + 그늘이 픽셀로 흩어진다
        const hits: readonly [number, number[]][] = [[0.95, [0]], [1.45, [1, 2]], [2.55, [3]]];
        hits.forEach(([at, idx], h) => {
          if (demo >= at && !demoFired[h]) {
            demoFired[h] = true;
            for (const i of idx) {
              const s = shades[i];
              if (s) this.scatter(s.x, s.foot - s.spr.height, 26);
            }
          }
        });
        vignette(ctx, 0.35);
      },
    };

    /* 씬 7 · 목표 */
    const s7: Scene = {
      lines: [
        { text: '가장 최근의 상처부터, 가장 오래된 상처까지.', delay: 2.6 },
        { text: '이기는 게 아니다. 마주하는 것이다.', delay: 1.4 },
      ],
      post: 1.6,
      draw: (ctx, c) => drawDoorScene(ctx, c),
    };

    return [s1, s2, s3, s4, s5, s6, s7];
  }
}
