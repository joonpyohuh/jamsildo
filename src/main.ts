import { VIEW_H, VIEW_W } from './game/config';
import { Sfx } from './game/audio';
import { Game, type InputState, type SkillKey } from './game/game';
import { Ui } from './game/ui';
import { loadArt } from './game/assets';
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
const startButton=must<HTMLButtonElement>('#startGame');
const continueButton=must<HTMLButtonElement>('#continueGame');

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
continueButton.addEventListener('click',()=>{if(assetsReady){sfx.unlock();game.resumeRun();}});
startButton.addEventListener('click', () => {
  if(!assetsReady || !accounts.confirmStart())return;
  sfx.unlock();
  game.onScreenTap();
});
volume.addEventListener('change', () => {
  sfx.unlock();
  sfx.play('pickup');
});

/* 세로는 260픽셀 너비, 가로는 방 전체를 보여준다. 오프닝은 장면 전체를 보존한다. */
let scale = 1;
let fittedMode = game.mode;
function fit(): void {
  const ratios = [viewportEl.clientWidth / VIEW_W, viewportEl.clientHeight / VIEW_H];
  const portrait = viewportEl.clientHeight > viewportEl.clientWidth;
  scale = game.mode === 'opening' ? Math.min(...ratios)
    : Math.min(viewportEl.clientWidth / (portrait ? 260 : VIEW_W), ratios[1]);
  stageEl.style.width = `${VIEW_W * scale}px`;
  stageEl.style.height = `${VIEW_H * scale}px`;
  ui.setScale(scale);
  fittedMode = game.mode;
  placeCamera();
}
function placeCamera(): void {
  const w = Math.min(VIEW_W, viewportEl.clientWidth / scale);
  const h = Math.min(VIEW_H, viewportEl.clientHeight / scale);
  const focus = game.cameraFocus;
  const x = Math.max(0, Math.min(VIEW_W - w, focus.x - w / 2));
  const y = Math.max(0, Math.min(VIEW_H - h, focus.y - h / 2));
  game.viewport = { x, y, w, h };
  stageEl.style.left = `${Math.max(0, (viewportEl.clientWidth - VIEW_W * scale) / 2) - x * scale}px`;
  stageEl.style.top = `${Math.max(0, (viewportEl.clientHeight - VIEW_H * scale) / 2) - y * scale}px`;
}
new ResizeObserver(() => { resetInput(); fit(); }).observe(viewportEl);
fit();

let touchSeen = window.matchMedia('(pointer: coarse)').matches;
const markTouch = (e: PointerEvent): void => {
  if (e.pointerType === 'touch') touchSeen = true;
};

/* ── 데스크톱 이동: 클릭한 지점으로. 누른 채 끌면 계속 따라간다. ── */
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
  movePointer = e.pointerId;
  movePosition = { clientX: e.clientX, clientY: e.clientY };
  canvas.setPointerCapture(e.pointerId);
  const p = toGame(e);
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

/* ── 키보드: Space 공격, QWER 정령 스킬, Enter 진행 ── */
const ATTACK_KEYS = new Set(['Space', 'KeyJ', 'KeyZ']);
const SKILL_KEYS: Readonly<Record<string, SkillKey>> = { KeyQ: 'q', KeyW: 'w', KeyE: 'e', KeyR: 'r' };

window.addEventListener('keydown', (e) => {
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
  if (game.mode === 'title' || game.mode === 'down' || game.mode === 'clear') {
    if (!skill && accounts.confirmStart()) game.onScreenTap();
    return;
  }
  if (skill) input.skillQueue.push(skill);
  else if (isAttack) {game.attackPressed();input.attackHeld = true;}
});
window.addEventListener('keyup', (e) => {
  if (ATTACK_KEYS.has(e.code)) input.attackHeld = false;
});

/* ── 모바일 버튼 ── */
let joystickPointer: number | null = null;
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
  if (pointer !== null && joystick.hasPointerCapture(pointer)) joystick.releasePointerCapture(pointer);
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
  skillPointers.clear();skillAim.hidden=true;
}
window.addEventListener('blur', resetInput);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) resetInput();
});

const skillPointers=new Map<number,{key:SkillKey;x:number;y:number}>();
skillPad.addEventListener('pointerdown',e=>{
  const button=(e.target as Element).closest<HTMLButtonElement>('button[data-skill]');
  if(!button||button.disabled)return;
  e.preventDefault();sfx.unlock();button.setPointerCapture(e.pointerId);
  skillPointers.set(e.pointerId,{key:button.dataset.skill as SkillKey,x:e.clientX,y:e.clientY});
});
skillPad.addEventListener('pointermove',e=>{
  const start=skillPointers.get(e.pointerId);if(!start||Math.hypot(e.clientX-start.x,e.clientY-start.y)<12)return;
  skillAim.hidden=false;skillAim.style.left=`${e.clientX-14}px`;skillAim.style.top=`${e.clientY-14}px`;
});
skillPad.addEventListener('pointerup',e=>{
  const start=skillPointers.get(e.pointerId);if(!start)return;
  const point=toGame(e);
  input.skillQueue.push(Math.hypot(e.clientX-start.x,e.clientY-start.y)>=12?{key:start.key,...point}:start.key);
  skillPointers.delete(e.pointerId);skillAim.hidden=true;
});
skillPad.addEventListener('pointercancel',e=>{skillPointers.delete(e.pointerId);skillAim.hidden=true;});
must('#spiritSlots').addEventListener('click',e=>{
  const button=(e.target as Element).closest<HTMLButtonElement>('button[data-spirit]');
  if(button){game.cycleSpirit(Number(button.dataset.spirit));canvas.focus({preventScroll:true});}
});


/* ── 개발용 관측 훅 (PDF 12번: 캔버스 결과는 상태 훅과 함께 확인) ── */
if (location.hostname === 'localhost') (window as unknown as { __jamsildo: Game }).__jamsildo = game;

/* ── 루프 ── */
let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const paused=document.hidden||settingsDialog.open||rewardDialog.open||accounts.paused;
  if(paused || (game.mode !== 'play' && game.mode !== 'embrace')) resetInput();
  if(!paused) game.update(dt);
  if (fittedMode !== game.mode) fit();
  else placeCamera();
  if (!paused && movePosition && (game.mode === 'play'||game.mode==='embrace')) {
    const p = toGame(movePosition);
    game.moveTo(p.x, p.y, false);
  }
  game.render();
  document.documentElement.classList.toggle('touch-controls', touchSeen);
  joystick.hidden = !(touchSeen && (game.mode === 'play' || game.mode === 'embrace'));
  skillPad.hidden = !(game.hasSpirit && game.mode === 'play');
  attackBtn.hidden = !(touchSeen && game.attackUnlocked && (game.mode === 'play'||game.mode==='embrace'));
  attackBtn.classList.toggle('is-embrace',game.mode==='embrace');attackBtn.textContent=game.mode==='embrace'?'안아주기':'공격';
  const inGame = game.mode === 'play' || game.mode === 'talk' || game.mode === 'slide'||game.mode==='embrace';
  healthHud.hidden = !inGame;
  minimap.hidden = !inGame;
  settingsToggle.hidden = !inGame;
  must<HTMLElement>('#stageInfo').hidden=!inGame;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
