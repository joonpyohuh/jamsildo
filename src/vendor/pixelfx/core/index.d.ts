// jamsildo가 쓰는 pixelfx core API의 타입 선언 (원본은 JS).

export interface PxFrame {
  w: number;
  h: number;
  ox: number;
  oy: number;
  color: Uint32Array;
  light: Uint32Array;
}

export interface PxMeta {
  name: string;
  size: [number, number];
  origin: [number, number];
  duration: number;
  loop: boolean;
  options?: Record<string, unknown>;
}

export interface PxModule {
  meta: PxMeta;
}

/** 효과의 몸 모양. soul-rise 같은 효과가 이 실루엣으로 그린다. */
export interface PxActor {
  mask: { w: number; h: number; data: Uint8Array };
  x: number;
  y: number;
  w: number;
  h: number;
  k: number;
  head: [number, number];
  chest: [number, number];
}

export interface PxOptions {
  x?: number;
  y?: number;
  flip?: boolean;
  angle?: number;
  seed?: number;
  light?: number;
  palette?: readonly string[];
  actor?: PxActor;
  [key: string]: unknown;
}

export interface PxInstance {
  readonly t: number;
  /** 살아 있는 동안 x, y, flip, angle을 바꾸면 따라 움직인다 (draw가 매번 읽는다) */
  readonly options: PxOptions;
  update(dt: number): void;
  draw(frame: PxFrame, layer?: 'back' | 'front'): void;
  stop(): void;
  done(): boolean;
}

export function createFrame(w: number, h: number, ox?: number, oy?: number): PxFrame;
export function clearFrame(f: PxFrame): PxFrame;
export function createFx(mod: PxModule, o?: PxOptions): PxInstance;
export function composite(f: PxFrame, out: Uint8ClampedArray, bg?: number | Uint32Array | null, lightK?: number): Uint8ClampedArray;
