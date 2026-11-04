/**
 * 오프닝 전용 픽셀 도구.
 * 원칙: 한 화면 안의 모든 픽셀은 같은 크기(1배). 그라데이션·빛·투명은 반투명 대신 4×4 베이어 디더로.
 */

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;

/** (x, y) 칸의 디더 문턱값 0..1 */
export function bayer(x: number, y: number): number {
  return ((BAYER[((y & 3) << 2) | (x & 3)] ?? 0) + 0.5) / 16;
}

/** '#rrggbb' → ImageData용 32비트 (리틀 엔디안 ABGR) */
export function hex(c: string): number {
  const n = parseInt(c.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

export type Ramp = readonly number[];
export const ramp = (...colors: string[]): Ramp => colors.map(hex);

/** 램프 위 위치 p(0..1)의 색을 디더로 고른다 */
export function rampAt(r: Ramp, p: number, x: number, y: number): number {
  const n = r.length - 1;
  const f = Math.max(0, Math.min(1, p)) * n;
  const i = Math.min(n - 1, Math.floor(f));
  const frac = f - i;
  return (frac > bayer(x, y) ? r[i + 1] : r[i]) ?? 0;
}

export type PixFn = (x: number, y: number) => number | null;

/** 픽셀 단위로 그리는 오프스크린 화면. 정적인 배경을 한 번 굽는 데 쓴다. */
export class Pix {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly img: ImageData;
  readonly buf: Uint32Array;

  constructor(readonly w: number, readonly h: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
    this.img = ctx.createImageData(w, h);
    this.buf = new Uint32Array(this.img.data.buffer);
  }

  set(x: number, y: number, c: number): void {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h) return;
    this.buf[iy * this.w + ix] = c;
  }

  get(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h) return 0;
    return this.buf[iy * this.w + ix] ?? 0;
  }

  /** 영역 안의 각 칸에 fn(x, y)의 색을. null이면 그대로 둔다. */
  each(x0: number, y0: number, w: number, h: number, fn: PixFn): void {
    const xs = Math.max(0, Math.floor(x0));
    const ys = Math.max(0, Math.floor(y0));
    const xe = Math.min(this.w, Math.floor(x0 + w));
    const ye = Math.min(this.h, Math.floor(y0 + h));
    for (let y = ys; y < ye; y += 1) {
      for (let x = xs; x < xe; x += 1) {
        const c = fn(x, y);
        if (c !== null) this.buf[y * this.w + x] = c;
      }
    }
  }

  rect(x: number, y: number, w: number, h: number, c: number): void {
    this.each(x, y, w, h, () => c);
  }

  /** 디더 농도(0..1)로 점을 흩뿌린다 = 픽셀아트식 반투명 */
  dith(x: number, y: number, w: number, h: number, c: number, density: number): void {
    this.each(x, y, w, h, (px, py) => (density > bayer(px, py) ? c : null));
  }

  /** 세로 그라데이션 */
  vramp(x: number, y: number, w: number, h: number, r: Ramp): void {
    this.each(x, y, w, h, (px, py) => rampAt(r, (py - y) / Math.max(1, h - 1), px, py));
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: number, density = 1): void {
    this.each(cx - rx - 1, cy - ry - 1, rx * 2 + 3, ry * 2 + 3, (x, y) => {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy > 1) return null;
      return density >= 1 || density > bayer(x, y) ? c : null;
    });
  }

  /** 다각형 채우기 (짝홀 규칙). fn으로 칸마다 색을 바꿀 수 있다. */
  poly(pts: readonly (readonly [number, number])[], fill: number | PixFn): void {
    if (pts.length < 3) return;
    const ys = pts.map((p) => p[1]);
    const y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const y1 = Math.min(this.h - 1, Math.ceil(Math.max(...ys)));
    for (let y = y0; y <= y1; y += 1) {
      const sy = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i += 1) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if (!a || !b) continue;
        if ((a[1] <= sy && b[1] > sy) || (b[1] <= sy && a[1] > sy)) {
          xs.push(a[0] + ((sy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.round(xs[k] ?? 0));
        const xb = Math.min(this.w, Math.round(xs[k + 1] ?? 0));
        for (let x = xa; x < xb; x += 1) {
          const c = typeof fill === 'number' ? fill : fill(x, y);
          if (c !== null) this.buf[y * this.w + x] = c;
        }
      }
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, c: number): void {
    let x = Math.round(x0);
    let y = Math.round(y0);
    const xe = Math.round(x1);
    const ye = Math.round(y1);
    const dx = Math.abs(xe - x);
    const dy = -Math.abs(ye - y);
    const sx = x < xe ? 1 : -1;
    const sy = y < ye ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x, y, c);
      if (x === xe && y === ye) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
  }

  /** 스프라이트(캔버스)를 버퍼에 찍는다 */
  stamp(src: HTMLCanvasElement, x: number, y: number): void {
    const sctx = src.getContext('2d');
    if (!sctx) return;
    const d = new Uint32Array(sctx.getImageData(0, 0, src.width, src.height).data.buffer);
    for (let j = 0; j < src.height; j += 1) {
      for (let i = 0; i < src.width; i += 1) {
        const c = d[j * src.width + i] ?? 0;
        if (c >>> 24 > 0) this.set(x + i, y + j, c);
      }
    }
  }

  commit(): HTMLCanvasElement {
    this.ctx.putImageData(this.img, 0, 0);
    return this.canvas;
  }
}

/* ── 스프라이트 후처리: 외곽선, 림라이트 ── */

function readMask(src: HTMLCanvasElement): { d: Uint32Array; w: number; h: number } {
  const ctx = src.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  return { d: new Uint32Array(ctx.getImageData(0, 0, src.width, src.height).data.buffer.slice(0)), w: src.width, h: src.height };
}

/** 빛 쪽(dx, dy) 가장자리 픽셀을 밝은 색으로 */
export function rim(src: HTMLCanvasElement, color: string, dx: number, dy: number): HTMLCanvasElement {
  const { d, w, h } = readMask(src);
  const out = new Pix(w, h);
  const c = hex(color);
  const opaque = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && (d[y * w + x] ?? 0) >>> 24 > 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!opaque(x, y)) continue;
      out.set(x, y, opaque(x + dx, y + dy) ? (d[y * w + x] ?? 0) : c);
    }
  }
  return out.commit();
}

/** 1px 외곽선 (스프라이트가 사방 1px씩 커진다) */
export function outline(src: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const { d, w, h } = readMask(src);
  const out = new Pix(w + 2, h + 2);
  const c = hex(color);
  const opaque = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && (d[y * w + x] ?? 0) >>> 24 > 0;
  for (let y = -1; y <= h; y += 1) {
    for (let x = -1; x <= w; x += 1) {
      if (opaque(x, y)) out.set(x + 1, y + 1, d[y * w + x] ?? 0);
      else if (opaque(x - 1, y) || opaque(x + 1, y) || opaque(x, y - 1) || opaque(x, y + 1)) out.set(x + 1, y + 1, c);
    }
  }
  return out.commit();
}

/** 단색으로 칠한 사본 (실루엣) */
export function silhouette(src: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const { d, w, h } = readMask(src);
  const out = new Pix(w, h);
  const c = hex(color);
  for (let i = 0; i < w * h; i += 1) if ((d[i] ?? 0) >>> 24 > 0) out.buf[i] = c;
  return out.commit();
}

/* ── 화면 전체 효과 ── */

const fadeCache = new Map<string, CanvasPattern>();

/** 디더로 덮는 페이드. k = 0(안 덮음) .. 1(완전히 덮음) */
export function ditherFade(ctx: CanvasRenderingContext2D, color: string, k: number, x = 0, y = 0, w = ctx.canvas.width, h = ctx.canvas.height): void {
  const level = Math.round(Math.max(0, Math.min(1, k)) * 16);
  if (level <= 0) return;
  if (level >= 16) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    return;
  }
  const key = `${color}:${level}`;
  let pat = fadeCache.get(key);
  if (!pat) {
    const p = new Pix(4, 4);
    const c = hex(color);
    p.each(0, 0, 4, 4, (px, py) => (level / 16 > bayer(px, py) ? c : null));
    const made = ctx.createPattern(p.commit(), 'repeat');
    if (!made) return;
    pat = made;
    fadeCache.set(key, pat);
  }
  ctx.fillStyle = pat;
  ctx.fillRect(x, y, w, h);
}

/** 정수 좌표로만 그린다 */
export function blit(ctx: CanvasRenderingContext2D, src: CanvasImageSource & { width: number; height: number }, x: number, y: number, flip = false): void {
  const dx = Math.round(x);
  const dy = Math.round(y);
  if (!flip) {
    ctx.drawImage(src, dx, dy);
    return;
  }
  ctx.save();
  ctx.translate(dx + src.width, dy);
  ctx.scale(-1, 1);
  ctx.drawImage(src, 0, 0);
  ctx.restore();
}

export function px(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}
