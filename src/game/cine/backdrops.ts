/**
 * 오프닝 배경. 정적인 부분은 Pix로 한 번만 굽고, 움직이는 건 씬에서 그 위에 얹는다.
 * 화면 = 480×270, 위아래 26px은 레터박스 (그림 영역 y 26..244).
 */
import { VIEW_W } from '../config';
import { Pix, bayer, hex, ramp, rampAt, type Ramp } from './pix';
import { ALARM, CUP, PILLS } from './actors';

export const LB = 26;
export const PIC_TOP = LB;
export const PIC_BOT = 270 - LB;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ═══════════════ 윤슬의 방 (옆에서 본 단면) ═══════════════ */

export const ROOM = {
  floor: 212,
  window: { x: 262, y: 66, w: 84, h: 92 },
  gapX: 304,
  bed: { x: 104, w: 196, top: 178 },
  pillow: { x: 108, y: 170 },
  head: { x: 112, y: 165 },
  stand: { x: 40, w: 46, top: 182 },
  clock: { x: 56, y: 173 },
  door: { x: 404, y: 98, w: 44 },
} as const;

/** 방 배경. light = 커튼 틈 빛줄기 세기 (0..1) */
export function buildRoom(light: number): HTMLCanvasElement {
  const p = new Pix(VIEW_W, 270);
  const R = ROOM;
  // 벽: 위가 더 어둡다
  p.vramp(0, PIC_TOP, VIEW_W, R.floor - PIC_TOP, ramp('#0a0c11', '#0f1219', '#13171f', '#161a23'));
  // 벽지 세로 결 (아주 희미하게)
  p.each(0, PIC_TOP + 8, VIEW_W, R.floor - PIC_TOP - 8, (x, y) => (x % 12 === 0 && 0.35 > bayer(x, y * 3) ? hex('#12151d') : null));
  // 천장 몰딩
  p.rect(0, PIC_TOP, VIEW_W, 5, hex('#07080c'));
  p.rect(0, PIC_TOP + 5, VIEW_W, 1, hex('#1a1e28'));
  // 걸레받이
  p.rect(0, R.floor - 6, VIEW_W, 6, hex('#0e1016'));
  p.rect(0, R.floor - 6, VIEW_W, 1, hex('#1c202a'));
  // 바닥: 마루, 앞으로 올수록 밝아진다
  p.vramp(0, R.floor, VIEW_W, PIC_BOT - R.floor, ramp('#0d0e12', '#121318', '#16181d', '#191b21'));
  for (let y = R.floor + 3; y < PIC_BOT; y += 5 + Math.floor((y - R.floor) / 8)) p.rect(0, y, VIEW_W, 1, hex('#0b0c10'));
  const rf = rng(11);
  for (let i = 0; i < 26; i += 1) {
    const y = R.floor + 2 + Math.floor(rf() * (PIC_BOT - R.floor - 4));
    p.rect(Math.floor(rf() * VIEW_W), y, 1, 3, hex('#0b0c10'));
  }

  // 창문 + 닫힌 커튼
  const W = R.window;
  p.rect(W.x - 2, W.y - 2, W.w + 4, W.h + 4, hex('#1d212b'));
  p.rect(W.x, W.y, W.w, W.h, hex('#0c0e14'));
  p.rect(W.x - 14, W.y - 8, W.w + 28, 2, hex('#2c313d')); // 커튼봉
  p.rect(W.x - 16, W.y - 9, 3, 4, hex('#3a404e'));
  p.rect(W.x + W.w + 13, W.y - 9, 3, 4, hex('#3a404e'));
  const curtain = ramp('#161a24', '#1f2431', '#29303f', '#323a4b');
  const cTop = W.y - 6;
  const cBot = R.floor - 26;
  const drawPanel = (x0: number, x1: number, phase: number): void => {
    p.each(x0, cTop, x1 - x0, cBot - cTop, (x, y) => {
      // 주름: 사인파 명암
      const f = Math.sin((x - x0) * 0.62 + phase) * 0.5 + 0.5;
      const sag = (y - cTop) / (cBot - cTop);
      return rampAt(curtain, f * 0.85 + 0.05 - sag * 0.15, x, y);
    });
    // 밑단
    p.rect(x0, cBot - 2, x1 - x0, 2, hex('#12151d'));
  };
  drawPanel(W.x - 14, R.gapX - 1, 0);
  drawPanel(R.gapX + 1, W.x + W.w + 14, 1.4);
  // 틈: 새벽빛 한 줄
  p.each(R.gapX - 1, W.y, 2, W.h, (x, y) => {
    const v = (y - W.y) / W.h;
    return x === R.gapX - 1 ? hex(v < 0.5 ? '#c9d3e4' : '#8f9bb0') : hex(v < 0.35 ? '#e8c89a' : '#6d788c');
  });

  // 문 (오른쪽)
  const D = R.door;
  p.rect(D.x - 4, D.y - 4, D.w + 8, R.floor - D.y + 4, hex('#1a1d26'));
  p.rect(D.x, D.y, D.w, R.floor - D.y, hex('#11131a'));
  p.rect(D.x + 4, D.y + 6, D.w - 8, 40, hex('#141721'));
  p.rect(D.x + 4, D.y + 52, D.w - 8, 52, hex('#141721'));
  p.rect(D.x + D.w - 8, D.y + 58, 4, 2, hex('#4a505e'));
  // 문고리에 걸린 겉옷
  p.poly([[D.x + 6, D.y + 10], [D.x + 16, D.y + 8], [D.x + 20, D.y + 40], [D.x + 4, D.y + 44]], hex('#0b0c10'));

  // 바닥의 것들: 벗어둔 옷 무더기, 빈 컵, 약통
  p.poly([[330, R.floor + 8], [338, R.floor + 1], [352, R.floor], [366, R.floor + 3], [372, R.floor + 9]], hex('#16181f'));
  p.poly([[336, R.floor + 7], [344, R.floor + 3], [356, R.floor + 3], [362, R.floor + 7]], hex('#1d2029'));
  p.stamp(CUP, 380, R.floor + 3);
  p.stamp(PILLS, 314, R.floor + 3);

  // 협탁 + 알람시계
  const S = R.stand;
  p.rect(S.x, S.top, S.w, R.floor - S.top, hex('#15171e'));
  p.rect(S.x, S.top, S.w, 3, hex('#22252f'));
  p.rect(S.x + 4, S.top + 8, S.w - 8, 1, hex('#0d0e13'));
  p.rect(S.x + S.w / 2 - 2, S.top + 13, 4, 1, hex('#2e323d'));
  p.stamp(ALARM, R.clock.x, R.clock.y);

  // 침대
  const B = R.bed;
  p.rect(B.x - 10, 150, 9, R.floor - 150, hex('#1b1e27')); // 헤드보드
  p.rect(B.x - 10, 150, 9, 2, hex('#272b36'));
  p.rect(B.x, B.top + 18, B.w, 8, hex('#151820')); // 프레임
  p.rect(B.x + 4, B.top + 26, 4, R.floor - B.top - 26, hex('#101218'));
  p.rect(B.x + B.w - 8, B.top + 26, 4, R.floor - B.top - 26, hex('#101218'));
  p.rect(B.x, B.top, B.w, 18, hex('#262a35')); // 매트리스
  p.rect(B.x, B.top, B.w, 1, hex('#323745'));
  // 베개
  p.ellipse(R.pillow.x + 17, R.pillow.y + 5, 20, 7, hex('#4a5162'));
  p.ellipse(R.pillow.x + 18, R.pillow.y + 3, 17, 4, hex('#5c6476'));
  // 이불: 몸 위로 불룩, 오른쪽 끝에서 흘러내림
  const blanket = ramp('#1a1f2c', '#222839', '#2b3346', '#36405a');
  const top = (x: number): number => {
    const u = (x - 134) / 150;
    const body = Math.sin(Math.max(0, Math.min(1, u)) * Math.PI) * 9;
    return B.top - 2 - body;
  };
  p.each(132, B.top - 14, B.w - 24, 46, (x, y) => {
    const t = top(x);
    if (y < t) return null;
    const hang = x > B.x + B.w - 30 ? B.top + 24 : B.top + 12;
    if (y > hang) return null;
    const shade = (y - t) / 24 + (Math.sin(x * 0.18) > 0.6 ? 0.25 : 0);
    return rampAt(blanket, 0.85 - shade, x, y);
  });
  // 이불 접힌 가장자리
  p.each(132, B.top - 14, 5, 40, (x, y) => (y >= top(x) && y < B.top + 12 ? hex('#3a4560') : null));

  // 빛줄기: 커튼 틈 → 침대 위 → 바닥
  if (light > 0) {
    const pale = hex('#7d8aa2');
    const paler = hex('#a7b3c8');
    const src: readonly [number, number] = [R.gapX, W.y + 6];
    const poly: readonly (readonly [number, number])[] = [[src[0] - 1, src[1]], [src[0] + 2, src[1]], [292, PIC_BOT], [214, PIC_BOT]];
    p.poly(poly, (x, y) => {
      const v = (y - src[1]) / (PIC_BOT - src[1]);
      const d = light * (0.28 - v * 0.18);
      return d > bayer(x, y) ? (v < 0.25 ? paler : pale) : null;
    });
    // 바닥에 닿은 자리
    p.ellipse(250, R.floor + 18, 44, 7, pale, 0.22 * light);
    p.ellipse(250, R.floor + 18, 26, 4, paler, 0.3 * light);
  }
  return p.commit();
}

/* ═══════════════ 잠실도 전경 (파노라마, 시차 레이어) ═══════════════ */

export const WORLD_W = 1040;
export const HORIZON = 150;

export interface PanoLayers {
  sky: HTMLCanvasElement;
  far: HTMLCanvasElement;
  island: HTMLCanvasElement;
  front: HTMLCanvasElement;
  /** 시차 계수: 카메라 x에 곱한다 */
  k: { far: number; island: number; front: number };
  /** 산책로 (섬 레이어 좌표) */
  walk: { x0: number; x1: number; y: number };
}

export function buildPanorama(): PanoLayers {
  const k = { far: 0.25, island: 0.6, front: 1 };
  const span = WORLD_W - VIEW_W;

  // 하늘 + 강 (고정)
  const sky = new Pix(VIEW_W, 270);
  sky.vramp(0, PIC_TOP, VIEW_W, HORIZON - PIC_TOP, ramp('#070a12', '#0b0f1a', '#111827', '#19223a', '#283248', '#3d4558', '#5e5a62', '#8a7064', '#b88a6a'));
  const rs = rng(5);
  for (let i = 0; i < 70; i += 1) {
    const x = Math.floor(rs() * VIEW_W);
    const y = PIC_TOP + Math.floor(rs() ** 2 * 70);
    sky.set(x, y, hex(rs() < 0.2 ? '#c8d0e0' : '#5a6478'));
  }
  // 강: 하늘을 어둡게 비춘다
  sky.vramp(0, HORIZON, VIEW_W, PIC_BOT - HORIZON, ramp('#4a4450', '#2a2e3c', '#1a2030', '#121826', '#0c111c', '#090d16'));

  // 먼 강변: 아파트 실루엣과 높은 탑
  const fw = Math.ceil(VIEW_W + span * k.far);
  const far = new Pix(fw, 270);
  const rf = rng(21);
  let x = 0;
  while (x < fw) {
    const w = 10 + Math.floor(rf() * 22);
    const h = 8 + Math.floor(rf() * 30);
    const top = HORIZON - h;
    far.rect(x, top, w - 1, h, hex(rf() < 0.5 ? '#151b28' : '#181f2d'));
    far.dith(x, top, w - 1, 3, hex('#222a3a'), 0.5);
    for (let wy = top + 3; wy < HORIZON - 2; wy += 3) {
      for (let wx = x + 2; wx < x + w - 3; wx += 3) {
        const r = rf();
        if (r < 0.04) far.set(wx, wy, hex('#d2a26a'));
        else if (r < 0.07) far.set(wx, wy, hex('#5a6680'));
      }
    }
    x += w + (rf() < 0.3 ? 4 : 0);
  }
  const tx = Math.floor(fw * 0.62);
  far.poly([[tx - 7, HORIZON], [tx - 3, 62], [tx, 48], [tx + 3, 62], [tx + 7, HORIZON]], hex('#131927'));
  far.rect(tx, 36, 1, 12, hex('#131927'));
  far.set(tx, 35, hex('#c04a3a'));
  for (let y = 70; y < HORIZON; y += 6) far.set(tx + 1, y, hex('#3a4660'));

  // 잠실도: 섬, 숲, 낮은 집들, 끊어진 다리
  const iw = Math.ceil(VIEW_W + span * k.island);
  const island = new Pix(iw, 270);
  const ix0 = Math.floor(iw * 0.34);
  const ix1 = Math.floor(iw * 0.92);
  const bankY = 172;
  // 축대
  island.poly([[ix0 - 20, 196], [ix0, bankY], [ix1, bankY], [ix1 + 24, 196]], hex('#1c212c'));
  island.each(ix0 - 20, bankY, ix1 - ix0 + 44, 24, (px, py) => ((px + py * 2) % 7 === 0 && py > bankY + 2 ? hex('#161a23') : null));
  island.rect(ix0, bankY, ix1 - ix0, 2, hex('#3a4252'));
  // 숲과 집
  const ri = rng(33);
  for (let i = 0; i < 46; i += 1) {
    const cx = ix0 + 6 + ri() * (ix1 - ix0 - 12);
    const r = 5 + ri() * 9;
    island.ellipse(cx, bankY - r * 0.6, r, r * 0.8, hex('#0f1a1c'));
    island.ellipse(cx + r * 0.25, bankY - r * 0.75, r * 0.6, r * 0.45, hex('#16242a'), 0.6);
  }
  for (let i = 0; i < 16; i += 1) {
    const hx = ix0 + 10 + ri() * (ix1 - ix0 - 40);
    const w = 12 + Math.floor(ri() * 14);
    const h = 8 + Math.floor(ri() * 8);
    const by = bankY - 1;
    island.rect(hx, by - h, w, h, hex('#1d2230'));
    island.poly([[hx - 2, by - h], [hx + w / 2, by - h - 6], [hx + w + 2, by - h]], hex('#262c3c'));
    if (ri() < 0.6) island.rect(hx + 3, by - h + 3, 2, 2, hex(ri() < 0.5 ? '#d8a868' : '#7a6650'));
  }
  // 끊어진 다리: 왼쪽 강변에서 섬으로, 가운데 한 칸이 없다
  const deckY = 128;
  for (let i = 0; i < 9; i += 1) {
    const px0 = 20 + i * 44;
    if (px0 + 6 > ix0 + 30) break;
    island.rect(px0, deckY + 6, 6, PIC_BOT - deckY, hex('#1a1f2a'));
    island.rect(px0, deckY + 6, 1, PIC_BOT - deckY, hex('#2a3140'));
  }
  const gap0 = 150;
  const gap1 = 196;
  island.rect(0, deckY, gap0, 6, hex('#242a38'));
  island.rect(gap1, deckY, ix0 + 40 - gap1, 6, hex('#242a38'));
  island.rect(0, deckY, gap0, 1, hex('#3c4456'));
  island.rect(gap1, deckY, ix0 + 40 - gap1, 1, hex('#3c4456'));
  // 끊긴 자리: 늘어진 철근
  for (let i = 0; i < 4; i += 1) {
    island.line(gap0 + i * 2, deckY + 6, gap0 + 3 + i * 3, deckY + 14 + i * 3, hex('#3a3236'));
    island.line(gap1 - i * 2, deckY + 6, gap1 - 2 - i * 3, deckY + 12 + i * 2, hex('#3a3236'));
  }

  // 앞쪽 갈대 (가장 빠르게 지나간다)
  const front = new Pix(WORLD_W, 270);
  const rr = rng(47);
  for (let i = 0; i < 420; i += 1) {
    const bx = Math.floor(rr() * WORLD_W);
    const h = 6 + Math.floor(rr() ** 2 * 34);
    const lean = (rr() - 0.5) * 6;
    front.line(bx, PIC_BOT, bx + lean, PIC_BOT - h, hex(rr() < 0.15 ? '#10141c' : '#05070b'));
  }
  front.rect(0, PIC_BOT - 4, WORLD_W, 4, hex('#05070b'));

  return {
    sky: sky.commit(), far: far.commit(), island: island.commit(), front: front.commit(), k,
    walk: { x0: ix0 + 8, x1: ix1 - 8, y: bankY },
  };
}

/* ═══════════════ 올림픽대교 아래 (씬 5 새벽, 씬 6 선명한 색) ═══════════════ */

export interface BridgeLook {
  sky: Ramp;
  sun: string;
  sunGlow: string;
  far: string;
  river: Ramp;
  bank: Ramp;
  grass: string;
  grassHi: string;
  deck: Ramp;
  pier: Ramp;
  stain: string;
}

export const BRIDGE_DAWN: BridgeLook = {
  sky: ramp('#1c2232', '#283044', '#3c4458', '#5c5e6c', '#8a7a78', '#b0907c'),
  sun: '#e8cfae',
  sunGlow: '#a8907e',
  far: '#1a202c',
  river: ramp('#5a5a66', '#363c4c', '#232a3a', '#192030'),
  bank: ramp('#161b20', '#1b2126', '#20262b'),
  grass: '#1d2a26',
  grassHi: '#2c3b34',
  deck: ramp('#0e1016', '#151821', '#1c202b', '#242936'),
  pier: ramp('#1a1d26', '#232733', '#2c3140', '#363c4c'),
  stain: '#14161d',
};

export const BRIDGE_VIVID: BridgeLook = {
  sky: ramp('#170f3a', '#2c1a62', '#5a2a7a', '#a43c72', '#e8664e', '#f8b05c'),
  sun: '#fff0c8',
  sunGlow: '#f8a050',
  far: '#1e1240',
  river: ramp('#e0805a', '#7a3a76', '#3a2466', '#1c1648'),
  bank: ramp('#0e1a22', '#12242a', '#163030'),
  grass: '#174a40',
  grassHi: '#2a7a5a',
  deck: ramp('#0c0a1c', '#141030', '#1c1840', '#26214f'),
  pier: ramp('#191538', '#221d4a', '#2c265c', '#3a3270'),
  stain: '#120e2a',
};

export const BR = {
  deckBot: 66,
  river: 158,
  bank: 196,
  foot: 216,
  pier: { x: 34, w: 62 },
  sun: { x: 404, y: 150 },
} as const;

export function buildBridge(L: BridgeLook): { back: HTMLCanvasElement; front: HTMLCanvasElement } {
  const p = new Pix(VIEW_W, 270);
  // 하늘
  p.vramp(0, PIC_TOP, VIEW_W, BR.river - PIC_TOP, L.sky);
  // 해: 수평선에 반쯤 걸친 원 + 디더 후광
  const S = BR.sun;
  p.each(S.x - 60, S.y - 60, 120, 62, (x, y) => {
    const d = Math.hypot(x + 0.5 - S.x, (y + 0.5 - S.y) * 1.3) / 60;
    return 0.55 * (1 - d) > bayer(x, y) ? hex(L.sunGlow) : null;
  });
  p.ellipse(S.x, S.y, 13, 13, hex(L.sun));
  // 먼 강변
  const rf = rng(8);
  let x = 0;
  while (x < VIEW_W) {
    const w = 8 + Math.floor(rf() * 18);
    const h = 3 + Math.floor(rf() * 14);
    p.rect(x, BR.river - h, w, h, hex(L.far));
    x += w;
  }
  // 강 + 해의 반사 기둥
  p.vramp(0, BR.river, VIEW_W, BR.bank - BR.river, L.river);
  for (let y = BR.river + 1; y < BR.bank; y += 2) {
    const spread = 6 + (y - BR.river) * 0.9;
    const r = rng(y);
    for (let i = 0; i < 3; i += 1) {
      const sx = S.x + (r() - 0.5) * spread * 2;
      p.rect(sx, y, 2 + Math.floor(r() * 6), 1, hex(y < BR.river + 12 ? L.sun : L.sunGlow));
    }
  }
  // 둑: 흙길 + 풀
  p.vramp(0, BR.bank, VIEW_W, PIC_BOT - BR.bank, L.bank);
  p.rect(0, BR.bank, VIEW_W, 1, hex(L.grassHi));
  const rg = rng(17);
  for (let i = 0; i < 700; i += 1) {
    const gx = Math.floor(rg() * VIEW_W);
    const gy = BR.bank + Math.floor(rg() * (BR.foot - BR.bank + 6));
    const h = 2 + Math.floor(rg() * 4);
    p.line(gx, gy, gx + (rg() < 0.5 ? -1 : 1), gy - h, hex(rg() < 0.3 ? L.grassHi : L.grass));
  }
  // 오솔길 (발밑)
  p.dith(0, BR.foot - 2, VIEW_W, 5, hex('#2a2a30'), L === BRIDGE_VIVID ? 0.15 : 0.3);

  // 다리 상판 아랫면: 보가 화면 안쪽으로 줄지어 있다
  p.vramp(0, PIC_TOP, VIEW_W, BR.deckBot - PIC_TOP, L.deck);
  for (let bx = 18; bx < VIEW_W; bx += 54) {
    p.rect(bx, PIC_TOP, 10, BR.deckBot - PIC_TOP + 4, hex('#07080c'));
    p.rect(bx, BR.deckBot, 10, 4, L.deck[2] ?? 0);
    p.rect(bx + 1, PIC_TOP, 1, BR.deckBot - PIC_TOP, L.deck[3] ?? 0);
  }
  p.rect(0, BR.deckBot, VIEW_W, 2, L.deck[3] ?? 0);
  p.rect(0, BR.deckBot + 2, VIEW_W, 1, hex('#05060a'));
  // 물 자국 (상판에서 흘러내린)
  const rd = rng(29);
  for (let i = 0; i < 14; i += 1) {
    const dx = Math.floor(rd() * VIEW_W);
    p.rect(dx, BR.deckBot + 3, 1, 2 + Math.floor(rd() * 6), hex(L.stain));
  }

  // 교각 (왼쪽, 거대한 콘크리트 기둥)
  const P = BR.pier;
  p.each(P.x, BR.deckBot, P.w, BR.foot - BR.deckBot + 4, (px, py) => {
    const u = (px - P.x) / (P.w - 1);
    // 왼쪽 그늘 → 오른쪽(해 쪽) 밝음
    const c = rampAt(L.pier, u * 0.9, px, py);
    // 세로 얼룩
    const streak = Math.sin(px * 1.7) * Math.sin(px * 0.31) > 0.55 && py < BR.river + 10;
    return streak && 0.6 > bayer(px, py) ? hex(L.stain) : c;
  });
  p.rect(P.x + P.w - 1, BR.deckBot, 1, BR.foot - BR.deckBot + 4, L.pier[3] ?? 0);
  p.rect(P.x - 4, BR.deckBot, P.w + 8, 6, L.deck[1] ?? 0); // 교좌
  p.dith(P.x, BR.river - 4, P.w, 10, hex(L.stain), 0.5); // 물때
  // 오른쪽 먼 교각
  p.vramp(452, BR.deckBot, 30, BR.river - BR.deckBot + 4, ramp('#0e1018', '#141824'));

  // 앞쪽 갈대 (인물보다 앞)
  const front = new Pix(VIEW_W, 270);
  const rr = rng(61);
  for (let i = 0; i < 160; i += 1) {
    const bx = Math.floor(rr() * VIEW_W);
    if (bx > 180 && bx < 380 && rr() < 0.85) continue; // 인물 자리는 비운다
    const h = 8 + Math.floor(rr() ** 1.5 * 40);
    const lean = (rr() - 0.5) * 8;
    front.line(bx, PIC_BOT, bx + lean, PIC_BOT - h, hex('#04050a'));
    if (rr() < 0.3) front.rect(bx + lean - 1, PIC_BOT - h - 3, 2, 4, hex('#04050a'));
  }
  return { back: p.commit(), front: front.commit() };
}

/** 세나가 웅크린 갈대 덤불 (세나 뒤) */
export function buildReeds(L: BridgeLook, seed: number): HTMLCanvasElement {
  const p = new Pix(70, 40);
  const r = rng(seed);
  for (let i = 0; i < 90; i += 1) {
    const bx = 4 + Math.floor(r() * 62);
    const h = 6 + Math.floor(r() * 28);
    const lean = (r() - 0.5) * 7;
    p.line(bx, 39, bx + lean, 39 - h, hex(r() < 0.35 ? L.grassHi : L.grass));
  }
  return p.commit();
}

/* ═══════════════ 문 (씬 7) ═══════════════ */

export const DOOR = { w: 62, h: 98, gap: 172, top: 64 } as const;

/** 문 하나의 틀과 계단 (정적). 문짝·빛·자물쇠는 씬에서 그린다. */
export function buildDoorFrame(): HTMLCanvasElement {
  const p = new Pix(DOOR.w + 40, DOOR.h + 70);
  const ox = 20;
  // 틀
  p.rect(ox - 5, 0, DOOR.w + 10, DOOR.h + 5, hex('#1c1e25'));
  p.rect(ox - 5, 0, DOOR.w + 10, 1, hex('#30333d'));
  p.rect(ox - 5, 0, 1, DOOR.h + 5, hex('#2a2d36'));
  p.rect(ox - 2, 3, DOOR.w + 4, DOOR.h + 2, hex('#0a0b0e'));
  // 문턱
  p.rect(ox - 8, DOOR.h + 5, DOOR.w + 16, 3, hex('#24272f'));
  // 아래로 내려가는 계단: 원근으로 좁아진다
  for (let s = 0; s < 8; s += 1) {
    const y = DOOR.h + 10 + s * 7;
    const inset = 4 + s * 2;
    p.rect(ox - 8 + inset, y, DOOR.w + 16 - inset * 2, 2, hex(s % 2 === 0 ? '#191b21' : '#16181e'));
    p.rect(ox - 8 + inset, y + 2, DOOR.w + 16 - inset * 2, 5, hex('#0d0e12'));
  }
  return p.commit();
}

/** 문 안쪽 기억 (회색 실루엣, 빛이 들면 보인다) */
export function buildMemory(i: number): HTMLCanvasElement {
  const w = DOOR.w;
  const h = DOOR.h;
  const p = new Pix(w, h);
  p.vramp(0, 0, w, h, ramp('#2a2a30', '#3a3a42', '#4a4a52'));
  const c = hex('#1a1a20');
  const d = hex('#26262e');
  const floorY = h - 22;
  p.rect(0, floorY, w, h - floorY, hex('#202026'));
  switch (i) {
    case 0: // 침대
      p.rect(8, floorY - 18, w - 16, 12, c);
      p.rect(8, floorY - 26, 6, 26, c);
      p.ellipse(22, floorY - 20, 7, 3, d);
      p.rect(10, floorY - 6, 3, 6, c);
      p.rect(w - 13, floorY - 6, 3, 6, c);
      break;
    case 1: // 캠퍼스 건물 + 금 간 거울
      p.rect(4, 14, 26, floorY - 14, c);
      for (let r = 0; r < 6; r += 1) for (let k = 0; k < 3; k += 1) p.rect(7 + k * 8, 18 + r * 10, 4, 5, d);
      p.ellipse(46, 44, 10, 16, hex('#3e3e48'));
      p.ellipse(46, 44, 8, 14, hex('#55555f'));
      p.line(42, 32, 47, 44, c);
      p.line(47, 44, 44, 56, c);
      p.line(47, 44, 53, 50, c);
      break;
    case 2: // 교실 책상
      for (let r = 0; r < 3; r += 1) {
        for (let k = 0; k < 3; k += 1) {
          const y = 30 + r * 18;
          p.rect(5 + k * 19, y, 14, 4, c);
          p.rect(7 + k * 19, y + 4, 2, 8, d);
          p.rect(15 + k * 19, y + 4, 2, 8, d);
        }
      }
      p.rect(4, 8, w - 8, 14, hex('#1e2420'));
      break;
    default: // 식탁과 작은 아이
      p.rect(6, floorY - 22, w - 12, 5, c);
      p.rect(9, floorY - 17, 3, 17, d);
      p.rect(w - 12, floorY - 17, 3, 17, d);
      for (let k = 0; k < 3; k += 1) p.rect(10 + k * 14, floorY - 30, 7, 8, d);
      p.ellipse(48, floorY - 14, 3, 3, c);
      p.rect(45, floorY - 11, 7, 11, c);
      break;
  }
  return p.commit();
}
