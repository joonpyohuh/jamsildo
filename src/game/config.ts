/** 내부 해상도. 화면에는 정수배로 확대해서 도트를 유지한다. */
export const VIEW_W = 480;
export const VIEW_H = 270;

/**
 * 3/4 시점 방.
 * 위쪽 벽은 윗면(cap) + 앞면(face)이 보이고, 좌우·아래 벽은 윗면만 보인다.
 */
export const WALL_SIDE = 16;
export const WALL_CAP = 10;
export const WALL_FACE = 30;
export const WALL_TOP = WALL_CAP + WALL_FACE;
export const WALL_BOTTOM = 16;

export const FLOOR = {
  x: WALL_SIDE,
  y: WALL_TOP,
  w: VIEW_W - WALL_SIDE * 2,
  h: VIEW_H - WALL_TOP - WALL_BOTTOM,
} as const;

/** 바닥 중심. 좌우 문은 이 높이에 있다. */
export const CX = FLOOR.x + FLOOR.w / 2;
export const CY = FLOOR.y + FLOOR.h / 2;
export const DOOR_HALF = 20;

/**
 * 정령 속성. 정령방의 벽지·문 색과 보스의 속성이 이걸 따른다.
 * 지금 구현된 정령은 불뿐이라 IMPLEMENTED_ELEMENTS 안에서만 뽑는다.
 */
export type Element = 'fire' | 'water' | 'wood';
export const IMPLEMENTED_ELEMENTS: readonly Element[] = ['fire'];
export const ELEMENT: Readonly<Record<Element, {
  label: string; wall: string; wallLine: string; door: string; glow: string;
}>> = {
  fire: { label: '불', wall: '#3b1519', wallLine: '#4c1b21', door: '#d0452f', glow: '#ff8a2a' },
  water: { label: '물', wall: '#13223a', wallLine: '#1a2d4b', door: '#3474c8', glow: '#5eb0ff' },
  wood: { label: '나무', wall: '#15301d', wallLine: '#1c3e26', door: '#3f9a52', glow: '#8fdc6a' },
};

/** 레퍼런스처럼 대미지 숫자를 띄울지. 기획서의 '정보 최소' 원칙 때문에 기본은 끈다. */
export const SHOW_DAMAGE_NUMBERS = false;

/**
 * 팔레트: 차가운 무채색 + 강조색 하나.
 * 강조색(accent)은 '온기' — HP와 재화, 그리고 커튼 틈 빛에만 쓴다.
 * 세나(sena)는 색이 아니라 '밝기'로 구분한다. 화면에서 가장 밝은 것.
 */
export const COLOR = {
  void: '#07080a',
  capTop: '#1d2027',
  capEdge: '#2b2f37',
  face: '#14161b',
  faceLine: '#181a20',
  skirting: '#22252c',
  skirtingTop: '#2e323a',
  floor: '#22252c',
  floorLine: '#1c1f25',
  floorDot: '#292c34',
  post: '#2e323a',
  postBoss: '#7a808b',
  doorway: '#050607',
  ink: '#07080b',
  inkMid: '#0e1015',
  inkRim: '#3a3e46',
  inkLight: '#5c626d',
  pale: '#c9ccd3',
  dim: '#6b707a',
  sena: '#eef0f3',
  senaShade: '#9aa0aa',
  senaGlow: '#cdd7ea',
  accent: '#e0a458',
  heart: '#d8343f',
  heartShade: '#8f1f2a',
  heartLight: '#ff9aa0',
  heartEmpty: '#2e2228',
  fire: '#ff8a2a',
  fireHot: '#ffd23d',
  fireDeep: '#c9281f',
  empty: '#2a2d34',
  shadow: 'rgba(0, 0, 0, 0.42)',
  white: '#ffffff',
} as const;
