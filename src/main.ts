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
const swapBtn=must<HTMLButtonElement>('#swapSpirit');
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
const startChoice=must<HTMLDivElement>('#startChoice');
function toggleStartChoice(open:boolean):void {
  startChoice.hidden=!open;startButton.setAttribute('aria-expanded',String(open));
  if(open)must<HTMLButtonElement>('#startRegister').focus({preventScroll:true});
}
startButton.addEventListener('click', () => {
  if(!assetsReady)return;
  void enterLandscape();
  // 로그인하지 않았으면 바로 시작하지 않고 아래에 게스트 / 회원가입을 펼친다
  if(!accounts.signedIn){toggleStartChoice(startChoice.hidden);return;}
  if(!accounts.confirmStart())return;
  sfx.unlock();
  game.onScreenTap();
});
must<HTMLButtonElement>('#startGuest').addEventListener('click',()=>{
  if(!assetsReady)return;
  sfx.unlock();accounts.playAsGuest();toggleStartChoice(false);
  game.onScreenTap();
});
must<HTMLButtonElement>('#startRegister').addEventListener('click',()=>{if(assetsReady)accounts.openAuth('register');});
must<HTMLButtonElement>('#startLogin').addEventListener('click',()=>{if(assetsReady)accounts.openAuth('login');});
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
function fit(): void {
  const W = window.innerWidth, H = window.innerHeight, safe = safeArea(), dpr = window.devicePixelRatio || 1;
  const areaW = W - safe.l - safe.r, areaH = H - safe.t - safe.b;
  const scale = pickScale(Math.min(areaW / VIEW_W, areaH / VIEW_H));
  const width = VIEW_W * scale, height = VIEW_H * scale;
  const left = Math.round((safe.l + (areaW - width) / 2) * dpr) / dpr, top = Math.round((safe.t + (areaH - height) / 2) * dpr) / dpr;
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
  ui.setScale(scale);
  layoutControls(W, H, safe, { l: left, t: top, r: left + width, b: top + height });
  updateOrientation();
}

/* ── 터치 버튼 배치 ── */
const SKILL_ANGLES: Readonly<Record<SkillKey, number>> = { q: 90, w: 125, e: 160, r: 195 };
const SKILL_RADIUS = 100, SKILL_SIZE = 56, ATTACK_SIZE = 80, SWAP_SIZE = 44, STICK_SIZE = 112;
function layoutControls(W: number, H: number, safe: Box, stage: Box): void {
  const skillButtons = skillPad.querySelectorAll<HTMLButtonElement>('button[data-skill]');
  if (!touchSeen) {
    for (const el of [attackBtn, joystick, swapBtn, ...skillButtons]) { el.style.left = el.style.top = ''; el.classList.remove('is-over'); }
    return;
  }
  // 버튼이 화면 밖으로 나가거나 노치·홈바에 닿지 않게 안쪽으로 민다
  const place = (el: HTMLElement, cx: number, cy: number, size: number): void => {
    const half = size / 2, pad = 6;
    const x = Math.min(W - safe.r - half - pad, Math.max(safe.l + half + pad, cx));
    const y = Math.min(H - safe.b - half - pad, Math.max(safe.t + half + pad, cy));
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
  const jx = roomLeft >= STICK_SIZE + 16 ? safe.l + roomLeft / 2 : Math.max(W * 0.1, safe.l + 8) + STICK_SIZE / 2;
  place(joystick, jx, H - Math.max(H * 0.18, safe.b + 8) - STICK_SIZE / 2, STICK_SIZE);
}

/* ── 모바일 가로: 전체화면 → 가로 고정. 안 되는 브라우저는 조용히 넘어간다. ── */
async function enterLandscape(): Promise<void> {
  if (!touchSeen) return;
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape');
  } catch { /* 아이폰 사파리 등은 지원하지 않는다. 세로 안내로 대신한다. */ }
}

/* ── 세로면 일시정지 + 안내. 가로로 돌아와도 '계속하기'를 눌러야 이어진다. ── */
const rotateOverlay = must<HTMLDialogElement>('#rotateOverlay');
const rotateResume = must<HTMLButtonElement>('#rotateResume');
const rotateText = must<HTMLElement>('#rotateText');
function updateOrientation(): void {
  const portrait = touchSeen && window.innerHeight > window.innerWidth;
  if (portrait) {
    rotateOverlay.classList.remove('is-landscape');
    rotateText.textContent = '화면을 가로로 돌려주세요';
    rotateResume.hidden = true;
    if (!rotateOverlay.open) rotateOverlay.showModal();
    return;
  }
  if (!rotateOverlay.open) return;
  // 진행 중인 게임이 없으면 눌러서 이어갈 것도 없다
  if (!['opening', 'talk', 'play', 'slide', 'embrace'].includes(game.mode)) { rotateOverlay.close(); return; }
  rotateOverlay.classList.add('is-landscape');
  rotateText.textContent = '일시정지';
  rotateResume.hidden = false;
}
rotateOverlay.addEventListener('cancel', e => e.preventDefault());
rotateResume.addEventListener('click', () => {
  rotateOverlay.close();
  sfx.unlock();
  void enterLandscape();
  canvas.focus({ preventScroll: true });
});
{
  // 도트 폰 아이콘: 세로 폰 + 도는 방향 화살표
  const rows = ['.......aaaa.............', '......a....a............', '.....a......a...........', '..........aaa...........', '...........a............', '........................',
    '.......pppppppppp.......', '.......pssssssssp.......', '.......pssssssssp.......', '.......pssssssssp.......', '.......pssssssssp.......', '.......pssssssssp.......',
    '.......pssssssssp.......', '.......pssssssssp.......', '.......pssssssssp.......', '.......pssssssssp.......', '.......pssssssssp.......', '.......pssssssssp.......',
    '.......pppppppppp.......', '.......pppaapppppp......'.slice(0, 24), '.......pppppppppp.......'];
  const icon = must<HTMLCanvasElement>('#rotateIcon').getContext('2d');
  const colors: Readonly<Record<string, string>> = { a: '#e0a458', p: '#c9ccd3', s: '#24272e' };
  rows.forEach((row, y) => { for (let x = 0; x < row.length; x += 1) { const c = colors[row.charAt(x)]; if (c && icon) { icon.fillStyle = c; icon.fillRect(x, y + 1, 1, 1); } } });
}

for (const target of [window, window.visualViewport]) {
  target?.addEventListener('resize', () => fit());
}
window.addEventListener('orientationchange', () => { fit(); window.setTimeout(fit, 300); });
document.addEventListener('fullscreenchange', () => fit());
new ResizeObserver(() => { resetInput(); fit(); }).observe(viewportEl);
applyTouchUi();
fit();

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
  if (game.mode === 'title') {
    // 타이틀에서 Enter/Space = '게임 시작' 버튼과 같다 (로그인 전이면 선택지를 펼친다)
    if (!skill) startButton.click();
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
swapBtn.addEventListener('pointerdown',e=>{e.preventDefault();sfx.unlock();game.cycleSpirit();});
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
  if (!paused && movePosition && (game.mode === 'play'||game.mode==='embrace')) {
    const p = toGame(movePosition);
    game.moveTo(p.x, p.y, false);
  }
  game.render();
  joystick.hidden = !(touchSeen && (game.mode === 'play' || game.mode === 'embrace'));
  skillPad.hidden = !(game.hasSpirit && game.mode === 'play');
  swapBtn.hidden = !(touchSeen && game.hasSpirit && game.mode === 'play');
  attackBtn.hidden = !(touchSeen && game.attackUnlocked && (game.mode === 'play'||game.mode==='embrace'));
  attackBtn.classList.toggle('is-embrace',game.mode==='embrace');attackBtn.textContent=game.mode==='embrace'?'안아주기':'공격';
  const inGame = game.mode === 'play' || game.mode === 'talk' || game.mode === 'slide'||game.mode==='embrace';
  document.documentElement.classList.toggle('in-game', inGame);
  must<HTMLElement>('#accountBar').hidden = game.mode === 'opening';
  healthHud.hidden = !inGame;
  minimap.hidden = !inGame;
  settingsToggle.hidden = !inGame;
  must<HTMLElement>('#stageInfo').hidden=!inGame;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
