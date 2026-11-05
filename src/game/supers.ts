/**
 * 초필살기·합동 궁극기 연출. 그림은 전부 정지 1프레임이라 움직임은 여기서 만든다.
 * 판정은 game.ts가 맡고, 이 파일은 시간(t)만 받아 어디에 어떻게 그릴지 정한다.
 */
import { ART } from './assets';
import { VIEW_H, VIEW_W } from './config';
import { easeOut } from './math';
import type { Element } from './config';

export type SuperKind = 'cannon' | 'wave' | 'sword' | 'reaper' | 'steam' | 'eclipse';

export interface SuperFx {
  kind: SuperKind;
  element: Element;
  /** 앵커가 놓이는 자리. wave는 파도 앞머리, 나머지는 시전 지점 또는 칼끝 */
  x: number; y: number;
  /** 판정 방향(라디안) */
  angle: number;
  /** 그림의 기울기. dir이 -1이면 좌우를 뒤집은 공간에서 돈다 */
  tilt: number;
  dir: 1 | -1;
  t: number;
  damage: number;
  hit: Set<number>;
}

interface Spec {
  art: string; life: number;
  /** 앵커: 그림 크기 대비 비율 */
  ax: number; ay: number;
  /** 왼쪽부터 드러나는 시간. 0이면 한 번에 나타난다 */
  reveal: number;
  /** 처음부터 보이는 왼쪽 비율: 포구와 정령은 잘리면 안 되고, 그 앞의 빔만 뻗어 나간다 */
  from: number;
}

/** 앵커는 그림을 보고 잡았다: 포구, 정령의 손, 파도 앞머리, 칼끝, 리퍼의 몸통 */
export const SUPERS: Readonly<Record<SuperKind, Spec>> = {
  cannon: { art: 'ult_fire', life: 0.85, ax: 0.185, ay: 0.52, reveal: 0.1, from: 0.3 },
  wave: { art: 'ult_water', life: 1.5, ax: 0.95, ay: 1, reveal: 0, from: 1 },
  sword: { art: 'ult_light', life: 0.95, ax: 0.8, ay: 0.975, reveal: 0, from: 1 },
  reaper: { art: 'ult_dark', life: 1, ax: 0.33, ay: 0.5, reveal: 0, from: 1 },
  steam: { art: 'combo_steam', life: 1.15, ax: 0.17, ay: 0.5, reveal: 0.24, from: 0.36 },
  eclipse: { art: 'combo_eclipse', life: 1.15, ax: 0.17, ay: 0.5, reveal: 0.22, from: 0.36 },
};

/** 빛의 검이 땅에 닿기까지. 판정도 이때 들어간다 */
export const SWORD_DROP = 0.16;
/** 리퍼의 낫이 다 돌아가는 시간 */
export const REAPER_SWING = 0.26;
/** 일식이 완성되어 터지는 시간 */
export const ECLIPSE_BURST = 0.24;
export const WAVE_SPEED = 800;

/** 끝에서 4단으로 끊어 사라진다 (도트에 부드러운 페이드는 어울리지 않는다) */
function fadeOut(k: number): number {
  return k < 0.75 ? 1 : Math.max(0, Math.ceil((1 - k) * 16) / 4);
}

function stamp(ctx: CanvasRenderingContext2D, spec: Spec, x: number, y: number, dir: number, tilt: number, shown: number, alpha: number): void {
  const art = ART.get(spec.art);
  if (!art) return;
  const w = art.width, h = art.height, cut = Math.max(1, Math.round(w * shown));
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(dir, 1);
  if (tilt) ctx.rotate(tilt);
  ctx.drawImage(art, 0, 0, cut, h, Math.round(-w * spec.ax), Math.round(-h * spec.ay), cut, h);
  ctx.restore();
}

export function drawSuperFx(ctx: CanvasRenderingContext2D, fx: SuperFx, ox: number, oy: number): void {
  const spec = SUPERS[fx.kind], k = fx.t / spec.life, alpha = fadeOut(k);
  const shown = spec.reveal ? spec.from + (1 - spec.from) * Math.min(1, fx.t / spec.reveal) : 1;
  let { x, y } = fx, tilt = fx.tilt;
  if (fx.kind === 'cannon') y += Math.floor(fx.t * 30) % 2; // 뿜는 힘으로 떤다
  if (fx.kind === 'sword') {
    // 칼날 축을 따라 위에서 내리꽂힌다
    const fall = (1 - Math.min(1, fx.t / SWORD_DROP)) * 240;
    x -= fall * 0.62; y -= fall * 0.78;
  }
  if (fx.kind === 'reaper') {
    // 낫을 뒤로 젖혔다가 앞으로 돌린다
    const swing = easeOut(Math.min(1, fx.t / REAPER_SWING));
    tilt += -0.2 + swing * 0.24;
    x -= fx.dir * (1 - Math.min(1, fx.t / 0.12)) * 18;
  }
  stamp(ctx, spec, x + ox, y + oy, fx.dir, tilt, shown, alpha);
}

/* ═══════════════ 컷인 ═══════════════ */

export type CutKind = 'spirit' | 'sena' | 'card' | 'awaken' | 'evolve';

export interface Cut {
  kind: CutKind;
  t: number; life: number;
  /** 세나 옆에 함께 서는 정령 그림 */
  spirits: readonly string[];
  glow: string;
  run: () => void;
}

const BAR = 46;

/** 세나 궁극기: 배경 70% 어둡게, 상반신이 오른쪽에서 들어오고 은빛 속도선이 흐른다 */
function drawSenaCut(ctx: CanvasRenderingContext2D, cut: Cut): void {
  ctx.fillStyle = 'rgba(4, 5, 8, 0.7)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.fillStyle = '#dfe6f0';
  for (let i = 0; i < 26; i += 1) {
    const y = (i * 37) % VIEW_H, length = 40 + (i * 53) % 120;
    ctx.fillRect(Math.round(VIEW_W - ((cut.t * 900 + i * 131) % (VIEW_W + 160))), y, length, 1);
  }
  const sena = ART.get('sena_human');
  if (!sena) return;
  const slide = easeOut(Math.min(1, cut.t / 0.25)), scale = 2, crop = 92;
  ctx.drawImage(sena, 0, 0, sena.width, crop, Math.round(VIEW_W - 30 - sena.width * scale * slide), 70, sena.width * scale, crop * scale);
}

/** 보스 카드: 위 띠는 왼쪽에서, 아래 띠는 오른쪽에서 들어온다 */
function drawBossCard(ctx: CanvasRenderingContext2D, cut: Cut): void {
  const inK = easeOut(Math.min(1, cut.t / 0.25)), outK = Math.max(0, (cut.t - cut.life + 0.25) / 0.25), w = Math.round(VIEW_W * inK * (1 - outK));
  ctx.fillStyle = '#050608';
  ctx.fillRect(0, 96, w, 84);
  ctx.fillRect(VIEW_W - w, 180, w, 84);
}

/** 정령 진화: 실루엣이 먼저, 그다음 새 모습 */
function drawEvolve(ctx: CanvasRenderingContext2D, cut: Cut): void {
  ctx.fillStyle = 'rgba(4, 5, 8, 0.75)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const art = ART.get(cut.spirits[0] ?? '');
  if (!art) return;
  ctx.save();
  if (cut.t < cut.life * 0.45) ctx.filter = 'brightness(0)';
  ctx.drawImage(art, Math.round(VIEW_W / 2 - art.width / 2 - 120), Math.round(VIEW_H / 2 - art.height / 2));
  ctx.restore();
}

/** 세상이 멈추고 띠가 닫히면 무기였던 세나가 사람 모습으로 들어온다 */
export function drawCutIn(ctx: CanvasRenderingContext2D, cut: Cut): void {
  if (cut.kind === 'awaken') return;
  if (cut.kind === 'sena') { drawSenaCut(ctx, cut); return; }
  if (cut.kind === 'card') { drawBossCard(ctx, cut); return; }
  if (cut.kind === 'evolve') { drawEvolve(ctx, cut); return; }
  const opening = Math.min(1, cut.t / 0.12), closing = Math.max(0, (cut.t - cut.life + 0.1) / 0.1);
  const shut = easeOut(opening) * (1 - closing);
  ctx.fillStyle = `rgba(4, 5, 8, ${0.8 * shut})`;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const bar = Math.round(BAR * shut);
  ctx.fillStyle = '#050608';
  ctx.fillRect(0, 0, VIEW_W, bar);
  ctx.fillRect(0, VIEW_H - bar, VIEW_W, bar);
  ctx.fillStyle = cut.glow;
  ctx.fillRect(0, bar, VIEW_W, 1);
  ctx.fillRect(0, VIEW_H - bar - 1, VIEW_W, 1);

  const sena = ART.get('sena_human');
  if (!sena) return;
  // 들어와서 멈추지 않고 아주 천천히 민다: 멈춘 시간 속에서 세나만 움직인다
  const slide = (1 - easeOut(Math.min(1, cut.t / 0.16))) * -150 + cut.t * 7;
  const x = Math.round(150 + slide), foot = VIEW_H - BAR - 6;
  ctx.save();
  ctx.globalAlpha = shut;
  cut.spirits.forEach((id, i) => {
    const spirit = ART.get(id);
    if (!spirit) return;
    const row = cut.spirits.length > 1 ? foot - 132 + i * 80 : foot - 96;
    ctx.drawImage(spirit, Math.round(x - 84 - spirit.width / 2 + i * 10), Math.round(row - spirit.height / 2));
  });
  ctx.drawImage(sena, Math.round(x - sena.width / 2), foot - sena.height);
  ctx.restore();
}
