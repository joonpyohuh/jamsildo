import { VIEW_H, VIEW_W } from './game/config';
import { Sfx } from './game/audio';
import { Game, type InputState, type SkillKey } from './game/game';
import { Ui } from './game/ui';
import { loadArt } from './game/assets';
import { SKILLS, SKILL_DESC, SPIRIT_NAMES, SPIRIT_ROLES } from './game/campaign';
import { ELEMENT } from './game/config';
import { Accounts } from './accounts';
import './accounts.css';

function must<T extends Element>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element: ${sel}`);
  return el;
}

const stageEl = must<HTMLDivElement>('#stage');
const viewportEl = must<HTMLDivElement>('#viewport');
const canvas = must<HTMLCanvasElement>('#game');
const healthHud = must<HTMLCanvasElement>('#healthHud');
const uiEl = must<HTMLDivElement>('#ui');
const attackBtn = must<HTMLButtonElement>('#attack');
const joystick = must<HTMLButtonElement>('#joystick');
const joystickKnob = must<HTMLElement>('#joystickKnob');
const skillPad = must<HTMLDivElement>('#skills');
const settingsDialog = must<HTMLDialogElement>('#settings');
const settingsToggle = must<HTMLButtonElement>('#settingsToggle');
const minimap = must<HTMLDivElement>('#minimap');
const brightness = must<HTMLInputElement>('#brightness');
const volume = must<HTMLInputElement>('#volume');
const brightnessValue = must<HTMLOutputElement>('#brightnessValue');
const volumeValue = must<HTMLOutputElement>('#volumeValue');
const rewardDialog=must<HTMLDialogElement>('#rewardDialog');
const skillAim=must<HTMLElement>('#skillAim');
const swapBtn=must<HTMLButtonElement>('#swapSpirit');
const startButton=must<HTMLButtonElement>('#startGame');
const continueButton=must<HTMLButtonElement>('#continueGame');
const guestButton=must<HTMLButtonElement>('#startGuest');
const comboButton=must<HTMLButtonElement>('#comboSkill');
const dashBtn=must<HTMLButtonElement>('#dash');
const touchZone=must<HTMLDivElement>('#touchZone');
const topBar=must<HTMLElement>('#topBar');
const statusBar=must<HTMLElement>('#statusBar');
const pauseToggle=must<HTMLButtonElement>('#pauseToggle');
const layoutEdit=must<HTMLDivElement>('#layoutEdit');
const itemDialog=must<HTMLDialogElement>('#itemDialog');
const itemsToggle=must<HTMLButtonElement>('#itemsToggle');

canvas.width = VIEW_W;
canvas.height = VIEW_H;
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('2d context unavailable');
const healthCtx = healthHud.getContext('2d');
if (!healthCtx) throw new Error('HUD 2d context unavailable');

const sfx = new Sfx();
const ui = new Ui(uiEl);
const input: InputState = { attackHeld: false, skillQueue: [], move: null };
const game = new Game(ctx, sfx, ui, input, healthCtx);
const accounts = new Accounts(game);
let assetsReady=false;
startButton.disabled=true;
void Promise.all([loadArt(),accounts.ready]).then(()=>{
  assetsReady=true;startButton.disabled=false;must('#loadStatus').textContent='이 게임은 우울과 오래된 상처를 다룹니다.';
  accounts.refreshContinue();
}).catch(()=>{must('#loadStatus').textContent='불러오지 못했어요. 새로고침 후 다시 시도해 주세요.';});

for (const slider of [brightness, volume]) {
  try {
    const saved = localStorage.getItem(`jamsildo.${slider.id}`);
    const value = saved === null ? NaN : Number(saved);
    if (Number.isFinite(value)) slider.value = String(Math.max(Number(slider.min), Math.min(Number(slider.max), value)));
  } catch { /* 저장이 차단된 브라우저에서도 설정은 현재 플레이에 적용한다. */ }
  slider.addEventListener('input', () => {
    applySettings();
    try { localStorage.setItem(`jamsildo.${slider.id}`, slider.value); } catch { /* 저장이 차단되어도 플레이는 계속한다. */ }
  });
}
function applySettings(): void {
  canvas.style.filter = `brightness(${brightness.valueAsNumber / 100})`;
  sfx.setVolume(volume.valueAsNumber / 100);
  brightnessValue.value = `${brightness.value}%`;
  volumeValue.value = `${volume.value}%`;
}
applySettings();
function openSettings(): void {
  resetInput();
  settingsDialog.showModal();
}
must<HTMLButtonElement>('#openSettings').addEventListener('click', openSettings);
settingsToggle.addEventListener('click', openSettings);
settingsDialog.addEventListener('close', () => {
  if (game.mode !== 'title') canvas.focus({ preventScroll: true });
});
rewardDialog.addEventListener('close',()=>canvas.focus({preventScroll:true}));
/** 아이템 창: 다른 창이 떠 있거나 플레이 중이 아니면 열지 않는다. 열려 있는 동안 게임은 멈춘다. */
function toggleItems(): void {
  if (itemDialog.open) { itemDialog.close(); return; }
  if (game.mode !== 'play' || accounts.paused) return;
  resetInput();
  ui.renderItems(game.inventory);
  itemDialog.showModal();
  // 닫기 버튼 대신 창에 포커스: 열자마자 강조 테두리가 뜨지 않게
  itemDialog.focus();
}
itemsToggle.addEventListener('click', toggleItems);
must<HTMLButtonElement>('#itemClose').addEventListener('click', () => itemDialog.close());
itemDialog.addEventListener('close', () => canvas.focus({ preventScroll: true }));
continueButton.addEventListener('click',()=>{if(assetsReady){sfx.unlock();game.resumeRun();}});
startButton.addEventListener('click', () => {
  if(!assetsReady)return;
  void enterFullscreen();
  if(!accounts.confirmStart())return;
  sfx.unlock();
  game.onScreenTap();
});
guestButton.addEventListener('click',()=>{
  if(!assetsReady)return;
  void enterFullscreen();
  sfx.unlock();accounts.playAsGuest();
  game.onScreenTap();
});
must<HTMLButtonElement>('#startRegister').addEventListener('click',()=>{if(assetsReady){void enterFullscreen();accounts.openAuth('register');}});
must<HTMLButtonElement>('#startLogin').addEventListener('click',()=>{if(assetsReady){void enterFullscreen();accounts.openAuth('login');}});
volume.addEventListener('change', () => {
  sfx.unlock();
  sfx.play('pickup');
});

/* ── 화면 맞춤: 640×360을 안전 영역 안에 정수 배율로. 남는 곳은 검은 여백. ── */
let touchSeen = window.matchMedia('(pointer: coarse)').matches;
const markTouch = (e: PointerEvent): void => {
  if (e.pointerType === 'touch') setTouch();
};
function setTouch(): void {
  if (touchSeen) return;
  touchSeen = true;
  applyTouchUi();
  fit();
}
window.addEventListener('touchstart', setTouch, { once: true, passive: true });
function applyTouchUi(): void {
  document.documentElement.classList.toggle('touch-controls', touchSeen);
  startButton.textContent = touchSeen ? '터치해서 시작' : '게임 시작';
}

interface Box { l: number; t: number; r: number; b: number }
const safeProbe = must<HTMLDivElement>('#safeProbe');
function safeArea(): Box {
  const c = getComputedStyle(safeProbe);
  return { l: parseFloat(c.paddingLeft) || 0, t: parseFloat(c.paddingTop) || 0, r: parseFloat(c.paddingRight) || 0, b: parseFloat(c.paddingBottom) || 0 };
}
/**
 * 배율은 물리 픽셀 기준 정수: 레티나(dpr 2)면 1.5배도 도트 한 칸이 정확히 3픽셀이라 뭉개지지 않는다.
 * 예외 하나: 터치 기기에서 정수로 내리면 화면이 80% 미만으로 쪼그라들 때(아이폰 SE + 사파리 주소창)만 꽉 채운다.
 */
function pickScale(fitScale: number): number {
  const dpr = window.devicePixelRatio || 1;
  const whole = Math.floor(fitScale * dpr + 1e-6) / dpr;
  if (whole <= 0) return fitScale;
  return touchSeen && whole < fitScale * 0.8 ? fitScale : whole;
}
/* 세로 레이아웃의 고정 높이. 게임 화면은 16:9 그대로 위에 두고 아래를 조작 영역으로 쓴다. */
const TOP_BAR = 44, BOSS_ROW = 30, STATUS_ROW = 40, SIDE_GAP = 8, BOTTOM_GAP = 16, MIN_CONTROLS = 250;
const portraitQuery = window.matchMedia('(orientation: portrait)');
/** PC는 창이 세로로 길어도 기존 화면을 쓴다 */
const isPortrait = (): boolean => touchSeen && portraitQuery.matches;

function fit(): void {
  const W = window.innerWidth, H = window.innerHeight, safe = safeArea(), dpr = window.devicePixelRatio || 1, portrait = isPortrait();
  document.documentElement.classList.toggle('portrait', portrait);
  const areaW = W - safe.l - safe.r - (portrait ? SIDE_GAP * 2 : 0), areaH = H - safe.t - safe.b;
  const portraitTop = safe.t + TOP_BAR + BOSS_ROW;
  // 세로는 폭을 꽉 채운다. 폴드처럼 넓은 화면에서만 조작 영역을 남기려고 줄인다.
  const scale = portrait ? Math.min(areaW / VIEW_W, (H - portraitTop - STATUS_ROW - safe.b - BOTTOM_GAP - MIN_CONTROLS) / VIEW_H) : pickScale(Math.min(areaW / VIEW_W, areaH / VIEW_H));
  const width = VIEW_W * scale, height = VIEW_H * scale;
  const left = Math.round((safe.l + (portrait ? SIDE_GAP : 0) + (areaW - width) / 2) * dpr) / dpr, top = Math.round((portrait ? portraitTop : safe.t + (areaH - height) / 2) * dpr) / dpr;
  stageEl.style.width = `${width}px`;
  stageEl.style.height = `${height}px`;
  stageEl.style.left = `${left}px`;
  stageEl.style.top = `${top}px`;
  const root = document.documentElement.style;
  root.setProperty('--sl', `${left}px`);
  root.setProperty('--st', `${top}px`);
  root.setProperty('--sr', `${W - left - width}px`);
  root.setProperty('--sb', `${H - top - height}px`);
  root.setProperty('--sw', `${width}px`);
  root.setProperty('--ct', `${top + height + STATUS_ROW}px`);
  ui.setScale(scale);
  layoutControls(W, H, safe, { l: left, t: top, r: left + width, b: top + height });
  updateOrientation();
}

/* ── 터치 버튼 배치 ── */
const SKILL_ANGLES: Readonly<Record<SkillKey, number>> = { q: 90, w: 125, e: 160, r: 195 };
const SKILL_RADIUS = 100, SKILL_SIZE = 56, ATTACK_SIZE = 80, SWAP_SIZE = 44, STICK_SIZE = 112, COMBO_ANGLE = 165;
/* 버튼 배치 편집: 기본 자리에서 옮긴 거리만 저장한다. 가로·세로는 손 위치가 달라 따로 둔다. */
type Layout = Record<string, readonly [number, number]>;
function readLayout(mode: string): Layout {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(`jamsildo.layout.${mode}`) ?? '{}');
    return value && typeof value === 'object' ? value as Layout : {};
  } catch { return {}; }
}
function saveLayout(mode: string, layout: Layout): void {
  try { localStorage.setItem(`jamsildo.layout.${mode}`, JSON.stringify(layout)); } catch { /* 저장이 막혀도 이번 플레이에는 적용된다. */ }
}
const layouts: Record<'portrait' | 'landscape', Layout> = { portrait: readLayout('portrait'), landscape: readLayout('landscape') };
const layoutMode = (): 'portrait' | 'landscape' => isPortrait() ? 'portrait' : 'landscape';
const layoutKey = (el: HTMLElement): string => el.dataset.skill ?? el.id;

/** 세로 부채꼴: 공격 버튼 왼쪽 위. 지름 52 · 거리 96이면 34도 간격이면 서로 닿지 않는다. */
const PORTRAIT_SKILLS: Readonly<Record<SkillKey, number>> = { q: 84, w: 118, e: 152, r: 186 };
function layoutPortrait(W: number, H: number, safe: Box, controlTop: number): void {
  const offsets = layouts.portrait, bottom = H - safe.b - BOTTOM_GAP, right = W - safe.r - 12;
  const place = (el: HTMLElement, cx: number, cy: number, size: number): void => {
    const half = size / 2, move = offsets[layoutKey(el)];
    const x = Math.min(right - half, Math.max(safe.l + 8 + half, cx + (Number(move?.[0]) || 0)));
    const y = Math.min(bottom - half, Math.max(controlTop + half, cy + (Number(move?.[1]) || 0)));
    el.style.left = `${Math.round(x - half)}px`;
    el.style.top = `${Math.round(y - half)}px`;
    el.classList.remove('is-over');
  };
  const ax = right - 38, ay = bottom - 38, polar = (angle: number, distance: number): [number, number] => [ax + Math.cos(angle * Math.PI / 180) * distance, ay - Math.sin(angle * Math.PI / 180) * distance];
  place(attackBtn, ax, ay, 76);
  for (const button of skillPad.querySelectorAll<HTMLButtonElement>('button[data-skill]')) place(button, ...polar(PORTRAIT_SKILLS[button.dataset.skill as SkillKey], 96), 52);
  place(swapBtn, ...polar(112, 150), 40);
  place(comboButton, ...polar(148, 158), 52);
  place(dashBtn, ax - 156, ay + 10, 56);
}

function layoutControls(W: number, H: number, safe: Box, stage: Box): void {
  const skillButtons = skillPad.querySelectorAll<HTMLButtonElement>('button[data-skill]');
  if (isPortrait()) { layoutPortrait(W, H, safe, stage.b + STATUS_ROW + 6); return; }
  if (!touchSeen) {
    for (const el of [attackBtn, joystick, swapBtn, comboButton, ...skillButtons]) { el.style.left = el.style.top = ''; el.classList.remove('is-over'); }
    return;
  }
  // 버튼이 화면 밖으로 나가거나 노치·홈바에 닿지 않게 안쪽으로 민다
  const place = (el: HTMLElement, cx: number, cy: number, size: number): void => {
    const half = size / 2, pad = 6, move = layouts.landscape[layoutKey(el)];
    const x = Math.min(W - safe.r - half - pad, Math.max(safe.l + half + pad, cx + (Number(move?.[0]) || 0)));
    const y = Math.min(H - safe.b - half - pad, Math.max(safe.t + half + pad, cy + (Number(move?.[1]) || 0)));
    el.style.left = `${Math.round(x - half)}px`;
    el.style.top = `${Math.round(y - half)}px`;
    // 게임 화면과 겹치면 반투명
    el.classList.toggle('is-over', x + half > stage.l && x - half < stage.r && y + half > stage.t && y - half < stage.b);
  };
  // 좌우 여백이 버튼보다 넓으면 여백 한가운데, 아니면 가장자리에서 10% / 아래에서 18%
  const roomRight = W - stage.r - safe.r, roomLeft = stage.l - safe.l;
  const ax = roomRight >= ATTACK_SIZE + 16 ? W - safe.r - roomRight / 2 : W - Math.max(W * 0.1, safe.r + 8) - ATTACK_SIZE / 2;
  const ay = H - Math.max(H * 0.18, safe.b + 8) - ATTACK_SIZE / 2;
  place(attackBtn, ax, ay, ATTACK_SIZE);
  for (const button of skillButtons) {
    const angle = SKILL_ANGLES[button.dataset.skill as SkillKey] * Math.PI / 180;
    place(button, ax + Math.cos(angle) * SKILL_RADIUS, ay - Math.sin(angle) * SKILL_RADIUS, SKILL_SIZE);
  }
  // 정령 교체: 스킬 부채꼴 바깥쪽 위
  const swapAngle = 125 * Math.PI / 180, swapDistance = SKILL_RADIUS + SKILL_SIZE / 2 + SWAP_SIZE / 2 + 8;
  place(swapBtn, ax + Math.cos(swapAngle) * swapDistance, ay - Math.sin(swapAngle) * swapDistance, SWAP_SIZE);
  // 합동 궁극기: 부채꼴 바깥, 정령 교체와 같은 거리의 왼쪽
  const comboAngle = COMBO_ANGLE * Math.PI / 180;
  place(comboButton, ax + Math.cos(comboAngle) * swapDistance, ay - Math.sin(comboAngle) * swapDistance, SKILL_SIZE);
  const jx = roomLeft >= STICK_SIZE + 16 ? safe.l + roomLeft / 2 : Math.max(W * 0.1, safe.l + 8) + STICK_SIZE / 2;
  place(joystick, jx, H - Math.max(H * 0.18, safe.b + 8) - STICK_SIZE / 2, STICK_SIZE);
}

/* ── 모바일: 전체화면만 시도한다. 방향은 기기를 따른다. 안 되는 브라우저는 조용히 넘어간다. ── */
async function enterFullscreen(): Promise<void> {
  if (!touchSeen) return;
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
  } catch { /* 아이폰 사파리 등은 지원하지 않는다. 브라우저 화면 그대로 플레이한다. */ }
}

/* ── 일시정지: 방향이 바뀌면 자동으로, 세로에서는 버튼으로. '계속하기'를 눌러야 이어진다. ── */
const pauseOverlay = must<HTMLDialogElement>('#pauseOverlay');
const IN_PROGRESS = ['opening', 'talk', 'play', 'slide', 'embrace'];
function openPause(): void {
  if (!IN_PROGRESS.includes(game.mode) || accounts.paused) return;
  resetInput();
  must<HTMLButtonElement>('#pauseItems').hidden = game.mode !== 'play';
  pauseOverlay.showModal();
}
let shownPortrait = isPortrait();
function updateOrientation(): void {
  const portrait = isPortrait();
  if (portrait === shownPortrait) return;
  shownPortrait = portrait;
  openPause();
}
pauseOverlay.addEventListener('cancel', e => e.preventDefault());
pauseOverlay.addEventListener('close', () => canvas.focus({ preventScroll: true }));
must<HTMLButtonElement>('#pauseResume').addEventListener('click', () => {
  pauseOverlay.close();
  sfx.unlock();
  void enterFullscreen();
});
must<HTMLButtonElement>('#pauseItems').addEventListener('click', () => { pauseOverlay.close(); toggleItems(); });
must<HTMLButtonElement>('#pauseSettings').addEventListener('click', () => { pauseOverlay.close(); openSettings(); });
must<HTMLButtonElement>('#pauseAccount').addEventListener('click', () => { pauseOverlay.close(); must<HTMLButtonElement>('#accountToggle').click(); });
pauseToggle.addEventListener('click', openPause);

/* ── 버튼 배치 편집: 설정에서 들어가 끌어서 옮긴다 ── */
let editing = false;
let dragging: { el: HTMLElement; id: number; x: number; y: number } | null = null;
const editableButtons = (): HTMLElement[] => [attackBtn, swapBtn, comboButton, ...skillPad.querySelectorAll<HTMLButtonElement>('button[data-skill]'), ...(isPortrait() ? [dashBtn] : [joystick])];
function setEditing(on: boolean): void {
  editing = on; dragging = null;
  layoutEdit.hidden = !on;
  document.documentElement.classList.toggle('layout-editing', on);
  if (!on) saveLayout(layoutMode(), layouts[layoutMode()]);
  fit();
}
const editButton = must<HTMLButtonElement>('#editLayout');
editButton.addEventListener('click', () => { settingsDialog.close(); setEditing(true); });
// 드래그 직후의 탭은 click이 오지 않는 경우가 있어 손을 뗄 때 처리한다
must<HTMLButtonElement>('#layoutDone').addEventListener('pointerup', () => setEditing(false));
must<HTMLButtonElement>('#layoutReset').addEventListener('pointerup', () => { layouts[layoutMode()] = {}; fit(); });
layoutEdit.addEventListener('pointerdown', e => {
  if ((e.target as Element).closest('button')) return;
  let best: HTMLElement | null = null, near = 48;
  for (const el of editableButtons()) {
    const r = el.getBoundingClientRect(), d = Math.hypot(r.left + r.width / 2 - e.clientX, r.top + r.height / 2 - e.clientY);
    if (d < near) { near = d; best = el; }
  }
  if (!best) return;
  dragging = { el: best, id: e.pointerId, x: e.clientX, y: e.clientY };
  layoutEdit.setPointerCapture(e.pointerId);
});
layoutEdit.addEventListener('pointermove', e => {
  if (!dragging || e.pointerId !== dragging.id) return;
  const layout = layouts[layoutMode()], key = layoutKey(dragging.el), [x, y] = layout[key] ?? [0, 0];
  layout[key] = [x + e.clientX - dragging.x, y + e.clientY - dragging.y];
  dragging.x = e.clientX; dragging.y = e.clientY;
  fit();
});
layoutEdit.addEventListener('pointerup', () => { dragging = null; });

for (const target of [window, window.visualViewport]) {
  target?.addEventListener('resize', () => fit());
}
window.addEventListener('orientationchange', () => { fit(); window.setTimeout(fit, 300); });
portraitQuery.addEventListener('change', () => fit());
document.addEventListener('fullscreenchange', () => fit());
new ResizeObserver(() => { resetInput(); fit(); }).observe(viewportEl);
applyTouchUi();
fit();

/* ── 데스크톱 마우스: 우클릭 = 이동(끌면 계속 따라감) / 적이면 공격, 좌클릭 = 적 정보 ── */
function toGame(e: { clientX: number; clientY: number }): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) / r.width) * VIEW_W,
    y: ((e.clientY - r.top) / r.height) * VIEW_H,
  };
}

let movePointer: number | null = null;
let movePosition: { clientX: number; clientY: number } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  sfx.unlock();
  markTouch(e);
  if (game.mode === 'opening') {
    game.cineTap();
    return;
  }
  if (game.mode === 'talk') {
    game.advanceTalk();
    return;
  }
  if (e.pointerType === 'touch') return;
  const p = toGame(e);
  if (e.button === 0) { game.inspectAt(p.x, p.y); return; }
  if (e.button !== 2 || game.attackAt(p.x, p.y)) return;
  movePointer = e.pointerId;
  movePosition = { clientX: e.clientX, clientY: e.clientY };
  canvas.setPointerCapture(e.pointerId);
  game.moveTo(p.x, p.y, true);
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== movePointer) return;
  movePosition = { clientX: e.clientX, clientY: e.clientY };
  const p = toGame(e);
  game.moveTo(p.x, p.y, false);
});
const endMove = (e: PointerEvent): void => {
  if (e.pointerId === movePointer) {
    movePointer = null;
    movePosition = null;
  }
};
canvas.addEventListener('pointerup', endMove);
canvas.addEventListener('pointercancel', endMove);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

/* ── 세로: 대사창 아래 빈 조작 영역을 눌러도 대사가 넘어간다 ── */
window.addEventListener('pointerdown', e => {
  if (!isPortrait() || game.mode !== 'talk' || accounts.paused) return;
  if (e.clientY >= stageEl.getBoundingClientRect().bottom + STATUS_ROW && !(e.target as Element).closest('#talk')) game.advanceTalk();
});

/* ── 화면(타이틀/쓰러짐/클리어)과 대사창 ── */
uiEl.addEventListener('pointerdown', (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  sfx.unlock();
  markTouch(e);
  if (target.closest('#cineSkip')) game.cineSkip();
  else if (target.closest('#cine')) game.cineTap();
  else if (target.closest('#talk')) game.advanceTalk();
  else if (target.closest('#down, #clear')) game.onScreenTap();
});

/* ── 키보드: 방향키 이동, Space 공격, QWER 정령 스킬, Enter 진행 ── */
const ATTACK_KEYS = new Set(['Space', 'KeyJ', 'KeyZ']);
const SKILL_KEYS: Readonly<Record<string, SkillKey>> = { KeyQ: 'q', KeyW: 'w', KeyE: 'e', KeyR: 'r' };
const ARROW_KEYS: Readonly<Record<string, readonly [number, number]>> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const heldArrows = new Set<string>();
let arrowsDriving = false;
/** 대각선도 같은 속도. 손을 떼면 그 자리에 선다. 마우스로 낸 이동은 건드리지 않는다. */
function applyArrows(): void {
  let x = 0, y = 0;
  for (const code of heldArrows) { const d = ARROW_KEYS[code]; if (d) { x += d[0]; y += d[1]; } }
  if (x || y) {
    const length = Math.hypot(x, y);
    input.move = { x: x / length, y: y / length };
    arrowsDriving = true;
  } else if (arrowsDriving) {
    input.move = { x: 0, y: 0 };
    arrowsDriving = false;
  }
}

window.addEventListener('keydown', (e) => {
  // 창이 열려 있어도 I로 닫을 수 있게 아래 일시정지 검사보다 먼저 본다
  if (e.code === 'KeyI' && !e.repeat && assetsReady && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); toggleItems(); return; }
  if (settingsDialog.open || rewardDialog.open || accounts.paused || e.target instanceof HTMLInputElement || !assetsReady) return;
  // 버튼에 포커스가 남아 있으면 키가 전부 버튼으로 새던 버그: 게임 중에는 포커스를 캔버스로 돌리고 키를 게임이 받는다.
  if (e.target instanceof HTMLButtonElement) {
    if (game.mode === 'title') return;
    e.target.blur();
    canvas.focus({ preventScroll: true });
  }
  // Tab은 어떤 상태에서도 브라우저 포커스 이동을 막는다 (대사·방 이동 중에 눌러도 포커스가 버튼으로 새지 않게)
  if (e.code === 'Tab') {
    e.preventDefault();
    if (!e.repeat && game.mode === 'play') game.cycleSpirit();
    return;
  }
  if (ARROW_KEYS[e.code]) { e.preventDefault(); heldArrows.add(e.code); return; }
  if (e.code === 'KeyF') { e.preventDefault(); if (!e.repeat) { sfx.unlock(); game.castCombo(); } return; }
  const skill = SKILL_KEYS[e.code];
  const isAttack = ATTACK_KEYS.has(e.code);
  if (!skill && !isAttack && e.code !== 'Enter') return;
  e.preventDefault();
  if (e.repeat) return;
  sfx.unlock();
  if (game.mode === 'opening') {
    if (!skill) game.cineTap();
    return;
  }
  if (game.mode === 'talk') {
    if (!skill) game.advanceTalk();
    return;
  }
  if(game.mode==='embrace'){if(isAttack)game.attackPressed();return;}
  if (game.mode === 'title') {
    // 타이틀에서 Enter/Space = 바로 시작 (로그인 전이면 게스트로)
    if (!skill) (accounts.signedIn ? startButton : guestButton).click();
    return;
  }
  if (game.mode === 'down' || game.mode === 'clear') {
    if (!skill && accounts.confirmStart()) game.onScreenTap();
    return;
  }
  if (skill) input.skillQueue.push(skill);
  else if (isAttack) {game.attackPressed();input.attackHeld = true;}
});
window.addEventListener('keyup', (e) => {
  if (ATTACK_KEYS.has(e.code)) input.attackHeld = false;
  heldArrows.delete(e.code);
});

/* ── 모바일 버튼 ── */
let joystickPointer: number | null = null;
/** 세로 플로팅 조이스틱: 누른 자리가 중심. 반경 50px, 데드존 10%. */
const STICK_RADIUS = 50, STICK_DEAD = 0.1;
let stickCenter: { x: number; y: number } | null = null;
function updateFloatingStick(e: PointerEvent): void {
  if (!stickCenter) return;
  const dx = e.clientX - stickCenter.x, dy = e.clientY - stickCenter.y, distance = Math.hypot(dx, dy), length = Math.min(distance, STICK_RADIUS);
  const strength = Math.max(0, (length / STICK_RADIUS - STICK_DEAD) / (1 - STICK_DEAD));
  input.move = { x: distance ? dx / distance * strength : 0, y: distance ? dy / distance * strength : 0 };
  joystickKnob.style.transform = `translate(${distance ? dx / distance * length : 0}px, ${distance ? dy / distance * length : 0}px)`;
}
function updateJoystick(e: PointerEvent): void {
  const r = joystick.getBoundingClientRect();
  const dx = e.clientX - r.left - r.width / 2;
  const dy = e.clientY - r.top - r.height / 2;
  const distance = Math.hypot(dx, dy);
  const radius = r.width * 0.28;
  const length = Math.min(distance, radius);
  const strength = Math.max(0, (length / radius - 0.16) / 0.84);
  input.move = { x: distance ? dx / distance * strength : 0, y: distance ? dy / distance * strength : 0 };
  joystickKnob.style.transform = `translate(${distance ? dx / distance * length : 0}px, ${distance ? dy / distance * length : 0}px)`;
}
function releaseJoystick(): void {
  const pointer = joystickPointer;
  joystickPointer = null;
  input.move = { x: 0, y: 0 };
  joystickKnob.style.transform = '';
  stickCenter = null;
  touchZone.classList.remove('is-held');
  if (pointer !== null && joystick.hasPointerCapture(pointer)) joystick.releasePointerCapture(pointer);
  if (pointer !== null && touchZone.hasPointerCapture(pointer)) touchZone.releasePointerCapture(pointer);
}
touchZone.addEventListener('pointerdown', e => {
  if (joystickPointer !== null || (game.mode !== 'play' && game.mode !== 'embrace')) return;
  e.preventDefault(); sfx.unlock(); markTouch(e);
  joystickPointer = e.pointerId;
  stickCenter = { x: e.clientX, y: e.clientY };
  touchZone.classList.add('is-held');
  touchZone.setPointerCapture(e.pointerId);
  joystick.style.left = `${e.clientX - STICK_RADIUS}px`;
  joystick.style.top = `${e.clientY - STICK_RADIUS}px`;
  updateFloatingStick(e);
});
touchZone.addEventListener('pointermove', e => { if (e.pointerId === joystickPointer) updateFloatingStick(e); });
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  touchZone.addEventListener(event, e => { if ((e as PointerEvent).pointerId === joystickPointer) releaseJoystick(); });
}
joystick.addEventListener('pointerdown', e => {
  if (joystickPointer !== null || (game.mode !== 'play' && game.mode !== 'embrace')) return;
  e.preventDefault(); sfx.unlock(); markTouch(e);
  movePointer = null; movePosition = null;
  joystickPointer = e.pointerId;
  joystick.setPointerCapture(e.pointerId);
  canvas.focus({ preventScroll: true });
  updateJoystick(e);
});
joystick.addEventListener('pointermove', e => { if (e.pointerId === joystickPointer) updateJoystick(e); });
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  joystick.addEventListener(event, e => { if ((e as PointerEvent).pointerId === joystickPointer) releaseJoystick(); });
}
attackBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  sfx.unlock();
  if (game.mode === 'talk') {
    game.advanceTalk();
    return;
  }
  if(game.mode==='embrace'){game.attackPressed();return;}
  game.attackPressed();
  attackBtn.setPointerCapture(e.pointerId);
  input.attackHeld = true;
  attackBtn.classList.add('is-down');
});
const releaseAttack = (): void => {
  input.attackHeld = false;
  attackBtn.classList.remove('is-down');
};
attackBtn.addEventListener('pointerup', releaseAttack);
attackBtn.addEventListener('pointercancel', releaseAttack);
attackBtn.addEventListener('lostpointercapture', releaseAttack);
function resetInput(): void {
  releaseAttack();
  releaseJoystick();
  movePointer = null;
  movePosition = null;
  input.skillQueue.length = 0;
  skillPointers.clear();skillAim.hidden=true;game.setAimPreview(null);
}
// 포커스를 잃으면 keyup이 오지 않으니 눌린 방향키도 비운다
window.addEventListener('blur', () => { resetInput(); heldArrows.clear(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { resetInput(); heldArrows.clear(); }
});

const skillPointers=new Map<number,{key:SkillKey;x:number;y:number}>();
/** 세로 드래그 조준: 90px을 끌면 사거리 끝, 150px을 넘으면 취소 */
const AIM_FULL=90,AIM_CANCEL=150,AIM_START=12;
skillPad.addEventListener('pointerdown',e=>{
  const button=(e.target as Element).closest<HTMLButtonElement>('button[data-skill]');
  if(!button||button.disabled)return;
  e.preventDefault();sfx.unlock();button.setPointerCapture(e.pointerId);
  skillPointers.set(e.pointerId,{key:button.dataset.skill as SkillKey,x:e.clientX,y:e.clientY});
});
skillPad.addEventListener('pointermove',e=>{
  const start=skillPointers.get(e.pointerId);if(!start||Math.hypot(e.clientX-start.x,e.clientY-start.y)<12)return;
  skillAim.hidden=false;skillAim.style.left=`${e.clientX-14}px`;skillAim.style.top=`${e.clientY-14}px`;
  if(isPortrait()){
    const dx=e.clientX-start.x,dy=e.clientY-start.y,pulled=Math.hypot(dx,dy),cancel=pulled>AIM_CANCEL;
    skillAim.classList.toggle('is-cancel',cancel);
    game.setAimPreview({...game.aimAt(start.key,dx,dy,Math.min(1,pulled/AIM_FULL)),cancel});
  }
});
skillPad.addEventListener('pointerup',e=>{
  const start=skillPointers.get(e.pointerId);if(!start)return;
  const dx=e.clientX-start.x,dy=e.clientY-start.y,pulled=Math.hypot(dx,dy);
  skillPointers.delete(e.pointerId);skillAim.hidden=true;skillAim.classList.remove('is-cancel');game.setAimPreview(null);
  if(isPortrait()){
    if(pulled>AIM_CANCEL)return;
    input.skillQueue.push(pulled>=AIM_START?{key:start.key,...game.aimAt(start.key,dx,dy,Math.min(1,pulled/AIM_FULL))}:start.key);
    return;
  }
  input.skillQueue.push(pulled>=AIM_START?{key:start.key,...toGame(e)}:start.key);
});
skillPad.addEventListener('pointercancel',e=>{skillPointers.delete(e.pointerId);skillAim.hidden=true;skillAim.classList.remove('is-cancel');game.setAimPreview(null);});
swapBtn.addEventListener('pointerdown',e=>{e.preventDefault();sfx.unlock();game.cycleSpirit();});
comboButton.addEventListener('pointerdown',e=>{e.preventDefault();sfx.unlock();game.castCombo();});
dashBtn.addEventListener('pointerdown',e=>{e.preventDefault();sfx.unlock();game.dash();});
must('#spiritSlots').addEventListener('click',e=>{
  const button=(e.target as Element).closest<HTMLButtonElement>('button[data-spirit]');
  if(button){game.cycleSpirit(Number(button.dataset.spirit));canvas.focus({preventScroll:true});}
});


/* ── 스킬 설명: 마우스를 올리면 이름·기력·쿨타임·효과. 비활성(쿨타임·기력 부족)이어도 보인다. ── */
const skillTip = must<HTMLDivElement>('#skillTip');
let tipFor: string | null = null;
function showTip(key: string, anchor: DOMRect): void {
  const slot = game.equipped[game.activeSpirit];
  if (!slot) { hideTip(); return; }
  const k = key as SkillKey, spec = SKILLS[slot.element][k];
  const locked = k === 'r' && slot.tier < 2;
  const sig = `${slot.element}${k}${slot.tier}`;
  if (tipFor !== sig) {
    tipFor = sig;
    must('#skillTipName').textContent = `${k.toUpperCase()} · ${spec.name}`;
    must('#skillTipMeta').textContent = `${SPIRIT_NAMES[slot.element]} · 기력 ${spec.cost} · 재사용 ${spec.cd}초`;
    must('#skillTipText').textContent = locked ? `${SKILL_DESC[slot.element][k]}

정령이 중급으로 자라면 열린다. (스킬을 쓰며 성장)` : SKILL_DESC[slot.element][k];
    skillTip.classList.toggle('is-locked', locked);
    skillTip.style.borderColor = ELEMENT[slot.element].glow;
  }
  skillTip.hidden = false;
  const w = skillTip.offsetWidth, h = skillTip.offsetHeight;
  skillTip.style.left = `${Math.round(Math.max(6, Math.min(window.innerWidth - w - 6, anchor.left + anchor.width / 2 - w / 2)))}px`;
  const above = anchor.top - h - 8;
  skillTip.style.top = `${Math.round(above >= 6 ? above : anchor.bottom + 8)}px`;
}
function hideTip(): void { if (!skillTip.hidden) skillTip.hidden = true; tipFor = null; }
document.addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse') return;
  // 비활성 버튼도 hit-test는 되므로 좌표로 찾는다
  const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-skill], #comboSkill, #spiritSlots button[data-spirit]');
  if (!el || skillPad.hidden && el.dataset.skill) { hideTip(); return; }
  if (el.dataset.skill) { showTip(el.dataset.skill, el.getBoundingClientRect()); return; }
  if (el === comboButton) {
    const combo = game.comboHud;
    if (!combo) { hideTip(); return; }
    tipFor = null;
    must('#skillTipName').textContent = `F · ${combo.name}`;
    must('#skillTipMeta').textContent = `${combo.pair} · 기력 ${combo.cost}`;
    must('#skillTipText').textContent = `${combo.text}\n\n두 정령이 모두 중급이고 R이 준비돼 있어야 한다. 쓰면 둘의 R이 함께 돈다.`;
    skillTip.classList.toggle('is-locked', !combo.grown);
    skillTip.style.borderColor = '#e0a458';
    skillTip.hidden = false;
    const r = el.getBoundingClientRect(), w = skillTip.offsetWidth, h = skillTip.offsetHeight;
    skillTip.style.left = `${Math.round(Math.max(6, Math.min(window.innerWidth - w - 6, r.left)))}px`;
    skillTip.style.top = `${Math.round(Math.max(6, r.top - h - 8))}px`;
    return;
  }
  const slot = game.equipped[Number(el.dataset.spirit)];
  if (!slot) { hideTip(); return; }
  tipFor = null;
  must('#skillTipName').textContent = `${SPIRIT_NAMES[slot.element]} · ${ELEMENT[slot.element].label}`;
  must('#skillTipMeta').textContent = `${slot.tier === 1 ? '하급' : slot.tier === 2 ? '중급' : '상급'} · ${SPIRIT_ROLES[slot.element]}`;
  must('#skillTipText').textContent = `클릭하거나 Tab으로 교체. 정령마다 쿨타임은 따로 돈다.`;
  skillTip.classList.remove('is-locked');
  skillTip.style.borderColor = ELEMENT[slot.element].glow;
  skillTip.hidden = false;
  const r = el.getBoundingClientRect(), w = skillTip.offsetWidth, h = skillTip.offsetHeight;
  skillTip.style.left = `${Math.round(Math.max(6, Math.min(window.innerWidth - w - 6, r.left)))}px`;
  skillTip.style.top = `${Math.round(Math.max(6, r.top - h - 8))}px`;
});
document.addEventListener('pointerleave', hideTip);
window.addEventListener('blur', hideTip);

/* ── 개발용 관측 훅 (PDF 12번: 캔버스 결과는 상태 훅과 함께 확인) ── */
if (location.hostname === 'localhost') (window as unknown as { __jamsildo: Game }).__jamsildo = game;

/* ── 루프 ── */
let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const paused=document.hidden||settingsDialog.open||rewardDialog.open||accounts.paused||editing;
  // 방을 넘어가는 동안은 손을 뗀 게 아니다: 조이스틱을 놓치면 문을 지날 때마다 다시 눌러야 한다
  if(paused || (game.mode !== 'play' && game.mode !== 'embrace' && game.mode !== 'slide')) { resetInput(); hideTip(); }
  if(!paused && (game.mode === 'play' || game.mode === 'embrace')) applyArrows();
  if(!paused) game.update(dt);
  if (!paused && movePosition && (game.mode === 'play'||game.mode==='embrace')) {
    const p = toGame(movePosition);
    game.moveTo(p.x, p.y, false);
  }
  game.render();
  ui.showEnemyInfo(game.inspectedInfo);
  ui.showPickup(game.pickupPrompt);
  const portrait = isPortrait(), moving = game.mode === 'play' || game.mode === 'embrace';
  joystick.hidden = portrait ? joystickPointer === null : !(touchSeen && (moving || editing));
  skillPad.hidden = !((game.hasSpirit && game.mode === 'play') || editing);
  swapBtn.hidden = !(touchSeen && ((game.hasSpirit && game.mode === 'play') || editing));
  attackBtn.hidden = !(touchSeen && ((game.attackUnlocked && moving) || editing));
  dashBtn.hidden = !(portrait && (game.mode === 'play' || editing));
  dashBtn.disabled = game.dashRatio > 0;
  dashBtn.style.setProperty('--cd', String(game.dashRatio));
  touchZone.hidden = !(portrait && moving);
  if (editing) comboButton.hidden = false;
  attackBtn.classList.toggle('is-embrace',game.mode==='embrace');attackBtn.textContent=game.mode==='embrace'?'안아주기':'공격';
  const inGame = game.mode === 'play' || game.mode === 'talk' || game.mode === 'slide'||game.mode==='embrace';
  document.documentElement.classList.toggle('in-game', inGame);
  must<HTMLElement>('#accountBar').hidden = game.mode === 'opening';
  healthHud.hidden = !inGame;
  minimap.hidden = !inGame;
  settingsToggle.hidden = !inGame;
  topBar.hidden = pauseToggle.hidden = statusBar.hidden = !(portrait && inGame);
  editButton.hidden = !touchSeen;
  itemsToggle.hidden = !inGame;
  must<HTMLElement>('#stageInfo').hidden=!inGame;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
