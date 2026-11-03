import { COLOR, FLOOR, VIEW_H, VIEW_W } from './config';
import { TAU, rand } from './math';
import { glow } from './sprites';

/* ── 픽셀 단위 그리기 도구 ── */

export function plot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
}

export function pixelLine(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number, x1: number, y1: number,
  color: string,
): void {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const tx = Math.round(x1);
  const ty = Math.round(y1);
  const dx = Math.abs(tx - x);
  const dy = -Math.abs(ty - y);
  const sx = x < tx ? 1 : -1;
  const sy = y < ty ? 1 : -1;
  let err = dx + dy;
  ctx.fillStyle = color;
  for (let guard = 0; guard < 1024; guard += 1) {
    ctx.fillRect(x, y, 1, 1);
    if (x === tx && y === ty) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

export function pixelArc(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  a0: number, a1: number,
  thickness: number, color: string,
): void {
  const steps = Math.max(4, Math.ceil(Math.abs(a1 - a0) * r * 1.6));
  ctx.fillStyle = color;
  for (let i = 0; i <= steps; i += 1) {
    const a = a0 + ((a1 - a0) * i) / steps;
    const c = Math.cos(a);
    const s = Math.sin(a);
    for (let k = 0; k < thickness; k += 1) {
      ctx.fillRect(Math.round(cx + c * (r - k)), Math.round(cy + s * (r - k)), 1, 1);
    }
  }
}

export function pixelEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, rx: number, ry: number,
  color: string,
): void {
  if (rx < 0.5 || ry < 0.5) return;
  ctx.fillStyle = color;
  const ryi = Math.max(1, Math.round(ry));
  for (let dy = -ryi + 1; dy < ryi; dy += 1) {
    const half = Math.round(rx * Math.sqrt(1 - (dy / ryi) ** 2));
    ctx.fillRect(Math.round(cx) - half, Math.round(cy) + dy, half * 2, 1);
  }
}

/* ── 3×5 숫자 ── */
const DIGITS: readonly string[] = [
  '111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001',
  '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111',
];

/** 오른쪽 끝(xRight)에 맞춰 숫자를 그린다. 그려진 왼쪽 끝 x를 반환. */
export function drawDigits(ctx: CanvasRenderingContext2D, n: number, xRight: number, y: number, color: string, scale = 1): number {
  const text = String(Math.max(0, Math.floor(n)));
  const left = xRight - (text.length * 4 - 1) * scale;
  ctx.fillStyle = color;
  for (let i = 0; i < text.length; i += 1) {
    const glyph = DIGITS[Number(text.charAt(i))] ?? '';
    for (let p = 0; p < 15; p += 1) {
      if (glyph.charAt(p) === '1') {
        ctx.fillRect(left + (i * 4 + (p % 3)) * scale, y + Math.floor(p / 3) * scale, scale, scale);
      }
    }
  }
  return left;
}

/* ── 효과 ── */

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number;
  color: string; size: number; drag: number; grav: number;
  glow: boolean;
}

/** 베기·타격 섬광은 pixelfx로 옮겼다. 여기엔 보스 울림·형태 변화의 고리만 남긴다. */
type SlashKind = 'ring';

interface Slash {
  kind: SlashKind;
  x: number; y: number; angle: number; range: number; arc: number; side: number;
  life: number; max: number;
}

interface Number_ { x: number; y: number; vy: number; value: number; life: number }
interface Mote { x: number; y: number; vx: number; vy: number; phase: number; size: number }
interface ClickMark { x: number; y: number; life: number }

export interface BurstOptions {
  spread?: number;
  speed?: number;
  size?: number;
  life?: number;
  drag?: number;
  grav?: number;
  glow?: boolean;
}

export class Fx {
  private particles: Particle[] = [];
  private slashes: Slash[] = [];
  private numbers: Number_[] = [];
  private motes: Mote[] = [];
  private clickMark: ClickMark | null = null;
  private shakeAmp = 0;

  /** 화면 전체 섬광 (0..1) */
  flashAmt = 0;
  /** 집중선: 남은 시간과 중심 */
  private speed = { life: 0, max: 0, x: 0, y: 0, seed: 0 };

  constructor() {
    this.seedMotes();
  }

  clear(): void {
    this.particles = [];
    this.slashes = [];
    this.numbers = [];
    this.clickMark = null;
    this.shakeAmp = 0;
    this.flashAmt = 0;
    this.speed.life = 0;
  }

  /** 방 안을 떠다니는 먼지. 오래 닫혀 있던 방의 공기. */
  private seedMotes(): void {
    this.motes = [];
    for (let i = 0; i < 34; i += 1) {
      this.motes.push({
        x: rand(FLOOR.x, FLOOR.x + FLOOR.w),
        y: rand(0, VIEW_H),
        vx: rand(-3, 3),
        vy: rand(-5, -1.5),
        phase: rand(0, TAU),
        size: Math.random() < 0.2 ? 2 : 1,
      });
    }
  }

  shake(amp: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
  }

  shakeOffset(): [number, number] {
    if (this.shakeAmp < 0.3) return [0, 0];
    return [Math.round(rand(-1, 1) * this.shakeAmp), Math.round(rand(-1, 1) * this.shakeAmp)];
  }

  burst(x: number, y: number, angle: number, count: number, colors: readonly string[], o: BurstOptions = {}): void {
    const spread = o.spread ?? TAU;
    const speed = o.speed ?? 80;
    for (let i = 0; i < count; i += 1) {
      const a = angle + rand(-spread / 2, spread / 2);
      const v = speed * rand(0.4, 1);
      const life = (o.life ?? 0.35) * rand(0.6, 1);
      this.particles.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life, max: life,
        color: colors[i % colors.length] ?? COLOR.pale,
        size: o.size ?? 1, drag: o.drag ?? 7, grav: o.grav ?? 0,
        glow: o.glow ?? false,
      });
    }
  }

  /** 퍼져 나가는 고리 (보스의 울림, 형태 변화) */
  ring(x: number, y: number, range: number, life: number): void {
    this.slashes.push({ kind: 'ring', x, y, angle: 0, range, arc: 0, side: 1, life, max: life });
  }

  number(x: number, y: number, value: number): void {
    this.numbers.push({ x: x + rand(-3, 3), y, vy: -50, value, life: 0.6 });
  }

  /** 피니시: 흰 섬광 + 집중선 */
  finisher(x: number, y: number, flash: number, duration: number): void {
    this.flashAmt = Math.max(this.flashAmt, flash);
    this.speed = { life: duration, max: duration, x, y, seed: Math.random() * 1000 };
  }

  click(x: number, y: number): void {
    this.clickMark = { x, y, life: 0.4 };
  }

  updateShake(dt: number): void {
    this.shakeAmp *= Math.exp(-dt * 14);
    this.flashAmt *= Math.exp(-dt * 7);
    if (this.flashAmt < 0.01) this.flashAmt = 0;
    this.speed.life = Math.max(0, this.speed.life - dt);
  }

  update(dt: number): void {
    for (const p of this.particles) {
      const f = Math.exp(-p.drag * dt);
      p.vx *= f;
      p.vy = p.vy * f + p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const s of this.slashes) s.life -= dt;
    this.slashes = this.slashes.filter((s) => s.life > 0);
    for (const n of this.numbers) {
      n.y += n.vy * dt;
      n.vy *= Math.exp(-6 * dt);
      n.life -= dt;
    }
    this.numbers = this.numbers.filter((n) => n.life > 0);
    for (const m of this.motes) {
      m.phase += dt;
      m.x += (m.vx + Math.sin(m.phase * 0.7) * 3) * dt;
      m.y += m.vy * dt;
      if (m.y < -2) {
        m.y = VIEW_H + 2;
        m.x = rand(FLOOR.x, FLOOR.x + FLOOR.w);
      }
    }
    if (this.clickMark) {
      this.clickMark.life -= dt;
      if (this.clickMark.life <= 0) this.clickMark = null;
    }
  }

  drawGround(ctx: CanvasRenderingContext2D): void {
    const m = this.clickMark;
    if (!m) return;
    const k = m.life / 0.4;
    const r = Math.round(2 + k * 4);
    ctx.globalAlpha = k * 0.8;
    pixelArc(ctx, m.x, m.y, r, 0, TAU, 1, COLOR.pale);
    ctx.globalAlpha = 1;
  }

  /** 먼지는 조명 위, 효과 아래 */
  drawMotes(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = COLOR.pale;
    for (const m of this.motes) {
      ctx.globalAlpha = 0.08 + (Math.sin(m.phase * 2) * 0.5 + 0.5) * 0.14;
      ctx.fillRect(Math.round(m.x), Math.round(m.y), m.size, m.size);
    }
    ctx.globalAlpha = 1;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const s of this.slashes) this.drawSlash(ctx, s);

    for (const p of this.particles) {
      ctx.globalAlpha = Math.min(1, (p.life / p.max) * 1.6);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    ctx.globalAlpha = 1;

    for (const n of this.numbers) {
      ctx.globalAlpha = Math.min(1, n.life / 0.2);
      drawDigits(ctx, n.value, Math.round(n.x) + 4, Math.round(n.y) + 1, COLOR.ink);
      drawDigits(ctx, n.value, Math.round(n.x) + 3, Math.round(n.y), COLOR.white);
    }
    ctx.globalAlpha = 1;
  }

  /** 가산 합성 패스: 빛나는 입자 */
  drawGlow(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      if (!p.glow) continue;
      const g = glow(COLOR.senaGlow, 6);
      ctx.globalAlpha = (p.life / p.max) * 0.5;
      ctx.drawImage(g, Math.round(p.x - 6), Math.round(p.y - 6));
    }
    ctx.globalAlpha = 1;
  }

  /** 화면 전체 오버레이: 집중선과 섬광 */
  drawOverlay(ctx: CanvasRenderingContext2D): void {
    const sp = this.speed;
    if (sp.life > 0) {
      const k = sp.life / sp.max;
      const lines = 46;
      ctx.fillStyle = COLOR.white;
      ctx.globalAlpha = Math.min(1, k * 1.6) * 0.85;
      for (let i = 0; i < lines; i += 1) {
        // 프레임마다 조금씩 흔들리는 방사선
        const a = ((i + Math.sin(sp.seed + i * 13.7) * 0.4) / lines) * TAU + Math.random() * 0.03;
        const inner = 70 + Math.abs(Math.sin(sp.seed * 3 + i * 7.1)) * 70 + (1 - k) * 40;
        const outer = 340;
        const w = 0.006 + Math.abs(Math.sin(i * 5.3 + sp.seed)) * 0.012;
        ctx.beginPath();
        ctx.moveTo(sp.x + Math.cos(a) * inner, sp.y + Math.sin(a) * inner);
        ctx.lineTo(sp.x + Math.cos(a - w) * outer, sp.y + Math.sin(a - w) * outer);
        ctx.lineTo(sp.x + Math.cos(a + w) * outer, sp.y + Math.sin(a + w) * outer);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (this.flashAmt > 0) {
      ctx.globalAlpha = Math.min(1, this.flashAmt);
      ctx.fillStyle = COLOR.white;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.globalAlpha = 1;
    }
  }

  private drawSlash(ctx: CanvasRenderingContext2D, s: Slash): void {
    const prog = 1 - s.life / s.max;
    const r = 4 + prog * s.range;
    ctx.globalAlpha = (1 - prog) * 0.9;
    ctx.strokeStyle = COLOR.pale;
    ctx.lineWidth = Math.max(1, 3 * (1 - prog));
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, r, r * 0.75, 0, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
