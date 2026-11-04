/**
 * Aseprite 내보내기(PNG 시트 + JSON) 애니메이션 재생.
 *
 * Aseprite에서  File > Export Sprite Sheet  (또는 CLI `--sheet x.png --data x.json --list-tags --format json-array`)
 * 로 뽑은 파일을 public/anim/<id>.png / <id>.json 에 넣으면 그대로 쓴다.
 *  - frames[].duration (ms)  : 프레임 시간
 *  - meta.frameTags          : 태그 이름 = 동작 (idle, move, walk, attack, hurt, die, spawn, cast, play, loop)
 *  - meta.slices "pivot"     : 발밑(또는 중심) 기준점. 없으면 셀 아래 가운데.
 * scripts/build-anims.cjs 가 같은 형식으로 기본 시트를 만든다. 정식 Aseprite 시트는 같은 id로 덮어쓰면 된다.
 */
import { tint, type Sprite } from './sprites';

export interface AnimFrame { x: number; y: number; w: number; h: number; duration: number }
export interface AnimTag { name: string; from: number; to: number; direction: 'forward' | 'reverse' | 'pingpong' }

interface AsepriteFrame { filename?: string; frame: { x: number; y: number; w: number; h: number }; duration: number }
interface AsepriteJson {
  frames: AsepriteFrame[] | Record<string, AsepriteFrame>;
  meta: {
    frameTags?: { name: string; from: number; to: number; direction?: string }[];
    slices?: { name: string; keys: { bounds: { x: number; y: number; w: number; h: number }; pivot?: { x: number; y: number } }[] }[];
  };
}

/** 한 번 재생하고 마지막 프레임에 머무는 태그. 나머지(idle/move/walk/loop)는 반복. */
const LOOPING = new Set(['idle', 'move', 'walk', 'loop', 'float']);

export interface DrawOptions { flip?: boolean; sx?: number; sy?: number; alpha?: number; tint?: string }

export class AnimSheet {
  readonly cellW: number;
  readonly cellH: number;
  constructor(
    readonly id: string,
    readonly image: Sprite,
    readonly frames: readonly AnimFrame[],
    private readonly tags: ReadonlyMap<string, AnimTag>,
    readonly pivot: { x: number; y: number },
  ) {
    this.cellW = frames[0]?.w ?? image.width;
    this.cellH = frames[0]?.h ?? image.height;
  }

  has(tag: string): boolean { return this.tags.has(tag); }

  /** 태그 전체 길이 (초) */
  length(tag: string): number {
    const t = this.tags.get(tag);
    if (!t) return 0;
    let ms = 0;
    for (let i = t.from; i <= t.to; i += 1) ms += this.frames[i]?.duration ?? 100;
    return ms / 1000;
  }

  /** 시작한 지 t초 뒤의 프레임. 반복 태그가 아니면 끝에서 멈춘다. */
  at(tag: string, t: number): { frame: AnimFrame; done: boolean } | null {
    const def = this.tags.get(tag);
    if (!def) return null;
    const order: number[] = [];
    for (let i = def.from; i <= def.to; i += 1) order.push(i);
    if (def.direction === 'reverse') order.reverse();
    else if (def.direction === 'pingpong' && order.length > 2) order.push(...order.slice(1, -1).reverse());
    let total = 0;
    for (const i of order) total += this.frames[i]?.duration ?? 100;
    if (total <= 0) return null;
    const ms = Math.max(0, t) * 1000, loop = LOOPING.has(tag);
    const done = !loop && ms >= total;
    let rest = loop ? ms % total : Math.min(ms, total - 0.001);
    for (const i of order) {
      const d = this.frames[i]?.duration ?? 100;
      if (rest < d) { const frame = this.frames[i]; return frame ? { frame, done } : null; }
      rest -= d;
    }
    const last = this.frames[order[order.length - 1] ?? 0];
    return last ? { frame: last, done } : null;
  }

  /** 진행도 k(0..1)로 프레임 고르기: 소멸·등장처럼 다른 타이머에 맞춰야 할 때 */
  atProgress(tag: string, k: number): { frame: AnimFrame; done: boolean } | null {
    const len = this.length(tag);
    return len > 0 ? this.at(tag, Math.min(0.9999, Math.max(0, k)) * len) : null;
  }

  /** 기준점(x, y)에 프레임을 그린다. 기준점은 시트의 pivot. */
  draw(ctx: CanvasRenderingContext2D, frame: AnimFrame, x: number, y: number, o: DrawOptions = {}): void {
    const sx = o.sx ?? 1, sy = o.sy ?? 1;
    const w = Math.max(1, Math.round(frame.w * sx)), h = Math.max(1, Math.round(frame.h * sy));
    const px = Math.round(this.pivot.x * sx), py = Math.round(this.pivot.y * sy);
    const dx = Math.round(x) - px, dy = Math.round(y) - py;
    const src = o.tint ? tint(this.image, o.tint) : this.image;
    ctx.save();
    if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
    if (o.flip) {
      // 기준점 x를 축으로 좌우 반전
      ctx.translate(Math.round(x), 0);
      ctx.scale(-1, 1);
      ctx.drawImage(src, frame.x, frame.y, frame.w, frame.h, -px, dy, w, h);
    } else {
      ctx.drawImage(src, frame.x, frame.y, frame.w, frame.h, dx, dy, w, h);
    }
    ctx.restore();
  }
}

export const ANIMS = new Map<string, AnimSheet>();

function parse(id: string, json: AsepriteJson, image: Sprite): AnimSheet {
  const rawFrames = Array.isArray(json.frames) ? json.frames : Object.values(json.frames);
  const frames: AnimFrame[] = rawFrames.map(f => ({ x: f.frame.x, y: f.frame.y, w: f.frame.w, h: f.frame.h, duration: f.duration || 100 }));
  const tags = new Map<string, AnimTag>();
  for (const t of json.meta.frameTags ?? []) {
    tags.set(t.name, { name: t.name, from: t.from, to: t.to, direction: t.direction === 'reverse' || t.direction === 'pingpong' ? t.direction : 'forward' });
  }
  if (tags.size === 0 && frames.length > 0) tags.set('idle', { name: 'idle', from: 0, to: frames.length - 1, direction: 'forward' });
  const slice = json.meta.slices?.find(s => s.name === 'pivot') ?? json.meta.slices?.[0];
  const key = slice?.keys[0];
  const first = frames[0];
  const pivot = key
    ? { x: key.bounds.x + (key.pivot?.x ?? key.bounds.w / 2), y: key.bounds.y + (key.pivot?.y ?? key.bounds.h) }
    : { x: (first?.w ?? image.width) / 2, y: first?.h ?? image.height };
  return new AnimSheet(id, image, frames, tags, pivot);
}

async function loadOne(id: string): Promise<void> {
  const [json, image] = await Promise.all([
    fetch(`/anim/${id}.json`).then(r => (r.ok ? (r.json() as Promise<AsepriteJson>) : Promise.reject(new Error(id)))),
    (async () => {
      const img = new Image();
      img.src = `/anim/${id}.png`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      c.getContext('2d')?.drawImage(img, 0, 0);
      return c;
    })(),
  ]);
  ANIMS.set(id, parse(id, json, image));
}

/** public/anim/index.json 에 적힌 시트를 전부 읽는다. 없거나 실패한 시트는 건너뛴다 (정지 그림으로 대체). */
export async function loadAnims(): Promise<void> {
  try {
    const res = await fetch('/anim/index.json');
    if (!res.ok) return;
    const { ids } = (await res.json()) as { ids: string[] };
    await Promise.all(ids.map(id => loadOne(id).catch(() => undefined)));
  } catch { /* 시트 없이도 게임은 돌아간다 */ }
}
