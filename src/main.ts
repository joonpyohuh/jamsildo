import { VIEW_H, VIEW_W } from './game/config';
import { Sfx } from './game/audio';
import { Game, type InputState, type SkillKey } from './game/game';
import { Ui } from './game/ui';

function must<T extends Element>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element: ${sel}`);
  return el;
}

const stageEl = must<HTMLDivElement>('#stage');
const canvas = must<HTMLCanvasElement>('#game');
const uiEl = must<HTMLDivElement>('#ui');
const attackBtn = must<HTMLButtonElement>('#attack');
const skillPad = must<HTMLDivElement>('#skills');

canvas.width = VIEW_W;
canvas.height = VIEW_H;
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('2d context unavailable');

const sfx = new Sfx();
const ui = new Ui(uiEl);
const input: InputState = { attackHeld: false, skillQueue: [] };
const game = new Game(ctx, sfx, ui, input);

/* ── 화면 맞춤: 2배 이상이면 정수배로만 키운다 (도트가 고르게) ── */
function fit(): void {
  const raw = Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H);
  const s = raw >= 2 ? Math.floor(raw) : raw;
  stageEl.style.width = `${VIEW_W * s}px`;
  stageEl.style.height = `${VIEW_H * s}px`;
  ui.setScale(s);
}
window.addEventListener('resize', fit);
fit();

let touchSeen = window.matchMedia('(pointer: coarse)').matches;
const markTouch = (e: PointerEvent): void => {
  if (e.pointerType === 'touch') touchSeen = true;
};

/* ── 이동: 클릭/터치한 지점으로. 누른 채 끌면 계속 따라간다. ── */
function toGame(e: PointerEvent): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) / r.width) * VIEW_W,
    y: ((e.clientY - r.top) / r.height) * VIEW_H,
  };
}

let movePointer: number | null = null;
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
  movePointer = e.pointerId;
  canvas.setPointerCapture(e.pointerId);
  const p = toGame(e);
  game.moveTo(p.x, p.y, true);
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== movePointer) return;
  const p = toGame(e);
  game.moveTo(p.x, p.y, false);
});
const endMove = (e: PointerEvent): void => {
  if (e.pointerId === movePointer) movePointer = null;
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
  else if (target.closest('#talk')) game.advanceTalk();
  else if (target.closest('.screen')) game.onScreenTap();
});

/* ── 키보드: Space 공격, QWER 정령 스킬, Enter 진행 ── */
const ATTACK_KEYS = new Set(['Space', 'KeyJ', 'KeyZ']);
const SKILL_KEYS: Readonly<Record<string, SkillKey>> = { KeyQ: 'q', KeyW: 'w', KeyE: 'e', KeyR: 'r' };

window.addEventListener('keydown', (e) => {
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
  if (game.mode === 'title' || game.mode === 'down' || game.mode === 'clear') {
    if (!skill) game.onScreenTap();
    return;
  }
  if (skill) input.skillQueue.push(skill);
  else if (isAttack) input.attackHeld = true;
});
window.addEventListener('keyup', (e) => {
  if (ATTACK_KEYS.has(e.code)) input.attackHeld = false;
});
window.addEventListener('blur', () => {
  input.attackHeld = false;
});

/* ── 모바일 버튼 ── */
attackBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  sfx.unlock();
  if (game.mode === 'talk') {
    game.advanceTalk();
    return;
  }
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

skillPad.addEventListener('pointerdown', (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  const key = target.dataset.skill;
  if (key === 'q' || key === 'w' || key === 'e' || key === 'r') {
    e.preventDefault();
    sfx.unlock();
    input.skillQueue.push(key);
  }
});


/* ── 루프 ── */
let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  game.update(dt);
  game.render();
  skillPad.hidden = !(touchSeen && game.hasSpirit && game.mode === 'play');
  attackBtn.hidden = !(touchSeen && game.attackUnlocked && (game.mode === 'play' || game.mode === 'talk'));
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
