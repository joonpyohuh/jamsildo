import {
  COLOR, CX, CY, DOOR_HALF, ELEMENT, FLOOR, SHOW_DAMAGE_NUMBERS, VIEW_H, VIEW_W, WALL_CAP, WALL_TOP,
} from './config';
import { TAU, angleDiff, angleTo, clamp, dist, easeInOut, easeOut, rand, seeded } from './math';
import type { Sfx } from './audio';
import { Fx, drawDigits, pixelEllipse, pixelLine, plot } from './fx';
import { FORMS, chooseForm, type FormId } from './forms';
import { DIRS, DIR_KEYS, generateStage, makeHomeRoom, neighborOf, type Dir, type EnemyKind, type Room, type Stage } from './stage';
import { PROP_IDS, SPRITES, glow, tint, type Sprite } from './sprites';
import type { Ui } from './ui';
import { PixelLayer, actorFromSprite } from './pixelfx';
import { FIRE_SPIRIT_TAKEN, OPENING, SPEAKER_NAME, pickLine, type LineKey, type Talk } from './lines';
import type { PxActor, PxInstance } from '../vendor/pixelfx/core/index.js';
import { HOME, Opening, drawEntranceGlow, drawHomeRoom } from './opening';

export type SkillKey = 'q' | 'w' | 'e' | 'r';

export interface InputState {
  attackHeld: boolean;
  /** 이번 프레임에 눌린 정령 스킬 (main이 넣고 game이 꺼낸다) */
  skillQueue: SkillKey[];
}

export type Mode = 'title' | 'opening' | 'talk' | 'play' | 'slide' | 'down' | 'clear';

const PLAYER_SPEED = 120;
/** HP 1 = 하트 반 칸. 6 = 하트 세 개. */
const PLAYER_HP = 6;
const INVULN = 1.1;
const SLIDE_TIME = 0.36;
const BOSS_NAME = '알람';
const BOSS_NAME_FIRE = '불붙은 알람';
const TYPE_SPEED = 32;

/**
 * 불의 정령 스킬. 쿨타임만 있다 (기력 시스템은 다음 단계).
 * Q 불덩이 · W 불 두르기 · E 불꽃 질주 · R 연속 불덩이(궁극기)
 */
const SKILL = {
  q: { label: '불덩이', cd: 1.0 },
  w: { label: '불 두르기', cd: 9 },
  e: { label: '불꽃 질주', cd: 8 },
  r: { label: '연속 불덩이', cd: 18 },
} as const;
const FIREBALL_SPEED = 230;
const FIREBALL_DAMAGE = 2;
const AURA_TIME = 4;
const AURA_RADIUS = 30;
const HASTE_TIME = 3;
const HASTE_MULT = 1.75;
const ULT_SHOTS = 14;
const ULT_INTERVAL = 0.085;

interface Player {
  x: number; y: number; r: number;
  tx: number; ty: number; moving: boolean;
  vx: number; vy: number;
  lvx: number; lvy: number; lungeT: number;
  hp: number; maxHp: number;
  invuln: number; hurtT: number; lostT: number;
  facing: 1 | -1; walkT: number;
  aim: number; form: FormId; cd: number;
  swingT: number; swingDur: number; swingSide: 1 | -1;
  warmth: number;
  downT: number;
}

type EnemyState =
  | 'rest' | 'move'
  | 'chase' | 'wind' | 'slam'
  | 'drift' | 'aim'
  | 'intro' | 'idle' | 'ringTele' | 'ring' | 'chargeTele' | 'charge' | 'stun' | 'snoozeTele';

interface Enemy {
  id: number; kind: EnemyKind;
  x: number; y: number; vx: number; vy: number; r: number;
  hp: number; maxHp: number; weight: number; warmth: number;
  spawnT: number; spawnMax: number;
  state: EnemyState; t: number; a: number; n: number;
  flash: number; squash: number;
  faced: boolean; fadeT: number;
  summoned: boolean; cycle: number;
}

interface Bullet {
  x: number; y: number; vx: number; vy: number; r: number;
  life: number; damage: number;
  owner: 'player' | 'enemy';
  /** fire: 정령 불덩이(pixelfx), ember: 불붙은 알람의 불씨 */
  style: 'arrow' | 'tear' | 'note' | 'fire' | 'ember';
  /** pixelfx 불덩이 핸들: 탄과 함께 움직인다 */
  fx?: PxInstance;
}

/** 바닥에 붙은 불: 정령(E 질주 자국)은 그늘을, 알람의 불은 윤슬을 태운다 */
interface Flame { x: number; y: number; t: number; life: number; owner: 'player' | 'enemy'; tick: number }

/** 정령방 받침 위의 정령 → 얻으면 윤슬 곁을 떠다닌다 */
interface Spirit { x: number; y: number; state: 'hidden' | 'waiting' | 'following'; t: number }

interface TalkState { lines: readonly Talk[]; i: number; shown: number; onDone: () => void }

interface Orb { x: number; y: number; vx: number; vy: number; t: number }
interface Strike { t: number; form: FormId; aim: number }
interface Slide { from: Room; to: Room; dir: Dir; t: number }
interface Relic { x: number; y: number; t: number }
interface Ghost { x: number; foot: number; frame: number; flip: boolean; life: number }
interface Zoom { amount: number; life: number; max: number; x: number; y: number }
interface Window_ { x: number; w: number }

const ENEMY_STATS: Readonly<Record<EnemyKind, { hp: number; r: number; weight: number; warmth: number }>> = {
  bother: { hp: 3, r: 9, weight: 1, warmth: 1 },
  heavy: { hp: 7, r: 12, weight: 2.6, warmth: 2 },
  gloom: { hp: 3, r: 7, weight: 1.2, warmth: 1 },
  alarm: { hp: 48, r: 17, weight: 7, warmth: 0 },
};

const ENEMY_SPRITE: Readonly<Record<EnemyKind, Sprite>> = {
  bother: SPRITES.bother,
  heavy: SPRITES.heavy,
  gloom: SPRITES.gloom,
  alarm: SPRITES.alarm,
};

function makePlayer(): Player {
  return {
    x: CX, y: CY + 10, r: 7,
    tx: CX, ty: CY + 10, moving: false,
    vx: 0, vy: 0, lvx: 0, lvy: 0, lungeT: 0,
    hp: PLAYER_HP, maxHp: PLAYER_HP, invuln: 0, hurtT: 0, lostT: 0,
    facing: 1, walkT: 0,
    aim: 0.9, form: 'dagger', cd: 0, swingT: 0, swingDur: 0.1, swingSide: 1,
    warmth: 0, downT: 0,
  };
}

/** 방마다 고정되는 창문 위치 (위쪽 벽 앞면). 북쪽 문과 겹치지 않게. */
function windowOf(room: Room): Window_ {
  if (room.kind === 'home') return { x: HOME.curtain.x, w: HOME.curtain.w };
  const rnd = seeded(room.seed + 7);
  const w = 40;
  for (let i = 0; i < 20; i += 1) {
    const x = Math.round(FLOOR.x + 30 + rnd() * (FLOOR.w - 60 - w));
    if (!room.doors.n || Math.abs(x + w / 2 - CX) > DOOR_HALF + w / 2 + 16) return { x, w };
  }
  return { x: FLOOR.x + 40, w };
}

export class Game {
  mode: Mode = 'title';

  private stage: Stage;
  private room: Room;
  private player: Player = makePlayer();
  private enemies: Enemy[] = [];
  private bullets: Bullet[] = [];
  private orbs: Orb[] = [];
  private ghosts: Ghost[] = [];
  private readonly fx = new Fx();
  /** pixelfx 효과층: 베기, 타격, 마주함, 피니시 */
  private readonly px = new PixelLayer();
  private readonly bodies = new Map<EnemyKind, PxActor>();

  private hitstop = 0;
  private timeScale = 1;
  private slowT = 0;
  private clock = 0;
  private screenT = 0;
  private doorOpen = 1;
  private nextId = 1;
  private ghostT = 0;
  private pending: Strike | null = null;
  private slide: Slide | null = null;
  private zoom: Zoom = { amount: 0, life: 0, max: 1, x: CX, y: CY };
  private endingT = -1;
  private relic: Relic | null = null;
  private warmthShown = false;
  /** 대사 사이 최소 간격 (초). 세나는 말이 많지 않다. */
  private lineCd = 0;
  private readonly formsSpoken = new Set<FormId>();
  private lowSaid = false;
  private talk: TalkState | null = null;

  /* 오프닝과 씬 8 */
  private opening: Opening | null = null;
  private openingSeen = false;
  /** 공격 버튼은 첫 그늘이 나타날 때 처음 생긴다 */
  attackUnlocked = false;
  /** 『아 뭐야..』 다음 『눌러. 한 번만.』까지 남은 시간 */
  private firstAttackT = -1;
  private readonly home = makeHomeRoom();
  private homeT = 0;
  private goOutSaid = false;

  /* 불의 정령 */
  private spirit: Spirit | null = null;
  hasSpirit = false;
  private readonly skillCd: Record<SkillKey, number> = { q: 0, w: 0, e: 0, r: 0 };
  private auraT = 0;
  private auraTick = 0;
  private auraFx: PxInstance | null = null;
  private hasteT = 0;
  private hasteFx: PxInstance | null = null;
  private trailT = 0;
  private ultLeft = 0;
  private ultT = 0;
  private flames: Flame[] = [];
  private readonly playerBody = actorFromSprite(SPRITES.yunseul[0]);
  private skillHinted = false;

  private readonly roomCache = new Map<Room, HTMLCanvasElement>();
  private readonly light: HTMLCanvasElement;
  private readonly lightCtx: CanvasRenderingContext2D;

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly sfx: Sfx,
    private readonly ui: Ui,
    private readonly input: InputState,
  ) {
    this.stage = generateStage();
    this.room = this.stage.start;
    this.light = document.createElement('canvas');
    this.light.width = VIEW_W;
    this.light.height = VIEW_H;
    const lc = this.light.getContext('2d');
    if (!lc) throw new Error('2d context unavailable');
    this.lightCtx = lc;
    this.ui.showScreen('title');
  }

  /* ═══════════════ 흐름 ═══════════════ */

  onScreenTap(): void {
    if (this.screenT < 0.5) return;
    if (this.mode === 'title' && !this.openingSeen) {
      this.startOpening();
      return;
    }
    // 쓰러진 뒤·클리어 뒤에는 오프닝 없이 방에서 다시 눈을 뜬다
    if (this.mode === 'title' || this.mode === 'down' || this.mode === 'clear') this.startRun();
  }

  private startOpening(): void {
    this.mode = 'opening';
    this.ui.showScreen(null);
    this.ui.showCine(true);
    this.opening = new Opening(this.ctx, this.ui.cineText, () => {
      this.opening = null;
      this.openingSeen = true;
      this.ui.showCine(false);
      this.startRun();
    });
  }

  /** 오프닝 중 화면 터치: 줄 완성 → 다음 줄 */
  cineTap(): void {
    if (this.mode === 'opening') this.opening?.tap();
  }

  cineSkip(): void {
    if (this.mode === 'opening') this.opening?.skip();
  }

  private say(key: LineKey, force = false): void {
    if (!force && this.lineCd > 0) return;
    if (this.mode === 'talk') return;
    this.ui.say(pickLine(key));
    this.lineCd = 4;
  }

  /* ── 대사창: 한 글자씩. 누르면 다 보이고, 한 번 더 누르면 다음 줄. ── */

  private startTalk(lines: readonly Talk[], onDone: () => void): void {
    if (lines.length === 0) {
      onDone();
      return;
    }
    this.talk = { lines, i: 0, shown: 0, onDone };
    this.mode = 'talk';
    this.input.attackHeld = false;
    this.player.moving = false;
    this.ui.hideLine();
    this.ui.hideForm();
    this.renderTalk();
  }

  advanceTalk(): void {
    const t = this.talk;
    if (!t || this.mode !== 'talk') return;
    const line = t.lines[t.i];
    if (!line) return;
    if (t.shown < line.text.length) {
      t.shown = line.text.length;
    } else if (t.i + 1 < t.lines.length) {
      t.i += 1;
      t.shown = 0;
    } else {
      this.talk = null;
      this.ui.hideTalk();
      this.mode = 'play';
      t.onDone();
      return;
    }
    this.renderTalk();
  }

  private updateTalk(dt: number): void {
    const t = this.talk;
    if (!t) return;
    const line = t.lines[t.i];
    if (!line || t.shown >= line.text.length) return;
    const before = Math.floor(t.shown);
    t.shown = Math.min(line.text.length, t.shown + dt * TYPE_SPEED);
    if (Math.floor(t.shown) !== before && line.text.charAt(before) !== ' ') this.sfx.play('blip');
    this.renderTalk();
  }

  private renderTalk(): void {
    const t = this.talk;
    const line = t?.lines[t.i];
    if (!t || !line) return;
    const n = Math.floor(t.shown);
    this.ui.showTalk(line.who, SPEAKER_NAME[line.who], line.text.slice(0, n), n >= line.text.length);
  }

  private startRun(): void {
    this.stage = generateStage();
    this.roomCache.clear();
    this.player = makePlayer();
    this.warmthShown = false;
    this.relic = null;
    this.lineCd = 0;
    this.formsSpoken.clear();
    this.lowSaid = false;
    this.talk = null;
    this.spirit = null;
    this.hasSpirit = false;
    this.skillHinted = false;
    this.skillCd.q = this.skillCd.w = this.skillCd.e = this.skillCd.r = 0;
    this.auraT = this.hasteT = 0;
    this.auraFx = this.hasteFx = null;
    this.ultLeft = 0;
    this.input.skillQueue.length = 0;
    this.endingT = -1;
    this.timeScale = 1;
    this.slowT = 0;
    this.hitstop = 0;
    this.ghosts = [];
    this.zoom.life = 0;
    this.fx.clear();
    this.px.clear();
    this.ui.showScreen(null);
    this.ui.hideBoss();
    this.ui.hideForm();
    this.mode = 'play';
    // 씬 8: 윤슬의 방에서 시작. 현관을 나서면 첫 일반방.
    this.enterRoom(this.home, null);
    this.homeT = 0;
    this.goOutSaid = false;
    this.ui.center(window.matchMedia('(pointer: coarse)').matches ? '터치한 곳으로 이동' : '클릭한 곳으로 이동');
  }

  private showScreen(id: 'down' | 'clear'): void {
    this.screenT = 0;
    if (id === 'clear') this.ui.setClearWarmth(this.player.warmth);
    this.ui.showScreen(id);
    this.ui.hideBoss();
    this.ui.hideForm();
    this.ui.hideLine();
    this.ui.hideTalk();
  }

  private enterRoom(room: Room, via: Dir | null): void {
    this.room = room;
    this.enemies = [];
    this.bullets = [];
    this.orbs = [];
    this.ghosts = [];
    this.flames = [];
    this.px.clear();
    this.pending = null;
    this.ultLeft = 0;
    const p = this.player;
    p.vx = p.vy = 0;
    p.lungeT = 0;
    // 방이 바뀌면 효과층을 비우므로, 지속 중인 정령 효과는 다시 붙인다
    this.auraFx = this.auraT > 0 ? this.px.burning(p.x, p.y + 4, this.playerBody) : null;
    this.hasteFx = this.hasteT > 0 ? this.px.haste(p.x, p.y + 4, this.playerBody, p.facing < 0) : null;
    if (this.spirit?.state !== 'following') this.spirit = null;

    if (via) {
      const inset = p.r + 1;
      if (via === 'e') { p.x = FLOOR.x + inset; p.y = CY; }
      if (via === 'w') { p.x = FLOOR.x + FLOOR.w - inset; p.y = CY; }
      if (via === 's') { p.x = CX; p.y = FLOOR.y + inset; }
      if (via === 'n') { p.x = CX; p.y = FLOOR.y + FLOOR.h - inset; }
      p.tx = p.x + DIRS[via].dx * 26;
      p.ty = p.y + DIRS[via].dy * 26;
      p.moving = true;
    } else {
      p.x = p.tx = CX;
      p.y = p.ty = CY + 10;
      p.moving = false;
    }

    this.doorOpen = 1;
    if (this.spirit?.state === 'following') {
      this.spirit.x = p.x - p.facing * 12;
      this.spirit.y = p.y - 24;
    }
    // 정령방을 비웠는데 정령을 안 가져가고 나갔다 돌아온 경우
    if (room.kind === 'spirit' && room.cleared && !this.hasSpirit) {
      this.spirit = { x: CX, y: CY - 6, state: 'waiting', t: 1 };
    }
    if (room.cleared) return;

    this.sfx.play('lock');
    if (room.kind === 'boss') {
      const d = via ? DIRS[via] : { dx: 0, dy: -1 };
      this.enemies.push(this.makeEnemy('alarm', CX + d.dx * 120, CY + d.dy * 45 - (d.dx !== 0 ? 10 : 0), 1.4));
      const fire = this.stage.element === 'fire';
      this.ui.showBoss(fire ? BOSS_NAME_FIRE : BOSS_NAME);
      this.say(fire ? 'bossIntroFire' : 'bossIntro', true);
      return;
    }
    if (room.kind === 'spirit') {
      // 정령은 지키는 그늘을 다 마주한 뒤에 나타난다
      this.spirit = { x: CX, y: CY - 6, state: 'hidden', t: 0 };
      this.say('spiritRoom', true);
    } else if (via) {
      this.say('enter');
    }
    room.wave.forEach((kind, i) => {
      const [x, y] = this.findSpawn();
      this.enemies.push(this.makeEnemy(kind, x, y, 0.7 + i * 0.15));
    });
  }

  private findSpawn(): [number, number] {
    const p = this.player;
    let best: [number, number] = [CX, CY];
    for (let i = 0; i < 80; i += 1) {
      const x = rand(FLOOR.x + 36, FLOOR.x + FLOOR.w - 36);
      const y = rand(FLOOR.y + 30, FLOOR.y + FLOOR.h - 24);
      best = [x, y];
      if (dist(x, y, p.x, p.y) < 130) continue;
      if (this.enemies.some((e) => dist(x, y, e.x, e.y) < 44)) continue;
      return best;
    }
    return best;
  }

  /** pixelfx 효과가 쓸 그늘의 실루엣 (종류별로 한 번만 만든다) */
  private bodyOf(kind: EnemyKind): PxActor {
    let body = this.bodies.get(kind);
    if (!body) {
      body = actorFromSprite(ENEMY_SPRITE[kind]);
      this.bodies.set(kind, body);
    }
    return body;
  }

  private makeEnemy(kind: EnemyKind, x: number, y: number, spawnT: number): Enemy {
    const s = ENEMY_STATS[kind];
    const initial: Readonly<Record<EnemyKind, EnemyState>> = {
      bother: 'rest', heavy: 'chase', gloom: 'drift', alarm: 'intro',
    };
    return {
      id: this.nextId++, kind,
      x, y, vx: 0, vy: 0, r: s.r,
      hp: s.hp, maxHp: s.hp, weight: s.weight, warmth: s.warmth,
      spawnT, spawnMax: spawnT,
      state: initial[kind], t: rand(0.2, 0.9), a: 0, n: 0,
      flash: 0, squash: 0,
      faced: false, fadeT: 0,
      summoned: false, cycle: 0,
    };
  }

  /* ═══════════════ 입력 ═══════════════ */

  moveTo(gx: number, gy: number, fresh: boolean): void {
    if (this.mode !== 'play') return;
    const p = this.player;
    const open = this.room.cleared;
    const near = (a: number, b: number): boolean => Math.abs(a - b) < DOOR_HALF + 14;
    let tx: number;
    let ty: number;

    // 문 근처를 누르면 문 너머를 목표로 잡아준다
    const dr = HOME.door;
    if (this.room.kind === 'home' && gy > FLOOR.y + FLOOR.h - 30 && gx > dr.x - 16 && gx < dr.x + dr.w + 16) {
      tx = dr.x + dr.w / 2;
      ty = VIEW_H + 16;
    }
    else if (open && this.room.doors.w && gx < FLOOR.x + 6 && near(gy, CY)) { tx = -16; ty = CY; }
    else if (open && this.room.doors.e && gx > FLOOR.x + FLOOR.w - 6 && near(gy, CY)) { tx = VIEW_W + 16; ty = CY; }
    else if (open && this.room.doors.n && gy < FLOOR.y + 6 && near(gx, CX)) { tx = CX; ty = -16; }
    else if (open && this.room.doors.s && gy > FLOOR.y + FLOOR.h - 6 && near(gx, CX)) { tx = CX; ty = VIEW_H + 16; }
    else {
      tx = clamp(gx, FLOOR.x + p.r, FLOOR.x + FLOOR.w - p.r);
      ty = clamp(gy, FLOOR.y + p.r, FLOOR.y + FLOOR.h - p.r);
    }
    p.tx = tx;
    p.ty = ty;
    p.moving = true;
    if (fresh) this.fx.click(clamp(gx, FLOOR.x + 4, FLOOR.x + FLOOR.w - 4), clamp(gy, FLOOR.y + 4, FLOOR.y + FLOOR.h - 4));
  }

  /* ═══════════════ 업데이트 ═══════════════ */

  update(dtReal: number): void {
    this.screenT += dtReal;
    this.lineCd = Math.max(0, this.lineCd - dtReal);
    this.fx.updateShake(dtReal);
    if (this.zoom.life > 0) this.zoom.life = Math.max(0, this.zoom.life - dtReal);
    if (this.mode === 'title') {
      this.fx.update(dtReal);
      return;
    }

    if (this.mode === 'opening') {
      this.opening?.update(dtReal);
      return;
    }

    if (this.mode === 'talk') {
      // 대사 중에는 세계가 멈춘다. 먼지와 정령만 움직인다.
      this.updateTalk(dtReal);
      this.updateSpirit(dtReal);
      this.fx.update(dtReal);
      return;
    }

    if (this.mode === 'slide') {
      this.updateSlide(dtReal);
      return;
    }

    if (this.hitstop > 0) {
      this.hitstop -= dtReal;
      return;
    }

    if (this.slowT > 0) {
      this.slowT -= dtReal;
      if (this.slowT <= 0) this.timeScale = 1;
    }
    const dt = dtReal * this.timeScale;
    this.clock += dt;

    if (this.mode === 'play') {
      this.updatePlayer(dt);
      this.updateAttack(dt);
      this.updateSkills(dt);
      this.updateEnemies(dt);
      this.updateBullets(dt);
      this.updateFlames(dt);
      this.updateOrbs(dt);
      this.updateSpirit(dt);
      this.checkClear();
      this.updateTutorial(dt);
      if (this.mode === 'play') this.checkExit();
    } else if (this.mode === 'down') {
      this.player.downT += dtReal;
      if (this.player.downT > 1.6 && !this.ui.isScreenOn()) this.showScreen('down');
      this.updateEnemies(dt);
    }

    for (const g of this.ghosts) g.life -= dt;
    this.ghosts = this.ghosts.filter((g) => g.life > 0);

    const target = this.room.cleared ? 1 : 0;
    this.doorOpen += clamp(target - this.doorOpen, -dt * 7, dt * 4);

    if (this.endingT >= 0) {
      this.endingT += dtReal;
      if (this.relic) this.relic.t += dtReal;
      if (this.endingT > 3.4 && this.mode === 'play') {
        this.mode = 'clear';
        this.showScreen('clear');
      }
    }

    this.fx.update(dt);
    this.px.update(dt, dtReal);
    this.ui.placeForm(this.player.x, this.player.y - 26);
  }

  /** 처음부터 다 보여주지 않는다: 방에서는 『뭐 해. 나가.』, 첫 그늘이 보이면 공격 버튼과 『눌러. 한 번만.』 */
  private updateTutorial(dt: number): void {
    if (this.room.kind === 'home') {
      this.homeT += dt;
      if (!this.goOutSaid && this.homeT > 1.6) {
        this.goOutSaid = true;
        this.say('goOut', true);
      }
      return;
    }
    if (!this.attackUnlocked && this.activeEnemies().length > 0) {
      this.attackUnlocked = true;
      this.say('start', true);
      this.firstAttackT = 1.8;
    }
    if (this.firstAttackT > 0) {
      this.firstAttackT -= dt;
      if (this.firstAttackT <= 0) this.say('firstAttack', true);
    }
  }

  private updateSlide(dt: number): void {
    const s = this.slide;
    if (!s) {
      this.mode = 'play';
      return;
    }
    s.t += dt / SLIDE_TIME;
    this.fx.update(dt);
    if (s.t >= 1) {
      this.slide = null;
      this.mode = 'play';
      this.enterRoom(s.to, s.dir);
      // 현관을 나와 처음 들어선 심상세계: 첫 대사창. 끝나야 그늘이 움직인다.
      if (s.from.kind === 'home') this.startTalk(OPENING, () => undefined);
    }
  }

  private updatePlayer(dt: number): void {
    const p = this.player;
    p.invuln = Math.max(0, p.invuln - dt);
    p.hurtT = Math.max(0, p.hurtT - dt);
    p.lostT = Math.max(0, p.lostT - dt);

    if (p.lungeT > 0) {
      p.x += p.lvx * dt;
      p.y += p.lvy * dt;
      p.lungeT -= dt;
      this.ghostT -= dt;
      if (this.ghostT <= 0) {
        this.ghostT = 0.018;
        this.ghosts.push({ x: p.x, foot: p.y + 4, frame: 1, flip: p.facing < 0, life: 0.16 });
      }
    } else if (p.moving) {
      const dx = p.tx - p.x;
      const dy = p.ty - p.y;
      const d = Math.hypot(dx, dy);
      const step = PLAYER_SPEED * (this.hasteT > 0 ? HASTE_MULT : 1) * dt;
      if (d <= step) {
        p.x = p.tx;
        p.y = p.ty;
        p.moving = false;
      } else {
        p.x += (dx / d) * step;
        p.y += (dy / d) * step;
        p.walkT += dt;
        if (p.swingT <= 0 && Math.abs(dx) > 0.5) p.facing = dx > 0 ? 1 : -1;
        if (p.swingT <= 0 && p.cd <= -0.4) p.aim = Math.atan2(dy, dx);
      }
    }

    const f = Math.exp(-10 * dt);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= f;
    p.vy *= f;

    this.clampPlayer();
  }

  private clampPlayer(): void {
    const p = this.player;
    const open = this.room.cleared;
    const d = this.room.doors;
    const gap = DOOR_HALF - p.r;
    const minX = FLOOR.x + p.r;
    const maxX = FLOOR.x + FLOOR.w - p.r;
    const minY = FLOOR.y + p.r;
    const maxY = FLOOR.y + FLOOR.h - p.r;
    const inGapV = Math.abs(p.y - CY) <= gap;
    const inGapH = Math.abs(p.x - CX) <= gap;

    let lx = minX, hx = maxX, ly = minY, hy = maxY;
    if (open && inGapV && d.w) lx = -24;
    if (open && inGapV && d.e) hx = VIEW_W + 24;
    if (open && inGapH && d.n) ly = -24;
    if (open && inGapH && d.s) hy = VIEW_H + 24;
    if (p.x < minX || p.x > maxX) { ly = Math.max(ly, CY - gap); hy = Math.min(hy, CY + gap); }
    if (p.y < minY || p.y > maxY) { lx = Math.max(lx, CX - gap); hx = Math.min(hx, CX + gap); }

    if (this.room.kind === 'home') {
      // 현관 문 폭 안에서만 아래로 나갈 수 있다
      const dr = HOME.door;
      const inDoor = p.x > dr.x + p.r && p.x < dr.x + dr.w - p.r;
      if (inDoor) hy = VIEW_H + 24;
      if (p.y > maxY) { lx = Math.max(lx, dr.x + p.r); hx = Math.min(hx, dr.x + dr.w - p.r); }
    }

    p.x = clamp(p.x, lx, hx);
    p.y = clamp(p.y, ly, hy);

    if (this.room.kind === 'home') {
      // 침대는 밟고 지나갈 수 없다: 가장 가까운 변으로 밀어낸다
      const b = HOME.bed;
      const x0 = b.x - p.r, x1 = b.x + b.w + p.r, y0 = b.y - p.r, y1 = b.y + b.h + 4;
      if (p.x > x0 && p.x < x1 && p.y > y0 && p.y < y1) {
        const push = [p.x - x0, x1 - p.x, p.y - y0, y1 - p.y];
        const m = Math.min(...push);
        if (m === push[0]) p.x = x0;
        else if (m === push[1]) p.x = x1;
        else if (m === push[2]) p.y = y0;
        else p.y = y1;
      }
    }
  }

  private checkExit(): void {
    if (!this.room.cleared) return;
    const p = this.player;
    if (this.room.kind === 'home') {
      // 현관을 나서면 첫 일반방(심상세계)으로
      if (p.y > VIEW_H - 8) {
        this.ui.hideLine();
        this.slide = { from: this.room, to: this.stage.start, dir: 's', t: 0 };
        this.mode = 'slide';
      }
      return;
    }
    let dir: Dir | null = null;
    if (p.x < 8) dir = 'w';
    else if (p.x > VIEW_W - 8) dir = 'e';
    else if (p.y < 14) dir = 'n';
    else if (p.y > VIEW_H - 8) dir = 's';
    if (!dir) return;
    const to = neighborOf(this.stage, this.room, dir);
    if (!to) return;
    p.warmth += this.orbs.length;
    if (this.orbs.length) this.warmthShown = true;
    this.orbs = [];
    this.bullets = [];
    this.ghosts = [];
    this.ui.hideForm();
    this.slide = { from: this.room, to, dir, t: 0 };
    this.mode = 'slide';
  }

  private checkClear(): void {
    if (this.room.cleared || this.enemies.length === 0) return;
    if (!this.enemies.every((e) => e.faced)) return;
    this.room.cleared = true;
    if (this.room.kind === 'normal') this.say('clear', true);
    this.sfx.play('open');
    if (this.room.kind === 'spirit' && this.spirit?.state === 'hidden') {
      this.spirit.state = 'waiting';
      this.spirit.t = 0;
      this.px.fireRing(this.spirit.x, this.spirit.y + 20, 44);
      this.sfx.play('spirit');
    }
  }

  /* ═══════════════ 불의 정령 ═══════════════ */

  private updateSpirit(dt: number): void {
    const s = this.spirit;
    if (!s) return;
    s.t += dt;
    const p = this.player;
    if (s.state === 'waiting' && this.mode === 'play' && s.t > 0.8 && dist(p.x, p.y - 10, s.x, s.y) < 20) {
      this.takeSpirit();
    } else if (s.state === 'following') {
      // 윤슬 어깨 뒤, 조금 위에서 둥실둥실
      const tx = p.x - p.facing * 13;
      const ty = p.y - 26 + Math.sin(this.clock * 3) * 2;
      const k = 1 - Math.exp(-dt * 6);
      s.x += (tx - s.x) * k;
      s.y += (ty - s.y) * k;
    }
  }

  private takeSpirit(): void {
    const s = this.spirit;
    if (!s) return;
    s.state = 'following';
    this.hasSpirit = true;
    this.sfx.play('spirit');
    this.fx.burst(s.x, s.y, 0, 26, [COLOR.fireHot, COLOR.fire, COLOR.fireDeep], { speed: 130, life: 0.6, size: 2 });
    this.fx.ring(s.x, s.y, 34, 0.45);
    this.startTalk(FIRE_SPIRIT_TAKEN, () => undefined);
  }

  private updateSkills(dt: number): void {
    for (const k of ['q', 'w', 'e', 'r'] as const) this.skillCd[k] = Math.max(0, this.skillCd[k] - dt);
    const queue = this.input.skillQueue.splice(0);
    if (this.hasSpirit && this.endingT < 0) for (const k of queue) this.castSkill(k);

    const p = this.player;
    const foot = p.y + 4;

    // 정령을 얻고 처음 그늘을 만나면 한 번 알려준다
    if (this.hasSpirit && !this.skillHinted && this.activeEnemies().length > 0) {
      this.skillHinted = true;
      this.say('skillHint', true);
    }

    // W: 몸에 두른 불. 주변 그늘을 틱마다 태운다.
    if (this.auraT > 0) {
      this.auraT -= dt;
      if (this.auraFx) {
        this.auraFx.options.x = p.x;
        this.auraFx.options.y = foot;
      }
      this.auraTick -= dt;
      if (this.auraTick <= 0) {
        this.auraTick = 0.3;
        for (const e of this.activeEnemies()) {
          if (dist(p.x, p.y, e.x, e.y) < AURA_RADIUS + e.r) this.hitEnemy(e, 0.6, angleTo(p.x, p.y, e.x, e.y), 40, true);
        }
      }
      if (this.auraT <= 0) {
        this.auraFx?.stop();
        this.auraFx = null;
      }
    }

    // E: 빨라지고, 지나간 자리에 불이 남는다
    if (this.hasteT > 0) {
      this.hasteT -= dt;
      if (this.hasteFx) {
        this.hasteFx.options.x = p.x;
        this.hasteFx.options.y = foot;
        this.hasteFx.options.flip = p.facing < 0;
      }
      this.trailT -= dt;
      if (this.trailT <= 0 && p.moving) {
        this.trailT = 0.07;
        this.flames.push({ x: p.x + rand(-2, 2), y: foot - 1, t: 0, life: 1.4, owner: 'player', tick: 0 });
      }
      if (this.hasteT <= 0) {
        this.hasteFx?.stop();
        this.hasteFx = null;
      }
    }

    // R: 불덩이 연사
    if (this.ultLeft > 0) {
      this.ultT -= dt;
      if (this.ultT <= 0) {
        this.ultT = ULT_INTERVAL;
        this.ultLeft -= 1;
        this.shootFireball(true);
      }
    }
  }

  private castSkill(k: SkillKey): void {
    if (this.skillCd[k] > 0) return;
    const p = this.player;
    const foot = p.y + 4;
    switch (k) {
      case 'q':
        this.shootFireball(false);
        break;
      case 'w':
        this.auraT = AURA_TIME;
        this.auraTick = 0;
        this.auraFx?.stop();
        this.auraFx = this.px.burning(p.x, foot, this.playerBody);
        this.px.fireRing(p.x, foot, 48);
        this.fx.shake(2.5);
        this.sfx.play('flame');
        break;
      case 'e':
        this.hasteT = HASTE_TIME;
        this.hasteFx?.stop();
        this.hasteFx = this.px.haste(p.x, foot, this.playerBody, p.facing < 0);
        this.sfx.play('flame');
        break;
      case 'r':
        this.ultLeft = ULT_SHOTS;
        this.ultT = 0;
        this.fx.shake(3);
        this.punchZoom(p.x, p.y - 10, 0.04, 0.4);
        this.fx.ring(p.x, p.y - 10, 40, 0.35);
        this.sfx.play('ult');
        break;
    }
    this.skillCd[k] = SKILL[k].cd;
  }

  /** 정령 불덩이. 궁극기는 여러 그늘에 번갈아 쏘고 살짝 흩뿌린다. */
  private shootFireball(ult: boolean): void {
    const p = this.player;
    const targets = [...this.activeEnemies()].sort((a, b) => dist(p.x, p.y, a.x, a.y) - dist(p.x, p.y, b.x, b.y));
    let aim = p.aim;
    const t = ult ? targets[this.ultLeft % Math.max(1, targets.length)] : targets[0];
    if (t) aim = angleTo(p.x, p.y - 10, t.x, t.y - t.r * 0.6);
    if (ult) aim += rand(-0.12, 0.12);
    p.aim = aim;
    if (Math.abs(Math.cos(aim)) > 0.15) p.facing = Math.cos(aim) >= 0 ? 1 : -1;

    const sx = p.x + Math.cos(aim) * 8;
    const sy = p.y - 10 + Math.sin(aim) * 8;
    const speed = ult ? FIREBALL_SPEED * 1.25 : FIREBALL_SPEED;
    this.bullets.push({
      x: sx, y: sy, vx: Math.cos(aim) * speed, vy: Math.sin(aim) * speed,
      r: 4, life: 1.6, damage: ult ? 1.5 : FIREBALL_DAMAGE, owner: 'player', style: 'fire',
      fx: this.px.fireball(sx, sy, aim, ult ? 3 : 4),
    });
    this.sfx.play('fireball');
    this.fx.shake(ult ? 1 : 1.5);
  }

  /** 바닥 불: 정령 불은 그늘을, 알람의 불은 윤슬을 태운다 */
  private updateFlames(dt: number): void {
    const p = this.player;
    for (const f of this.flames) {
      f.t += dt;
      f.tick -= dt;
      if (f.tick > 0) continue;
      if (f.owner === 'player') {
        for (const e of this.activeEnemies()) {
          if (dist(f.x, f.y, e.x, e.y + e.r * 0.5) < e.r + 5) {
            this.hitEnemy(e, 0.4, angleTo(f.x, f.y, e.x, e.y), 10, true);
            f.tick = 0.35;
          }
        }
      } else if (f.t > 0.25 && dist(f.x, f.y, p.x, p.y + 4) < 9) {
        this.hurtPlayer(f.x, f.y);
        f.tick = 0.5;
      }
    }
    this.flames = this.flames.filter((f) => f.t < f.life);
  }

  /* ── 공격 ── */

  private activeEnemies(): Enemy[] {
    return this.enemies.filter((e) => !e.faced && e.spawnT <= 0);
  }

  private updateAttack(dt: number): void {
    const p = this.player;
    p.cd -= dt;
    p.swingT = Math.max(0, p.swingT - dt);

    if (this.pending) {
      this.pending.t -= dt;
      if (this.pending.t <= 0) {
        const s = this.pending;
        this.pending = null;
        this.resolveStrike(s);
      }
    }

    if (this.input.attackHeld && this.attackUnlocked && p.cd <= 0 && !this.pending && this.endingT < 0) this.startAttack();
  }

  private startAttack(): void {
    const p = this.player;
    const targets = this.activeEnemies();
    // 그늘이 없으면 세나는 반응하지 않는다. 읽을 상황이 없으니까.
    if (targets.length === 0) return;
    const choice = chooseForm(p.x, p.y, targets, p.form);
    if (choice.form !== p.form) {
      this.fx.burst(p.x, p.y - 10, 0, 14, [COLOR.sena, COLOR.senaShade], { speed: 80, life: 0.28, drag: 9, glow: true });
      this.fx.ring(p.x, p.y - 8, 16, 0.22);
      this.ui.flashForm(FORMS[choice.form].label);
      if (!this.formsSpoken.has(choice.form)) {
        this.formsSpoken.add(choice.form);
        this.say(choice.form);
      }
      this.sfx.play('morph');
    }
    p.form = choice.form;
    const spec = FORMS[p.form];
    const t = choice.target;
    p.cd = spec.cooldown;

    const aim = t ? angleTo(p.x, p.y, t.x, t.y) : p.aim;
    p.aim = aim;
    p.swingT = spec.swing;
    p.swingDur = spec.swing;
    p.swingSide = p.swingSide === 1 ? -1 : 1;
    if (Math.abs(Math.cos(aim)) > 0.15) p.facing = Math.cos(aim) >= 0 ? 1 : -1;

    if (p.form === 'bow') {
      const speed = 340;
      this.bullets.push({
        x: p.x + Math.cos(aim) * 9, y: p.y - 7 + Math.sin(aim) * 9,
        vx: Math.cos(aim) * speed, vy: Math.sin(aim) * speed,
        r: 3, life: 1.3, damage: spec.damage, owner: 'player', style: 'arrow',
      });
      this.sfx.play('bow');
      return;
    }

    // 세나가 몸을 끌어당긴다: 목표 쪽으로 짧게 돌진
    const reach = t ? dist(p.x, p.y, t.x, t.y) - t.r - p.r - 5 : spec.lunge * 0.3;
    const step = clamp(reach, 0, spec.lunge);
    const lungeDur = 0.065;
    p.lungeT = step > 0.5 ? lungeDur : 0;
    p.lvx = (Math.cos(aim) * step) / lungeDur;
    p.lvy = (Math.sin(aim) * step) / lungeDur;
    this.ghostT = 0;
    this.pending = { t: p.lungeT, form: p.form, aim };

    if (p.form === 'dagger') this.sfx.play('swing');
    if (p.form === 'sword') this.sfx.play('swingBig');
  }

  private resolveStrike(s: Strike): void {
    const p = this.player;
    const spec = FORMS[s.form];
    let hits = 0;
    let kills = 0;

    for (const e of this.activeEnemies()) {
      const d = dist(p.x, p.y, e.x, e.y);
      if (d > spec.range + e.r) continue;
      const a = angleTo(p.x, p.y, e.x, e.y);
      const inArc = Math.abs(angleDiff(s.aim, a)) <= spec.arc / 2;
      if (!inArc && d > p.r + e.r + 4) continue;
      hits += 1;
      if (this.hitEnemy(e, spec.damage, a, spec.knockback)) kills += 1;
    }

    // 형태별 베기 효과는 pixelfx (원점 = 윤슬의 발밑)
    const foot = p.y + 4;
    if (s.form === 'sword') this.px.swordSlash(p.x, foot, s.aim, 40);
    if (s.form === 'dagger') this.px.thrust(p.x, foot, s.aim, spec.range + 6);
    if (s.form === 'knuckle') {
      this.px.blunt(p.x + Math.cos(s.aim) * 14, p.y - 8 + Math.sin(s.aim) * 10, 0);
      this.sfx.play(hits ? 'punch' : 'swing');
    }

    if (hits > 0) {
      if (s.form === 'dagger') this.sfx.play('hit');
      if (s.form === 'sword') this.sfx.play('hitBig');
      this.hitstop = Math.max(this.hitstop, spec.hitstop + (kills > 0 ? 0.04 : 0) + (hits > 1 ? 0.02 : 0));
      this.fx.shake(spec.shake + hits * 0.5);
    }
  }

  /** @returns 이번 타격으로 마주했는지 */
  private hitEnemy(e: Enemy, damage: number, angle: number, knockback: number, fire = false): boolean {
    e.hp -= damage;
    e.flash = 0.1;
    e.squash = 1;
    const immovable = e.kind === 'alarm' && e.state === 'charge';
    if (!immovable) {
      e.vx += (Math.cos(angle) * knockback) / e.weight;
      e.vy += (Math.sin(angle) * knockback) / e.weight;
    }
    const hy = e.y - e.r * 0.8;
    // 그늘의 잉크가 튄다 (우리 것) + 세나의 타격 섬광 (pixelfx)
    this.fx.burst(e.x, hy, angle, 12, [COLOR.ink, COLOR.inkRim, COLOR.ink], { spread: 1.3, speed: 170, size: 2, life: 0.4 });
    if (fire) this.px.fireHit(e.x - Math.cos(angle) * e.r * 0.4, e.y + e.r * 0.6, e.r * 1.4, angle);
    else this.px.hitSpark(e.x - Math.cos(angle) * e.r * 0.4, e.y + e.r * 0.6, e.r * 1.4, angle);
    if (SHOW_DAMAGE_NUMBERS) this.fx.number(e.x, e.y - e.r * 2 - 4, Math.round(damage * 10));
    if (e.hp <= 0) {
      this.faceEnemy(e, true);
      return true;
    }
    return false;
  }

  /**
   * 그늘을 '없애지' 않는다. 색이 빠지고, 조용히 가라앉고, 바닥에 흔적을 남긴다.
   */
  private faceEnemy(e: Enemy, reward: boolean): void {
    if (e.faced) return;
    e.faced = true;
    e.fadeT = 0;
    e.vx *= 0.3;
    e.vy *= 0.3;
    this.room.marks.push({ x: Math.round(e.x), y: Math.round(e.y + e.r * 0.6), w: Math.max(5, Math.round(e.r * 1.4)) });
    // 옅은 사본이 몸에서 빠져나와 떠오른다. 사라진 게 아니라 놓아준 것.
    this.px.soul(e.x, e.y + e.r * 0.6, this.bodyOf(e.kind), e.kind === 'alarm' ? 46 : 28);
    if (!reward) {
      if (e.kind === 'alarm') this.faceBoss(e);
      return;
    }
    for (let i = 0; i < e.warmth; i += 1) {
      const a = rand(0, TAU);
      const v = rand(45, 90);
      this.orbs.push({ x: e.x, y: e.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0 });
    }
    this.sfx.play('face');
    this.hitstop = Math.max(this.hitstop, 0.07);
    this.fx.shake(3);

    if (e.kind === 'alarm') {
      this.faceBoss(e);
      return;
    }
    // 방의 마지막 그늘: 크리티컬 섬광 + 짧은 슬로모 + 줌
    const remaining = this.enemies.some((o) => o !== e && !o.faced);
    if (!remaining && this.room.kind === 'normal') {
      this.slowT = 0.45;
      this.timeScale = 0.25;
      this.hitstop = Math.max(this.hitstop, 0.1);
      this.px.crit(e.x, e.y + e.r * 0.6, e.r * 1.4, angleTo(this.player.x, this.player.y, e.x, e.y));
      this.fx.finisher(e.x, e.y - e.r, 0.25, 0);
      this.punchZoom(e.x, e.y - e.r, 0.06, 0.5);
      this.fx.shake(5);
      this.sfx.play('hitBig');
    }
  }

  private faceBoss(e: Enemy): void {
    this.endingT = 0;
    this.slowT = 1.2;
    this.timeScale = 0.25;
    this.hitstop = Math.max(this.hitstop, 0.16);
    this.relic = { x: e.x, y: e.y, t: 0 };
    // 애니메 임팩트 프레임은 화면 중앙 기준 (효과 캔버스가 화면을 정확히 덮도록)
    this.px.impactFrame(VIEW_W / 2, VIEW_H / 2);
    this.fx.finisher(e.x, e.y - 18, 0.5, 0);
    this.punchZoom(e.x, e.y - 18, 0.12, 1.4);
    this.fx.shake(7);
    for (let i = 0; i < 3; i += 1) this.fx.ring(e.x, e.y - 18, 70 + i * 40, 0.5 + i * 0.25);
    this.fx.burst(e.x, e.y - 18, 0, 40, [COLOR.white, COLOR.sena, COLOR.senaShade], { speed: 260, life: 0.8, drag: 4, size: 2, glow: true });
    for (const other of this.enemies) if (other !== e) this.faceEnemy(other, false);
    for (const b of this.bullets) {
      if (b.owner === 'enemy') this.fx.burst(b.x, b.y, 0, 2, [COLOR.pale], { speed: 14, life: 0.7, drag: 3 });
    }
    this.bullets = [];
    this.sfx.play('hitBig');
    this.sfx.play('quiet');
    this.say('bossFaced', true);
    this.ui.hideBoss();
  }

  private punchZoom(x: number, y: number, amount: number, duration: number): void {
    this.zoom = { amount, life: duration, max: duration, x, y };
  }

  private hurtPlayer(sx: number, sy: number): void {
    const p = this.player;
    if (p.invuln > 0 || this.mode !== 'play' || this.endingT >= 0) return;
    p.hp -= 1;
    p.invuln = INVULN;
    p.hurtT = 0.14;
    p.lostT = 0.4;
    p.lungeT = 0;
    const a = angleTo(sx, sy, p.x, p.y);
    p.vx = Math.cos(a) * 220;
    p.vy = Math.sin(a) * 220;
    this.hitstop = Math.max(this.hitstop, 0.1);
    this.fx.shake(5);
    this.fx.burst(p.x, p.y - 10, a, 7, [COLOR.accent], { spread: 1.8, speed: 110, life: 0.45 });
    this.sfx.play('hurt');
    if (p.hp > 0 && p.hp <= 2 && !this.lowSaid) {
      this.lowSaid = true;
      this.say('low', true);
    } else {
      this.say('hurt');
    }
    if (p.hp <= 0) this.playerDown();
  }

  private playerDown(): void {
    this.mode = 'down';
    this.player.downT = 0;
    this.player.moving = false;
    this.screenT = 0;
    this.slowT = 1.2;
    this.timeScale = 0.4;
    this.bullets = [];
    this.ui.hideForm();
  }

  /* ── 그늘 ── */

  private updateEnemies(dt: number): void {
    const p = this.player;
    const live = this.mode === 'play';

    for (const e of this.enemies) {
      if (e.faced) {
        e.fadeT += dt / 0.9;
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        e.vx *= Math.exp(-8 * dt);
        e.vy *= Math.exp(-8 * dt);
        continue;
      }
      if (e.spawnT > 0) {
        e.spawnT -= dt;
        if (e.spawnT <= 0) {
          e.squash = 1;
          if (e.kind !== 'alarm') this.sfx.play('spawn');
        }
        continue;
      }

      e.flash = Math.max(0, e.flash - dt);
      e.squash *= Math.exp(-10 * dt);
      e.t -= dt;
      const f = Math.exp(-9 * dt);
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      e.vx *= f;
      e.vy *= f;

      if (live) {
        switch (e.kind) {
          case 'bother': this.aiBother(e, dt); break;
          case 'heavy': this.aiHeavy(e, dt); break;
          case 'gloom': this.aiGloom(e, dt); break;
          case 'alarm': this.aiAlarm(e, dt); break;
        }
      }

      const hitWall = this.clampEnemy(e);
      if (hitWall && e.kind === 'alarm' && e.state === 'charge') {
        e.state = 'stun';
        e.t = e.hp <= e.maxHp / 2 ? 0.7 : 0.95;
        e.squash = 1;
        this.fx.shake(5);
        this.fx.burst(e.x, e.y, 0, 14, [COLOR.inkRim, COLOR.dim], { speed: 120, size: 2, life: 0.5 });
        this.sfx.play('thud');
      }

      if (live && dist(p.x, p.y, e.x, e.y) < p.r + e.r - 2) this.hurtPlayer(e.x, e.y);
    }

    const alive = this.enemies.filter((e) => !e.faced && e.spawnT <= 0);
    for (let i = 0; i < alive.length; i += 1) {
      for (let j = i + 1; j < alive.length; j += 1) {
        const a = alive[i];
        const b = alive[j];
        if (!a || !b) continue;
        const d = dist(a.x, a.y, b.x, b.y);
        const min = a.r + b.r;
        if (d >= min || d < 0.01) continue;
        const push = (min - d) / 2;
        const nx = (b.x - a.x) / d;
        const ny = (b.y - a.y) / d;
        const wa = b.weight / (a.weight + b.weight);
        a.x -= nx * push * wa * 2;
        a.y -= ny * push * wa * 2;
        b.x += nx * push * (1 - wa) * 2;
        b.y += ny * push * (1 - wa) * 2;
      }
    }

    this.enemies = this.enemies.filter((e) => !(e.faced && e.fadeT >= 1 && e.kind !== 'alarm'));
  }

  private clampEnemy(e: Enemy): boolean {
    const x = clamp(e.x, FLOOR.x + e.r, FLOOR.x + FLOOR.w - e.r);
    const y = clamp(e.y, FLOOR.y + e.r * 0.6, FLOOR.y + FLOOR.h - e.r * 0.6);
    const hit = x !== e.x || y !== e.y;
    e.x = x;
    e.y = y;
    return hit;
  }

  private stepToward(e: Enemy, tx: number, ty: number, speed: number, dt: number): void {
    const d = dist(e.x, e.y, tx, ty);
    if (d < 0.5) return;
    e.x += ((tx - e.x) / d) * speed * dt;
    e.y += ((ty - e.y) / d) * speed * dt;
  }

  /** 귀찮음: 움직이다 멈추다를 반복한다 */
  private aiBother(e: Enemy, dt: number): void {
    const p = this.player;
    if (e.state === 'rest') {
      if (e.t <= 0) { e.state = 'move'; e.t = rand(0.6, 0.9); }
    } else {
      this.stepToward(e, p.x, p.y, 48, dt);
      if (e.t <= 0) { e.state = 'rest'; e.t = rand(0.7, 1.2); }
    }
  }

  /** 힘듦: 느리게 따라오다 가까워지면 몸을 웅크렸다가 덮친다 */
  private aiHeavy(e: Enemy, dt: number): void {
    const p = this.player;
    const d = dist(e.x, e.y, p.x, p.y);
    if (e.state === 'chase') {
      this.stepToward(e, p.x, p.y, 27, dt);
      if (d < e.r + p.r + 26 && e.t <= 0) {
        e.state = 'wind';
        e.t = 0.6;
        e.a = angleTo(e.x, e.y, p.x, p.y);
      }
    } else if (e.state === 'wind') {
      if (e.t <= 0) { e.state = 'slam'; e.t = 0.2; e.squash = 1; }
    } else if (e.state === 'slam') {
      e.x += Math.cos(e.a) * 180 * dt;
      e.y += Math.sin(e.a) * 180 * dt;
      if (e.t <= 0) {
        e.state = 'chase';
        e.t = 1.3;
        this.fx.ring(e.x, e.y + 4, 18, 0.25);
        this.fx.shake(2);
        this.sfx.play('thud');
      }
    }
  }

  /** 우울감: 거리를 두고 떠다니며 느린 물방울을 떨군다 */
  private aiGloom(e: Enemy, dt: number): void {
    const p = this.player;
    const d = dist(e.x, e.y, p.x, p.y);
    const a = angleTo(e.x, e.y, p.x, p.y);
    if (d < 96) {
      e.x -= Math.cos(a) * 38 * dt;
      e.y -= Math.sin(a) * 38 * dt;
    } else if (d > 156) {
      e.x += Math.cos(a) * 38 * dt;
      e.y += Math.sin(a) * 38 * dt;
    } else {
      const side = e.id % 2 === 0 ? 1 : -1;
      e.x += Math.cos(a + (Math.PI / 2) * side) * 18 * dt;
      e.y += Math.sin(a + (Math.PI / 2) * side) * 18 * dt;
    }
    if (e.state === 'drift' && e.t <= 0) {
      e.state = 'aim';
      e.t = 0.55;
    } else if (e.state === 'aim' && e.t <= 0) {
      this.fireEnemy(e.x, e.y - 14, angleTo(e.x, e.y - 14, p.x, p.y - 8), 92, 'tear');
      this.sfx.play('tear');
      e.state = 'drift';
      e.t = rand(2.0, 2.8);
    }
  }

  /** 알람: 세 번 울리고(탄막), 달려들고, 스누즈를 누른다(소환) */
  private aiAlarm(e: Enemy, dt: number): void {
    const p = this.player;
    const phase2 = e.hp <= e.maxHp / 2;
    const fire = this.stage.element === 'fire';
    const my = e.y - 18;
    switch (e.state) {
      case 'intro':
        if (e.t > 0.6) e.t = 0.6;
        if (e.t <= 0) {
          e.state = 'idle';
          e.t = 1.0;
          this.sfx.play('alarm');
          this.fx.shake(3.5);
          this.fx.ring(e.x, my, 60, 0.45);
        }
        break;
      case 'idle':
        if (dist(e.x, e.y, p.x, p.y) > 76) this.stepToward(e, p.x, p.y, phase2 ? 36 : 24, dt);
        if (e.t <= 0) {
          if (phase2 && !e.summoned) {
            e.summoned = true;
            this.say('bossSnooze', true);
            e.state = 'snoozeTele';
            e.t = 0.7;
          } else {
            e.cycle += 1;
            if (e.cycle % 2 === 1) {
              e.state = 'ringTele';
              e.t = 0.7;
            } else {
              e.state = 'chargeTele';
              e.t = 0.8;
              e.a = angleTo(e.x, e.y, p.x, p.y);
            }
          }
        }
        break;
      case 'ringTele':
        if (e.t <= 0) { e.state = 'ring'; e.n = 3; e.t = 0; }
        break;
      case 'ring':
        if (e.t <= 0 && e.n > 0) {
          const count = phase2 ? 12 : 10;
          const offset = (e.n % 2) * (Math.PI / count);
          for (let i = 0; i < count; i += 1) {
            this.fireEnemy(e.x, my, offset + (i * TAU) / count, phase2 ? 92 : 78, fire ? 'ember' : 'note');
          }
          this.fx.ring(e.x, my, 46, 0.38);
          this.fx.shake(2);
          this.sfx.play('alarm');
          e.squash = 1;
          e.n -= 1;
          e.t = 0.45;
          if (e.n === 0) { e.state = 'idle'; e.t = phase2 ? 1.1 : 1.5; }
        }
        break;
      case 'chargeTele':
        if (e.t > 0.35) e.a = angleTo(e.x, e.y, p.x, p.y);
        if (e.t <= 0) { e.state = 'charge'; e.t = 0.6; this.sfx.play('beep'); }
        break;
      case 'charge': {
        const speed = phase2 ? 280 : 250;
        e.x += Math.cos(e.a) * speed * dt;
        e.y += Math.sin(e.a) * speed * dt;
        // 불붙은 알람은 달린 자리에 불을 남긴다
        if (fire && Math.floor(e.t * 20) !== Math.floor((e.t + dt) * 20)) {
          this.flames.push({ x: e.x + rand(-4, 4), y: e.y + 6, t: 0, life: 2.4, owner: 'enemy', tick: 0 });
        }
        if (e.t <= 0) { e.state = 'stun'; e.t = 0.6; }
        break;
      }
      case 'stun':
        if (e.t <= 0) { e.state = 'idle'; e.t = phase2 ? 0.9 : 1.2; }
        break;
      case 'snoozeTele':
        if (e.t <= 0) {
          for (const side of [-1, 1]) {
            const x = clamp(e.x + side * 40, FLOOR.x + 20, FLOOR.x + FLOOR.w - 20);
            this.enemies.push(this.makeEnemy('bother', x, e.y + 10, 0.6));
          }
          this.sfx.play('beep');
          e.state = 'idle';
          e.t = 1.2;
        }
        break;
      default:
        break;
    }
  }

  private fireEnemy(x: number, y: number, a: number, speed: number, style: 'tear' | 'note' | 'ember'): void {
    this.bullets.push({
      x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      r: style === 'tear' ? 3 : 3.5, life: 6, damage: 1, owner: 'enemy', style,
    });
  }

  private updateBullets(dt: number): void {
    const p = this.player;
    const keep: Bullet[] = [];
    for (const b of this.bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      let alive = b.life > 0;
      if (b.fx) {
        b.fx.options.x = b.x;
        b.fx.options.y = b.y;
      }

      const out = b.x < FLOOR.x || b.x > FLOOR.x + FLOOR.w || b.y < FLOOR.y - 20 || b.y > FLOOR.y + FLOOR.h;
      if (alive && out) {
        alive = false;
        const hot = b.style === 'fire' || b.style === 'ember';
        const color = hot ? COLOR.fire : b.owner === 'player' ? COLOR.senaShade : COLOR.inkRim;
        this.fx.burst(b.x, b.y, Math.atan2(-b.vy, -b.vx), 4, [color], { spread: 1.5, speed: 60, life: 0.22 });
      }

      if (alive && b.owner === 'player') {
        for (const e of this.activeEnemies()) {
          if (dist(b.x, b.y, e.x, e.y - e.r * 0.6) > e.r + b.r) continue;
          const a = Math.atan2(b.vy, b.vx);
          if (b.style === 'fire') {
            this.hitEnemy(e, b.damage, a, 120, true);
            this.fx.burst(b.x, b.y, a, 10, [COLOR.fireHot, COLOR.fire, COLOR.fireDeep], { spread: 2, speed: 140, life: 0.4, size: 2 });
            this.sfx.play('fireHit');
            this.hitstop = Math.max(this.hitstop, 0.05);
            this.fx.shake(2.5);
          } else {
            this.hitEnemy(e, b.damage, a, FORMS.bow.knockback);
            this.sfx.play('arrowHit');
            this.hitstop = Math.max(this.hitstop, FORMS.bow.hitstop);
            this.fx.shake(FORMS.bow.shake);
          }
          alive = false;
          break;
        }
      }

      if (alive && b.owner === 'enemy' && dist(b.x, b.y, p.x, p.y - 8) < p.r + b.r - 1) {
        this.hurtPlayer(b.x, b.y);
        alive = false;
      }

      if (alive) keep.push(b);
      else b.fx?.stop();
    }
    this.bullets = keep;
  }

  private updateOrbs(dt: number): void {
    const p = this.player;
    const keep: Orb[] = [];
    for (const o of this.orbs) {
      o.t += dt;
      const d = dist(o.x, o.y, p.x, p.y - 6);
      if (o.t > 0.35 && (d < 60 || this.room.cleared)) {
        const a = angleTo(o.x, o.y, p.x, p.y - 6);
        const pull = Math.min(380, 90 + o.t * 240);
        o.vx += (Math.cos(a) * pull - o.vx) * Math.min(1, dt * 10);
        o.vy += (Math.sin(a) * pull - o.vy) * Math.min(1, dt * 10);
      } else {
        const f = Math.exp(-5 * dt);
        o.vx *= f;
        o.vy *= f;
      }
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      if (d < 8 && o.t > 0.35) {
        p.warmth += 1;
        this.warmthShown = true;
        this.px.warmth(p.x, p.y + 4);
        this.sfx.play('pickup');
        continue;
      }
      keep.push(o);
    }
    this.orbs = keep;
  }

  /* ═══════════════ 그리기 ═══════════════ */

  render(): void {
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = COLOR.void;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    if (this.mode === 'opening') {
      this.opening?.render();
      return;
    }

    const [sx, sy] = this.fx.shakeOffset();
    ctx.save();
    ctx.translate(sx, sy);

    if (this.mode === 'slide' && this.slide) {
      const s = this.slide;
      const k = easeInOut(Math.min(1, s.t));
      const d = DIRS[s.dir];
      const ax = Math.round(-d.dx * VIEW_W * k);
      const ay = Math.round(-d.dy * VIEW_H * k);
      const bx = Math.round(d.dx * VIEW_W * (1 - k));
      const by = Math.round(d.dy * VIEW_H * (1 - k));
      ctx.drawImage(this.roomCanvas(s.from), ax, ay);
      ctx.drawImage(this.roomCanvas(s.to), bx, by);
      ctx.restore();
      this.drawLighting(null);
      this.drawHud();
      return;
    }

    // 피니시 줌
    if (this.zoom.life > 0) {
      const k = this.zoom.life / this.zoom.max;
      const z = 1 + this.zoom.amount * easeOut(Math.min(1, k * 1.4));
      ctx.translate(this.zoom.x, this.zoom.y);
      ctx.scale(z, z);
      ctx.translate(-this.zoom.x, -this.zoom.y);
    }

    ctx.drawImage(this.roomCanvas(this.room), 0, 0);
    this.drawMarks();
    this.drawDoors();
    if (this.room.kind === 'home') drawEntranceGlow(ctx, this.clock);
    this.fx.drawGround(ctx);
    this.drawRelic();
    this.drawTelegraphs();
    this.drawPedestal();
    for (const f of this.flames) this.drawFlame(f);

    type Drawable = { y: number; draw: () => void };
    const list: Drawable[] = [];
    const sp = this.spirit;
    if (sp && sp.state !== 'hidden') {
      list.push({ y: sp.state === 'following' ? this.player.y + 0.5 : sp.y + 20, draw: () => this.drawSpirit(sp) });
    }
    for (const e of this.enemies) {
      const spawnK = e.spawnT > 0 ? 1 - e.spawnT / e.spawnMax : 1;
      if (!e.faced) pixelEllipse(ctx, e.x, e.y + e.r * 0.6, e.r * spawnK, Math.max(2, e.r * 0.3), COLOR.shadow);
      list.push({ y: e.y, draw: () => this.drawEnemy(e) });
    }
    if (this.mode !== 'title') {
      const p = this.player;
      pixelEllipse(ctx, p.x, p.y + 4, 6, 2, COLOR.shadow);
      this.drawFacingRing();
      for (const g of this.ghosts) list.push({ y: p.y - 0.5, draw: () => this.drawGhost(g) });
      list.push({ y: p.y, draw: () => this.drawPlayer() });
    }
    list.sort((a, b) => a.y - b.y);
    for (const item of list) item.draw();

    for (const o of this.orbs) this.drawOrb(o);
    for (const b of this.bullets) this.drawBullet(b);
    this.px.draw(ctx);
    this.fx.draw(ctx);
    ctx.restore();

    this.drawLighting([sx, sy]);
    this.fx.drawMotes(ctx);
    this.drawGlowPass([sx, sy]);
    this.fx.drawOverlay(ctx);
    this.drawHud();
  }

  /**
   * 조명. 방은 어둡고, 윤슬 주변과 커튼 틈 빛만 밝다.
   * 1장의 방은 오래 커튼을 닫아 둔 방이다.
   */
  private drawLighting(offset: [number, number] | null): void {
    const lc = this.lightCtx;
    const [ox, oy] = offset ?? [0, 0];
    lc.globalCompositeOperation = 'source-over';
    lc.clearRect(0, 0, VIEW_W, VIEW_H);
    const hurt = this.player.hurtT > 0 ? 0.12 : 0;
    lc.fillStyle = `rgba(3, 4, 7, ${0.42 + hurt})`;
    lc.fillRect(0, 0, VIEW_W, VIEW_H);
    lc.globalCompositeOperation = 'destination-out';

    const cut = (x: number, y: number, r: number, a: number): void => {
      const g = lc.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(0,0,0,${a})`);
      g.addColorStop(0.55, `rgba(0,0,0,${a * 0.55})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      lc.fillStyle = g;
      lc.fillRect(x - r, y - r, r * 2, r * 2);
    };

    if (offset) {
      const win = windowOf(this.room);
      this.shaftPath(lc, win, ox, oy);
      lc.fillStyle = 'rgba(0,0,0,0.3)';
      lc.fill();
      cut(win.x + win.w / 2 + ox, WALL_TOP - 8 + oy, 40, 0.6);

      if (this.mode !== 'title') {
        const p = this.player;
        cut(p.x + ox, p.y - 6 + oy, 150, 0.95);
      }
      for (const e of this.enemies) {
        if (e.kind === 'alarm' && !e.faced) cut(e.x + ox, e.y - 18 + oy, 50, 0.3);
      }
      for (const b of this.bullets) cut(b.x + ox, b.y + oy, b.style === 'fire' ? 40 : 14, b.style === 'fire' ? 0.8 : 0.5);
      for (const f of this.flames) cut(f.x + ox, f.y - 3 + oy, 22, 0.35 * (1 - f.t / f.life));
      const s = this.spirit;
      if (s && s.state !== 'hidden') cut(s.x + ox, s.y + oy, 60, 0.7);
      if (this.auraT > 0) cut(this.player.x + ox, this.player.y - 8 + oy, 70, 0.6);
      for (const o of this.orbs) cut(o.x + ox, o.y + oy, 12, 0.5);
      if (this.relic) cut(this.relic.x + ox, this.relic.y + oy, 70 * clamp(this.relic.t / 1.5, 0, 1), 0.6);
    } else {
      cut(CX, CY, 220, 0.6);
    }

    this.ctx.drawImage(this.light, 0, 0);
  }

  /** 커튼 틈 → 바닥으로 번지는 빛줄기 */
  private shaftPath(c: CanvasRenderingContext2D, win: Window_, ox: number, oy: number): void {
    const mid = win.x + win.w / 2 + ox;
    const top = WALL_TOP + oy;
    c.beginPath();
    c.moveTo(mid - 3, top);
    c.lineTo(mid + 3, top);
    c.lineTo(mid + 44, top + 120);
    c.lineTo(mid + 14, top + 120);
    c.closePath();
  }

  /** 가산 합성: 세나, 빛줄기, 탄, 온기, 타격 섬광 */
  private drawGlowPass(offset: [number, number]): void {
    const ctx = this.ctx;
    const [ox, oy] = offset;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(ox, oy);

    const win = windowOf(this.room);
    this.shaftPath(ctx, win, 0, 0);
    ctx.fillStyle = 'rgba(224, 164, 88, 0.035)';
    ctx.fill();

    const put = (color: string, x: number, y: number, r: number, a: number): void => {
      ctx.globalAlpha = a;
      ctx.drawImage(glow(color, r), Math.round(x - r), Math.round(y - r));
    };

    if (this.mode === 'play' || this.mode === 'down') {
      const p = this.player;
      const swing = p.swingT > 0 ? 1 - p.swingT / p.swingDur : 0;
      const [hx, hy] = this.handPos();
      put(COLOR.senaGlow, hx, hy, 12, 0.22 + Math.sin(swing * Math.PI) * 0.3);
      for (const g of this.ghosts) put(COLOR.senaGlow, g.x, g.foot - 12, 12, g.life * 1.5);
    }
    for (const b of this.bullets) {
      if (b.style === 'fire') put(COLOR.fire, b.x, b.y, 16, 0.5);
      else if (b.style === 'ember') put(COLOR.fire, b.x, b.y, 9, 0.5);
      else if (b.owner === 'player') put(COLOR.senaGlow, b.x, b.y, 10, 0.55);
      else put(COLOR.pale, b.x, b.y, b.style === 'note' ? 8 : 7, 0.28);
    }
    for (const f of this.flames) put(COLOR.fire, f.x, f.y - 3, 8, 0.35 * (1 - f.t / f.life));
    const sp = this.spirit;
    if (sp && sp.state !== 'hidden') put(COLOR.fire, sp.x, sp.y, 20, 0.45 + Math.sin(this.clock * 6) * 0.08);
    if (this.auraT > 0) put(COLOR.fire, this.player.x, this.player.y - 8, 26, 0.3);
    for (const o of this.orbs) put(COLOR.accent, o.x, o.y - 2, 7, 0.55);
    for (const e of this.enemies) {
      if (e.flash > 0 && !e.faced) put(COLOR.white, e.x, e.y - e.r, e.r * 2, e.flash * 4);
    }
    if (this.relic && this.room.kind === 'boss') {
      put(COLOR.accent, this.relic.x, this.relic.y, 22, 0.18 * clamp((this.relic.t - 0.8) / 1.5, 0, 1));
    }
    ctx.globalAlpha = 1;
    this.fx.drawGlow(ctx);
    ctx.restore();
  }

  private roomCanvas(room: Room): HTMLCanvasElement {
    const cached = this.roomCache.get(room);
    if (cached) return cached;
    if (room.kind === 'home') {
      // 씬 8: 오프닝의 방과 같은 그림. 커튼 틈은 아까보다 조금 넓다.
      const hc = document.createElement('canvas');
      hc.width = VIEW_W;
      hc.height = VIEW_H;
      const hg = hc.getContext('2d');
      if (!hg) throw new Error('2d context unavailable');
      drawHomeRoom(hg, { sliver: 3, sleeper: null, blink: false, toss: 0 });
      this.roomCache.set(room, hc);
      return hc;
    }

    const c = document.createElement('canvas');
    c.width = VIEW_W;
    c.height = VIEW_H;
    const g = c.getContext('2d');
    if (!g) throw new Error('2d context unavailable');
    const rnd = seeded(room.seed);

    // 벽 윗면 (전체)
    g.fillStyle = COLOR.capTop;
    g.fillRect(0, 0, VIEW_W, VIEW_H);

    // 바닥: 낮은 대비의 마루 결
    g.fillStyle = COLOR.floor;
    g.fillRect(FLOOR.x, FLOOR.y, FLOOR.w, FLOOR.h);
    g.fillStyle = COLOR.floorLine;
    for (let y = FLOOR.y + 10; y < FLOOR.y + FLOOR.h; y += 10) g.fillRect(FLOOR.x, y, FLOOR.w, 1);
    for (let row = 0; row < FLOOR.h / 10; row += 1) {
      const y = FLOOR.y + row * 10;
      let x = FLOOR.x + Math.floor(rnd() * 60);
      while (x < FLOOR.x + FLOOR.w) {
        g.fillRect(x, y, 1, 10);
        x += 56 + Math.floor(rnd() * 60);
      }
    }
    g.fillStyle = COLOR.floorDot;
    for (let i = 0; i < 46; i += 1) {
      g.fillRect(FLOOR.x + Math.floor(rnd() * FLOOR.w), FLOOR.y + Math.floor(rnd() * FLOOR.h), 1, 1);
    }

    // 위쪽 벽 앞면 (3/4 시점의 깊이)
    const faceTop = WALL_CAP;
    // 정령방은 속성색 벽지 (불: 붉은색, 물: 파란색, 나무: 초록색)
    const elem = room.kind === 'spirit' ? ELEMENT[this.stage.element] : null;
    g.fillStyle = elem ? elem.wall : COLOR.face;
    g.fillRect(FLOOR.x, faceTop, FLOOR.w, WALL_TOP - faceTop);
    g.fillStyle = elem ? elem.wallLine : COLOR.faceLine;
    for (let x = FLOOR.x + 6; x < FLOOR.x + FLOOR.w; x += 12) g.fillRect(x, faceTop + 2, 1, WALL_TOP - faceTop - 8);
    g.fillStyle = COLOR.skirting;
    g.fillRect(FLOOR.x, WALL_TOP - 5, FLOOR.w, 5);
    g.fillStyle = COLOR.skirtingTop;
    g.fillRect(FLOOR.x, WALL_TOP - 5, FLOOR.w, 1);
    // 벽 아래 그늘
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(FLOOR.x, FLOOR.y, FLOOR.w, 3);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(FLOOR.x, FLOOR.y + 3, FLOOR.w, 3);

    // 창문: 닫힌 커튼, 가운데 틈
    const win = windowOf(room);
    const wy = faceTop + 3;
    const wh = WALL_TOP - faceTop - 11;
    g.fillStyle = COLOR.capEdge;
    g.fillRect(win.x - 1, wy - 1, win.w + 2, wh + 2);
    g.fillStyle = '#262a32';
    g.fillRect(win.x, wy, win.w, wh);
    g.fillStyle = '#1e2128';
    for (let x = win.x + 2; x < win.x + win.w; x += 4) g.fillRect(x, wy, 1, wh);
    g.fillStyle = '#e0a458';
    g.fillRect(win.x + win.w / 2 - 1, wy + 1, 1, wh - 2);
    g.fillStyle = '#7a5a33';
    g.fillRect(win.x + win.w / 2, wy + 1, 1, wh - 2);
    g.fillStyle = COLOR.capEdge;
    g.fillRect(win.x - 3, wy - 2, win.w + 6, 1);

    // 벽 윗면 테두리
    g.fillStyle = COLOR.capEdge;
    g.fillRect(FLOOR.x - 1, faceTop - 1, FLOOR.w + 2, 1);
    g.fillRect(FLOOR.x - 1, faceTop, 1, FLOOR.h + WALL_TOP - faceTop + 1);
    g.fillRect(FLOOR.x + FLOOR.w, faceTop, 1, FLOOR.h + WALL_TOP - faceTop + 1);
    g.fillRect(FLOOR.x - 1, FLOOR.y + FLOOR.h, FLOOR.w + 2, 1);

    // 소품: 벽 쪽에 몇 개. 오래 치우지 않은 방.
    const propCount = 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < propCount; i += 1) {
      const id = PROP_IDS[Math.floor(rnd() * PROP_IDS.length)] ?? 'cup';
      const spr = SPRITES.props[id];
      for (let tries = 0; tries < 12; tries += 1) {
        const alongTop = rnd() < 0.6;
        const x = alongTop
          ? Math.round(FLOOR.x + 8 + rnd() * (FLOOR.w - 16 - spr.width))
          : rnd() < 0.5 ? FLOOR.x + 3 : FLOOR.x + FLOOR.w - 3 - spr.width;
        const y = alongTop
          ? FLOOR.y + 4 + Math.round(rnd() * 6)
          : Math.round(FLOOR.y + 16 + rnd() * (FLOOR.h - 30));
        const blocksDoor =
          (Math.abs(x + spr.width / 2 - CX) < DOOR_HALF + 18 && (y < FLOOR.y + 24 || y > FLOOR.y + FLOOR.h - 24)) ||
          (Math.abs(y - CY) < DOOR_HALF + 14 && !alongTop);
        if (blocksDoor) continue;
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(x + 1, y + spr.height - 1, spr.width, 2);
        g.drawImage(spr, x, y);
        break;
      }
    }

    // 문 통로
    for (const dir of DIR_KEYS) {
      if (!room.doors[dir]) continue;
      const next = neighborOf(this.stage, room, dir);
      const toBoss = next?.kind === 'boss';
      // 정령방으로 가는 문, 정령방 안의 문은 속성색
      const spiritDoor = next?.kind === 'spirit' || room.kind === 'spirit';
      const r = this.doorRect(dir);
      g.fillStyle = dir === 'n' ? COLOR.doorway : COLOR.floor;
      g.fillRect(r.x, r.y, r.w, r.h);
      if (dir === 'n') {
        // 앞면에 뚫린 문: 바닥과 이어지는 문턱
        g.fillStyle = COLOR.floor;
        g.fillRect(r.x, WALL_TOP - 6, r.w, 6);
      }
      g.fillStyle = spiritDoor ? ELEMENT[this.stage.element].door : toBoss ? COLOR.postBoss : COLOR.post;
      if (dir === 'n' || dir === 's') {
        g.fillRect(r.x - 3, r.y, 3, r.h);
        g.fillRect(r.x + r.w, r.y, 3, r.h);
        if (dir === 'n') g.fillRect(r.x - 3, r.y, r.w + 6, 2);
      } else {
        g.fillRect(r.x, r.y - 3, r.w, 3);
        g.fillRect(r.x, r.y + r.h, r.w, 3);
      }
    }

    this.roomCache.set(room, c);
    return c;
  }

  private doorRect(dir: Dir): { x: number; y: number; w: number; h: number } {
    const h = DOOR_HALF;
    switch (dir) {
      case 'n': return { x: CX - h, y: WALL_CAP + 2, w: h * 2, h: FLOOR.y - WALL_CAP - 2 };
      case 's': return { x: CX - h, y: FLOOR.y + FLOOR.h, w: h * 2, h: VIEW_H - FLOOR.y - FLOOR.h };
      case 'w': return { x: 0, y: CY - h, w: FLOOR.x, h: h * 2 };
      case 'e': return { x: FLOOR.x + FLOOR.w, y: CY - h, w: VIEW_W - FLOOR.x - FLOOR.w, h: h * 2 };
    }
  }

  /** 잠긴 문: 잉크가 양쪽에서 막는다 */
  private drawDoors(): void {
    const closed = 1 - this.doorOpen;
    if (closed <= 0.01) return;
    const ctx = this.ctx;
    for (const dir of DIR_KEYS) {
      if (!this.room.doors[dir]) continue;
      const r = this.doorRect(dir);
      if (dir === 'n' || dir === 's') {
        const w = Math.round(DOOR_HALF * closed);
        ctx.fillStyle = COLOR.ink;
        ctx.fillRect(r.x, r.y, w, r.h);
        ctx.fillRect(r.x + r.w - w, r.y, w, r.h);
        ctx.fillStyle = COLOR.inkRim;
        if (w > 0) {
          ctx.fillRect(r.x + w - 1, r.y, 1, r.h);
          ctx.fillRect(r.x + r.w - w, r.y, 1, r.h);
        }
      } else {
        const h = Math.round(DOOR_HALF * closed);
        ctx.fillStyle = COLOR.ink;
        ctx.fillRect(r.x, r.y, r.w, h);
        ctx.fillRect(r.x, r.y + r.h - h, r.w, h);
        ctx.fillStyle = COLOR.inkRim;
        if (h > 0) {
          ctx.fillRect(r.x, r.y + h - 1, r.w, 1);
          ctx.fillRect(r.x, r.y + r.h - h, r.w, 1);
        }
      }
    }
  }

  private drawMarks(): void {
    const ctx = this.ctx;
    ctx.globalAlpha = 0.06;
    for (const m of this.room.marks) pixelEllipse(ctx, m.x, m.y, m.w, 3, COLOR.pale);
    ctx.globalAlpha = 1;
  }

  private drawRelic(): void {
    const r = this.relic;
    if (!r || this.room.kind !== 'boss') return;
    const k = clamp((r.t - 0.6) / 1.6, 0, 1);
    if (k <= 0) return;
    const ctx = this.ctx;
    pixelEllipse(ctx, r.x, r.y + 9, 7, 2, COLOR.shadow);
    this.blit(SPRITES.plainClock, r.x, r.y + 10, { alpha: easeOut(k) });
  }

  private drawTelegraphs(): void {
    const ctx = this.ctx;
    for (const e of this.enemies) {
      if (e.faced || e.kind !== 'alarm' || e.state !== 'chargeTele') continue;
      if (Math.floor(this.clock * 12) % 2 === 0) continue;
      const c = Math.cos(e.a);
      const s = Math.sin(e.a);
      for (let d = e.r + 6; d < e.r + 110; d += 5) {
        plot(ctx, e.x + c * d, e.y + s * d, COLOR.dim);
        plot(ctx, e.x + c * d + 1, e.y + s * d, COLOR.dim);
      }
    }
  }

  /** 발밑의 방향 표시. 세나가 지금 어느 쪽을 보는지. */
  private drawFacingRing(): void {
    if (this.mode !== 'play') return;
    const p = this.player;
    const ctx = this.ctx;
    const a = p.aim;
    ctx.globalAlpha = 0.55;
    for (let i = -6; i <= 6; i += 1) {
      const t = a + i * 0.09;
      plot(ctx, p.x + Math.cos(t) * 11, p.y + 4 + Math.sin(t) * 5, i === 0 ? COLOR.sena : COLOR.senaShade);
    }
    ctx.globalAlpha = 1;
  }

  private blit(spr: Sprite, x: number, footY: number, o: { flip?: boolean; sx?: number; sy?: number; alpha?: number } = {}): void {
    const ctx = this.ctx;
    const w = Math.max(1, Math.round(spr.width * (o.sx ?? 1)));
    const h = Math.max(1, Math.round(spr.height * (o.sy ?? 1)));
    const dx = Math.round(x - w / 2);
    const dy = Math.round(footY - h);
    ctx.save();
    ctx.globalAlpha = o.alpha ?? 1;
    if (o.flip) {
      ctx.translate(dx + w, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(spr, 0, 0, w, h);
    } else {
      ctx.drawImage(spr, dx, dy, w, h);
    }
    ctx.restore();
  }

  private drawEnemy(e: Enemy): void {
    const base = this.spriteOf(e);
    const lift = e.kind === 'gloom' ? 8 + Math.sin(this.clock * 3 + e.id) * 2 : 0;
    const breathe = e.kind === 'gloom' ? 0 : Math.sin(this.clock * 2.4 + e.id) * 0.03;
    const foot = e.y + e.r * 0.6 - lift;

    if (e.spawnT > 0) {
      const k = 1 - e.spawnT / e.spawnMax;
      pixelEllipse(this.ctx, e.x, e.y + e.r * 0.6, e.r * 1.3 * k, 3, COLOR.ink);
      if (k > 0.35) this.blit(base, e.x, foot, { sy: (k - 0.35) / 0.65, alpha: k });
      return;
    }

    if (e.faced) {
      const k = Math.min(1, e.fadeT);
      if (e.kind === 'alarm') {
        this.blit(tint(base, COLOR.pale), e.x, foot - k * 14, { alpha: (1 - k) * 0.8 });
        return;
      }
      // 몸은 바닥으로 가라앉고, 옅은 사본(pixelfx soul-rise)이 위로 빠져나간다
      this.blit(base, e.x, foot, { alpha: 1 - k, sy: 1 - k * 0.6, sx: 1 + k * 0.2 });
      return;
    }

    let sxs = 1 + e.squash * 0.24 - breathe;
    let sys = 1 - e.squash * 0.2 + breathe;
    let ox = 0;
    if (e.kind === 'heavy' && e.state === 'wind') {
      sxs = 1.14;
      sys = 0.84;
      ox = Math.round(Math.sin(this.clock * 60));
    }
    if (e.kind === 'alarm' && (e.state === 'ringTele' || e.state === 'snoozeTele' || e.state === 'ring')) {
      ox = Math.round(rand(-1.5, 1.5));
    }
    if (e.kind === 'alarm' && e.state === 'stun') sys *= 0.9;

    const telegraph = (e.kind === 'gloom' && e.state === 'aim') || (e.kind === 'alarm' && e.state === 'chargeTele')
      || (e.kind === 'heavy' && e.state === 'wind');
    const flip = e.kind !== 'alarm' && this.player.x < e.x;
    this.blit(base, e.x + ox, foot, { sx: sxs, sy: sys, flip });
    if (e.flash > 0) {
      this.blit(tint(base, COLOR.white), e.x + ox, foot, { sx: sxs, sy: sys, flip });
    } else if (telegraph && Math.floor(this.clock * 14) % 2 === 0) {
      this.blit(tint(base, COLOR.pale), e.x + ox, foot, { sx: sxs, sy: sys, flip, alpha: 0.35 });
    }
  }

  private walkFrame(): number {
    const p = this.player;
    return p.moving && p.lungeT <= 0 ? Math.floor(p.walkT * 10) % 4 : 0;
  }

  private drawPlayer(): void {
    const p = this.player;
    const ctx = this.ctx;
    const foot = Math.round(p.y + 4);

    if (this.mode === 'down') {
      const k = clamp(p.downT / 0.4, 0, 1);
      const spr = SPRITES.yunseul[0];
      ctx.save();
      ctx.translate(Math.round(p.x), foot);
      ctx.rotate((Math.PI / 2) * easeOut(k) * -p.facing);
      ctx.drawImage(spr, -Math.round(spr.width / 2), -spr.height);
      ctx.restore();
      return;
    }

    if (p.invuln > 0 && p.hurtT <= 0 && Math.floor(p.invuln * 16) % 2 === 0) return;

    const frame = this.walkFrame();
    const spr = SPRITES.yunseul[frame as 0 | 1 | 2 | 3];
    const bob = frame === 1 || frame === 3 ? -1 : 0;
    const behind = Math.sin(this.weaponAngle()) < -0.35;
    if (behind) this.drawWeapon();
    this.blit(p.hurtT > 0 ? tint(spr, COLOR.white) : spr, p.x, foot + bob, { flip: p.facing < 0 });
    if (!behind) this.drawWeapon();
  }

  private drawGhost(g: Ghost): void {
    const spr = SPRITES.yunseul[g.frame as 0 | 1 | 2 | 3];
    this.blit(tint(spr, COLOR.senaGlow), g.x, g.foot, { flip: g.flip, alpha: (g.life / 0.16) * 0.45 });
  }

  private weaponAngle(): number {
    const p = this.player;
    if (p.swingT <= 0) return p.aim;
    if (p.form !== 'sword') return p.aim;
    const prog = 1 - p.swingT / p.swingDur;
    const arc = FORMS.sword.arc;
    return p.aim - (arc / 2) * p.swingSide + arc * p.swingSide * easeOut(prog);
  }

  private handPos(): [number, number] {
    const p = this.player;
    const a = this.weaponAngle();
    return [p.x + Math.cos(a) * 5, p.y - 7 + Math.sin(a) * 3];
  }

  /** 세나. 화면에서 가장 밝은 물체. */
  private drawWeapon(): void {
    const p = this.player;
    const ctx = this.ctx;
    const prog = p.swingT > 0 ? 1 - p.swingT / p.swingDur : 0;
    const pulse = p.swingT > 0 ? Math.sin(prog * Math.PI) : 0;
    const a = this.weaponAngle();
    const c = Math.cos(a);
    const s = Math.sin(a);
    const [hx, hy] = this.handPos();
    const px = -s;
    const py = c;

    if (this.room.kind === 'home') {
      // 방에서는 세나가 손목의 은빛 팔찌로 붙어 있다
      const wx = Math.round(p.x + p.facing * 6);
      const wy = Math.round(p.y - 7);
      ctx.fillStyle = COLOR.sena;
      ctx.fillRect(wx - 1, wy, 3, 1);
      ctx.fillStyle = COLOR.senaShade;
      ctx.fillRect(wx - 1, wy + 1, 3, 1);
      return;
    }

    switch (p.form) {
      case 'dagger': {
        const len = 9 + pulse * 8;
        pixelLine(ctx, hx - c, hy - s, hx + c * 2, hy + s * 2, COLOR.senaShade);
        pixelLine(ctx, hx + c * 2 + px * 2, hy + s * 2 + py * 2, hx + c * 2 - px * 2, hy + s * 2 - py * 2, COLOR.senaShade);
        pixelLine(ctx, hx + c * 3, hy + s * 3, hx + c * len, hy + s * len, COLOR.sena);
        pixelLine(ctx, hx + c * 3 + px, hy + s * 3 + py, hx + c * (len - 2) + px, hy + s * (len - 2) + py, COLOR.senaShade);
        break;
      }
      case 'sword': {
        pixelLine(ctx, hx - c * 2, hy - s * 2, hx + c * 2, hy + s * 2, COLOR.senaShade);
        pixelLine(ctx, hx + c * 3 + px * 3, hy + s * 3 + py * 3, hx + c * 3 - px * 3, hy + s * 3 - py * 3, COLOR.senaShade);
        pixelLine(ctx, hx + c * 4, hy + s * 4, hx + c * 21, hy + s * 21, COLOR.sena);
        pixelLine(ctx, hx + c * 4 + px, hy + s * 4 + py, hx + c * 19 + px, hy + s * 19 + py, COLOR.senaShade);
        break;
      }
      case 'bow': {
        const pull = pulse * 3;
        const bx = hx + c * 3;
        const by = hy + s * 3;
        const r = 8;
        const steps = 14;
        ctx.fillStyle = COLOR.sena;
        for (let i = 0; i <= steps; i += 1) {
          const t = a - 1.15 + (2.3 * i) / steps;
          ctx.fillRect(Math.round(bx + Math.cos(t) * r - c * 3), Math.round(by + Math.sin(t) * r - s * 3), 1, 1);
        }
        const e1x = bx + Math.cos(a - 1.15) * r - c * 3;
        const e1y = by + Math.sin(a - 1.15) * r - s * 3;
        const e2x = bx + Math.cos(a + 1.15) * r - c * 3;
        const e2y = by + Math.sin(a + 1.15) * r - s * 3;
        const mx = bx - c * (pull + 1);
        const my = by - s * (pull + 1);
        pixelLine(ctx, e1x, e1y, mx, my, COLOR.senaShade);
        pixelLine(ctx, mx, my, e2x, e2y, COLOR.senaShade);
        break;
      }
      case 'knuckle': {
        const ext = 3 + pulse * 10;
        const kx = Math.round(hx + c * ext) - 2;
        const ky = Math.round(hy + s * ext) - 2;
        ctx.fillStyle = COLOR.sena;
        ctx.fillRect(kx, ky, 5, 4);
        ctx.fillStyle = COLOR.senaShade;
        ctx.fillRect(kx, ky + 3, 5, 1);
        ctx.fillRect(kx + 1, ky + 1, 1, 1);
        ctx.fillRect(kx + 3, ky + 1, 1, 1);
        break;
      }
    }
  }

  private drawOrb(o: Orb): void {
    const ctx = this.ctx;
    const x = Math.round(o.x);
    const y = Math.round(o.y) - 3;
    ctx.fillStyle = COLOR.accent;
    ctx.fillRect(x - 1, y - 1, 3, 3);
    if (Math.floor((this.clock + o.x * 0.05) * 4) % 3 === 0) plot(ctx, x - 1, y - 1, COLOR.white);
  }

  /** 그늘 종류별 스프라이트. 보스는 스테이지 속성을 따른다. */
  private spriteOf(e: Enemy): Sprite {
    if (e.kind === 'alarm' && this.stage.element === 'fire') return SPRITES.alarmFire;
    return ENEMY_SPRITE[e.kind];
  }

  /** 바닥 불: 3~5px짜리 작은 불꽃이 깜빡이다 사그라든다 */
  private drawFlame(f: Flame): void {
    const ctx = this.ctx;
    const k = 1 - f.t / f.life;
    const big = f.owner === 'enemy';
    const h = Math.max(1, Math.round((big ? 7 : 5) * k * (0.75 + Math.abs(Math.sin(f.t * 17 + f.x)) * 0.35)));
    const w = big ? 5 : 3;
    const x = Math.round(f.x - w / 2);
    const y = Math.round(f.y);
    ctx.fillStyle = COLOR.fireDeep;
    ctx.fillRect(x, y - h, w, h);
    ctx.fillStyle = COLOR.fire;
    ctx.fillRect(x + 1, y - h + 1, w - 2, Math.max(1, h - 1));
    ctx.fillStyle = COLOR.fireHot;
    ctx.fillRect(x + Math.floor(w / 2), y - Math.max(1, Math.round(h * 0.5)), 1, Math.max(1, Math.round(h * 0.4)));
  }

  /** 정령방 가운데 받침: 정령이 나타날 자리 */
  private drawPedestal(): void {
    if (this.room.kind !== 'spirit') return;
    const ctx = this.ctx;
    const col = ELEMENT[this.stage.element];
    const x = CX;
    const y = CY + 16;
    pixelEllipse(ctx, x, y, 14, 4, '#1b0d0f');
    pixelEllipse(ctx, x, y - 1, 12, 3, '#2a1316');
    ctx.globalAlpha = 0.6 + Math.sin(this.clock * 3) * 0.2;
    for (let i = 0; i < 16; i += 1) {
      const a = (i / 16) * TAU + this.clock * 0.6;
      plot(ctx, x + Math.cos(a) * 12, y - 1 + Math.sin(a) * 3, col.door);
    }
    ctx.globalAlpha = 1;
  }

  private drawSpirit(s: Spirit): void {
    const frame = Math.floor(this.clock * 5) % 2 === 0 ? 0 : 1;
    const spr = SPRITES.fireSpirit[frame];
    const bob = s.state === 'waiting' ? Math.sin(this.clock * 2.5) * 2 : 0;
    const appear = s.state === 'waiting' ? clamp(s.t / 0.8, 0, 1) : 1;
    if (s.state === 'waiting') pixelEllipse(this.ctx, s.x, s.y + 20, 5 * appear, 1.5, COLOR.shadow);
    const flip = s.state === 'following' && this.player.facing < 0;
    this.blit(spr, s.x, s.y + 8 + bob, { alpha: appear, sy: 0.6 + appear * 0.4, flip });
  }

  private drawBullet(b: Bullet): void {
    const ctx = this.ctx;
    if (b.style === 'fire') {
      // 몸통은 pixelfx 불덩이가 그린다. 여기선 판정 위치의 흰 심지만.
      ctx.fillStyle = COLOR.white;
      ctx.fillRect(Math.round(b.x) - 1, Math.round(b.y) - 1, 2, 2);
      return;
    }
    if (b.style === 'ember') {
      const x = Math.round(b.x);
      const y = Math.round(b.y);
      ctx.fillStyle = COLOR.fireDeep;
      ctx.fillRect(x - 2, y - 1, 5, 3);
      ctx.fillRect(x - 1, y - 2, 3, 5);
      ctx.fillStyle = COLOR.fire;
      ctx.fillRect(x - 1, y - 1, 3, 3);
      ctx.fillStyle = COLOR.fireHot;
      ctx.fillRect(x, y - 1, 1, 2);
      return;
    }
    if (b.style === 'arrow') {
      const sp = Math.hypot(b.vx, b.vy);
      const c = b.vx / sp;
      const s = b.vy / sp;
      pixelLine(ctx, b.x - c * 12, b.y - s * 12, b.x - c * 3, b.y - s * 3, COLOR.senaShade);
      pixelLine(ctx, b.x - c * 3, b.y - s * 3, b.x + c * 2, b.y + s * 2, COLOR.white);
      return;
    }
    const x = Math.round(b.x);
    const y = Math.round(b.y);
    if (b.style === 'tear') {
      ctx.fillStyle = COLOR.pale;
      ctx.fillRect(x - 1, y - 3, 3, 6);
      ctx.fillRect(x - 2, y - 1, 5, 3);
      ctx.fillStyle = COLOR.ink;
      ctx.fillRect(x, y - 1, 1, 3);
      return;
    }
    // 소리(음표): 속이 빈 고리
    ctx.fillStyle = COLOR.pale;
    ctx.fillRect(x - 1, y - 3, 3, 1);
    ctx.fillRect(x - 1, y + 3, 3, 1);
    ctx.fillRect(x - 3, y - 1, 1, 3);
    ctx.fillRect(x + 3, y - 1, 1, 3);
    ctx.fillRect(x - 2, y - 2, 1, 1);
    ctx.fillRect(x + 2, y - 2, 1, 1);
    ctx.fillRect(x - 2, y + 2, 1, 1);
    ctx.fillRect(x + 2, y + 2, 1, 1);
    ctx.fillStyle = COLOR.ink;
    ctx.fillRect(x - 1, y - 1, 3, 3);
  }

  /* ── HUD: 처음엔 HP뿐. 온기는 처음 주운 뒤에 나타난다. ── */
  private drawHud(): void {
    if (this.mode === 'title') return;
    const ctx = this.ctx;
    const p = this.player;

    // 하트: HP 2 = 한 칸. 맞으면 반 칸씩. 방금 잃은 반 칸은 흰색으로 깜빡인다.
    const hearts = Math.ceil(p.maxHp / 2);
    for (let i = 0; i < hearts; i += 1) {
      const x = FLOOR.x + i * 11;
      const y = 1;
      const fill = clamp(p.hp - i * 2, 0, 2);
      ctx.drawImage(SPRITES.heartEmpty, x, y);
      if (fill === 2) ctx.drawImage(SPRITES.heart, x, y);
      else if (fill === 1) ctx.drawImage(SPRITES.heart, 0, 0, 5, 8, x, y, 5, 8);
      const lostHere = p.lostT > 0 && Math.floor(p.hp / 2) === i;
      if (lostHere && Math.floor(p.lostT * 20) % 2 === 0) {
        const lx = p.hp % 2 === 1 ? 5 : 0;
        ctx.drawImage(tint(SPRITES.heart, COLOR.white), lx, 0, lx === 0 ? 5 : 4, 8, x + lx, y, lx === 0 ? 5 : 4, 8);
      }
    }

    if (this.hasSpirit) this.drawSkillBar();

    if (this.warmthShown) {
      const left = drawDigits(ctx, p.warmth, FLOOR.x + FLOOR.w - 1, 2, COLOR.pale);
      ctx.fillStyle = COLOR.accent;
      ctx.fillRect(left - 6, 3, 3, 3);
    }

    const boss = this.enemies.find((e) => e.kind === 'alarm' && !e.faced);
    if (boss && this.mode === 'play') {
      const w = 120;
      const x = FLOOR.x + FLOOR.w - w;
      const y = VIEW_H - 9;
      const k = boss.spawnT > 0 ? 1 - boss.spawnT / boss.spawnMax : 1;
      ctx.fillStyle = COLOR.empty;
      ctx.fillRect(x, y, Math.round(w * k), 2);
      ctx.fillStyle = COLOR.pale;
      ctx.fillRect(x, y, Math.round(w * k * (boss.hp / boss.maxHp)), 2);
    }
  }

  /** 정령 스킬 칸: 아래 벽 가운데. 정령을 얻은 뒤에만 열린다. */
  private drawSkillBar(): void {
    const ctx = this.ctx;
    const keys: readonly SkillKey[] = ['q', 'w', 'e', 'r'];
    const w = 13;
    const gap = 3;
    const total = keys.length * w + (keys.length - 1) * gap;
    const x0 = Math.round(CX - total / 2);
    const y = VIEW_H - 14;
    keys.forEach((k, i) => {
      const x = x0 + i * (w + gap);
      const cd = this.skillCd[k];
      const ready = cd <= 0;
      const active = (k === 'w' && this.auraT > 0) || (k === 'e' && this.hasteT > 0) || (k === 'r' && this.ultLeft > 0);
      ctx.fillStyle = active ? COLOR.fireDeep : '#140c0b';
      ctx.fillRect(x, y, w, 12);
      if (!ready) {
        const h = Math.ceil(12 * (cd / SKILL[k].cd));
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(x, y + 12 - h, w, h);
      }
      ctx.fillStyle = ready ? COLOR.fire : COLOR.empty;
      ctx.fillRect(x, y, w, 1);
      ctx.fillRect(x, y + 11, w, 1);
      ctx.fillRect(x, y, 1, 12);
      ctx.fillRect(x + w - 1, y, 1, 12);
      drawGlyph(ctx, k, x + 4, y + 4, ready ? COLOR.fireHot : COLOR.dim);
    });
  }
}

/** 5×5 스킬 키 글자 */
const GLYPHS: Readonly<Record<SkillKey, readonly string[]>> = {
  q: ['.###.', '#...#', '#.#.#', '#..#.', '.##.#'],
  w: ['#...#', '#...#', '#.#.#', '#.#.#', '.#.#.'],
  e: ['####.', '#....', '###..', '#....', '####.'],
  r: ['###..', '#..#.', '###..', '#.#..', '#..#.'],
};

function drawGlyph(ctx: CanvasRenderingContext2D, k: SkillKey, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  GLYPHS[k].forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx += 1) if (row.charAt(dx) === '#') ctx.fillRect(x + dx, y + dy, 1, 1);
  });
}
