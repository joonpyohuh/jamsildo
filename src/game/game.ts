import {
  COLOR, CX, CY, DOOR_HALF, ELEMENT, FLOOR, IMPLEMENTED_ELEMENTS, SHOW_DAMAGE_NUMBERS, VIEW_H, VIEW_W, WALL_CAP, WALL_TOP, type Element,
} from './config';
import { TAU, angleDiff, angleTo, clamp, dist, easeInOut, easeOut, rand, seeded } from './math';
import type { Sfx } from './audio';
import { Fx, drawDigits, pixelArc, pixelEllipse, pixelLine, plot } from './fx';
import { FORMS, SENSE, chooseForm, type FormId } from './forms';
import { DIRS, DIR_KEYS, generateStage, restoreStage, makeHomeRoom, neighborOf, type Dir, type EnemyKind, type Room, type Stage } from './stage';
import { readSave, writeSave } from './storage';
import { PROP_IDS, SPRITES, glow, tint, type Sprite } from './sprites';
import type { ComboHud, EnemyInfo, Inventory, PickupPrompt, Ui } from './ui';
import { ECLIPSE_BURST, ECLIPSE_REACH, REAPER_SWING, SUPERS, SWORD_DROP, WAVE_SPEED, drawCutIn, drawSuperFx, type Cut, type SuperFx, type SuperKind } from './supers';
import { PixelLayer, actorFromSprite } from './pixelfx';
import { LINE_FACE, OPENING, SPEAKER_NAME, pickLine, tutorialLines, type LineKey, type Talk, type TutorialKey } from './lines';
import type { PxActor, PxInstance } from '../vendor/pixelfx/core/index.js';
import { HOME, Opening, drawEntranceGlow, drawHomeRoom } from './opening';
import { ART, MONSTER_VFX } from './assets';
import { ANIMS } from './anim';
import { BOSSES, CHAPTERS, COMBOS, ENEMY_DESC, ENEMY_NAMES, ITEMS, PATTERNS, PATTERN_LABELS, SKILLS, STATUS_LABELS, SPIRIT_ASSETS, SPIRIT_NAMES, newSpirit, type BossId, type ComboSpec, type ItemId, type SpiritSlot, type StatusId } from './campaign';
import { contains, newBoss, tickStatuses, type BossState, type Statuses, type Zone } from './combat';

export type SkillKey = 'q' | 'w' | 'e' | 'r';

export interface InputState {
  attackHeld: boolean;
  /** null = 클릭 목표 이동, 영벡터 = 조이스틱 정지. */
  move: { x: number; y: number } | null;
  /** 이번 프레임에 눌린 정령 스킬 (main이 넣고 game이 꺼낸다) */
  skillQueue: Array<SkillKey | { key: SkillKey; x: number; y: number }>;
}

export type Mode = 'title' | 'opening' | 'talk' | 'play' | 'slide' | 'down' | 'clear' | 'embrace';

const PLAYER_SPEED = 150;
/** 바닥 안쪽 경계: 보스·장판이 벽에 붙지 않게 */
const IN_X0 = FLOOR.x + 24, IN_X1 = FLOOR.x + FLOOR.w - 24, IN_Y0 = FLOOR.y + 25, IN_Y1 = FLOOR.y + FLOOR.h - 19;
/** HP 20 = 하트 한 칸. 시작 체력 100 = 하트 다섯 개. */
const PLAYER_HP = 100;
/** 스테이지 보상 아이템으로 오를 수 있는 상한 */
const MAX_HP_CAP = 160;
const MAX_ENERGY_CAP = 130;
const INVULN = 1.1;
/** 1스테이지는 튜토리얼: 적 체력과 받는 피해를 낮춘다 */
const TUTORIAL_STAGE = 1, TUTORIAL_HP = 0.6, TUTORIAL_DAMAGE = 0.5;
/** 대시: 짧게 튀어나가고 0.3초 무적, 재사용 1초 */
const DASH_TIME = 0.14, DASH_SPEED = 400, DASH_INVULN = 0.3, DASH_COOLDOWN = 1;
/** 스테이지마다 오르는 공격력 */
const STAGE_ATTACK = 0.09;
/** 정령이 중급·상급이 되는 경험치 */
const TIER2_XP = 5, TIER3_XP = 16;
/** 방사형 탄이 시작되는 거리(보스 몸 바깥). 이 안쪽은 탄이 지나가지 않아 붙어서 치는 쪽이 안전하다. */
const RING_GAP = 30;
/** 바닥 아이템을 Space로 주울 수 있는 거리 */
const PICKUP_RANGE = 30;
/** 튀어 오른 아이템이 내려앉는 시간. 그 전에는 줍지 못한다. */
const ITEM_LAND = 0.7;
const SLIDE_TIME = 0.36;
const TYPE_SPEED = 32;
const SPIRIT_BRAZIERS = [
  { x: FLOOR.x + 32, y: FLOOR.y + 36 },
  { x: FLOOR.x + FLOOR.w - 32, y: FLOOR.y + 36 },
  { x: FLOOR.x + 32, y: FLOOR.y + FLOOR.h - 26 },
  { x: FLOOR.x + FLOOR.w - 32, y: FLOOR.y + FLOOR.h - 26 },
] as const;

interface Player {
  energy: number; maxEnergy: number; effects: Statuses; armor: number; skillShield: number;
  fireArmor: number; healTime: number; lightGuard: number; stealth: number; slowFactor: number;
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
  | 'intro' | 'idle' | 'ringTele' | 'ring' | 'chargeTele' | 'charge' | 'stun' | 'snoozeTele' | 'bossAct';

interface Enemy {
  armor?:number; skillShield?:number; fireArmor?:number; stealth?:number; healTime?:number; lightGuard?:number;
  effects: Statuses; burnTick: number; boss?: BossState; tag?: string; source?: number; spriteId?: string;
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
  element?: Element; status?: StatusId; statusTime?: number; skill?: boolean; pierce?: boolean; hit?: Set<number>; bounced?: boolean;
  x: number; y: number; vx: number; vy: number; r: number;
  life: number; damage: number;
  owner: 'player' | 'enemy';
  /** fire: 정령 불덩이(pixelfx), ember: 불붙은 알람의 불씨 */
  style: 'arrow' | 'tear' | 'note' | 'fire' | 'ember' | 'slash' | 'dark' | 'bubble' | 'shadow';
  /** 어둠덩이: 수명이 다하면 이 수만큼 파편으로 터진다 */
  burst?: number;
  /** 초당 꺾이는 각도 (약한 유도) */
  home?: number;
  /** 맞으면 이 반경 안의 다른 그늘에도 피해 (불씨 탄) */
  explode?: number;
  /** 넉백 세기 (물방울) */
  knock?: number;
  /** 탄 대신 그릴 원화 이펙트 */
  art?: string;
  artScale?: number;
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
/** 원화 이펙트 한 장. 정적인 그림이라 등장·퇴장을 코드로 움직인다. */
interface Vfx { id: string; x: number; y: number; t: number; life: number; angle: number; scale: number; alpha: number; rise: number; follow: boolean }
/** 진행 방향이 있는 그림 (오른쪽을 향해 그려져 있다) */
const AIMED_PANELS = new Set([
  'fire_dagger', 'fire_bow', 'fire_knuckle', 'water_dagger', 'water_bow', 'water_knuckle',
  'wood_bow', 'dark_dagger', 'dark_bow', 'light_dagger', 'light_bow', 'chaos_prismatic_shadow_ray',
]);
const CHAOS_PANELS = ['fire_water_collision', 'wood_lightning_burst', 'prismatic_shadow_ray', 'cosmic_chaos_ring'] as const;
const WEAPON_PANEL: Readonly<Record<FormId, string>> = { dagger: 'dagger', sword: 'longsword', bow: 'bow', knuckle: 'knuckle' };
interface Slide { from: Room; to: Room; dir: Dir; t: number }
interface Relic { x: number; y: number; t: number }
/** 스테이지를 깰 때마다 하나: 기력의 결정(최대 기력) 또는 심장 조각(최대 체력) */
interface Item { x: number; y: number; vx: number; vy: number; t: number; kind: ItemId }
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
    energy: 30, maxEnergy: 30, effects: {}, armor: 0, skillShield: 0, fireArmor: 0, healTime: 0, lightGuard: 0, stealth: 0, slowFactor: 0.5,
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
  readonly cheats = { health: false, energy: false };
  get stageNumber(): number { return this.stage.number; }
  private stage: Stage;
  readonly equipped: SpiritSlot[] = [];
  private readonly acquired = new Set<Element>();
  activeSpirit = 0;
  private switchCd = 0;
  private zones: Zone[] = [];
  private events: Array<{ time: number; run: () => void }> = [];
  private aimPoint: { x: number; y: number } | null = null;
  private skillPower = 1;
  private chaosTime = 0;
  private chaosTick = 0;
  private reverseTime = 0;
  private freezeCooldown = 0;
  private reactionCd = 0;
  private fixedForm = 0;
  private runAttack = 1;
  private embracing: Enemy | null = null;
  private playerBurnTick = 0;
  private room: Room;
  private readonly visitedRooms = new Set<Room>();
  private player: Player = makePlayer();
  private enemies: Enemy[] = [];
  /** 우클릭으로 지정한 적: 닿을 거리까지 쫓아가서 친다 */
  private attackOrder: Enemy | null = null;
  /** 좌클릭으로 고른 적: 정보 패널에 보여준다 */
  private inspected: Enemy | null = null;
  /** 초필살기 컷인: 이 동안 세상이 멈춘다 */
  private cut: Cut | null = null;
  private supers: SuperFx[] = [];
  /** 세나가 사람 모습으로 윤슬 곁에 서 있는 남은 시간 */
  private senaShowT = 0;
  private comboHinted = false;
  private ringHinted = false;
  private dashCd = 0;
  /** 이 탭에서 이미 들은 설명. 쓰러져 다시 시작해도 반복하지 않는다. */
  private readonly tutorialSeen = new Set<TutorialKey>();
  /** 문을 지나 걸어 들어오는 중: 테스트나 복원으로 방을 여는 경우엔 설명하지 않는다 */
  private walkingIn = false;
  /** 세로 조작에서 스킬을 끄는 동안 보여주는 조준점 */
  private aimPreview: { x: number; y: number; cancel: boolean } | null = null;
  /** 이번 판에 얻은 아이템 수 */
  private items: Partial<Record<ItemId, number>> = {};
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
  private vfx: Vfx[] = [];
  /** 동작이 바뀐 시각: 동작이 시작한 뒤 흐른 시간으로 프레임을 고른다 */
  private animTags = new Map<number, { tag: string; start: number }>();
  private castAt = -9;
  private spiritCastAt = -9;
  private armorFx: PxInstance | null = null;
  private playerBodyCache: PxActor | null = null;
  private armorTick = 0;
  private item: Item | null = null;
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

  /* 정령 동행 */
  private spirit: Spirit | null = null;
  hasSpirit = false;
  private flames: Flame[] = [];
  private skillHinted = false;

  private readonly roomCache = new Map<Room, HTMLCanvasElement>();
  private readonly light: HTMLCanvasElement;
  private readonly lightCtx: CanvasRenderingContext2D;

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly sfx: Sfx,
    private readonly ui: Ui,
    private readonly input: InputState,
    private readonly healthCtx: CanvasRenderingContext2D,
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
    if (this.mode !== 'title' && this.screenT < 0.5) return;
    if (this.mode === 'title' && !this.openingSeen) {
      this.startOpening();
      return;
    }
    // 쓰러진 뒤·클리어 뒤에는 오프닝 없이 방에서 다시 눈을 뜬다
    if (this.mode === 'clear' && this.stage.number < 20) { this.advanceStage(); return; }
    if (this.mode === 'down') { this.resumeRun(); return; }
    if (this.mode === 'title' || this.mode === 'clear') this.startRun();
  }

  private startOpening(): void {
    this.mode = 'opening';
    this.ui.showScreen(null);
    this.ui.showCine(true);
    this.opening = new Opening(this.ctx, this.ui.cineText, (face) => this.ui.cineFace(face), () => {
      this.opening = null;
      this.openingSeen = true;
      this.ui.showCine(false);
      this.startRun();
    });
  }

  /** 개발용: 오프닝의 특정 씬·줄로 바로 (localhost에서 window.__jamsildo로 부른다) */
  debugOpening(si: number, li: number, lt = 0, t = lt): void {
    if (this.mode !== 'opening') this.startOpening();
    this.opening?.jump(si, li, lt, t);
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
    this.ui.say(pickLine(key), LINE_FACE[key]);
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
    this.ui.showTalk(line.who, SPEAKER_NAME[line.who], line.text.slice(0, n), n >= line.text.length, line.face);
  }

  private startRun(): void {
    document.querySelector<HTMLDialogElement>('#rewardDialog')?.close();
    this.stage = generateStage();
    this.visitedRooms.clear();
    this.roomCache.clear();
    this.player = makePlayer();
    const growth = Number(readSave('max-energy')); if (Number.isFinite(growth)) this.player.energy = this.player.maxEnergy = clamp(growth, 30, MAX_ENERGY_CAP);
    this.equipped.length = 0;
    this.acquired.clear();
    this.activeSpirit = 0;
    this.runAttack = 1;
    this.zones = [];
    this.events = [];
    this.clearSupers();
    this.comboHinted = false;
    this.ringHinted = false;
    this.dashCd = 0;
    this.aimPreview = null;
    this.chaosTime = this.reverseTime = this.freezeCooldown = this.fixedForm = 0;
    this.switchCd=this.chaosTick=this.reactionCd=this.playerBurnTick=0;this.aimPoint=null;
    this.embracing = null;
    this.relic = null;
    this.item = null;
    this.items = {};
    this.lineCd = 0;
    this.formsSpoken.clear();
    this.lowSaid = false;
    this.talk = null;
    this.spirit = null;
    this.hasSpirit = false;
    this.attackUnlocked = false;
    this.firstAttackT = -1;
    this.skillHinted = false;
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
    this.ui.center(window.matchMedia('(pointer: coarse)').matches ? '왼쪽 조이스틱으로 이동' : '방향키 · 우클릭으로 이동');
    this.saveCheckpoint();
  }

  private showScreen(id: 'down' | 'clear'): void {
    this.screenT = 0;
    if (id === 'clear') this.ui.setClearWarmth(this.player.warmth);
    if (id === 'clear') this.ui.setCampaignClear(this.stage.number, this.stage.within === 5 ? CHAPTERS[this.stage.chapter - 1]!.after : '한 걸음 더, 다음 방으로 간다.');
    this.ui.showScreen(id);
    this.ui.hideBoss();
    this.ui.hideForm();
    this.ui.hideLine();
    this.ui.hideTalk();
  }

  private enterRoom(room: Room, via: Dir | null): void {
    if (!this.stage.rooms.includes(room) && room !== this.home) throw new Error('room does not belong to stage');
    this.room = room;
    this.ui.hideBoss();
    const labels:Partial<Record<Room['kind'],string>>={spirit:`${ELEMENT[this.stage.element].label}의 정령방`,rest:'숨 고르기',shop:'작은 가게',hard:'깊은 그늘 · 하드방',memory:'기억의 방'};
    this.ui.showRoomLabel(labels[room.kind]??null);
    if (room.kind !== 'home') this.visitedRooms.add(room);
    this.ui.updateMap(room.kind === 'home' ? [room] : [...this.visitedRooms], room);
    this.enemies = [];
    this.item = null;
    this.bullets = [];
    this.orbs = [];
    this.ghosts = [];
    this.flames = [];
    this.zones = [];
    this.events = [];
    this.vfx = [];
    this.clearSupers();
    this.animTags.clear();
    this.px.clear();
    this.pending = null;
    const p = this.player;
    p.vx = p.vy = 0;
    p.lungeT = 0;
    // 방이 바뀌면 효과층을 비우므로, 지속 중인 정령 효과는 다시 붙인다
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
    if (room.kind === 'spirit' && room.cleared && !room.rewarded) {
      this.spirit = { x: CX, y: CY - 6, state: 'waiting', t: 1 };
    }
    if (room.cleared) { this.roomReward(room); return; }

    this.sfx.play('lock');
    if (room.kind === 'boss') {
      const d = via ? DIRS[via] : { dx: 0, dy: -1 };
      this.enemies.push(this.makeBoss(this.stage.bossId, CX + d.dx * 90, CY + d.dy * 35, true));
      this.ui.showBoss(BOSSES[this.stage.bossId].name);
      this.ui.center(BOSSES[this.stage.bossId].name);
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
      if (kind === 'alarm') {
        const ids = CHAPTERS[this.stage.chapter - 1]!.bosses;
        this.enemies.push(this.makeBoss(ids[room.kind === 'hard' ? 1 : 0] as BossId, x, y, false));
      } else this.enemies.push(this.makeEnemy(kind, x, y, 0.7 + i * 0.15));
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

  private get enemyHpScale(): number { return this.stage.number === TUTORIAL_STAGE ? TUTORIAL_HP : 1; }

  private makeEnemy(kind: EnemyKind, x: number, y: number, spawnT: number): Enemy {
    const s = ENEMY_STATS[kind];
    const initial: Readonly<Record<EnemyKind, EnemyState>> = {
      bother: 'rest', heavy: 'chase', gloom: 'drift', alarm: 'intro',
    };
    return {
      effects: {}, burnTick: 0,
      id: this.nextId++, kind,
      x, y, vx: 0, vy: 0, r: s.r,
      hp: s.hp * 10 * (1 + (this.stage.number - 1) * 0.05) * this.enemyHpScale, maxHp: s.hp * 10 * (1 + (this.stage.number - 1) * 0.05) * this.enemyHpScale, weight: s.weight, warmth: s.warmth,
      spawnT, spawnMax: spawnT,
      state: initial[kind], t: rand(0.2, 0.9), a: 0, n: 0,
      flash: 0, squash: 0,
      faced: false, fadeT: 0,
      summoned: false, cycle: 0,
    };
  }

  /* ═══════════════ 입력 ═══════════════ */

  get dashRatio(): number { return this.dashCd / DASH_COOLDOWN; }

  /** 조이스틱 방향으로, 입력이 없으면 바라보는 쪽으로 짧게 튀어나간다 */
  dash(): void {
    const p = this.player, stick = this.input.move;
    if (this.mode !== 'play' || this.cut || this.dashCd > 0 || this.endingT >= 0 || p.effects.stun || p.effects.root) return;
    const moved = !!stick && (stick.x !== 0 || stick.y !== 0), length = moved ? Math.hypot(stick.x, stick.y) : 1;
    const x = moved ? stick.x / length * (this.reverseTime > 0 ? -1 : 1) : p.facing, y = moved ? stick.y / length : 0;
    p.lvx = x * DASH_SPEED; p.lvy = y * DASH_SPEED; p.lungeT = DASH_TIME;
    p.invuln = Math.max(p.invuln, DASH_INVULN);
    this.dashCd = DASH_COOLDOWN; this.ghostT = 0;
    this.sfx.play('swing');
  }

  /** 세로 조작의 조준: 버튼에서 끈 벡터를 윤슬 기준 위치로 옮긴다. pull 1이면 스킬 사거리 끝. */
  aimAt(key: SkillKey, dx: number, dy: number, pull: number): { x: number; y: number } {
    const slot = this.equipped[this.activeSpirit], p = this.player;
    const range = (slot ? SKILLS[slot.element][key].range : undefined) ?? 96, length = Math.hypot(dx, dy) || 1;
    return { x: clamp(p.x + dx / length * range * pull, FLOOR.x + 8, FLOOR.x + FLOOR.w - 8), y: clamp(p.y + dy / length * range * pull, FLOOR.y + 8, FLOOR.y + FLOOR.h - 8) };
  }

  setAimPreview(aim: { x: number; y: number; cancel: boolean } | null): void { this.aimPreview = aim; }

  /** 화면 좌표의 적. 그림이 발밑보다 위에 있어 판정 중심을 몸통으로 올린다. */
  private enemyAt(gx: number, gy: number): Enemy | null {
    let found: Enemy | null = null, best = Infinity;
    for (const e of this.activeEnemies()) {
      const d = dist(gx, gy, e.x, e.y - e.r * 0.5);
      if (d <= e.r + 10 && d < best) { found = e; best = d; }
    }
    return found;
  }

  /** 우클릭: 적이면 공격 지시. @returns 적을 눌렀는지 (아니면 호출한 쪽이 이동으로 처리) */
  attackAt(gx: number, gy: number): boolean {
    if (this.mode !== 'play') return false;
    const enemy = this.enemyAt(gx, gy);
    if (!enemy) return false;
    this.attackOrder = enemy;
    this.input.move = null;
    return true;
  }

  /** 좌클릭: 적이면 정보를 열고, 빈 곳이면 닫는다 */
  inspectAt(gx: number, gy: number): void {
    if (this.mode === 'play') this.inspected = this.enemyAt(gx, gy);
  }

  get inspectedInfo(): EnemyInfo | null {
    const e = this.inspected;
    if (!e || e.faced || !this.enemies.includes(e)) { this.inspected = null; return null; }
    if (this.mode !== 'play') return null;
    const spec = e.boss ? BOSSES[e.boss.id] : null;
    const sprite = this.spriteIdOf(e);
    const statuses = (Object.keys(e.effects) as StatusId[]).filter(id => (e.effects[id] ?? 0) > 0).map(id => STATUS_LABELS[id]);
    return {
      name: spec?.name ?? ENEMY_NAMES[sprite ?? ''] ?? ENEMY_NAMES[e.kind] ?? '그늘',
      meta: [spec ? `${spec.chapter}장 보스` : '그늘', `체력 ${Math.max(0, Math.ceil(e.hp))}/${Math.ceil(e.maxHp)}`, ...statuses].join(' · '),
      ratio: clamp(e.hp / e.maxHp, 0, 1),
      text: spec ? [...new Set(spec.patterns)].map(id => PATTERN_LABELS[id]).filter(Boolean).join('\n') : ENEMY_DESC[e.kind] ?? '',
    };
  }

  moveTo(gx: number, gy: number, fresh: boolean): void {
    if (this.mode !== 'play' && this.mode !== 'embrace') return;
    this.input.move = null;
    this.attackOrder = null;
    if (this.reverseTime > 0) gx = this.player.x * 2 - gx;
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
    if (this.mode === 'embrace') { this.updatePlayer(dtReal); this.fx.update(dtReal); return; }
    if (this.cut) { this.updateCut(dtReal); return; }

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
      this.updateEffects(dt);
      this.updateAttackOrder();
      this.updatePlayer(dt);
      this.updateAttack(dt);
      this.updateSkills(dt);
      this.updateEnemies(dt);
      this.updateBullets(dt);
      this.updateFlames(dt);
      this.updateOrbs(dt);
      this.updateSpirit(dt);
      this.updateZones(dt);
      this.updateSupers(dt);
      this.senaShowT = Math.max(0, this.senaShowT - dtReal);
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
      // 바닥에 아이템이 남아 있으면 주울 때까지 기다린다 (보상은 반드시 하나)
      if (this.endingT > 3.4 && this.mode === 'play' && !this.item) {
        this.mode = 'clear';
        this.showScreen('clear');
      }
    }

    if (this.mode === 'play') this.updateItem(dtReal);
    this.fx.update(dt);
    this.px.update(dt, dtReal);
    this.updateVfx(dtReal);
    this.ui.placeForm(this.player.x, this.player.y - 26);
    this.ui.placeCall(this.player.x, this.player.y);
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
      this.firstAttackT = 3.2;
      this.ui.center(window.matchMedia('(pointer: coarse)').matches ? '왼쪽 아래 공격 버튼을 꾹 누르세요' : '적을 우클릭해 공격 · 좌클릭하면 정보');
    }
    if (this.firstAttackT > 0) {
      this.firstAttackT -= dt;
      if (this.firstAttackT <= 0) this.say('firstAttack', true);
    }
  }

  /** 1스테이지에서 상황마다 한 번씩 세나가 설명한다. 대화 중에는 세상이 멈춘다. */
  private tutorial(key: TutorialKey, onDone: () => void = () => undefined): void {
    if (this.stage.number !== TUTORIAL_STAGE || this.tutorialSeen.has(key) || this.mode !== 'play') { onDone(); return; }
    this.tutorialSeen.add(key);
    this.startTalk(tutorialLines(key, window.matchMedia('(pointer: coarse)').matches), onDone);
  }

  private roomTutorial(room: Room): void {
    if (room.kind === 'boss') this.tutorial('boss');
    else if (room.kind === 'spirit') this.tutorial('spirit');
    else if (room.cleared) return;
    else if (this.hasSpirit) this.tutorial('skills');
    else this.tutorial('forms');
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
      this.walkingIn = true;
      this.enterRoom(s.to, s.dir);
      this.walkingIn = false;
      // 현관을 나와 처음 들어선 심상세계: 첫 대사창. 끝나야 그늘이 움직인다.
      if (s.from.kind === 'home') this.startTalk(OPENING, () => undefined);
      else this.roomTutorial(s.to);
    }
  }

  private updatePlayer(dt: number): void {
    const p = this.player, fromX = p.x, fromY = p.y;
    const stick = this.input.move;
    if (stick) {
      p.tx = p.x + stick.x * PLAYER_SPEED * (this.reverseTime > 0 ? -1 : 1);
      p.ty = p.y + stick.y * PLAYER_SPEED;
      p.moving = stick.x !== 0 || stick.y !== 0;
    }
    p.invuln = Math.max(0, p.invuln - dt);
    p.hurtT = Math.max(0, p.hurtT - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    p.lostT = Math.max(0, p.lostT - dt);
    if (p.effects.stun || p.effects.root) { p.lungeT = 0; p.vx = p.vy = 0; return; }

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
      const step = PLAYER_SPEED * (stick ? Math.min(1, Math.hypot(stick.x, stick.y)) : 1) * (p.effects.slow ? p.slowFactor : 1) * dt;
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

    this.clampPlayer(fromX, fromY);
  }

  /** from: 이번 프레임에 움직이기 전 자리. 벽을 밀었는지, 이미 통로 안에 있었는지를 가른다. */
  private clampPlayer(fromX: number, fromY: number): void {
    const p = this.player;
    const open = this.room.cleared;
    const d = this.room.doors;
    const gap = DOOR_HALF - p.r;
    const minX = FLOOR.x + p.r;
    const maxX = FLOOR.x + FLOOR.w - p.r;
    const minY = FLOOR.y + p.r;
    const maxY = FLOOR.y + FLOOR.h - p.r;
    // 벽을 넘은 프레임만 보고 통로로 치면 벽을 미는 순간 문 앞으로 튄다. 움직이기 전에 벽 밖이었을 때만 통로다.
    const inSideDoor = fromX < minX || fromX > maxX, inFloorDoor = fromY < minY || fromY > maxY;
    const inGapV = inSideDoor || Math.abs(p.y - CY) <= gap;
    const inGapH = inFloorDoor || Math.abs(p.x - CX) <= gap;

    let lx = minX, hx = maxX, ly = minY, hy = maxY;
    if (open && inGapV && d.w) lx = -24;
    if (open && inGapV && d.e) hx = VIEW_W + 24;
    if (open && inGapH && d.n) ly = -24;
    if (open && inGapH && d.s) hy = VIEW_H + 24;
    if (inSideDoor) { ly = Math.max(ly, CY - gap); hy = Math.min(hy, CY + gap); }
    // 집의 현관은 중앙 통로가 아니라 오른쪽에 있다.
    if (this.room.kind !== 'home' && inFloorDoor) { lx = Math.max(lx, CX - gap); hx = Math.min(hx, CX + gap); }

    if (this.room.kind === 'home') {
      // 현관 문 폭 안에서만 아래로 나갈 수 있다
      const dr = HOME.door;
      const inDoor = fromY > maxY || (p.x > dr.x + p.r && p.x < dr.x + dr.w - p.r);
      if (inDoor) hy = VIEW_H + 24;
      if (fromY > maxY) { lx = Math.max(lx, dr.x + p.r); hx = Math.min(hx, dr.x + dr.w - p.r); }
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
    if (this.endingT >= 0 || this.embracing || (this.room.kind === 'boss' && this.enemies.some(e => e.boss?.main && !e.faced))) return;
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
    this.player.hp = Math.min(this.player.maxHp,this.player.hp+8);
    this.player.energy = Math.min(this.player.maxEnergy,this.player.energy+8);
    if (this.room.kind === 'hard' && !this.room.rewarded) {
      this.placeRoomItem();
      this.fx.ring(CX, CY, 34, 0.5);
      this.ui.say('방 한가운데에 뭔가 떠올랐어.', 'smile');
    }
    if (this.room.kind === 'normal') { this.say('clear', true); this.tutorial('clear'); }
    this.sfx.play('open');
    if (this.room.kind === 'spirit' && this.spirit?.state === 'hidden') {
      this.spirit.state = 'waiting';
      this.spirit.t = 0;
      this.px.fireRing(this.spirit.x, this.spirit.y + 20, 44);
      this.sfx.play('spirit');
      this.say('spiritReady', true);
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
    const pool = ([...IMPLEMENTED_ELEMENTS, ...(this.stage.number >= 11 ? ['chaos' as const] : [])]).filter(el => !this.acquired.has(el));
    if (pool.length === 0) { this.growActiveSpirit(); return; }
    const choices:Element[]=[],available=[...pool];
    while(choices.length<3&&available.length)choices.push(available.splice(Math.floor(Math.random()*available.length),1)[0]!);
    const active = this.equipped[this.activeSpirit];
    const replacing = active && this.equipped.length >= this.slotLimit ? SPIRIT_NAMES[active.element] : null;
    this.ui.chooseSpirit(choices, replacing, element => {
      this.room.rewarded = true;
      this.equipSpirit(element);
      this.startTalk([
        {who:'sena',face:'smile',text:`${SPIRIT_NAMES[element]}, ${ELEMENT[element].label}의 정령이야. Q/W/E로 기력을 써. 중급이 되면 R도 쓸 수 있어.`},
        {who:'sena',face:'flat',text:'Tab이나 아래 정령 아이콘으로 교체해. 정령마다 쿨타임은 따로 돌아가. 기력은 천천히 회복돼.'},
      ], () => undefined);
    }, () => this.growActiveSpirit());
  }

  /** 새 정령을 받지 않을 때의 보상: 지금 정령이 한 단계 자란다 */
  private growActiveSpirit(): void {
    const slot = this.equipped[this.activeSpirit];
    if (slot) { slot.xp += 8; slot.tier = Math.min(3, slot.tier + 1); }
    this.player.energy = this.player.maxEnergy;
    this.room.rewarded = true;
    this.ui.say('함께 자란 만큼, 정령이 더 강해졌어.', 'smile');
  }

  equipSpirit(element: Element): void {
    if (!Object.hasOwn(SPIRIT_NAMES, element)) throw new RangeError('unknown spirit');
    const existing = this.equipped.findIndex(slot => slot.element === element);
    if (existing >= 0) this.activeSpirit = existing;
    else if (this.equipped.length < this.slotLimit) {
      this.equipped.push(newSpirit(element)); this.activeSpirit = this.equipped.length - 1;
    } else this.equipped[this.activeSpirit] = newSpirit(element);
    this.acquired.add(element);
    this.hasSpirit = true;
    this.switchCd = 0;
    this.spirit = { x: this.player.x - 12, y: this.player.y - 26, state: 'following', t: 0 };
    this.player.energy = this.player.maxEnergy;
    this.sfx.play('spirit');
  }

  setCheat(kind: 'health' | 'energy', enabled: boolean): void {
    this.cheats[kind] = enabled;
    if (enabled) {
      if (kind === 'health') this.player.hp = this.player.maxHp;
      else this.player.energy = this.player.maxEnergy;
    }
  }

  /** 정령 슬롯: 처음부터 3칸. 먹은 정령이 말없이 사라지지 않게 스테이지와 무관하다. */
  get slotLimit(): number { return 3; }

  cycleSpirit(index = (this.activeSpirit + 1) % Math.max(1, this.equipped.length)): void {
    if (this.mode !== 'play') return;
    if (this.equipped.length < 2) {
      if (this.switchCd <= 0) { this.ui.say(this.equipped.length ? '정령이 하나뿐이야. 정령방에서 더 데려와.' : '아직 함께하는 정령이 없어.', 'flat'); this.switchCd = 1.5; }
      return;
    }
    if (this.player.effects.silence) { this.ui.say('지금은 정령 목소리가 안 들려.', 'troubled'); return; }
    // 짧은 연타 방지만 둔다 (예전 1초는 눌러도 안 바뀌는 것처럼 느껴졌다)
    if (this.switchCd > 0 || !this.equipped[index] || index === this.activeSpirit) return;
    this.activeSpirit = index;
    this.switchCd = 0.25;
    const el = this.equipped[index]!.element;
    this.fx.burst(this.player.x, this.player.y - 12, 0, 14, [ELEMENT[el].glow, COLOR.white], { spread: Math.PI, speed: 90, life: 0.35, glow: true });
    this.ui.say(`${SPIRIT_NAMES[el]}, 같이 가자.`, 'flat');
  }

  private advanceStage(): void {
    if (this.stage.number >= 20) return;
    const next = this.stage.number + 1;
    this.stage = generateStage(next);
    this.visitedRooms.clear(); this.roomCache.clear(); this.bodies.clear();
    this.endingT = -1; this.relic = null; this.item = null; this.timeScale = 1; this.slowT = this.hitstop = 0;
    this.player.maxEnergy = Math.min(MAX_ENERGY_CAP, this.player.maxEnergy + 4);
    this.player.energy = this.player.maxEnergy;
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + (this.stage.within === 1 ? 35 : 15));
    this.runAttack += STAGE_ATTACK;
    this.player.effects = {};
    this.mode = 'play'; this.ui.showScreen(null); this.ui.hideTalk();
    this.enterRoom(this.stage.start, null);
    this.ui.center(`${this.stage.chapter}장 · ${this.stage.within}/5 · ${CHAPTERS[this.stage.chapter - 1]!.name}`);
    this.saveCheckpoint();
  }

  /** 계정으로 로그인했을 때만 기기·서버에 저장한다. */
  saveEnabled = false;
  /** 게스트 진행: 어디에도 남기지 않고 이 탭에서 다시 도전할 때만 쓴다 */
  private sessionCheckpoint: string | null = null;

  saveCheckpoint(): boolean {
    if (this.mode === 'title' || this.mode === 'opening' || this.mode === 'slide') return true;
    // ponytail: 전투 도중 종료하면 현재 방의 적은 다시 생성한다. 전투 중 객체·타이머 직렬화가 필요할 때 확장한다.
    const checkpoint = JSON.stringify({version:2,stage:this.stage.number,hp:this.player.hp,maxHp:this.player.maxHp,maxEnergy:this.player.maxEnergy,energy:this.player.energy,armor:this.player.armor,attack:this.runAttack,warmth:this.player.warmth,items:this.items,equipped:this.equipped,active:this.activeSpirit,acquired:[...this.acquired],rooms:this.stage.rooms.map(room=>({...room,marks:[]})),element:this.stage.element,room:[this.room.gx,this.room.gy],visited:[...this.visitedRooms].map(room=>[room.gx,room.gy]),attackUnlocked:this.attackUnlocked,cleared:this.mode==='clear'||this.endingT>=0,down:this.mode==='down'});
    if (!this.saveEnabled) { this.sessionCheckpoint = checkpoint; return true; }
    writeSave(String(Math.max(this.player.maxEnergy, Number(readSave('max-energy')) || 30)), 'max-energy');
    return writeSave(checkpoint);
  }

  resumeRun(): void {
    try {
      const data = JSON.parse((this.saveEnabled ? readSave() : this.sessionCheckpoint) ?? 'null');
      if (!data || ![1,2].includes(data.version) || !Number.isInteger(data.stage) || data.stage < 1 || data.stage > 20) {
        // 쓰러진 화면에서 이어갈 기록이 없어도 누른 사람을 멈춰 두지 않는다
        if (this.mode === 'down') this.startRun();
        return;
      }
      const restored = data.version === 2 ? restoreStage(data.stage, data.rooms, data.element) : generateStage(data.stage);
      this.startRun();
      this.stage = restored;
      for (const id of Object.keys(ITEMS) as ItemId[]) { const count = clamp(Math.floor(Number(data.items?.[id]) || 0), 0, 99); if (count) this.items[id] = count; }
      this.visitedRooms.clear(); this.roomCache.clear();
      this.player.maxEnergy = clamp(Number(data.maxEnergy)||30+(data.stage-1)*4,30,MAX_ENERGY_CAP); this.player.energy = this.player.maxEnergy;
      this.player.maxHp = clamp(Math.round(Number(data.maxHp) || PLAYER_HP), PLAYER_HP, MAX_HP_CAP);
      this.player.hp = clamp(Number(data.hp) || this.player.maxHp, 1, this.player.maxHp); this.player.warmth = clamp(Number(data.warmth) || 0, 0, 100000);
      for (const saved of (Array.isArray(data.equipped) ? data.equipped : []).slice(0, this.slotLimit)) {
        if (!Object.hasOwn(SPIRIT_NAMES,saved?.element) || this.acquired.has(saved.element)) continue;
        const slot = newSpirit(saved.element); slot.xp = clamp(Number(saved.xp) || 0, 0, 10000); slot.tier = clamp(Math.floor(Number(saved.tier) || 1), 1, 3);
        for (const [key,spec] of Object.entries(SKILLS[slot.element])) {
          slot.uses[spec.type] = clamp(Math.floor(Number(saved.uses?.[spec.type]) || 0), 0, 100000);
          slot.cooldowns[key as SkillKey] = clamp(Number(saved.cooldowns?.[key]) || 0, 0, spec.cd);
        }
        this.equipped.push(slot); this.acquired.add(saved.element);
      }
      for (const element of Array.isArray(data.acquired) ? data.acquired : []) if (Object.hasOwn(SPIRIT_NAMES,element)) this.acquired.add(element);
      this.hasSpirit = this.equipped.length > 0; this.attackUnlocked = true; this.openingSeen = true;
      if(this.hasSpirit)this.spirit={x:this.player.x-12,y:this.player.y-26,state:'following',t:0};
      this.runAttack = clamp(Number(data.attack)||1+(data.stage-1)*STAGE_ATTACK,1,10);
      this.player.energy = Number.isFinite(data.energy) ? clamp(data.energy, 0, this.player.maxEnergy) : this.player.maxEnergy;
      this.player.armor = clamp(Math.floor(Number(data.armor) || 0), 0, 3);
      this.activeSpirit = clamp(Math.floor(Number(data.active) || 0), 0, Math.max(0, this.equipped.length - 1));
      this.attackUnlocked = data.version === 1 || data.attackUnlocked === true;
      for (const room of this.stage.rooms) if (Array.isArray(data.visited) && data.visited.some((point: unknown) => Array.isArray(point) && point[0] === room.gx && point[1] === room.gy)) this.visitedRooms.add(room);
      const room = data.down ? this.stage.start : this.stage.rooms.find(room => room.gx === data.room?.[0] && room.gy === data.room?.[1]);
      if (data.down) this.player.hp = this.player.maxHp;
      this.enterRoom(data.room?.[0] === 99 && !data.down ? this.home : room ?? this.stage.start, null);
      if (data.cleared) { this.mode = 'clear'; this.showScreen('clear'); }
      this.saveCheckpoint();
    } catch {
      this.ui.say('저장된 기록을 읽지 못했어. 새로 시작할 수 있어.', 'troubled');
      if (this.mode === 'down') this.startRun();
    }
  }

  debugStage(number: number): void {
    if (!Number.isInteger(number) || number < 1 || number > 20) throw new RangeError('stage must be 1..20');
    this.startRun(); this.stage = generateStage(number); this.visitedRooms.clear(); this.roomCache.clear();
    this.player.maxEnergy = Math.min(100, 30 + (number - 1) * 4); this.player.energy = this.player.maxEnergy;
    this.runAttack = 1 + (number - 1) * STAGE_ATTACK;
    this.enterRoom(this.stage.start, null); this.attackUnlocked = true;
  }

  returnToTitle(): void {
    this.clearSupers();
    this.setCheat('health', false); this.setCheat('energy', false);
    document.querySelector<HTMLDialogElement>('#rewardDialog')?.close();
    this.mode = 'title'; this.opening = null; this.talk = null;
    this.ui.showCine(false); this.ui.hideTalk(); this.ui.hideBoss(); this.ui.hideForm(); this.ui.hideLine(); this.ui.showScreen('title');
  }

  private roomReward(room: Room): void {
    if (room.rewarded || room.kind === 'home' || room.kind === 'spirit') return;
    // 줍지 않고 나갔다 돌아와도 하드방 보상은 그 자리에 있다
    if (room.kind === 'hard') { this.placeRoomItem(); return; }
    if (room.kind === 'rest') {
      room.rewarded = true; this.player.hp = Math.min(this.player.maxHp, this.player.hp + 35); this.player.energy = this.player.maxEnergy;
      this.ui.center('숨 고르기 · HP +35 · 기력 회복');
    } else if (room.kind === 'memory') {
      room.rewarded = true; this.player.armor = Math.min(3, this.player.armor + 1);
      this.startTalk([{who:'yunseul',face:'troubled',text:CHAPTERS[this.stage.chapter - 1]!.after},{who:'sena',face:'smile',text:'지나간 기억이야. 네 잘못이 아니었어. 이제 한 번은 내가 막아줄게.'}],()=>{});
    } else if (room.kind === 'shop') {
      if (this.walkingIn) this.tutorial('shop', () => this.openShop(room)); else this.openShop(room);
    }
  }

  private openShop(room: Room): void {
    const goods = (Object.keys(ITEMS) as ItemId[]).filter(id => {
      const spec = ITEMS[id];
      return spec.cost !== undefined && !room.bought?.includes(id) && (this.items[id] ?? 0) < (spec.limit ?? Infinity);
    });
    if (goods.length === 0) {
      room.rewarded = true;
      document.querySelector<HTMLDialogElement>('#rewardDialog')?.close();
      return;
    }
    this.ui.chooseReward(goods, this.player.warmth, id => {
      const cost = ITEMS[id].cost ?? 0;
      if (this.player.warmth < cost) return;
      this.player.warmth -= cost;
      (room.bought ??= []).push(id);
      this.gainItem(id);
      this.sfx.play('pickup');
      this.saveCheckpoint();
      this.openShop(room);
    });
  }

  /** 아이템 효과는 여기 한 곳에서만 적용한다 (상점·줍기 공통) */
  private gainItem(id: ItemId): void {
    const p = this.player, first = Object.keys(this.items).length === 0;
    this.items[id] = (this.items[id] ?? 0) + 1;
    if (id === 'meal') { this.runAttack += 0.15; p.hp = Math.min(p.maxHp, p.hp + 25); }
    else if (id === 'shoes') { this.runAttack += 0.12; p.maxEnergy = Math.min(MAX_ENERGY_CAP, p.maxEnergy + 3); }
    else if (id === 'crystal') { p.maxEnergy = Math.min(MAX_ENERGY_CAP, p.maxEnergy + 10); p.energy = p.maxEnergy; }
    else if (id === 'heart') { p.maxHp = Math.min(MAX_HP_CAP, p.maxHp + 20); p.hp = Math.min(p.maxHp, p.hp + 20); }
    if (first) this.ui.say(window.matchMedia('(pointer: coarse)').matches ? '아이템 버튼으로 가진 걸 볼 수 있어.' : 'I를 누르면 가진 아이템을 볼 수 있어.', 'smile');
  }

  /** 보온병 하나에 25%씩. 기본은 초당 1. */
  private get energyRate(): number { return 1 + (this.items.thermos ?? 0) * 0.25; }

  get inventory(): Inventory {
    const p = this.player;
    return {
      stats: [
        ['공격력', `+${Math.round((this.runAttack - 1) * 100)}%`],
        ['기력 회복', `초당 ${this.energyRate}`],
        ['최대 체력', String(p.maxHp)],
        ['최대 기력', String(p.maxEnergy)],
        ['온기', String(p.warmth)],
      ],
      items: (Object.keys(ITEMS) as ItemId[]).filter(id => this.items[id]).map(id => ({ id, count: this.items[id] ?? 0 })),
    };
  }

  private after(time: number, run: () => void): void { this.events.push({time,run}); }

  private addZone(options: Partial<Zone> & Pick<Zone,'x'|'y'>): Zone {
    const zone: Zone = {shape:'circle',r:40,angle:0,width:8,length:160,warning:0,life:0.2,age:0,tick:0,damage:0,owner:'enemy',element:this.stage.element,...options};
    if(zone.owner==='enemy'&&zone.source!==undefined){const src=this.enemies.find(e=>e.id===zone.source);if(src)zone.warning/=this.bossHaste(src);}
    this.zones.push(zone); return zone;
  }

  private applyStatus(enemy: Enemy, status: StatusId, duration: number): void {
    enemy.effects[status] = Math.max(enemy.effects[status] ?? 0, status === 'stun' && enemy.boss ? duration / 3 : duration);
  }

  private updateSkills(dt: number): void {
    this.switchCd = Math.max(0, this.switchCd - dt);
    this.reverseTime = Math.max(0, this.reverseTime - dt); this.freezeCooldown = Math.max(0,this.freezeCooldown-dt); this.fixedForm = Math.max(0,this.fixedForm-dt);
    const p = this.player;
    const draining=this.zones.some(zone=>zone.stopEnergy&&zone.age>=zone.warning&&contains(zone,p.x,p.y));
    p.energy = this.cheats.energy ? p.maxEnergy : Math.min(p.maxEnergy, p.energy + (draining ? 0 : dt * this.energyRate));
    for (const slot of this.equipped) for (const key of ['q','w','e','r'] as const) if (this.freezeCooldown <= 0) slot.cooldowns[key] = Math.max(0,slot.cooldowns[key]-dt);
    if (!this.comboHinted && this.comboHud?.grown) {
      this.comboHinted = true;
      this.ui.say(window.matchMedia('(pointer: coarse)').matches ? '둘이 같이 쏠 수 있어. R이 다 돌아오면 합동 버튼.' : '둘이 같이 쏠 수 있어. R이 다 돌아오면 F.', 'smile');
    }
    for (const queued of this.input.skillQueue.splice(0)) {
      this.aimPoint = typeof queued === 'string' ? null : {x:queued.x,y:queued.y};
      this.castSkill(typeof queued === 'string' ? queued : queued.key);
    }
    this.aimPoint = null;
    if (this.chaosTime > 0) {
      this.chaosTime -= dt; this.chaosTick -= dt;
      if (this.chaosTick <= 0) { this.chaosTick = 0.5; this.executeSkill(IMPLEMENTED_ELEMENTS[Math.floor(Math.random()*5)]!, (['q','w','e'] as const)[Math.floor(Math.random()*3)]!); }
      if (this.chaosTime <= 0) p.effects.stun = 3;
    }
    if (this.hasSpirit && !this.skillHinted && this.activeEnemies().length) {
      this.skillHinted = true; this.ui.say('Q/W/E는 기력, R은 중급부터. Tab으로 정령 교체.', 'smile');
    }
  }

  private castSkill(key: SkillKey): void {
    const slot = this.equipped[this.activeSpirit], p = this.player;
    if (!slot || p.effects.stun || p.effects.silence || this.endingT >= 0) return;
    const spec = SKILLS[slot.element][key];
    if (key === 'r' && slot.tier < 2) { this.ui.say('R은 정령이 중급으로 자라면 열려.', 'flat'); return; }
    if (slot.cooldowns[key] > 0) return;
    if (!this.cheats.energy && p.energy < spec.cost) { this.ui.say(`기력이 부족해. ${spec.cost}만큼 필요해.`, 'troubled'); return; }
    if (!this.cheats.energy) p.energy -= slot.element === 'chaos' && key === 'r' ? p.energy : spec.cost;
    slot.cooldowns[key] = spec.cd;
    slot.uses[spec.type] = (slot.uses[spec.type] ?? 0) + 1; slot.xp += 1;
    const tier = slot.xp >= TIER3_XP ? 3 : slot.xp >= TIER2_XP ? 2 : 1;
    if (tier > slot.tier) {
      slot.tier = tier; this.ui.center(`${SPIRIT_NAMES[slot.element]} · ${tier===2?'중급 · R 해금':'상급 진화'}`);
      this.fx.burst(p.x-p.facing*13,p.y-26,0,28,[ELEMENT[slot.element].glow,COLOR.white],{spread:Math.PI,speed:130,life:0.7,glow:true});
      this.fx.ring(p.x-p.facing*13,p.y-26,34,0.5);
    }
    this.skillPower = (slot.tier === 3 ? 1.6 : slot.tier === 2 ? 1.3 : 1) * this.runAttack;
    this.castAt = this.clock; this.spiritCastAt = this.clock;
    if (key === 'r') {
      const element = slot.element, aim = this.aimPoint, power = this.skillPower;
      this.beginCut([slot], `${SPIRIT_NAMES[element]} · 초필살기`, spec.name, pickLine('super'), 0.8, ELEMENT[element].glow, () => {
        this.skillPower = power; this.aimPoint = aim;
        this.ui.callSpirit(`${SPIRIT_NAMES[element]}!!`, true);
        this.executeSkill(element, 'r');
        this.aimPoint = null;
        this.ultBurst(element);
      });
    } else {
      this.ui.callSpirit(`${SPIRIT_NAMES[slot.element]}!`, false);
      this.executeSkill(slot.element, key);
    }
    if(this.reactionCd<=0&&this.equipped.length>=2){
      const elements=this.equipped.map(s=>s.element);
      if(elements.includes('fire')&&elements.includes('wood')){
        for(const enemy of this.activeEnemies())if(dist(p.x,p.y,enemy.x,enemy.y)<128)this.applyStatus(enemy,'burn',3);
        this.reactionCd=10;
      }else if(elements.includes('water')&&elements.includes('light')){p.hp=Math.min(p.maxHp,p.hp+10);this.reactionCd=10;this.fx.ring(p.x,p.y,65,0.5);}
      else if(elements.includes('dark')&&elements.includes('light')){
        if(!this.cheats.health)p.hp=Math.max(1,p.hp-5);for(const enemy of this.activeEnemies())if(dist(p.x,p.y,enemy.x,enemy.y)<96)this.hitEnemy(enemy,20*this.runAttack,0,40,true,'dark');this.reactionCd=10;
      }
    }
    if (slot.tier === 3) {
      const dominant = Object.keys(slot.uses).sort((a,b)=>(slot.uses[b]??0)-(slot.uses[a]??0))[0];
      if (dominant === spec.type) {
        if (spec.type === 'defense') p.armor = Math.min(3,p.armor+1);
        else if (spec.type === 'heal') p.energy = Math.min(p.maxEnergy,p.energy+5);
        else for (const enemy of this.activeEnemies()) if (dist(p.x,p.y,enemy.x,enemy.y)<100) this.applyStatus(enemy,'mark',3);
      }
    }
    if (key === 'r') for (const enemy of this.activeEnemies()) if (enemy.boss?.id === 'young' && enemy.boss.phase >= 1) {
      this.after(2,()=>{if(!enemy.faced&&this.mode==='play')this.copySpiritSkill(enemy,slot.element,'r');});
    }
    this.sfx.play(key === 'r' ? 'ult' : 'spirit');
  }

  /**
   * 정령마다 성격이 다르다.
   *  메르(불)   폭발·화상: 맞은 자리에서 터지고, 몸에 두른 불이 주변을 태운다.
   *  쿠이(물)   밀어내기·회복: 느리고 무거운 물방울이 밀쳐내고, 막이 한 번 막고 터지며 밀어낸다.
   *  매매(나무) 지형·속박: 벽과 덩굴로 길을 막고 묶는다.
   *  카이(어둠) 표식·처형: 표식을 새기고, 뒤로 숨어들고, 표식 있는 것들을 한 번에 벤다.
   *  루나(빛)   관통·정화: 즉시 꿰뚫는 빛줄기, 탄을 지우는 섬광, 피해를 덜어주는 기둥.
   */
  private executeSkill(element: Element, key: SkillKey): void {
    const p = this.player, spec = SKILLS[element][key];
    const startX=p.x,startY=p.y;
    const origin=this.aimPoint??p;
    const target = this.activeEnemies().sort((a,b)=>dist(origin.x,origin.y,a.x,a.y)-dist(origin.x,origin.y,b.x,b.y))[0];
    const point = this.aimPoint ?? (target ? {x:target.x,y:target.y} : {x:p.x+Math.cos(p.aim)*96,y:p.y+Math.sin(p.aim)*96});
    const angle = angleTo(p.x,p.y,point.x,point.y);
    const limit = spec.range ?? 96, distance = (element==='wood'&&key==='q')||(element==='fire'&&key==='w')?limit:Math.min(limit,dist(p.x,p.y,point.x,point.y));
    const x = clamp(p.x+Math.cos(angle)*distance,FLOOR.x+8,FLOOR.x+FLOOR.w-8), y = clamp(p.y+Math.sin(angle)*distance,FLOOR.y+8,FLOOR.y+FLOOR.h-8);
    const damage = (spec.damage ?? 0)*this.skillPower;
    const status = spec.status as StatusId | undefined;
    const glow = ELEMENT[element].glow;
    const shot = (a: number, o: Partial<Bullet> = {}) => {
      const speed = o.vx ?? 240;
      const b: Bullet = {x:p.x,y:p.y-9,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,r:4,life:limit/speed,damage,owner:'player',style:'fire',element,status,statusTime:spec.duration,skill:true,hit:new Set(),...o};
      b.vx = Math.cos(a)*speed; b.vy = Math.sin(a)*speed;
      this.bullets.push(b);
      return b;
    };
    const area = (options: Partial<Zone>) => this.addZone({x:p.x,y:p.y,r:limit,damage,owner:'player',element,status,...options});
    const sparkle = (sx: number, sy: number, n: number, colors: readonly string[], speed = 90) =>
      this.fx.burst(sx, sy, 0, n, colors, { spread: Math.PI, speed, life: 0.5, glow: true });
    if (element === 'chaos') {
      if (key === 'q') this.executeSkill(IMPLEMENTED_ELEMENTS[Math.floor(Math.random()*5)]!,'q');
      if (key === 'w' && target && dist(p.x,p.y,target.x,target.y)<=256) { const px=p.x,py=p.y;p.x=p.tx=target.x;p.y=p.ty=target.y;target.x=px;target.y=py;p.moving=false; }
      if (key === 'e') {
        if (Math.random()<0.5) { for (const slot of this.equipped) for (const k of ['q','w','e','r'] as const) slot.cooldowns[k]=0;this.ui.center('앞면 · 모든 정령 쿨타임 초기화'); }
        else { if(!this.cheats.energy)p.energy=0;this.ui.center(this.cheats.energy?'뒷면 · 무한 기력 유지':'뒷면 · 기력 0'); }
      }
      if (key === 'r') { this.chaosTime=5;this.chaosTick=0; }
      sparkle(p.x, p.y - 10, 16, [glow, COLOR.white]);
      this.skillVfx(element,key,angle,startX,startY,x,y);
      return;
    }

    if (element === 'fire') {
      if (key === 'q') {
        // 불씨 탄: 진짜 불덩이가 날아가 맞은 자리에서 터진다 (주변까지 화상)
        const b = shot(angle, { vx: 230, explode: 28 });
        b.fx = this.px.fireball(b.x, b.y, angle, 4);
      }
      if (key === 'w') {
        // 점화 돌진: 순간 돌진, 지나간 자리에 불길
        this.px.fireRing(startX, startY + 4, 26);
        p.x=p.tx=x;p.y=p.ty=y;p.moving=false;p.invuln=Math.max(p.invuln,0.35);
        for(let i=0;i<10;i++)this.flames.push({x:startX+(x-startX)*i/10,y:startY+(y-startY)*i/10,t:0,life:2.4,owner:'player',tick:0});
        for (const enemy of this.activeEnemies()) {
          // 지나간 길 위의 그늘은 바로 데인다
          const t = clamp(((enemy.x-startX)*(x-startX)+(enemy.y-startY)*(y-startY))/Math.max(1,(x-startX)**2+(y-startY)**2),0,1);
          if (dist(enemy.x,enemy.y,startX+(x-startX)*t,startY+(y-startY)*t) < enemy.r+12) { this.hitEnemy(enemy,14*this.skillPower,angle,120,true,'fire'); this.applyStatus(enemy,'burn',3); }
        }
        this.ghosts.push({ x: startX, foot: startY + 4, frame: 0, flip: p.facing < 0, life: 0.3 });
        this.fx.shake(3);
      }
      if (key === 'e') {
        // 불꽃 갑옷: 5초 동안 몸에 불을 두른다. 가까운 그늘을 0.5초마다 태우고, 때린 놈에겐 되돌려준다.
        p.fireArmor = spec.duration ?? 5;
        this.armorFx?.stop();
        this.armorFx = this.px.burning(p.x, p.y + 4, this.playerActor());
        this.px.fireRing(p.x, p.y + 4, 32);
      }
      if (key === 'r') {
        // 초대형 불대포: 조준한 쪽으로 곧게 뻗는다. 그림이 대칭이라 그대로 돌린다.
        this.spawnSuper('cannon', element, p.x + Math.cos(angle) * 12, p.y - 10 + Math.sin(angle) * 12, angle, angle, 1, damage);
        sparkle(p.x, p.y - 10, 24, [COLOR.fireHot, COLOR.fire], 40);
      }
    } else if (element === 'water') {
      if (key === 'q') {
        // 물방울 탄: 느리고 크다. 꿰뚫으며 세게 밀어내고 잠깐 기절.
        shot(angle, { vx: 165, r: 6, style: 'bubble', pierce: true, knock: 420, art: 'fx_water_bow_sm', artScale: 0.9 });
      }
      if (key === 'w') {
        // 맑은 물: 회복 + 걸린 상태이상 전부 씻어냄
        p.hp=Math.min(p.maxHp,p.hp+p.maxHp*0.3*Math.min(1.6,this.skillPower));
        p.effects = {};
        sparkle(p.x, p.y - 8, 26, ['#5eb0ff', '#c8e8ff', COLOR.white], 110);
        this.fx.ring(p.x, p.y - 4, 30, 0.45);
      }
      if (key === 'e') {
        // 물의 막: 다음 공격 하나를 무엇이든 막고, 터지면서 주변을 밀어낸다
        p.skillShield = spec.duration ?? 8;
        sparkle(p.x, p.y - 10, 18, ['#5eb0ff', '#c8e8ff']);
      }
      if (key === 'r') {
        // 대해일: 조준한 쪽을 향해 방 끝에서 끝까지 쓸고 간다
        const dir = Math.cos(angle) >= 0 ? 1 : -1;
        this.spawnSuper('wave', element, dir > 0 ? -20 : VIEW_W + 20, FLOOR.y + FLOOR.h - 6, dir > 0 ? 0 : Math.PI, 0, dir, damage);
        this.fx.shake(4);
      }
    } else if (element === 'wood') {
      if (key === 'q') {
        // 나무벽: 탄을 막는 벽. 닿은 그늘은 가시에 찔리고 묶인다.
        area({shape:'wall',x,y,width:Math.abs(Math.cos(angle))>0.7?12:96,length:Math.abs(Math.cos(angle))>0.7?96:12,r:0,life:6,damage:8*this.skillPower,hp:60,status:'root'});
        sparkle(x, y, 20, ['#8fdc6a', '#3f9a52', '#d8f0a0']);
      }
      if (key === 'w') {
        // 단단해지기: 공격 한 번을 막는 껍질 + 조금 회복
        p.armor=Math.min(3,p.armor+1);
        p.hp=Math.min(p.maxHp,p.hp+p.maxHp*0.06);
        sparkle(p.x, p.y - 8, 16, ['#8a6a3a', '#8fdc6a']);
      }
      if (key === 'e') {
        // 가시 덩굴: 앞으로 뻗어나가는 덩굴 한 줄. 닿은 것 전부 묶는다.
        area({shape:'line',x:p.x,y:p.y,angle,length:limit,width:12,life:0.25,status:'root'});
        for (let i = 1; i <= 6; i++) this.after(i * 0.04, () => {
          const d = (limit / 6) * i;
          this.fx.burst(p.x + Math.cos(angle) * d, p.y + Math.sin(angle) * d, angle, 5, ['#3f9a52', '#8fdc6a'], { spread: 2.4, speed: 50, life: 0.5 });
        });
      }
      if (key === 'r') {
        // 숲의 성역: 안에선 회복, 그늘은 느려진다
        area({x,y,life:8,effect:'heal'});
        for(const enemy of this.activeEnemies())if(dist(x,y,enemy.x,enemy.y)<=limit){this.applyStatus(enemy,'root',2.5);this.hitEnemy(enemy,damage*1.5,angleTo(x,y,enemy.x,enemy.y),40,true,'wood');}
        sparkle(x, y, 40, ['#3f9a52', '#8fdc6a', '#d8f0a0'], 90);
      }
    } else if (element === 'dark') {
      if (key === 'q') {
        // 그림자 단도 세 자루: 맞은 것에 표식
        for (const d of [-0.2, 0, 0.2]) shot(angle + d, { vx: 280, style: 'shadow', pierce: false, art: 'fx_dark_bow_sm', artScale: 0.7 });
      }
      if (key === 'w') {
        // 그림자 이동: 가장 가까운 그늘 뒤로 숨어들어 등을 벤다
        if (target && dist(p.x, p.y, target.x, target.y) <= limit) {
          const a = angleTo(p.x, p.y, target.x, target.y);
          this.fx.burst(p.x, p.y - 8, 0, 14, ['#251735', '#9662c7'], { spread: Math.PI, speed: 80, life: 0.4 });
          p.x = p.tx = clamp(target.x + Math.cos(a) * (target.r + 10), FLOOR.x + 8, FLOOR.x + FLOOR.w - 8);
          p.y = p.ty = clamp(target.y + Math.sin(a) * (target.r + 10), FLOOR.y + 8, FLOOR.y + FLOOR.h - 8);
          this.hitEnemy(target, 22 * this.skillPower, a, 60, true, 'dark');
          this.applyStatus(target, 'mark', 4);
          this.px.crit(target.x, target.y + target.r * 0.6, target.r * 1.4, a);
        } else { p.x = p.tx = x; p.y = p.ty = y; }
        p.moving = false; p.stealth = 1.2;
        for(const enemy of this.activeEnemies())if(!enemy.boss){enemy.state='rest';enemy.t=1;}
        this.fx.burst(p.x, p.y - 8, 0, 14, ['#251735', '#b88aff'], { spread: Math.PI, speed: 80, life: 0.4 });
      }
      if (key === 'e') {
        // 어둠 장막: 안에 있는 그늘은 눈이 먼다
        area({x,y,life:4,effect:'dark',damage:0,status:'blind'});
        this.fx.burst(x, y, 0, 24, ['#251735', '#3c2452', '#9662c7'], { spread: Math.PI, speed: 60, life: 0.7 });
      }
      if (key === 'r') {
        // 그림자 처형: 표식이 있는 것 전부를 동시에 벤다. 표식이 없으면 주변에 먼저 새긴다.
        let marked = this.activeEnemies().filter(e => e.effects.mark);
        if (marked.length === 0) {
          marked = this.activeEnemies().filter(e => dist(p.x, p.y, e.x, e.y) < 140);
          for (const e of marked) this.applyStatus(e, 'mark', 1);
        }
        // 리퍼가 나타나 낫을 돌린다. 베는 건 낫이 다 돌아간 뒤.
        const dir = Math.cos(angle) >= 0 ? 1 : -1;
        this.spawnSuper('reaper', element, p.x - dir * 8, p.y - 24, angle, 0, dir, damage);
        this.fx.flashAmt = Math.max(this.fx.flashAmt, 0.2);
        marked.forEach((enemy, i) => this.after(REAPER_SWING + 0.08 * i, () => {
          if (enemy.faced) return;
          const a = angleTo(p.x, p.y, enemy.x, enemy.y);
          this.hitEnemy(enemy, !enemy.boss && enemy.hp / enemy.maxHp <= 0.25 ? enemy.hp : damage, a, 0, true, 'dark');
          this.px.crit(enemy.x, enemy.y + enemy.r * 0.6, enemy.r * 1.4, a);
        }));
      }
    } else if (element === 'light') {
      if (key === 'q') {
        // 빛 화살: 날아가지 않는다. 그 즉시 일직선을 꿰뚫는 빛줄기.
        area({shape:'line',x:p.x,y:p.y-6,angle,length:limit,width:9,life:0.28});
        this.fx.burst(p.x + Math.cos(angle) * 10, p.y - 6 + Math.sin(angle) * 10, angle, 10, ['#fff0b1', COLOR.white], { spread: 0.4, speed: 260, life: 0.25, glow: true });
      }
      if (key === 'w') {
        // 축복: 즉시 조금, 이후 5초간 천천히
        p.hp=Math.min(p.maxHp,p.hp+p.maxHp*0.15);p.healTime=spec.duration ?? 5;
        sparkle(p.x, p.y - 12, 20, ['#fff0b1', '#d1b46a', COLOR.white], 60);
      }
      if (key === 'e') {
        // 섬광: 주변 기절 + 날아오던 탄을 지운다
        for(const enemy of this.activeEnemies())if(dist(p.x,p.y,enemy.x,enemy.y)<=limit)this.applyStatus(enemy,'stun',1.2);
        for (const b of this.bullets) if (b.owner === 'enemy' && dist(p.x, p.y, b.x, b.y) <= limit) this.fx.burst(b.x, b.y, 0, 3, ['#fff0b1'], { speed: 40, life: 0.3 });
        this.bullets=this.bullets.filter(b=>b.owner!=='enemy'||dist(p.x,p.y,b.x,b.y)>limit);
        this.fx.flashAmt = Math.max(this.fx.flashAmt, 0.5);
        this.fx.ring(p.x, p.y - 6, limit, 0.35);
      }
      if (key === 'r') {
        // 빛의 검: 꽂힌 자리가 성역이 된다. 안에선 받는 피해 절반, 그늘은 계속 탄다.
        this.spawnSuper('sword', element, x, y + 6, angle, 0, 1, damage);
        this.after(SWORD_DROP, () => {
          area({x,y,life:6,effect:'light'});
          for(const enemy of this.activeEnemies())if(dist(x,y,enemy.x,enemy.y)<=limit){this.applyStatus(enemy,'stun',1.5);this.hitEnemy(enemy,damage*2,angleTo(x,y,enemy.x,enemy.y),60,true,'light');}
          sparkle(x, y - 20, 50, ['#fff0b1', COLOR.white], 160);
          this.fx.flashAmt = Math.max(this.fx.flashAmt, 0.5); this.fx.shake(9);
          this.hitstop = Math.max(this.hitstop, 0.08);
        });
      }
    }
    this.skillVfx(element,key,angle,startX,startY,x,y);
  }

  /* ═══════════════ 초필살기 · 합동 궁극기 ═══════════════ */

  private clearSupers(): void {
    this.cut = null; this.supers = []; this.senaShowT = 0;
    this.ui.hideSuper();
  }

  /** 컷인의 정령 그림. R과 합동 궁극기는 중급부터라 하급 그림은 필요 없다. */
  private spiritArt(slot: SpiritSlot): string {
    return `cut_evo_${slot.element}_${slot.tier >= 3 ? 'upper' : 'medium'}`;
  }

  private beginCut(slots: readonly SpiritSlot[], label: string, name: string, line: string, life: number, glow: string, run: () => void): void {
    this.cut = { t: 0, life, spirits: slots.map(slot => this.spiritArt(slot)), glow, run };
    this.ui.showSuper(label, name, line, glow);
  }

  private updateCut(dt: number): void {
    const cut = this.cut;
    if (!cut) return;
    cut.t += dt;
    if (cut.t < cut.life) return;
    this.cut = null;
    this.ui.hideSuper();
    this.input.skillQueue.length = 0; // 멈춘 동안 눌린 키가 풀리자마자 나가지 않게
    this.senaShowT = 1.5;
    this.player.invuln = Math.max(this.player.invuln, 0.5);
    cut.run();
  }

  private spawnSuper(kind: SuperKind, element: Element, x: number, y: number, angle: number, tilt: number, dir: 1 | -1, damage: number): void {
    this.supers.push({ kind, element, x, y, angle, tilt, dir, t: 0, damage, hit: new Set() });
  }

  /** 곧게 뻗는 공격의 판정: 그늘을 치고 탄을 지운다 */
  private superLine(s: SuperFx, length: number, half: number, damage: number, knock: number, onHit?: (e: Enemy) => void): void {
    const c = Math.cos(s.angle), n = Math.sin(s.angle);
    const inside = (x: number, y: number, r: number): boolean => {
      const dx = x - s.x, dy = y - s.y, along = dx * c + dy * n, across = -dx * n + dy * c;
      return along >= -r && along <= length + r && Math.abs(across) <= half + r;
    };
    for (const e of this.activeEnemies()) {
      if (!inside(e.x, e.y, e.r)) continue;
      this.hitEnemy(e, damage, s.angle, knock, true, s.element);
      onHit?.(e);
    }
    this.bullets = this.bullets.filter(b => b.owner !== 'enemy' || !inside(b.x, b.y, b.r));
  }

  private updateSupers(dt: number): void {
    for (const s of this.supers) {
      const before = s.t;
      s.t += dt;
      const at = (time: number): boolean => before < time && s.t >= time;
      if (s.kind === 'cannon' && at(0.06)) {
        this.superLine(s, 420, 46, s.damage, 120, e => this.applyStatus(e, 'burn', 3));
        this.fx.shake(10); this.fx.flashAmt = Math.max(this.fx.flashAmt, 0.5);
        this.hitstop = Math.max(this.hitstop, 0.08);
      }
      if (s.kind === 'wave') {
        s.x += s.dir * WAVE_SPEED * dt;
        for (const e of this.activeEnemies()) {
          if (s.hit.has(e.id) || s.dir * (s.x - e.x) < -e.r) continue;
          s.hit.add(e.id);
          this.hitEnemy(e, s.damage, s.angle, 560, true, 'water');
        }
        // 앞머리가 지나간 자리의 탄은 파도에 씻긴다
        this.bullets = this.bullets.filter(b => b.owner !== 'enemy' || s.dir * (s.x - b.x) < 0);
      }
      if (s.kind === 'steam') for (const time of [0.2, 0.42, 0.64]) if (at(time)) {
        const last = time === 0.64;
        this.superLine(s, 465, 60, s.damage / 3, last ? 300 : 60, e => { if (last) this.applyStatus(e, 'burn', 4); });
        this.fx.shake(last ? 12 : 6);
        if (last) { this.fx.flashAmt = Math.max(this.fx.flashAmt, 0.6); this.hitstop = Math.max(this.hitstop, 0.1); }
      }
      if (s.kind === 'eclipse' && at(ECLIPSE_BURST)) {
        const cx = s.x + Math.cos(s.angle) * ECLIPSE_REACH, cy = s.y + Math.sin(s.angle) * ECLIPSE_REACH;
        const struck = (e: Enemy): void => { if (s.hit.has(e.id)) return; s.hit.add(e.id); this.applyStatus(e, 'stun', 1.5); this.applyStatus(e, 'blind', 3); };
        const hitNear = (e: Enemy): void => { if (s.hit.has(e.id) || dist(cx, cy, e.x, e.y) > 130 + e.r) return; this.hitEnemy(e, s.damage, angleTo(cx, cy, e.x, e.y), 200, true, 'dark'); struck(e); };
        this.superLine(s, ECLIPSE_REACH, 50, s.damage, 200, struck);
        for (const e of this.activeEnemies()) hitNear(e);
        this.bullets = this.bullets.filter(b => b.owner !== 'enemy');
        this.fx.ring(cx, cy, 130, 0.5); this.fx.shake(13);
        this.fx.flashAmt = Math.max(this.fx.flashAmt, 0.75); this.hitstop = Math.max(this.hitstop, 0.12);
      }
    }
    this.supers = this.supers.filter(s => s.t < SUPERS[s.kind].life);
  }

  /** 장착한 정령 중 합동 궁극기 짝. 슬롯이 3칸이라 동시에 두 짝은 나오지 않는다. */
  private comboSlots(): { spec: ComboSpec; slots: readonly [SpiritSlot, SpiritSlot] } | null {
    for (const spec of COMBOS) {
      const a = this.equipped.find(slot => slot.element === spec.pair[0]), b = this.equipped.find(slot => slot.element === spec.pair[1]);
      if (a && b) return { spec, slots: [a, b] };
    }
    return null;
  }

  get comboHud(): ComboHud | null {
    const combo = this.comboSlots();
    if (!combo) return null;
    const [a, b] = combo.slots, p = this.player;
    const grown = a.tier >= 2 && b.tier >= 2, cooldown = Math.max(a.cooldowns.r, b.cooldowns.r);
    return {
      name: combo.spec.name, cost: combo.spec.cost, text: combo.spec.text,
      pair: `${SPIRIT_NAMES[a.element]} × ${SPIRIT_NAMES[b.element]}`,
      grown, cooldown,
      ready: grown && cooldown <= 0 && (this.cheats.energy || p.energy >= combo.spec.cost) && !p.effects.stun && !p.effects.silence,
    };
  }

  /** F · 합동 궁극기 버튼. 안 되는 이유는 세나가 말해준다. */
  castCombo(): void {
    const p = this.player;
    if (this.mode !== 'play' || this.cut || this.endingT >= 0 || p.effects.stun || p.effects.silence) return;
    const combo = this.comboSlots();
    if (!combo) { this.ui.say('같이 쏠 짝이 없어. 메르와 쿠이, 아니면 루나와 카이.', 'flat'); return; }
    const { spec, slots } = combo, [a, b] = slots;
    if (a.tier < 2 || b.tier < 2) { this.ui.say('둘 다 중급이 돼야 같이 쏠 수 있어.', 'flat'); return; }
    if (a.cooldowns.r > 0 || b.cooldowns.r > 0) { this.ui.say('둘의 R이 다 돌아와야 해.', 'flat'); return; }
    if (!this.cheats.energy && p.energy < spec.cost) { this.ui.say(`기력이 부족해. ${spec.cost}만큼 필요해.`, 'troubled'); return; }
    if (!this.cheats.energy) p.energy -= spec.cost;
    for (const slot of slots) { slot.cooldowns.r = SKILLS[slot.element].r.cd; slot.xp += 1; }
    const power = (Math.max(a.tier, b.tier) === 3 ? 1.6 : 1.3) * this.runAttack, glow = ELEMENT[a.element].glow;
    this.castAt = this.clock; this.spiritCastAt = this.clock;
    this.sfx.play('ult');
    this.beginCut(slots, `${SPIRIT_NAMES[a.element]} × ${SPIRIT_NAMES[b.element]} · 합동 궁극기`, spec.name, pickLine('combo'), 1.15, glow, () => {
      const target = this.activeEnemies().sort((m, n) => dist(p.x, p.y, m.x, m.y) - dist(p.x, p.y, n.x, n.y))[0];
      const aim = target ? angleTo(p.x, p.y - 10, target.x, target.y) : p.facing > 0 ? 0 : Math.PI;
      // 그림에 정령이 들어 있어 뒤집히면 안 된다: 좌우만 뒤집고 살짝만 기울인다
      const dir = Math.cos(aim) >= 0 ? 1 : -1;
      const tilt = clamp(dir > 0 ? Math.atan2(Math.sin(aim), Math.cos(aim)) : Math.atan2(Math.sin(aim), -Math.cos(aim)), -0.45, 0.45);
      const angle = dir > 0 ? tilt : Math.PI - tilt;
      this.spawnSuper(spec.pair[0] === 'fire' ? 'steam' : 'eclipse', a.element, p.x, p.y - 10, angle, tilt, dir, spec.damage * power);
      this.ultBurst(a.element);
      this.ui.callSpirit(`${spec.name}!!`, true);
    });
  }

  /** 궁극기: 화면이 번쩍이고 멈칫하며 크게 흔들린다 */
  private ultBurst(element: Element): void {
    const p = this.player, glow = ELEMENT[element].glow;
    this.fx.flashAmt = Math.max(this.fx.flashAmt, 0.6);
    this.fx.shake(11);
    this.hitstop = Math.max(this.hitstop, 0.14);
    if (this.endingT < 0) { this.slowT = 0.3; this.timeScale = 0.3; }
    this.punchZoom(p.x, p.y - 10, 0.08, 0.55);
    for (let i = 0; i < 3; i++) this.fx.ring(p.x, p.y - 8, 70 + i * 50, 0.45 + i * 0.15);
    this.fx.burst(p.x, p.y - 10, 0, 70, [glow, COLOR.white], { spread: Math.PI, speed: 280, life: 0.85, drag: 3, size: 2, glow: true });
    this.sfx.play('hitBig');
  }

  /** 지금 정령 × 무기 형태의 그림 이름 */
  private weaponPanel(form: FormId): string | null {
    const el = this.equipped[this.activeSpirit]?.element;
    if (!el) return null;
    if (el === 'chaos') return `chaos_${CHAOS_PANELS[Math.floor(Math.random() * CHAOS_PANELS.length)]!}`;
    return `${el}_${WEAPON_PANEL[form]}`;
  }

  private playVfx(id: string, x: number, y: number, o: Partial<Pick<Vfx, 'life' | 'angle' | 'scale' | 'alpha' | 'rise' | 'follow'>> = {}): void {
    if (!ART.has(id) || this.vfx.length > 48) return;
    this.vfx.push({ id, x, y, t: 0, life: 0.45, angle: 0, scale: 1, alpha: 1, rise: 0, follow: false, ...o });
  }

  /** 몬스터의 대표 스킬 그림. 공격하는 순간에 부른다. */
  private monsterVfx(e: Enemy, o: Partial<Pick<Vfx, 'life' | 'angle' | 'scale' | 'alpha'>> = {}, dy = -6): void {
    const chapter = CHAPTERS[this.stage.chapter - 1]!;
    const monster = e.spriteId ?? chapter.enemies[e.kind === 'bother' ? 0 : e.kind === 'heavy' ? 1 : 2];
    const id = MONSTER_VFX.get(monster);
    if (id) this.playVfx(id, e.x, e.y + dy, { life: 0.5, alpha: 0.9, ...o });
  }

  /** QWER 그림: 정령마다 네 장을 스킬 성격에 맞춰 배정했다 */
  private skillVfx(el: Element, key: SkillKey, angle: number, sx: number, sy: number, x: number, y: number): void {
    const p = this.player, panel = (name: string): string => `fx_${el}_${name}`;
    if (el === 'chaos') {
      const pick = `fx_chaos_${CHAOS_PANELS[Math.floor(Math.random() * CHAOS_PANELS.length)]!}`;
      this.playVfx(pick, p.x, p.y - 10, { life: key === 'r' ? 1.2 : 0.7, scale: key === 'r' ? 3.4 : 1, angle: pick.endsWith('ray') ? angle : 0 });
      return;
    }
    const mid = { x: (sx + x) / 2, y: (sy + y) / 2 - 8 };
    switch (`${el}_${key}`) {
      case 'fire_q': this.playVfx(panel('bow') + '_sm', sx + Math.cos(angle) * 20, sy - 9 + Math.sin(angle) * 20, { life: 0.2, angle }); break;
      case 'fire_w': this.playVfx(panel('dagger'), mid.x, mid.y, { life: 0.35, angle }); break;
      case 'fire_e': this.playVfx(panel('longsword'), p.x, p.y - 10, { life: 0.6, follow: true, scale: 0.8 }); break;
      case 'water_q': this.playVfx(panel('dagger') + '_sm', sx + Math.cos(angle) * 18, sy - 9 + Math.sin(angle) * 18, { life: 0.2, angle }); break;
      case 'water_w': this.playVfx(panel('longsword'), p.x, p.y - 12, { life: 0.6, rise: 18, scale: 0.8 }); break;
      case 'water_e': this.playVfx(panel('knuckle') + '_sm', p.x, p.y - 10, { life: 0.4, angle }); break;
      case 'wood_q': this.playVfx(panel('knuckle'), x, y - 6, { life: 0.5, scale: 0.8 }); break;
      case 'wood_w': this.playVfx(panel('knuckle') + '_sm', p.x, p.y - 10, { life: 0.6, follow: true }); break;
      case 'wood_e': this.playVfx(panel('bow'), sx + Math.cos(angle) * 64, sy + Math.sin(angle) * 64, { life: 0.4, angle, scale: 1.3 }); if (x !== sx || y !== sy) this.playVfx(panel('dagger'), x, y - 6, { life: 0.8, scale: 0.7 }); break;
      case 'wood_r': this.playVfx(panel('longsword'), x, y - 14, { life: 1.6, scale: 3.6 }); this.playVfx(panel('dagger'), x, y - 6, { life: 1.2, scale: 3 }); break;
      case 'dark_q': this.playVfx(panel('dagger') + '_sm', sx + Math.cos(angle) * 18, sy - 9 + Math.sin(angle) * 18, { life: 0.2, angle }); break;
      case 'dark_w': this.playVfx(panel('dagger'), sx, sy - 8, { life: 0.35 }); this.playVfx(panel('dagger'), p.x, p.y - 8, { life: 0.35 }); break;
      case 'dark_e': this.playVfx(panel('longsword'), x, y - 8, { life: 1.2, scale: 1.8, alpha: 0.85 }); break;
      case 'light_q': this.playVfx(panel('bow'), sx + Math.cos(angle) * 56, sy - 6 + Math.sin(angle) * 56, { life: 0.28, angle, scale: 1.2 }); break;
      case 'light_w': this.playVfx(panel('knuckle'), p.x, p.y - 12, { life: 0.8, follow: true, rise: 8, scale: 0.8 }); break;
      case 'light_e': this.playVfx(panel('knuckle'), p.x, p.y - 8, { life: 0.4, scale: 2 }); break;
    }
  }

  private updateVfx(dt: number): void {
    for (const v of this.vfx) {
      v.t += dt;
      if (v.follow) { v.x = this.player.x; v.y = this.player.y - 10; }
    }
    this.vfx = this.vfx.filter(v => v.t < v.life);
  }

  /** 조명 위에 그린다 (어두운 방에서도 이펙트는 또렷하게). 빠르게 커지며 나타나고 서서히 사라진다. */
  private drawVfx(ox: number, oy: number): void {
    const ctx = this.ctx;
    for (const v of this.vfx) {
      const sheet = ANIMS.get(v.id);
      if (sheet) {
        // Aseprite 시트: 나타남 → 정점 → 디더로 사라짐이 프레임에 들어 있다
        const at = sheet.atProgress('play', v.t / v.life);
        if (!at) continue;
        ctx.save();
        ctx.translate(Math.round(v.x + ox), Math.round(v.y + oy - v.rise * (v.t / v.life)));
        if (v.angle) ctx.rotate(v.angle);
        sheet.draw(ctx, at.frame, 0, 0, { sx: v.scale, sy: v.scale, alpha: v.alpha });
        ctx.restore();
        continue;
      }
      const spr = ART.get(v.id);
      if (!spr) continue;
      const k = v.t / v.life, pop = Math.min(1, v.t / 0.07);
      const scale = v.scale * (0.72 + 0.28 * pop);
      ctx.save();
      ctx.globalAlpha = v.alpha * (k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1);
      ctx.translate(Math.round(v.x + ox), Math.round(v.y + oy - v.rise * k));
      if (v.angle) ctx.rotate(v.angle);
      ctx.scale(scale, scale);
      ctx.drawImage(spr, -Math.round(spr.width / 2), -Math.round(spr.height / 2));
      ctx.restore();
    }
  }

  /** 불꽃 갑옷이 따라붙을 윤슬의 몸 */
  private playerActor(): PxActor {
    if (!this.playerBodyCache) this.playerBodyCache = actorFromSprite(SPRITES.yunseul[0]);
    return this.playerBodyCache;
  }

  private updateEffects(dt: number): void {
    const p=this.player;
    tickStatuses(p.effects,dt);
    this.reactionCd=Math.max(0,this.reactionCd-dt);
    if(p.fireArmor>0){
      this.armorTick-=dt;
      if(this.armorFx){this.armorFx.options.x=p.x;this.armorFx.options.y=p.y+4;}
      if(this.armorTick<=0){
        this.armorTick=0.5;
        for(const enemy of this.activeEnemies())if(dist(enemy.x,enemy.y,p.x,p.y)<enemy.r+30){this.hitEnemy(enemy,5*this.runAttack,angleTo(p.x,p.y,enemy.x,enemy.y),40,true,'fire');this.applyStatus(enemy,'burn',2);}
      }
      if(p.fireArmor-dt<=0){this.armorFx?.stop();this.armorFx=null;}
    }
    p.skillShield=Math.max(0,p.skillShield-dt);p.fireArmor=Math.max(0,p.fireArmor-dt);p.stealth=Math.max(0,p.stealth-dt);p.lightGuard=Math.max(0,p.lightGuard-dt);
    if(p.healTime>0){p.healTime-=dt;p.hp=Math.min(p.maxHp,p.hp+p.maxHp*0.02*dt);}
    this.playerBurnTick-=dt;
    if(p.effects.burn&&this.playerBurnTick<=0){this.playerBurnTick=1;this.hurtPlayer(p.x,p.y,3,true);}
    const pending=this.events;this.events=[];
    for(const event of pending){event.time-=dt;if(event.time<=0)event.run();else this.events.push(event);}
  }

  private updateZones(dt: number): void {
    const p=this.player;
    for(const zone of this.zones){
      if(zone.source&&zone.source>0&&!this.enemies.some(e=>e.id===zone.source&&!e.faced)){zone.age=zone.warning+zone.life;continue;}
      zone.age+=dt;zone.tick-=dt;
      if(zone.source===-1&&zone.age<zone.warning){zone.x=p.x;zone.y=p.y;}
      if(zone.age<zone.warning)continue;
      if(zone.grow)zone.r=Math.max(12,zone.r+zone.grow*dt);
      if(zone.rotate)zone.angle+=zone.rotate*dt;
      if(zone.owner==='enemy'&&contains(zone,p.x,p.y)){
        if(zone.effect==='pull'&&!this.zones.some(w=>w.shape==='wall'&&dist(w.x,w.y,p.x,p.y)<65)){
          const a=angleTo(p.x,p.y,zone.x,zone.y);p.x+=Math.cos(a)*64*dt;p.y+=Math.sin(a)*64*dt;
        }
        if(zone.effect==='slow'){p.effects.slow=0.15;p.slowFactor=0.5;}
        if(zone.tick<=0){
          let hit=true;
          if(zone.damage>0)hit=this.hurtPlayer(zone.x,zone.y,zone.damage*(this.enemies.find(e=>e.id===zone.source)?.boss?.scale??1),true);
          else if(zone.status&&p.skillShield>0){p.skillShield=0;hit=false;}
          if(hit&&zone.status)p.effects[zone.status]=Math.max(p.effects[zone.status]??0,zone.status==='root'?1:zone.status==='slow'?2:5);
        }
      }
      if(zone.owner==='player'){
        if(contains(zone,p.x,p.y)){
          if(zone.effect==='heal'&&zone.tick<=0)p.hp=Math.min(p.maxHp,p.hp+p.maxHp*0.02);
          if(zone.effect==='light')p.lightGuard=0.15;
        }
        if(zone.shape==='wall'&&zone.tick<=0&&zone.damage>0)for(const enemy of this.activeEnemies()){
          if(Math.abs(enemy.x-zone.x)>zone.width/2+enemy.r+3||Math.abs(enemy.y-zone.y)>zone.length/2+enemy.r+3)continue;
          this.hitEnemy(enemy,zone.damage,angleTo(zone.x,zone.y,enemy.x,enemy.y),80,true,'wood');this.applyStatus(enemy,'root',0.8);
          this.fx.burst(enemy.x,enemy.y-6,0,5,['#3f9a52','#8fdc6a'],{spread:Math.PI,speed:60,life:0.3});
        }
        if(zone.shape!=='wall'&&zone.tick<=0)for(const enemy of this.activeEnemies())if(contains(zone,enemy.x,enemy.y)){
          if(zone.damage>0)this.hitEnemy(enemy,zone.damage,angleTo(zone.x,zone.y,enemy.x,enemy.y),zone.element==='water'?300:40,true,zone.element);
          if(zone.status)this.applyStatus(enemy,zone.status,zone.effect==='dark'?0.3:zone.status==='root'?1:3);
          if(zone.effect==='heal')this.applyStatus(enemy,'slow',1.1);
        }
      }
      if(zone.owner==='enemy'&&zone.effect==='light')for(const enemy of this.activeEnemies())if(contains(zone,enemy.x,enemy.y))enemy.lightGuard=0.15;
      if(zone.tick<=0)zone.tick=zone.effect==='dark'?0.2:1;
    }
    this.zones=this.zones.filter(z=>z.age<z.warning+z.life&&(z.hp===undefined||z.hp>0));
  }

  /**
   * 바닥 세 종류를 한눈에 구분한다.
   *  - 공격 예고(한 번 맞는 것): 붉은 면 + 깜빡이는 붉은 테두리
   *  - 느려지는 바닥: 짙은 남색 면 + 천천히 번지는 파란 물결 (피해 없음)
   *  - 밟으면 아픈 바닥: 검붉은 면 + 튀는 불씨 + 주황 테두리 (1초마다 피해)
   */
  private floorKind(zone: Zone): 'slow' | 'damp' | 'hazard' | null {
    if (zone.owner !== 'enemy') return null;
    if (zone.look === 'hazard') return 'hazard';
    if (zone.damage <= 0 && zone.stopEnergy) return 'damp';
    if (zone.damage <= 0 && zone.effect === 'slow') return 'slow';
    return null;
  }

  private drawFloor(zone: Zone, kind: 'slow' | 'damp' | 'hazard'): void {
    const ctx = this.ctx, t = this.clock;
    const warning = zone.age < zone.warning;
    const pal = kind === 'hazard'
      ? { base: '#2a0a0a', edge: '#ff6a3a', a: '#ff5a2a', b: '#ffc06a' }
      : kind === 'damp'
        ? { base: '#0d2a2a', edge: '#3fb7a8', a: '#3fb7a8', b: '#a8f0e4' }
        : { base: '#141c38', edge: '#6f8fe0', a: '#6f8fe0', b: '#c8d8ff' };
    if (zone.shape === 'screen') {
      // 방 전체가 무거워지는 공기: 옅은 남색 + 천천히 떨어지는 점
      ctx.save(); ctx.globalAlpha = 0.1; ctx.fillStyle = pal.a; ctx.fillRect(FLOOR.x, FLOOR.y, FLOOR.w, FLOOR.h); ctx.restore();
      ctx.fillStyle = pal.b;
      for (let i = 0; i < 40; i++) {
        const x = FLOOR.x + ((i * 53) % FLOOR.w), y = FLOOR.y + ((i * 37 + t * 14) % FLOOR.h);
        ctx.fillRect(Math.round(x), Math.round(y), 1, 2);
      }
      return;
    }
    const r = zone.r, cx = zone.x, cy = zone.y;
    // 예고 중에는 테두리만 그려진다 (곧 깔린다는 신호)
    ctx.save();
    if (!warning) {
      ctx.globalAlpha = kind === 'hazard' ? 0.62 : 0.5;
      pixelEllipse(ctx, cx, cy, r, r, pal.base);
    }
    ctx.restore();
    ctx.fillStyle = pal.edge;
    const blink = warning ? Math.floor(zone.age * 10) % 2 === 0 : true;
    if (blink) {
      // 테두리: 느린 바닥은 점선, 아픈 바닥은 실선
      const steps = Math.ceil(r * 3.4);
      for (let i = 0; i < steps; i++) {
        if (kind !== 'hazard' && i % 3 === 2) continue;
        const a = (i / steps) * TAU;
        ctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 1, 1);
      }
    }
    if (warning) return;
    if (kind === 'hazard') {
      // 불씨: 바닥에서 튀어 오르는 점
      const seed = Math.floor(t * 8);
      for (let i = 0; i < Math.ceil(r * 0.9); i++) {
        const h = Math.sin((i + 1) * 12.9898 + seed * 78.233 + cx) * 43758.5453;
        const u = h - Math.floor(h);
        const v = Math.sin((i + 1) * 4.1 + seed * 1.7 + cy) * 0.5 + 0.5;
        const a = u * TAU, d = Math.sqrt(v) * (r - 2);
        const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d - ((t * 20 + i * 3) % 6);
        ctx.fillStyle = i % 3 === 0 ? pal.b : pal.a;
        ctx.fillRect(Math.round(x), Math.round(y), 1, i % 4 === 0 ? 2 : 1);
      }
    } else {
      // 물결: 가운데서 번져 나가는 고리 두 개
      ctx.fillStyle = pal.b;
      for (let k = 0; k < 2; k++) {
        const rr = ((t * 10 + k * r * 0.5) % (r - 2)) + 2;
        const steps = Math.ceil(rr * 2.2);
        for (let i = 0; i < steps; i += 2) {
          const a = (i / steps) * TAU;
          ctx.fillRect(Math.round(cx + Math.cos(a) * rr), Math.round(cy + Math.sin(a) * rr), 1, 1);
        }
      }
    }
  }

  private drawZones(): void {
    const ctx=this.ctx;
    for(const zone of this.zones){
      const floor=this.floorKind(zone);
      if(floor&&(zone.shape==='circle'||zone.shape==='screen')){this.drawFloor(zone,floor);continue;}
      if(zone.owner==='player'&&zone.shape==='line'&&zone.element==='light'){
        // 빛줄기: 흰 심 + 금빛 테두리, 사라지며 가늘어진다
        const k=1-zone.age/Math.max(0.01,zone.life),c=Math.cos(zone.angle),sn=Math.sin(zone.angle),nx=-sn,ny=c;
        const ex=zone.x+c*zone.length,ey=zone.y+sn*zone.length;
        for(let w=-3;w<=3;w++){if(Math.abs(w)>k*3+0.5)continue;pixelLine(ctx,zone.x+nx*w,zone.y+ny*w,ex+nx*w,ey+ny*w,Math.abs(w)<=1?'#ffffff':'#fff0b1');}
        continue;
      }
      const warning=zone.age<zone.warning;
      const color=zone.owner==='enemy'?'#e06467':ELEMENT[zone.element].glow;
      if(zone.shape==='ring'&&zone.damage===0&&zone.owner==='enemy'){
        // 방사 탄 예고: 원이 또렷할수록 안전한 안쪽이 읽힌다
        const steps=Math.round(zone.r*7);
        for(let i=0;i<steps;i++){const a=i/steps*TAU;plot(ctx,zone.x+Math.cos(a)*zone.r,zone.y+Math.sin(a)*zone.r,warning?'#ff8a8c':color);}
        continue;
      }
      ctx.save();ctx.fillStyle=color;ctx.strokeStyle=color;ctx.lineWidth=1;
      ctx.globalAlpha=warning?0.16+Math.sin(zone.age*14)*0.04:0.22;
      ctx.beginPath();
      if(zone.shape==='screen')ctx.rect(FLOOR.x,FLOOR.y,FLOOR.w,FLOOR.h);
      else if(zone.shape==='wall'||zone.shape==='rect')ctx.rect(Math.round(zone.x-zone.width/2),Math.round(zone.y-zone.length/2),zone.width,zone.length);
      else if(zone.shape==='line'){
        const dx=Math.cos(zone.angle)*zone.length,dy=Math.sin(zone.angle)*zone.length,wx=-Math.sin(zone.angle)*zone.width,wy=Math.cos(zone.angle)*zone.width;
        ctx.moveTo(zone.x+wx,zone.y+wy);ctx.lineTo(zone.x+dx+wx,zone.y+dy+wy);ctx.lineTo(zone.x+dx-wx,zone.y+dy-wy);ctx.lineTo(zone.x-wx,zone.y-wy);ctx.closePath();
      }else if(zone.shape==='cone'){ctx.moveTo(zone.x,zone.y);ctx.arc(zone.x,zone.y,zone.r,zone.angle-Math.PI/4,zone.angle+Math.PI/4);ctx.closePath();}
      else if(zone.shape==='ring'){ctx.arc(zone.x,zone.y,zone.r,0,TAU);ctx.arc(zone.x,zone.y,Math.max(0,zone.r-zone.width*2),TAU,0,true);}
      else ctx.arc(zone.x,zone.y,zone.r,0,TAU);
      ctx.fill();ctx.globalAlpha=warning?0.75:0.9;ctx.stroke();
      if(zone.safe){ctx.fillStyle='#87d4b1';ctx.strokeStyle='#c0ffe0';ctx.globalAlpha=0.7;ctx.beginPath();ctx.arc(zone.safe.x,zone.safe.y,zone.safe.r,0,TAU);ctx.fill();ctx.stroke();}
      if(zone.shape==='wall'){ctx.globalAlpha=1;ctx.fillStyle='#66824a';for(let x=zone.x-zone.width/2;x<zone.x+zone.width/2;x+=6)ctx.fillRect(Math.round(x),Math.round(zone.y-zone.length/2),2,zone.length);}
      ctx.restore();
    }
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
            this.hitEnemy(e, 4*this.runAttack, angleTo(f.x, f.y, e.x, e.y), 10, true);
            this.applyStatus(e,'burn',3);
            f.tick = 0.35;
          }
        }
      } else if (f.t > 0.25 && dist(f.x, f.y, p.x, p.y + 4) < 9) {
        this.hurtPlayer(f.x, f.y);
        p.effects.burn=3;
        f.tick = 0.5;
      }
    }
    this.flames = this.flames.filter((f) => f.t < f.life);
  }

  /* ── 공격 ── */

  private activeEnemies(): Enemy[] {
    return this.enemies.filter((e) => !e.faced && e.spawnT <= 0 && !(e.stealth&&e.stealth>0));
  }

  /** 단검이 몸을 끌어당겨 닿는 거리. 이 안이면 멈춰서 친다. */
  private orderInReach(): boolean {
    const t = this.attackOrder, p = this.player;
    return !!t && dist(p.x, p.y, t.x, t.y) - t.r <= SENSE.near;
  }

  /** 대상이 사라지면 지시를 거둔다. 방향키로 피하는 동안은 쫓아가지 않지만 닿으면 계속 친다. */
  private updateAttackOrder(): void {
    const t = this.attackOrder;
    if (!t) return;
    const p = this.player, stick = this.input.move;
    if (t.faced || (t.stealth ?? 0) > 0 || !this.enemies.includes(t)) {
      this.attackOrder = null;
      if (!stick) p.moving = false;
      return;
    }
    if (stick) return;
    p.moving = !this.orderInReach();
    if (p.moving) { p.tx = t.x; p.ty = t.y; }
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

    if ((this.input.attackHeld || this.orderInReach()) && this.attackUnlocked && p.cd <= 0 && !this.pending && this.endingT < 0 && !p.effects.stun) this.startAttack();
  }

  private startAttack(): void {
    const p = this.player;
    const targets = this.activeEnemies();
    // 그늘이 없으면 세나는 반응하지 않는다. 읽을 상황이 없으니까.
    if (targets.length === 0) return;
    // 지시한 적이 있으면 그 적만 본다 (Space만 누를 때는 세나가 알아서 고른다)
    const choice = chooseForm(p.x, p.y, this.attackOrder ? [this.attackOrder] : targets, p.form);
    if(this.fixedForm>0)choice.form='dagger';
    // 뒤로 빠지는 중: 몸을 끌어당기지 않으므로, 근접이 안 닿으면 활로 견제한다
    const foe=choice.target;
    const retreating=!!foe&&p.moving&&(p.tx-p.x)*(foe.x-p.x)+(p.ty-p.y)*(foe.y-p.y)<0;
    if(retreating&&foe&&this.fixedForm<=0&&choice.form==='dagger'&&dist(p.x,p.y,foe.x,foe.y)-foe.r>FORMS.dagger.range)choice.form='bow';
    if(p.effects.blind&&choice.form==='bow'){p.cd=0.3;return;}
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
        art: this.weaponPanel('bow') ? `fx_${this.weaponPanel('bow')}_sm` : undefined, artScale: 0.6,
      });
      this.sfx.play('bow');
      return;
    }

    // 세나가 몸을 끌어당긴다: 목표 쪽으로 짧게 돌진
    const reach = t ? dist(p.x, p.y, t.x, t.y) - t.r - p.r - 5 : spec.lunge * 0.3;
    // 뒤로 빠지는 중이면 몸을 끌어당기지 않는다: 피하려는데 다시 적에게 붙으면 조작을 뺏기는 느낌이 난다
    const step = retreating ? 0 : clamp(reach, 0, spec.lunge);
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
      if(p.effects.blind&&Math.random()<0.5)continue;
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
    const panel = this.weaponPanel(s.form);
    if (panel) {
      const reach = Math.min(spec.range, 34);
      this.playVfx(`fx_${panel}_sm`, p.x + Math.cos(s.aim) * reach, p.y - 8 + Math.sin(s.aim) * reach * 0.8, { life: s.form === 'dagger' ? 0.16 : 0.26, angle: AIMED_PANELS.has(panel) ? s.aim : 0, scale: s.form === 'sword' ? 1.3 : 0.9, alpha: 0.9 });
    }

    if (hits > 0) {
      if (s.form === 'dagger') this.sfx.play('hit');
      if (s.form === 'sword') this.sfx.play('hitBig');
      this.hitstop = Math.max(this.hitstop, spec.hitstop + (kills > 0 ? 0.04 : 0) + (hits > 1 ? 0.02 : 0));
      this.fx.shake(spec.shake + hits * 0.5);
    }
  }

  /** @returns 이번 타격으로 마주했는지 */
  private hitEnemy(e: Enemy, damage: number, angle: number, knockback: number, fire = false,element:Element='fire'): boolean {
    if(e.faced||this.mode==='embrace')return false;
    if(e.tag==='fakeDoor')return false;
    if(e.armor){e.armor--;return false;}
    if(fire&&e.skillShield&&e.skillShield>0){e.skillShield=0;return false;}
    if(e.lightGuard&&e.lightGuard>0)damage*=0.5;
    if(e.fireArmor&&e.fireArmor>0&&dist(e.x,e.y,this.player.x,this.player.y)<60){this.player.effects.burn=3;this.hurtPlayer(e.x,e.y,damage*0.2,true);}
    if(e.tag==='decoy'){this.hurtPlayer(e.x,e.y,15,true);this.faceEnemy(e,false);return false;}
    damage*=fire?1:this.runAttack;
    if(e.effects.mark)damage*=1.2;
    const boss=e.boss;
    if(boss){
      if(boss.qteTime>0)return false;
      if(boss.invulnerable||(boss.id==='door'&&boss.elapsed%8.5>=2.5))return false;
      if(boss.stagger>0)damage*=1.5;
      const servants=this.enemies.filter(other=>!other.faced&&other.source===e.id);
      if(boss.id==='blanket'&&servants.some(other=>other.tag==='blanket'))damage*=0.25;
      if(boss.id==='group')damage*=1-Math.min(0.6,servants.length*0.05);
      if(boss.id==='table')damage*=1+(4-servants.filter(other=>other.tag==='chair').length)*0.1;
      if(boss.id==='mirror'&&dist(this.player.x,this.player.y,e.x,e.y)<64&&Math.floor(boss.elapsed/4)%2===0)damage*=0.2;
    }
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
    if (fire&&element==='fire') this.px.fireHit(e.x - Math.cos(angle) * e.r * 0.4, e.y + e.r * 0.6, e.r * 1.4, angle);
    else this.px.hitSpark(e.x - Math.cos(angle) * e.r * 0.4, e.y + e.r * 0.6, e.r * 1.4, angle);
    if (SHOW_DAMAGE_NUMBERS) this.fx.number(e.x, e.y - e.r * 2 - 4, Math.round(damage * 10));
    if (e.hp <= 0) {
      if(e.boss?.id==='young'&&e.boss.main){e.hp=0;this.beginEmbrace(e);return false;}
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
    if(reward)for(const slot of this.equipped){slot.xp+=0.6;if(slot.xp>=TIER3_XP)slot.tier=3;else if(slot.xp>=TIER2_XP)slot.tier=Math.max(2,slot.tier);}
    this.room.marks.push({ x: Math.round(e.x), y: Math.round(e.y + e.r * 0.6), w: Math.max(5, Math.round(e.r * 1.4)) });
    // 옅은 사본이 몸에서 빠져나와 떠오른다. 사라진 게 아니라 놓아준 것.
    this.px.soul(e.x, e.y + e.r * 0.6, this.bodyOf(e.kind), e.kind === 'alarm' ? 46 : 28);
    if (!reward) {
      if (e.boss?.main) this.faceBoss(e);
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

    if (e.boss?.main) {
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
    if(this.endingT>=0)return;
    this.room.cleared=true;this.room.rewarded=true;
    this.events=[];this.zones=[];
    this.endingT = 0;
    this.slowT = 1.2;
    this.timeScale = 0.25;
    this.hitstop = Math.max(this.hitstop, 0.16);
    this.relic = { x: e.x, y: e.y, t: 0 };
    this.dropItem(e.x, e.y - 10);
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

  private dropItem(x: number, y: number): void {
    const p = this.player;
    const heartFull = p.maxHp >= MAX_HP_CAP, energyFull = p.maxEnergy >= MAX_ENERGY_CAP;
    if (heartFull && energyFull) return;
    const kind: ItemId = heartFull ? 'crystal' : energyFull ? 'heart' : Math.random() < 0.5 ? 'crystal' : 'heart';
    this.item = { x, y, vx: rand(-30, 30), vy: -90, t: 0, kind };
  }

  /** 하드방 보상: 방 한가운데에 떠 있다 */
  private placeRoomItem(): void {
    this.item = { x: CX, y: CY, vx: 0, vy: 0, t: ITEM_LAND, kind: 'shoes' };
  }

  /** 튀어 올랐다 내려앉은 뒤에는 그 자리에서 기다린다. 벽 밖으로 나가면 못 주우니 바닥 안에 묶는다. */
  private updateItem(dt: number): void {
    const it = this.item;
    if (!it) return;
    it.t += dt;
    if (it.t >= ITEM_LAND) return;
    it.vy += 260 * dt;
    it.x = clamp(it.x + it.vx * dt, IN_X0, IN_X1);
    it.y = clamp(it.y + it.vy * dt, IN_Y0, IN_Y1);
  }

  private itemInReach(): boolean {
    const it = this.item, p = this.player;
    return !!it && it.t >= ITEM_LAND && dist(it.x, it.y, p.x, p.y - 8) <= PICKUP_RANGE;
  }

  get pickupPrompt(): PickupPrompt | null {
    const it = this.item;
    if (!it || this.mode !== 'play' || it.t < ITEM_LAND) return null;
    const near = this.itemInReach(), name = ITEMS[it.kind].name;
    const key = window.matchMedia('(pointer: coarse)').matches ? '공격 버튼' : 'Space';
    return { text: near ? `${key} · ${name}` : name, x: it.x, y: it.y - 12, near };
  }

  private takeItem(it: Item): void {
    const p = this.player;
    this.item = null;
    if (this.room.kind === 'hard') this.room.rewarded = true;
    this.gainItem(it.kind);
    this.ui.center(`${ITEMS[it.kind].name} · ${ITEMS[it.kind].effect}`);
    const colors = it.kind === 'crystal' ? ['#7fd8ff', '#e8faff', '#3a8ad0'] : it.kind === 'heart' ? [COLOR.heart, '#ffd0d0', COLOR.accent] : [COLOR.accent, COLOR.white, COLOR.pale];
    this.fx.burst(p.x, p.y - 10, 0, 22, colors, { spread: Math.PI, speed: 120, life: 0.6, glow: true });
    this.px.warmth(p.x, p.y + 4);
    this.fx.ring(p.x, p.y - 6, 26, 0.4);
    this.sfx.play('spirit');
    this.saveCheckpoint();
  }

  private drawItem(): void {
    const it = this.item;
    if (!it) return;
    const ctx = this.ctx, x = Math.round(it.x), y = Math.round(it.y + Math.sin(this.clock * 4) * 1.5);
    // 바닥 다른 아이템(심장·결정)은 2px를 콕 찍는 한 점이라 눈에 잘 안 띈다. 도트 한 칸을 2배로 찍어서 키운다.
    if (it.kind === 'shoes') {
      pixelEllipse(ctx, it.x, it.y + 10, 8, 2, COLOR.shadow);
      // 끈 묶은 운동화: 옆모습, 도트 한 칸 = 2×2픽셀
      const rows = ['..ww...', '..wlw..', '..wlww.', '..wwwww', 'sssssss'];
      const pal: Record<string, string> = { w: '#e8e4da', l: COLOR.accent, s: '#8a8b93' };
      const scale = 2;
      rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) { const c = pal[row[i]!]; if (c) { ctx.fillStyle = c; ctx.fillRect(x - 7 + i * scale, y - 4 + j * scale, scale, scale); } } });
      if (Math.floor(this.clock * 3) % 3 === 0) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x + 6, y - 10, 2, 2); ctx.fillRect(x + 4, y - 8, 6, 2); ctx.fillRect(x + 6, y - 6, 2, 2); }
      return;
    }
    pixelEllipse(ctx, it.x, it.y + 9, 5, 1.5, COLOR.shadow);
    if (it.kind === 'crystal') {
      // 기력의 결정: 푸른 마름모
      const rows = ['...w...', '..wbw..', '.wbbbw.', 'wbbBbbw', '.bbBbb.', '..bBb..', '...b...'];
      const pal: Record<string, string> = { w: '#e8faff', b: '#5ab8f0', B: '#2a6ab0' };
      rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) { const c = pal[row[i]!]; if (c) { ctx.fillStyle = c; ctx.fillRect(x - 3 + i, y - 3 + j, 1, 1); } } });
    } else {
      // 심장 조각: 반짝이는 큰 하트
      const rows = ['.hh.hh.', 'hwhhhhh', 'hhhhhhh', 'hhhhhhh', '.hhhhh.', '..hhh..', '...h...'];
      const pal: Record<string, string> = { h: COLOR.heart, w: '#ffffff' };
      rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) { const c = pal[row[i]!]; if (c) { ctx.fillStyle = c; ctx.fillRect(x - 3 + i, y - 3 + j, 1, 1); } } });
    }
    if (Math.floor(this.clock * 3) % 3 === 0) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x + 3, y - 5, 1, 1); ctx.fillRect(x + 2, y - 4, 3, 1); ctx.fillRect(x + 3, y - 3, 1, 1); }
  }

  private punchZoom(x: number, y: number, amount: number, duration: number): void {
    this.zoom = { amount, life: duration, max: duration, x, y };
  }

  private hurtPlayer(sx: number, sy: number, damage=10, _skill=false): boolean {
    const p = this.player;
    if (this.cheats.health || p.invuln > 0 || this.mode !== 'play' || this.endingT >= 0) return false;
    if(p.armor>0){p.armor--;this.fx.ring(p.x,p.y,20,0.3);return false;}
    if(p.skillShield>0){
      p.skillShield=0;p.invuln=Math.max(p.invuln,0.5);
      this.fx.ring(p.x,p.y-6,40,0.35);
      this.fx.burst(p.x,p.y-8,0,20,['#5eb0ff','#c8e8ff',COLOR.white],{spread:Math.PI,speed:140,life:0.45,glow:true});
      for(const enemy of this.activeEnemies())if(dist(enemy.x,enemy.y,p.x,p.y)<60)this.hitEnemy(enemy,6*this.runAttack,angleTo(p.x,p.y,enemy.x,enemy.y),420,true,'water');
      this.sfx.play('fireHit');
      return false;
    }
    if(p.lightGuard>0)damage*=0.5;
    if(p.effects.mark)damage*=1.2;
    const enraged=this.enemies.some(e=>e.boss&&BOSSES[e.boss.id].enrage>0&&e.boss.elapsed>BOSSES[e.boss.id].enrage);
    if(enraged)damage*=1.5;
    if(this.stage.number===TUTORIAL_STAGE)damage*=TUTORIAL_DAMAGE;
    p.hp -= damage;
    p.invuln = INVULN;
    if(p.fireArmor>0)for(const enemy of this.activeEnemies())if(dist(enemy.x,enemy.y,p.x,p.y)<enemy.r+35){this.applyStatus(enemy,'burn',3);this.hitEnemy(enemy,damage*0.2,angleTo(p.x,p.y,enemy.x,enemy.y),20,true);}
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
    if (p.hp > 0 && p.hp <= 30 && !this.lowSaid) {
      this.lowSaid = true;
      this.say('low', true);
    } else {
      this.say('hurt');
    }
    if (p.hp <= 0) this.playerDown();
    else this.tutorial('hurt');
    return true;
  }

  private playerDown(): void {
    this.clearSupers();
    this.mode = 'down';
    this.saveCheckpoint();
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
    const whisper=this.enemies.find(e=>e.boss&&e.boss.qteTime>0);

    for (const e of this.enemies) {
      if(whisper&&e!==whisper)continue;
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
      if(e.skillShield)e.skillShield=Math.max(0,e.skillShield-dt);if(e.fireArmor)e.fireArmor=Math.max(0,e.fireArmor-dt);if(e.stealth)e.stealth=Math.max(0,e.stealth-dt);if(e.lightGuard)e.lightGuard=Math.max(0,e.lightGuard-dt);
      if(e.healTime&&e.healTime>0){e.healTime-=dt;e.hp=Math.min(e.maxHp,e.hp+2*dt);}
      tickStatuses(e.effects,dt);e.burnTick-=dt;
      if(e.effects.burn&&e.burnTick<=0){e.burnTick=1;this.hitEnemy(e,3*this.runAttack,0,0,true);}
      if(e.faced)continue;
      e.squash *= Math.exp(-10 * dt);
      // 2페이즈 가속은 '다음 공격까지의 간격'에만 건다. 그로기·QTE 창은 실제 시간 그대로.
      const haste=e.boss&&(e.boss.qteTime>0||e.boss.stagger>0||e.state==='stun')?1:this.bossHaste(e);
      e.t -= dt*haste;
      const oldX=e.x,oldY=e.y;
      const f = Math.exp(-9 * dt);
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      e.vx *= f;
      e.vy *= f;

      if (live&&!e.effects.stun&&!e.effects.root) {
        const step=dt*(e.effects.slow?0.5:1);
        if(e.boss)this.aiBoss(e,step);
        else if(e.tag==='chair')this.aiChair(e);
        else if(e.tag==='fakeDoor'){
          const parent=this.enemies.find(p=>p.id===e.source);const cycle=Math.floor((parent?.boss?.elapsed??0)/8.5);
          if(cycle>e.cycle){e.cycle=cycle;const angle=angleTo(e.x,e.y,p.x,p.y);this.addZone({shape:'line',x:e.x,y:e.y,angle,length:320,width:6,warning:1,life:2,damage:25,source:e.id});}
        }
        else if(e.tag==='child'&&e.kind==='bother'){
          const distance=dist(e.x,e.y,p.x,p.y);if(distance<100)this.stepToward(e,p.x,p.y,-24,step);
          if(e.t<=0){e.t=5;this.summon(e,'bother',3);}
        }
        else if(e.tag==='echo'&&this.enemies.some(parent=>parent.id===e.source&&parent.boss?.id==='apathy')){
          if(e.t<=0){e.t=3.5;this.addZone({shape:'cone',x:e.x,y:e.y,r:192,angle:angleTo(e.x,e.y,p.x,p.y),warning:1.5,life:0.3,damage:30,source:e.id});}
        }
        else if(e.effects.blind&&e.kind==='gloom')this.stepToward(e,p.x,p.y,20,step);
        else {
        switch (e.kind) {
          case 'bother': this.aiBother(e, step); break;
          case 'heavy': this.aiHeavy(e, step); break;
          case 'gloom': this.aiGloom(e, step); break;
          case 'alarm': break;
        }
        }
      }
      for(const wall of this.zones)if(wall.shape==='wall'&&contains(wall,e.x,e.y)){e.x=oldX;e.y=oldY;if(wall.hp!==undefined)wall.hp-=dt*(e.boss?40:10);}

      const hitWall = this.clampEnemy(e);
      if (hitWall && e.kind === 'alarm' && e.state === 'charge') {
        e.state = 'stun';
        e.t = e.hp <= e.maxHp / 2 ? 0.7 : 0.95;
        e.squash = 1;
        this.fx.shake(5);
        this.fx.burst(e.x, e.y, 0, 14, [COLOR.inkRim, COLOR.dim], { speed: 120, size: 2, life: 0.5 });
        this.sfx.play('thud');
      }

      if (live && p.stealth<=0 && e.tag!=='fakeDoor' && (!e.boss||e.state==='charge') && dist(p.x, p.y, e.x, e.y) < p.r + e.r - 2) this.hurtPlayer(e.x, e.y,e.boss?25*e.boss.scale:12,Boolean(e.boss));
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

    this.enemies = this.enemies.filter((e) => !(e.faced && e.fadeT >= 1 && e.kind !== 'alarm' && !(e.tag==='child'&&this.enemies.some(parent=>parent.id===e.source&&parent.boss?.phase===1))));
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
      if (e.t <= 0) { e.state = 'move'; e.t = rand(0.6, 0.9); if (Math.random() < 0.3) this.monsterVfx(e, { scale: 0.55, life: 0.6, alpha: 0.75 }, 2); }
    } else {
      this.stepToward(e, p.x, p.y, 66, dt);
      if (e.t <= 0) { e.state = 'rest'; e.t = rand(0.5, 0.9); }
    }
  }

  /** 힘듦: 느리게 따라오다 가까워지면 몸을 웅크렸다가 덮친다 */
  private aiHeavy(e: Enemy, dt: number): void {
    const p = this.player;
    const d = dist(e.x, e.y, p.x, p.y);
    if (e.state === 'chase') {
      this.stepToward(e, p.x, p.y, 38, dt);
      if (d < e.r + p.r + 30 && e.t <= 0) {
        e.state = 'wind';
        e.t = 0.48;
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
        this.monsterVfx(e, { scale: 0.75, life: 0.45 }, 0);
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
      this.fireEnemy(e.x, e.y - 14, angleTo(e.x, e.y - 14, p.x, p.y - 8), 108, 'tear');
      this.monsterVfx(e, { scale: 0.6, life: 0.4 }, -16);
      this.sfx.play('tear');
      e.state = 'drift';
      e.t = rand(1.5, 2.1);
    }
  }

  private makeBoss(id: BossId,x: number,y: number,main: boolean): Enemy {
    const enemy=this.makeEnemy('alarm',x,y,0.9),spec=BOSSES[id];
    enemy.boss=newBoss(id,main);enemy.hp=enemy.maxHp=spec.hp*this.enemyHpScale;enemy.r=main?20:16;enemy.weight=20;enemy.warmth=main?8:5;
    enemy.state='idle';enemy.t=1;
    const chapter=CHAPTERS[spec.chapter-1]!;
    enemy.spriteId=spec.asset??chapter.enemies[id==='great_heavy'||id==='bedroom'?1:0];
    if(id==='door'||id==='table'){enemy.x=CX;enemy.y=CY-24;enemy.weight=100;}
    return enemy;
  }

  private summon(parent: Enemy,kind: EnemyKind,count: number,tag='servant',hp?: number): Enemy[] {
    const result: Enemy[]=[];
    if(parent.faced)return result;
    for(let i=0;i<count&&this.enemies.filter(e=>!e.faced).length<18;i++){
      const angle=i/count*TAU, r=tag==='surround'?80:65;
      const cx=tag==='surround'?this.player.x:parent.x,cy=tag==='surround'?this.player.y:parent.y;
      const enemy=this.makeEnemy(kind,clamp(cx+Math.cos(angle)*r,FLOOR.x+20,FLOOR.x+FLOOR.w-20),clamp(cy+Math.sin(angle)*r,FLOOR.y+20,FLOOR.y+FLOOR.h-20),0.8);
      enemy.tag=tag;enemy.source=parent.id;if(hp)enemy.hp=enemy.maxHp=hp;
      if(tag==='blanket')enemy.spriteId=BOSSES.blanket.asset;
      if(tag==='decoy')enemy.spriteId=BOSSES.mirror.asset;
      this.enemies.push(enemy);result.push(enemy);
    }
    return result;
  }

  private bossPhase(enemy: Enemy,phase: number): void {
    const b=enemy.boss!;b.phase=phase;
    this.ui.center(`${BOSSES[b.id].name} · ${phase+1}페이즈`);
    this.fx.ring(enemy.x,enemy.y,70,0.5);
    if(b.id==='giant_bother'&&phase===1)this.summon(enemy,'bother',4);
    if(b.id==='blanket'&&phase===1){const blankets=this.summon(enemy,'bother',4,'blanket',150);blankets.forEach((blanket,i)=>{blanket.x=i%2?FLOOR.x+FLOOR.w-25:FLOOR.x+25;blanket.y=i<2?FLOOR.y+25:FLOOR.y+FLOOR.h-25;});b.splitAt=b.elapsed;}
    if(b.id==='door'&&phase===1){
      enemy.x=CX-68;const fake=this.summon(enemy,'gloom',1,'fakeDoor',1)[0];if(fake){fake.x=CX+68;fake.y=enemy.y;fake.spriteId=BOSSES.door.asset;fake.weight=100;}
      this.ui.say('손잡이에 빛이 남은 쪽이 진짜 문이야.', 'flat');
    }
    if(b.id==='apathy'&&phase===1){this.summon(enemy,'bother',8,'wave');b.invulnerable=true;b.splitAt=b.elapsed;b.flags.add('resting');}
    if(b.id==='apathy'&&phase===2){this.summon(enemy,'gloom',2,'echo',300);this.ui.say('어두워져도, 세나를 놓치지 마.', 'flat');}
    if(b.id==='group'&&phase===1){
      const servants=this.enemies.filter(e=>e.source===enemy.id&&!e.faced);b.scale=1+servants.length*0.05;
      for(const servant of servants)this.faceEnemy(servant,false);
    }
    if(b.id==='merged'&&phase===1){
      b.invulnerable=true;
      for(const kind of ['heavy','gloom','bother'] as const)this.summon(enemy,kind,1,'child',1200);
      const children=this.enemies.filter(e=>e.source===enemy.id&&e.tag==='child');
      children.forEach((child,i)=>{child.x=CX+(i-1)*90;child.y=CY+20;});
      this.ui.say('셋을 10초 안에 함께 마주해. 체력을 맞춰 둬.', 'flat');
    }
    if(b.id==='table'&&phase===1)b.flags.add('empty');
  }

  private aiChair(enemy: Enemy): void {
    if(enemy.effects.blind)return;
    if(enemy.t>0)return;
    enemy.t=3;
    const angle=angleTo(enemy.x,enemy.y,this.player.x,this.player.y);
    this.addZone({shape:'line',x:enemy.x,y:enemy.y,angle,length:240,width:3,warning:0.8,life:0.1});
    this.after(0.8,()=>{if(!enemy.faced)this.fireEnemy(enemy.x,enemy.y,angle,105,'note',15,true);});
  }

  private aiBoss(enemy: Enemy,dt: number): void {
    const b=enemy.boss!,spec=BOSSES[b.id],p=this.player;
    b.elapsed+=dt;b.stagger=Math.max(0,b.stagger-dt);
    if(b.stagger>0){enemy.state='stun';enemy.t=b.stagger;return;}
    if(enemy.state==='stun'){if(enemy.t<=0){enemy.state='idle';enemy.t=1;}return;}
    const phase=spec.phases.filter(threshold=>enemy.hp/enemy.maxHp<=threshold).length;
    if(phase>b.phase)this.bossPhase(enemy,phase);
    // 보스: 피가 반이 되면 2페이즈 — 모든 공격이 빨라진다
    if(b.main&&!b.flags.has('rage')&&enemy.hp/enemy.maxHp<=0.5)this.enrageBoss(enemy);
    // 중간 보스: 붉은 예고 공격과 별개로, 피가 줄수록 더 자주·더 많이 '밟으면 아픈 바닥'을 깐다
    if(!b.main&&!b.invulnerable&&b.qteTime<=0){
      b.hazard-=dt;
      if(b.hazard<=0){
        const lost=1-enemy.hp/enemy.maxHp;
        b.hazard=Math.max(1.6,5.2-lost*4);
        this.spawnHazards(enemy,1+Math.floor(lost*4.5),lost);
      }
    }
    const servants=this.enemies.filter(e=>e.source===enemy.id);
    if(b.id==='blanket'&&b.phase>=1&&b.flags.has('blanket')===false){
      if(servants.some(e=>e.tag==='blanket')&&servants.filter(e=>e.tag==='blanket').every(e=>e.faced)){
        b.flags.add('blanket');if(b.elapsed-b.splitAt<=10)b.stagger=5;
      }
    }
    if(b.id==='apathy'&&b.flags.has('resting')){
      if(servants.filter(e=>e.tag==='wave').every(e=>e.faced)){b.invulnerable=false;b.stagger=5;b.flags.delete('resting');b.splitAt=b.elapsed;}
      else if(b.elapsed-b.splitAt>15){enemy.hp=Math.min(enemy.maxHp,enemy.hp+enemy.maxHp*0.1);this.summon(enemy,'bother',3,'wave');b.splitAt=b.elapsed;}
    } else if(b.id==='apathy'&&b.phase===1&&b.elapsed-b.splitAt>30){this.summon(enemy,'bother',8,'wave');b.invulnerable=true;b.flags.add('resting');b.splitAt=b.elapsed;}
    if(b.id==='merged'&&b.phase===1){
      const children=servants.filter(e=>e.tag==='child');
      if(children.length===3&&children.every(e=>e.faced)){enemy.hp=enemy.maxHp*0.2;b.invulnerable=false;this.bossPhase(enemy,2);}
      else if(children.some(e=>e.faced)){
        if(!b.reviveAt)b.reviveAt=b.elapsed+10;
        if(b.elapsed>b.reviveAt){for(const child of children)if(child.faced){child.faced=false;child.fadeT=0;child.hp=child.maxHp*0.5;child.spawnT=0.8;}b.reviveAt=0;}
      }
    }
    if(b.id==='group'){
      const interval=b.phase?8:10,stamp=`call${Math.floor(b.elapsed/interval)}`;
      if(b.elapsed>=interval&&!b.flags.has(stamp)){b.flags.add(stamp);this.summon(enemy,'bother',b.phase?8:6);}
    }
    if(b.id==='table'){
      if(!b.flags.has('chairs')){
        b.flags.add('chairs');const chairs=this.summon(enemy,'gloom',4,'chair',400);
        chairs.forEach((chair,i)=>{chair.x=CX+(i%2===0?-70:70);chair.y=CY+(i<2?-40:46);chair.weight=100;});
      }
      if(b.phase>=1){
        const place=Math.floor(b.elapsed/10)%4;b.safeX=CX+(place%2===0?-70:70);b.safeY=CY+(place<2?-40:46);
        const stamp=`seat${Math.floor(b.elapsed/5)}`;
        if(!b.flags.has(stamp)){b.flags.add(stamp);this.bossPattern(enemy,'empty_seat');}
      }
    }
    if(b.id==='apathy'&&enemy.hp/enemy.maxHp<=0.1&&!b.flags.has('whisper')){
      b.flags.add('whisper');b.qteTime=5;b.qte=0;this.ui.center('그냥 누워 있어. · 공격을 10번 눌러 버텨');
      this.bullets=[];this.zones=[];this.events=[];this.input.attackHeld=false;p.vx=p.vy=0;p.invuln=Math.max(p.invuln,2);
    }
    if(b.id==='apathy'&&b.elapsed>=20){const stamp=`air${Math.floor(b.elapsed/20)}`;if(!b.flags.has(stamp)){b.flags.add(stamp);this.bossPattern(enemy,'air');}}
    if(b.id==='mirror'&&enemy.hp/enemy.maxHp<=0.1&&!b.flags.has('shatter')){b.flags.add('shatter');this.bossPattern(enemy,'shatter');}
    if(b.id==='young'&&enemy.hp/enemy.maxHp<=0.15&&!b.flags.has('notice')){b.flags.add('notice');this.bossPattern(enemy,'notice_me');}
    if(b.qteTime>0){
      b.qteTime-=dt;
      if(b.qteTime>3)p.effects.root=0.1;
      if(b.qte>=10){b.qteTime=0;b.stagger=8;this.ui.center('일어난다. · 8초 그로기');}
      else if(b.qteTime<=0){this.hurtPlayer(enemy.x,enemy.y,40,true);p.effects.stun=3;}
      return;
    }
    if(b.id==='young'&&dist(p.x,p.y,enemy.x,enemy.y)<96&&b.elapsed>b.reviveAt){
      b.reviveAt=b.elapsed+4;const a=angleTo(p.x,p.y,enemy.x,enemy.y);enemy.x=clamp(enemy.x+Math.cos(a)*128,FLOOR.x+30,FLOOR.x+FLOOR.w-30);enemy.y=clamp(enemy.y+Math.sin(a)*128,FLOOR.y+24,FLOOR.y+FLOOR.h-24);
    }
    if(b.invulnerable)return;
    if(enemy.state==='charge'){
      enemy.x+=Math.cos(enemy.a)*270*dt;enemy.y+=Math.sin(enemy.a)*270*dt;
      if(enemy.t<=0){enemy.state='idle';enemy.t=1;}
      return;
    }
    if(enemy.state==='bossAct'&&enemy.t<=0){enemy.state='idle';enemy.t=spec.enrage>0&&b.elapsed>spec.enrage?0.3:rand(0.8,1.5)-b.phase*0.15;return;}
    if(enemy.state==='idle'){
      if(!['door','table','apathy'].includes(b.id)&&dist(enemy.x,enemy.y,p.x,p.y)>100)this.stepToward(enemy,p.x,p.y,18+b.phase*5,dt);
      enemy.a=angleTo(enemy.x,enemy.y,p.x,p.y);
      if(enemy.t<=0){
        const pool=spec.patterns.filter(pattern=>pattern!==b.last&&
          !(b.id==='giant_bother'&&pattern==='split')&&
          !(b.id==='apathy'&&['air','wave'].includes(pattern))&&
          !(b.id==='mirror'&&pattern==='shatter')&&
          !(b.id==='group'&&(pattern==='call'||(phase===0&&pattern==='triple_charge')))&&
          !(b.id==='table'&&pattern==='empty_seat')&&
          !(b.id==='young'&&pattern==='notice_me')&&
          !(b.id==='blanket'&&b.phase===0&&pattern==='triple_cover')&&
          !(b.id==='apathy'&&b.phase===0&&['prison','wave'].includes(pattern))&&
          !(b.id==='door'&&b.phase===0&&pattern==='lock')&&
          !(b.id==='mirror'&&b.phase===0&&['compare','invert','shatter'].includes(pattern))&&
          !(b.id==='merged'&&b.phase<2&&pattern==='photo')&&
          !(b.id==='table'&&b.phase===0&&['empty_seat','silent_meal'].includes(pattern))&&
          !(b.id==='young'&&b.phase===0&&pattern==='copy_spirit')&&
          !(b.id==='young'&&b.phase<2&&['emotion','notice_me'].includes(pattern)));
        // 모든 보스가 가끔 어둠덩이를 던진다 (같은 패턴이 연달아 나오지 않게)
        if(b.last!=='dark_orb'&&Math.random()<(b.main?0.22:0.16))pool.splice(0,pool.length,'dark_orb');
        const selected=pool[Math.floor(Math.random()*pool.length)]??spec.patterns[0]!;
        b.last=selected;this.bossPattern(enemy,selected);
      }
    }
  }

  attackPressed(): void {
    if(this.mode==='embrace'){this.tryEmbrace();return;}
    if(this.mode==='play'&&this.itemInReach()&&this.item){this.takeItem(this.item);return;}
    for(const enemy of this.enemies)if(enemy.boss&&enemy.boss.qteTime>0&&enemy.boss.qteTime<=3)enemy.boss.qte++;
  }

  private beginEmbrace(enemy: Enemy): void {
    if(this.embracing)return;
    this.clearSupers();
    this.embracing=enemy;this.mode='embrace';this.bullets=[];this.zones=[];this.events=[];this.input.attackHeld=false;
    this.player.effects={};this.ui.hideBoss();this.ui.center('다가가서 안아주기 · Space / 왼쪽 버튼');
    for(const other of this.enemies)if(other!==enemy)this.faceEnemy(other,false);
  }

  private tryEmbrace(): void {
    const child=this.embracing;
    if(!child)return;
    if(dist(this.player.x,this.player.y,child.x,child.y)>42){this.ui.center('어린 윤슬 곁으로 다가가 주세요');return;}
    this.startTalk([
      {who:'yunseul',face:'troubled',text:'미안해. 이렇게 오래 혼자 두어서.'},
      {who:'yunseul',face:'smile',text:'네 잘못이 아니야. 이제 같이 가자.'},
      {who:'sena',face:'smile',text:'...그래. 오늘은 같이 밖으로 나가자. 내일은 내일 생각하고.'},
    ],()=>{this.mode='clear';this.showScreen('clear');this.saveCheckpoint();});
  }

  private copySpiritSkill(enemy:Enemy,element:Element,key:SkillKey):void {
    const spec=SKILLS[element][key],p=this.player,angle=angleTo(enemy.x,enemy.y,p.x,p.y);
    const later=(time:number,run:()=>void)=>this.after(time,()=>{if(!enemy.faced&&this.mode==='play')run();});
    const zone=(extra:Partial<Zone>)=>this.addZone({x:enemy.x,y:enemy.y,r:spec.range??80,element,owner:'enemy',warning:1,life:0.25,damage:spec.damage??0,status:spec.status as StatusId|undefined,source:enemy.id,...extra});
    const shot=(a:number)=>{
      if(enemy.effects.blind)return;
      this.fireEnemy(enemy.x,enemy.y-10,a,180,'note',spec.damage??15,true,element);
      const bullet=this.bullets[this.bullets.length-1];if(bullet){bullet.status=spec.status as StatusId|undefined;bullet.statusTime=spec.duration;}
    };
    this.ui.center(`어린 윤슬 · ${spec.name}`);
    if(element==='chaos'){
      if(key==='q'){this.copySpiritSkill(enemy,IMPLEMENTED_ELEMENTS[Math.floor(Math.random()*5)]!,'q');return;}
      if(key==='w'){zone({shape:'line',angle,length:256,width:4,damage:0});later(1,()=>{const x=p.x,y=p.y;p.x=p.tx=enemy.x;p.y=p.ty=enemy.y;enemy.x=x;enemy.y=y;});}
      if(key==='e')later(1,()=>{if(Math.random()<0.5)enemy.t=0;else if(enemy.boss)enemy.boss.stagger=2;});
      if(key==='r')for(let i=0;i<10;i++)later(1+i*0.5,()=>this.copySpiritSkill(enemy,IMPLEMENTED_ELEMENTS[Math.floor(Math.random()*5)]!,(['q','w','e']as const)[Math.floor(Math.random()*3)]!));
      return;
    }
    if(key==='q'&&element!=='wood'){zone({shape:'line',angle,length:spec.range??224,width:3,damage:0});later(1,()=>shot(angle));return;}
    if(element==='water'){
      if(key==='w')later(1,()=>enemy.hp=Math.min(enemy.maxHp,enemy.hp+30));
      if(key==='e')enemy.skillShield=8;
      if(key==='r'){zone({damage:0});later(1,()=>{for(let i=0;i<8;i++)shot(i/8*TAU);});}
    }else if(element==='wood'){
      if(key==='q')zone({shape:'wall',x:clamp(enemy.x+Math.cos(angle)*64,IN_X0,IN_X1),y:clamp(enemy.y+Math.sin(angle)*64,IN_Y0,IN_Y1),width:12,length:96,life:6,damage:0,hp:50});
      if(key==='w')enemy.armor=Math.min(3,(enemy.armor??0)+1);
      if(key==='e')zone({shape:'cone',angle});
      if(key==='r')zone({x:p.x,y:p.y,life:8,effect:'slow'});
    }else if(element==='fire'){
      if(key==='w'){
        zone({shape:'line',angle,length:96,width:8,damage:0});
        later(1,()=>{const x=enemy.x,y=enemy.y;enemy.x=clamp(x+Math.cos(angle)*96,IN_X0,IN_X1);enemy.y=clamp(y+Math.sin(angle)*96,IN_Y0,IN_Y1);for(let i=0;i<10;i++)this.flames.push({x:x+(enemy.x-x)*i/10,y:y+(enemy.y-y)*i/10,t:0,life:2,owner:'enemy',tick:0});});
      }
      if(key==='e')enemy.fireArmor=5;
      if(key==='r')zone({status:'burn'});
    }else if(element==='dark'){
      if(key==='w'){enemy.x=clamp(enemy.x+Math.cos(angle)*192,IN_X0,IN_X1);enemy.y=clamp(enemy.y+Math.sin(angle)*192,IN_Y0,IN_Y1);enemy.stealth=1;}
      if(key==='e')zone({x:p.x,y:p.y,life:4,status:'blind',damage:0});
      if(key==='r'&&p.effects.mark)zone({shape:'screen'});
    }else if(element==='light'){
      if(key==='w'){enemy.hp=Math.min(enemy.maxHp,enemy.hp+15);enemy.healTime=5;}
      if(key==='e'){zone({status:'stun',damage:0});later(1,()=>this.bullets=this.bullets.filter(b=>b.owner!=='player'||dist(b.x,b.y,enemy.x,enemy.y)>96));}
      if(key==='r')zone({life:6,effect:'light'});
    }
  }

  private bossPattern(enemy: Enemy,pattern: string): void {
    const b=enemy.boss!,p=this.player,phase=b.phase;
    const profile=PATTERNS[pattern]!;
    // 2페이즈: 예고·연타 간격은 짧게, 탄은 빠르게
    const haste=this.bossHaste(enemy);
    const later=(time:number,run:()=>void)=>this.after(time/haste,()=>{if(!enemy.faced)run();});
    const gap=enemy.r+RING_GAP;
    // 보스 몸에서 나가는 탄은 몸 바깥 원에서 시작한다. 붙어서 때리는 사람이 까닭 없이 맞지 않게.
    const shoot=(x:number,y:number,a:number,speed:number,style:'tear'|'note'|'ember',damage=15,skill=false,element?:Element)=>{
      const fromBody=Math.hypot(x-enemy.x,y-enemy.y)<24;
      this.fireEnemy(fromBody?x+Math.cos(a)*gap:x,fromBody?y+Math.sin(a)*gap:y,a,speed*(haste>1?1.3:1),style,damage,skill,element);
    };
    b.pattern=pattern;enemy.state='bossAct';enemy.t=2.8;
    this.monsterVfx(enemy,{life:0.8,scale:enemy.spriteId?.startsWith('boss')?1:1.5,alpha:0.85},-14);
    const angle=angleTo(enemy.x,enemy.y,p.x,p.y);
    const circle=(x:number,y:number,r:number,damage:number,warning=profile.warning,status?:StatusId,life=0.25)=>this.addZone({x,y,r,damage:damage>0?(pattern==='mimic'?damage:profile.damage):0,warning,life,status,source:enemy.id});
    // 예고: 탄이 시작될 원을 그린다. 안쪽은 안전하다는 걸 처음 한 번은 세나가 말해준다.
    const warn=()=>{
      this.addZone({shape:'ring',x:enemy.x,y:enemy.y-12,r:gap,width:2,warning:0.8,life:0.15,damage:0,source:enemy.id});
      enemy.flash=0.2;
      if(!this.ringHinted){this.ringHinted=true;this.ui.say('원이 뜨면 안쪽에 붙어. 탄은 거기서 시작돼.','flat');}
    };
    const fan=(count:number,spread:number,damage=profile.damage,delay=profile.warning)=>{
      this.addZone({shape:'cone',x:enemy.x,y:enemy.y,r:210,angle,warning:delay,life:0.15,source:enemy.id});
      later(delay,()=>{if(enemy.faced||enemy.effects.blind)return;for(let i=0;i<count;i++)shoot(enemy.x,enemy.y-15,angle+(i-(count-1)/2)*spread,115,'note',damage,true);});
    };
    const burst=(count:number,waves=1,element:Element=this.stage.element)=>{
      warn();enemy.t=1.5+waves*0.5;
      for(let wave=0;wave<waves;wave++)later(0.8+wave*0.5,()=>{
        if(enemy.faced||enemy.effects.blind)return;
        const offset=angle+wave*Math.PI/count;
        for(let i=1;i<count-1;i++)shoot(enemy.x,enemy.y-12,offset+i/count*TAU,90+phase*10,'note',profile.damage,true,element);
      });
    };
    switch(pattern){
      case 'slash_ring':{
        // 보스 중심에서 원형으로 퍼지는 베기 탄. 2페이즈엔 엇갈린 두 겹.
        warn();this.fx.ring(enemy.x,enemy.y-10,enemy.r+14,0.5);
        const rage=b.flags.has('rage'),waves=rage?2:1,count=rage?16:(profile.count??12),v=118*(rage?1.3:1);
        for(let wave=0;wave<waves;wave++)later(profile.warning+wave*0.4,()=>{
          if(enemy.effects.blind)return;
          const offset=angle+wave*Math.PI/count+Math.random()*0.2;
          for(let i=0;i<count;i++){
            const a=offset+i/count*TAU;
            this.bullets.push({x:enemy.x+Math.cos(a)*gap,y:enemy.y-10+Math.sin(a)*gap,vx:Math.cos(a)*v,vy:Math.sin(a)*v,r:4,life:3.2,damage:profile.damage,owner:'enemy',style:'slash',skill:true});
          }
          this.px.swordSlash(enemy.x,enemy.y+enemy.r*0.6-12,angle+wave*Math.PI,enemy.r+18);
          this.fx.shake(2.5);this.sfx.play('swing');
        });
        enemy.t=1.6+waves*0.4;break;
      }
      case 'dark_orb':{
        // 어둠을 뭉쳐 던진다. 천천히 따라오다 수명이 다하면 파편으로 터진다.
        warn();
        const n=b.flags.has('rage')?5:(profile.count??3);
        for(let i=0;i<n;i++)later(profile.warning+i*0.22,()=>{
          if(enemy.effects.blind)return;
          const a=angleTo(enemy.x,enemy.y-14,p.x,p.y-8)+(i-(n-1)/2)*0.32,v=72*(haste>1?1.3:1);
          this.bullets.push({x:enemy.x,y:enemy.y-14,vx:Math.cos(a)*v,vy:Math.sin(a)*v,r:7,life:2.6,damage:profile.damage,owner:'enemy',style:'dark',skill:true,burst:8,home:0.9});
          this.fx.burst(enemy.x,enemy.y-14,a,6,['#2a1a44','#7a5ee0'],{spread:0.8,speed:70,life:0.3});
        });
        enemy.t=1.4+n*0.22;break;
      }
      case 'roll':case 'triple_charge':{
        const count=pattern==='triple_charge'?3:1;enemy.t=count*1.5+1;
        for(let i=0;i<count;i++)later(i*1.5,()=>{
          if(enemy.faced)return;const a=angleTo(enemy.x,enemy.y,p.x,p.y);
          this.addZone({shape:'line',x:enemy.x,y:enemy.y,angle:a,length:220,width:enemy.r,warning:0.8,life:0.3,damage:20,source:enemy.id});
          later(0.8,()=>{if(!enemy.faced){enemy.a=a;enemy.state='charge';enemy.t=0.45;}});
        });break;
      }
      case 'split':warn();later(0.8,()=>this.summon(enemy,'bother',4));break;
      case 'crush':circle(p.x,p.y,36,25,1,'slow');break;
      case 'weight':case 'damp':case 'silence_pool':{
        for(let i=0;i<(pattern==='damp'?4:3);i++){
          const z=circle(rand(FLOOR.x+55,FLOOR.x+FLOOR.w-55),rand(FLOOR.y+38,FLOOR.y+FLOOR.h-38),pattern==='damp'?50:36,0,1,pattern==='silence_pool'?'silence':undefined,pattern==='damp'?15:6);
          if(pattern!=='silence_pool')z.effect='slow';
          if(pattern==='damp')z.stopEnergy=true;
        }break;
      }
      case 'cover':circle(p.x,p.y,48,25,1.2,'root');break;
      case 'triple_cover':enemy.t=3.5;for(let i=0;i<3;i++)later(i*0.8,()=>circle(p.x,p.y,48,25,0.8,'root'));break;
      case 'pull':case 'notice_me':
        this.addZone({shape:'screen',x:enemy.x,y:enemy.y,warning:1,life:pattern==='pull'?3:4,effect:'pull',source:enemy.id});
        circle(enemy.x,enemy.y,32,15,1,undefined,3);
        if(pattern==='notice_me')burst(16,3,this.equipped[0]?.element??'fire');enemy.t=5;break;
      case 'gap_ring':burst(16,phase?3:1);break;
      case 'hands':for(let i=0;i<(phase?8:5);i++)circle(i===0?p.x:rand(IN_X0,IN_X1),i===0?p.y:rand(IN_Y0,IN_Y1-5),22,20,phase?0.8:1,'slow');break;
      case 'yawn':this.addZone({shape:'cone',x:enemy.x,y:enemy.y,r:192,angle,warning:1.5,life:0.3,damage:30,source:enemy.id});break;
      case 'air':this.addZone({shape:'screen',x:enemy.x,y:enemy.y,warning:1,life:10,effect:'slow',source:enemy.id});break;
      case 'prison':this.addZone({shape:'ring',x:p.x,y:p.y,r:96,width:6,grow:-21,warning:1,life:3,damage:20,effect:'prison',source:enemy.id});break;
      case 'wave':warn();later(0.8,()=>this.summon(enemy,'bother',8,'wave'));break;
      case 'fan':fan(5,0.18);break;
      case 'door_laser':case 'gaze':{
        if(enemy.effects.blind){enemy.t=1;break;}
        const count=pattern==='gaze'?1:phase?5:3;
        for(let i=0;i<count;i++)this.addZone({shape:'line',x:enemy.x,y:enemy.y-12,angle:angle+(i-(count-1)/2)*0.32,width:4,length:400,warning:pattern==='gaze'?1.2:1,life:pattern==='gaze'?1.5:3,damage:pattern==='gaze'?30:25,source:enemy.id,rotate:pattern==='gaze'?0.05:phase?0.3:0.2});
        if(b.id==='door'&&phase)circle(VIEW_W-enemy.x+60,enemy.y,38,0,1);
        enemy.t=4.2;break;
      }
      case 'knock':case 'echo_ring':case 'tantrum':
        for(let i=0;i<3;i++)later(i*0.7,()=>this.addZone({shape:'ring',x:enemy.x,y:enemy.y,r:18,width:5,grow:85,warning:0.8,life:2.5,damage:20,source:enemy.id}));
        if(pattern==='echo_ring')later(2,()=>this.addZone({shape:'ring',x:VIEW_W-enemy.x,y:VIEW_H-enemy.y,r:18,width:5,grow:85,warning:0.8,life:2.5,damage:20,source:enemy.id}));
        enemy.t=4;break;
      case 'luggage':case 'mirror_rain':for(let i=0;i<(pattern==='luggage'?6:12);i++)circle(rand(IN_X0-2,IN_X1+2),rand(IN_Y0,IN_Y1),16,pattern==='luggage'?20:15,1);break;
      case 'lock':case 'alone':case 'read_ignore':case 'silent_meal':
        warn();later(1,()=>{if(pattern==='read_ignore')this.freezeCooldown=3;else p.effects.silence=pattern==='alone'?6:5;if(pattern==='silent_meal')this.fixedForm=5;});break;
      case 'compare':
        warn();later(0.8,()=>{this.summon(enemy,'gloom',2,'decoy',1);enemy.x=clamp(enemy.x+rand(-55,55),IN_X0+20,IN_X1-20);});
        later(5,()=>{for(const decoy of this.enemies)if(decoy.source===enemy.id&&decoy.tag==='decoy')this.faceEnemy(decoy,false);});enemy.t=5.5;break;
      case 'invert':warn();later(1.5,()=>{this.reverseTime=5;this.ui.center('5초간 좌우 반전 · 반대 방향으로 이동');});enemy.t=3;break;
      case 'shatter':burst(20,3);break;
      case 'call':warn();later(0.8,()=>this.summon(enemy,'bother',phase?8:6));break;
      case 'surround':warn();later(0.8,()=>this.summon(enemy,'bother',6,'surround'));break;
      case 'point':fan(3,0.04);break;
      case 'spiral':warn();for(let i=0;i<32;i++)later(0.8+i*0.125,()=>{if(!enemy.faced&&!enemy.effects.blind)shoot(enemy.x,enemy.y-10,angle+i*0.45,90,'note',15,true);});enemy.t=5;break;
      case 'laugh_storm':burst(18,phase>=2?4:2);break;
      case 'back_wall':circle(enemy.x,enemy.y,96,10,1,undefined,6);break;
      case 'push':case 'table_flip':this.addZone({shape:'line',x:enemy.x,y:enemy.y,angle,length:160,width:48,warning:pattern==='table_flip'?1.5:1.2,life:0.25,damage:pattern==='table_flip'?40:25,source:enemy.id});break;
      case 'photo':{
        const safe={x:clamp(enemy.x-Math.cos(angle)*70,IN_X0,IN_X1),y:clamp(enemy.y-Math.sin(angle)*70,IN_Y0,IN_Y1),r:32};
        this.addZone({shape:'screen',x:enemy.x,y:enemy.y,warning:3,life:0.3,damage:50,safe,source:enemy.id});enemy.t=4;this.ui.center('3 · 2 · 1 · 초록색 그림자 뒤로!');break;
      }
      case 'words':fan(5,0.04,15);break;
      case 'echo_clone':warn();later(0.8,()=>this.summon(enemy,'bother',1,'echo',180));break;
      case 'plates':warn();for(let i=0;i<24;i++)later(0.8+i*0.15,()=>{if(!enemy.faced&&!enemy.effects.blind)shoot(enemy.x,enemy.y,angle+i*0.65,85,'note',20,true);});enemy.t=5;break;
      case 'empty_seat':this.addZone({shape:'screen',x:enemy.x,y:enemy.y,warning:1,life:0.2,damage:25,safe:{x:b.safeX||CX-70,y:b.safeY||CY+46,r:32},source:enemy.id});break;
      case 'mimic':
        if(p.form==='bow')fan(1,0,20,0.8);
        else if(p.form==='sword')this.addZone({shape:'cone',x:enemy.x,y:enemy.y,r:72,angle,warning:0.7,life:0.3,damage:25,source:enemy.id});
        else for(let i=0;i<(p.form==='dagger'?3:1);i++)later(i*0.3,()=>circle(p.x,p.y,32,p.form==='dagger'?10:15,0.6));break;
      case 'copy_spirit':{
        const element=this.equipped[Math.floor(Math.random()*Math.max(1,this.equipped.length))]?.element??'fire';
        this.copySpiritSkill(enemy,element,(['q','w','e']as const)[Math.floor(Math.random()*3)]!);break;
      }
      case 'emotion':for(let i=0;i<3;i++)later(i*0.7,()=>burst(18,1,this.equipped[i%Math.max(1,this.equipped.length)]?.element??'fire'));enemy.t=4;break;
    }
  }

  /** 보스 2페이즈(분노)면 1.4배 빠르게 */
  private bossHaste(e: Enemy): number {
    return e.boss?.flags.has('rage') ? 1.4 : 1;
  }

  private enrageBoss(enemy: Enemy): void {
    const b=enemy.boss!;b.flags.add('rage');
    this.ui.center(BOSSES[b.id].name+' · 2페이즈 · 모든 공격이 빨라진다');
    this.fx.shake(6);
    for(let i=0;i<3;i++)this.fx.ring(enemy.x,enemy.y-10,40+i*36,0.4+i*0.15);
    this.fx.burst(enemy.x,enemy.y-10,0,36,['#140c2c','#4a2f8a','#b88aff'],{spread:Math.PI,speed:200,life:0.7,drag:3,size:2,glow:true});
    this.sfx.play('hitBig');
  }

  /** 중간 보스의 '밟으면 아픈 바닥'. 예고 뒤 몇 초간 남아 1초마다 피해. 피가 적을수록 넓고 오래. */
  private spawnHazards(enemy: Enemy,count: number,lost: number): void {
    const p=this.player,profile=PATTERNS.hazard!;
    for(let i=0;i<count;i++){
      // 첫 장은 윤슬 발밑 근처, 나머지는 방 여기저기
      const near=i===0||Math.random()<0.35;
      const x=near?clamp(p.x+rand(-26,26),FLOOR.x+24,FLOOR.x+FLOOR.w-24):rand(FLOOR.x+30,FLOOR.x+FLOOR.w-30);
      const y=near?clamp(p.y+rand(-18,18),FLOOR.y+20,FLOOR.y+FLOOR.h-20):rand(FLOOR.y+24,FLOOR.y+FLOOR.h-24);
      this.addZone({x,y,r:20+lost*10,damage:profile.damage,warning:profile.warning,life:3.5+lost*2.5,source:enemy.id,look:'hazard'});
    }
  }

  private fireEnemy(x: number, y: number, a: number, speed: number, style: 'tear' | 'note' | 'ember', damage=15, skill=false,element?:Element): void {
    this.bullets.push({
      x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      r: style === 'tear' ? 3 : 3.5, life: 6, damage, owner: 'enemy', style,skill,element,
    });
  }

  private updateBullets(dt: number): void {
    const p = this.player;
    const keep: Bullet[] = [];
    const shards: Bullet[] = [];
    for (const b of this.bullets) {
      if (b.home && b.owner === 'enemy') {
        const want = angleTo(b.x, b.y, p.x, p.y - 8), cur = Math.atan2(b.vy, b.vx), sp = Math.hypot(b.vx, b.vy);
        const turn = clamp(angleDiff(want, cur), -b.home * dt, b.home * dt);
        b.vx = Math.cos(cur + turn) * sp; b.vy = Math.sin(cur + turn) * sp;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      let alive = b.life > 0;
      if (!alive && b.burst) {
        // 어둠덩이가 터진다
        for (let i = 0; i < b.burst; i++) {
          const a = i / b.burst * TAU + b.x * 0.1;
          shards.push({ x: b.x, y: b.y, vx: Math.cos(a) * 96, vy: Math.sin(a) * 96, r: 3, life: 2, damage: Math.round(b.damage * 0.6), owner: 'enemy', style: 'note', skill: true });
        }
        this.fx.burst(b.x, b.y, 0, 16, ['#140c2c', '#4a2f8a', '#b88aff'], { spread: Math.PI, speed: 110, life: 0.4, glow: true });
        this.fx.ring(b.x, b.y, 18, 0.3);
      }
      if (b.fx) {
        b.fx.options.x = b.x;
        b.fx.options.y = b.y;
      }

      const out = b.x < FLOOR.x || b.x > FLOOR.x + FLOOR.w || b.y < FLOOR.y - 20 || b.y > FLOOR.y + FLOOR.h;
      if (alive && out) {
        const mirror=this.enemies.some(enemy=>enemy.boss?.id==='mirror'&&enemy.boss.phase>=2&&!enemy.faced);
        if(b.owner==='player'&&mirror&&!b.bounced){
          b.bounced=true;
          if(b.x<FLOOR.x||b.x>FLOOR.x+FLOOR.w)b.vx*=-1;
          if(b.y<FLOOR.y||b.y>FLOOR.y+FLOOR.h)b.vy*=-1;
          b.x=clamp(b.x,FLOOR.x+1,FLOOR.x+FLOOR.w-1);b.y=clamp(b.y,FLOOR.y+1,FLOOR.y+FLOOR.h-1);
        }else alive = false;
        const hot = b.style === 'fire' || b.style === 'ember';
        const color = hot ? COLOR.fire : b.owner === 'player' ? COLOR.senaShade : COLOR.inkRim;
        this.fx.burst(b.x, b.y, Math.atan2(-b.vy, -b.vx), 4, [color], { spread: 1.5, speed: 60, life: 0.22 });
      }
      if(alive&&this.zones.some(zone=>zone.shape==='wall'&&contains(zone,b.x,b.y)))alive=false;

      if (alive && b.owner === 'player') {
        for (const e of this.activeEnemies()) {
          if(b.hit?.has(e.id))continue;
          if (dist(b.x, b.y, e.x, e.y - e.r * 0.6) > e.r + b.r) continue;
          const a = Math.atan2(b.vy, b.vx);
          if(e.boss&&['mirror','great_shard'].includes(e.boss.id)&&Math.abs(angleDiff(a+Math.PI,e.a))<(e.boss.id==='mirror'?Math.PI/2:Math.PI/3)){
            b.owner='enemy';b.vx*=-1;b.vy*=-1;b.damage=15;b.skill=true;b.hit?.clear();break;
          }
          b.hit?.add(e.id);
          if (b.style === 'fire' || b.style === 'bubble' || b.style === 'shadow') {
            const el = b.element ?? 'fire';
            this.hitEnemy(e, b.damage, a, b.knock ?? 120, true, el);
            if(b.status)this.applyStatus(e,b.status,b.statusTime??3);
            const colors = el === 'fire' ? [COLOR.fireHot, COLOR.fire, COLOR.fireDeep] : el === 'water' ? ['#c8e8ff', '#5eb0ff', '#1e4a7a'] : el === 'dark' ? ['#b88aff', '#3c2452', '#140c2c'] : [ELEMENT[el].glow, COLOR.white];
            this.fx.burst(b.x, b.y, a, 10, colors, { spread: 2, speed: 140, life: 0.4, size: 2 });
            if (b.explode) {
              // 불씨 탄이 터진다: 주변 그늘에도 피해 + 화상
              this.px.fireRing(b.x, b.y + 6, b.explode);
              this.playVfx('fx_fire_bow_sm', b.x, b.y, { life: 0.3, scale: 1.3 });
              for (const o of this.activeEnemies()) if (o !== e && dist(o.x, o.y, b.x, b.y) < b.explode + o.r) { this.hitEnemy(o, b.damage * 0.6, angleTo(b.x, b.y, o.x, o.y), 90, true, 'fire'); this.applyStatus(o, 'burn', 3); }
            }
            this.sfx.play('fireHit');
            this.hitstop = Math.max(this.hitstop, 0.05);
            this.fx.shake(b.style === 'bubble' ? 3.5 : 2.5);
          } else {
            this.hitEnemy(e, b.damage, a, FORMS.bow.knockback);
            this.sfx.play('arrowHit');
            this.hitstop = Math.max(this.hitstop, FORMS.bow.hitstop);
            this.fx.shake(FORMS.bow.shake);
          }
          alive = Boolean(b.pierce);
          break;
        }
      }

      if (alive && b.owner === 'enemy' && dist(b.x, b.y, p.x, p.y - 8) < p.r + b.r - 1) {
        const hit=this.hurtPlayer(b.x, b.y,b.damage,b.skill);
        if(hit&&b.status)p.effects[b.status]=b.statusTime??3;
        alive = false;
      }

      if (alive) keep.push(b);
      else b.fx?.stop();
    }
    this.bullets = keep.concat(shards);
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
    this.drawZones();
    this.drawMarks();
    this.drawDoors();
    if (this.room.kind === 'home') drawEntranceGlow(ctx, this.clock);
    this.fx.drawGround(ctx);
    this.drawRelic();
    this.drawItem();
    this.drawTelegraphs();
    this.drawTargetMarks();
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
      if (this.senaShowT > 0) list.push({ y: p.y - 0.25, draw: () => this.drawSenaHuman() });
    }
    list.sort((a, b) => a.y - b.y);
    for (const item of list) item.draw();

    for (const o of this.orbs) this.drawOrb(o);
    for (const b of this.bullets) this.drawBullet(b);
    this.px.draw(ctx);
    this.fx.draw(ctx);
    ctx.restore();

    this.drawLighting([sx, sy]);
    for (const s of this.supers) drawSuperFx(ctx, s, sx, sy);
    this.drawVfx(sx, sy);
    this.fx.drawMotes(ctx);
    this.drawGlowPass([sx, sy]);
    this.fx.drawOverlay(ctx);
    this.drawHud();
    if (this.cut) drawCutIn(ctx, this.cut);
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
    const submerged=this.enemies.some(enemy=>enemy.boss?.id==='apathy'&&enemy.boss.phase>=2&&!enemy.faced);
    lc.fillStyle = `rgba(3, 4, 7, ${(submerged?0.78:0.42) + hurt})`;
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
        cut(p.x + ox, p.y - 6 + oy, submerged?128:150, 0.95);
      }
      for (const e of this.enemies) {
        if (e.kind === 'alarm' && !e.faced) cut(e.x + ox, e.y - 18 + oy, 50, 0.3);
      }
      for (const b of this.bullets) cut(b.x + ox, b.y + oy, b.style === 'fire' ? 40 : 14, b.style === 'fire' ? 0.8 : 0.5);
      for (const f of this.flames) cut(f.x + ox, f.y - 3 + oy, 22, 0.35 * (1 - f.t / f.life));
      const s = this.spirit;
      if (s && s.state !== 'hidden') cut(s.x + ox, s.y + oy, 60, 0.7);
      if (this.player.fireArmor > 0) cut(this.player.x + ox, this.player.y - 8 + oy, 70, 0.6);
      for (const o of this.orbs) cut(o.x + ox, o.y + oy, 12, 0.5);
      if (this.relic) cut(this.relic.x + ox, this.relic.y + oy, 70 * clamp(this.relic.t / 1.5, 0, 1), 0.6);
      if (this.item) cut(this.item.x + ox, this.item.y + oy, 26, 0.7);
      if (this.room.kind === 'spirit') {
        cut(CX + ox, CY + oy, 115, 0.6);
        for (const b of SPIRIT_BRAZIERS) cut(b.x + ox, b.y - 14 + oy, 44, 0.75);
      }
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
    if (this.room.kind === 'spirit') {
      put(COLOR.fire, CX, CY + 10, 76, 0.12);
      for (const b of SPIRIT_BRAZIERS) put(COLOR.fire, b.x, b.y - 14, 26, 0.3 + Math.sin(this.clock * 5 + b.x) * 0.05);
    }
    if (this.player.fireArmor > 0) put(COLOR.fire, this.player.x, this.player.y - 8, 26, 0.3);
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
    const spiritRoom = room.kind === 'spirit';
    const chapter=CHAPTERS[this.stage.chapter-1]!;

    // 벽 윗면 (전체)
    g.fillStyle = COLOR.capTop;
    g.fillRect(0, 0, VIEW_W, VIEW_H);

    // 바닥: 낮은 대비의 마루 결
    g.fillStyle = spiritRoom ? ELEMENT[this.stage.element].wall : chapter.floor;
    g.fillRect(FLOOR.x, FLOOR.y, FLOOR.w, FLOOR.h);
    const rowHeight = spiritRoom ? 16 : 10;
    g.fillStyle = spiritRoom ? ELEMENT[this.stage.element].wallLine : chapter.line;
    for (let y = FLOOR.y + rowHeight; y < FLOOR.y + FLOOR.h; y += rowHeight) g.fillRect(FLOOR.x, y, FLOOR.w, 1);
    for (let row = 0; row < FLOOR.h / rowHeight; row += 1) {
      const y = FLOOR.y + row * rowHeight;
      let x = FLOOR.x + Math.floor(rnd() * 60);
      if (spiritRoom) x = FLOOR.x + (row % 2) * 16;
      while (x < FLOOR.x + FLOOR.w) {
        g.fillRect(x, y, 1, rowHeight);
        x += spiritRoom ? 32 : 56 + Math.floor(rnd() * 60);
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
    g.fillStyle = elem ? elem.wall : chapter.wall;
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
    const propCount = spiritRoom ? 0 : 2 + Math.floor(rnd() * 2);
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

    if (spiritRoom) {
      // 제단을 둘러싼 이중 문장과 방 전체에 반복되는 불꽃 문양.
      for (const radius of [70, 88]) {
        for (let i = 0; i < 80; i += 1) {
          const a = i / 80 * TAU;
          const b = (i + 1) / 80 * TAU;
          pixelLine(g, CX + Math.cos(a) * radius, CY + 10 + Math.sin(a) * radius * 0.46,
            CX + Math.cos(b) * radius, CY + 10 + Math.sin(b) * radius * 0.46, ELEMENT[this.stage.element].door);
        }
      }
      for (let i = 0; i < 8; i += 1) {
        const a = i / 8 * TAU;
        pixelLine(g, CX + Math.cos(a) * 60, CY + 10 + Math.sin(a) * 28,
          CX + Math.cos(a) * 88, CY + 10 + Math.sin(a) * 40, '#c4874d');
        g.drawImage(this.stage.element==='fire'?SPRITES.spiritRune:tint(SPRITES.spiritRune,ELEMENT[this.stage.element].glow), Math.round(CX + Math.cos(a) * 108 - 4), Math.round(CY + 10 + Math.sin(a) * 59 - 6));
      }
      for (const b of SPIRIT_BRAZIERS) {
        pixelEllipse(g, b.x, b.y + 1, 10, 3, '#160d15');
        g.drawImage(SPRITES.brazier, b.x - 7, b.y - SPRITES.brazier.height);
      }
      for (let x = FLOOR.x + 44; x < FLOOR.x + FLOOR.w - 20; x += 72) {
        if (x > win.x - 12 && x < win.x + win.w + 12) continue;
        g.drawImage(SPRITES.spiritRune, x, WALL_CAP + 8);
      }
    }

    if(room.kind==='rest'){
      g.fillStyle='#493c3d';g.fillRect(CX-30,CY-18,60,38);g.fillStyle='#8a8b93';g.fillRect(CX-26,CY-14,52,10);g.fillStyle='#4c6073';g.fillRect(CX-26,CY-2,52,18);g.fillStyle='#738ba0';g.fillRect(CX-26,CY-2,52,2);
    }else if(room.kind==='shop'){
      g.fillStyle='#59402c';g.fillRect(CX-35,CY-14,70,30);g.fillStyle='#a68150';g.fillRect(CX-35,CY-14,70,5);g.drawImage(SPRITES.props.cup,CX-16,CY-20);g.drawImage(SPRITES.props.books,CX+10,CY-23);
    }else if(room.kind==='memory'){
      g.fillStyle='#4c4357';g.fillRect(CX-32,CY-24,64,48);g.fillStyle='#16131c';g.fillRect(CX-28,CY-20,56,40);g.fillStyle='#8e8095';g.fillRect(CX-11,CY-12,22,24);g.fillStyle='#302c37';g.fillRect(CX-8,CY-9,16,21);
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
      if (spiritDoor) {
        if (dir === 'n' || dir === 's') {
          const y = dir === 'n' ? r.y + 4 : r.y - 12;
          g.drawImage(SPRITES.spiritRune, r.x - 17, y);
          g.drawImage(SPRITES.spiritRune, r.x + r.w + 8, y);
        } else {
          g.drawImage(SPRITES.spiritRune, r.x + 3, r.y - 18);
          g.drawImage(SPRITES.spiritRune, r.x + 3, r.y + r.h + 6);
        }
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
  /** 발밑 점선 고리: 공격 지시는 강조색, 정보를 연 적은 옅은 색 */
  private drawTargetMarks(): void {
    if (this.mode !== 'play') return;
    const ring = (e: Enemy, color: string): void => {
      const rx = e.r + 4, ry = Math.max(4, rx * 0.36), steps = Math.round(rx * 1.5);
      for (let i = 0; i < steps; i += 1) {
        const t = (i / steps) * Math.PI * 2;
        plot(this.ctx, e.x + Math.cos(t) * rx, e.y + e.r * 0.6 + Math.sin(t) * ry, color);
      }
    };
    if (this.inspected && this.inspected !== this.attackOrder) ring(this.inspected, COLOR.dim);
    if (this.attackOrder) ring(this.attackOrder, '#e0a458');
    const aim = this.aimPreview;
    if (aim) {
      const p = this.player, color = aim.cancel ? COLOR.dim : '#e0a458', steps = Math.max(1, Math.floor(dist(p.x, p.y, aim.x, aim.y) / 5));
      for (let i = 1; i <= steps; i += 1) plot(this.ctx, p.x + (aim.x - p.x) * i / steps, p.y + (aim.y - p.y) * i / steps, color);
      for (let i = 0; i < 20; i += 1) plot(this.ctx, aim.x + Math.cos(i / 20 * TAU) * 9, aim.y + Math.sin(i / 20 * TAU) * 5, color);
    }
  }

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
    // ponytail: 원본은 정적 콘셉트 1장이다. 전용 프레임이 생기면 이 변형 대신 상태별 시트를 사용한다.
    const base = this.spriteOf(e);
    const lift = e.kind === 'gloom'&&e.tag!=='chair' ? 8 + Math.sin(this.clock * 3 + e.id) * 2 : 0;
    const breathe = e.kind === 'gloom' ? 0 : Math.sin(this.clock * 2.4 + e.id) * 0.03;
    const foot = e.y + e.r * 0.6 - lift;

    if (e.spawnT > 0) {
      const k = 1 - e.spawnT / e.spawnMax;
      pixelEllipse(this.ctx, e.x, e.y + e.r * 0.6, e.r * 1.3 * k, 3, COLOR.ink);
      const spawnSheet = ANIMS.get(this.spriteIdOf(e) ?? '');
      const spawnAt = spawnSheet?.atProgress('spawn', k);
      if (spawnSheet && spawnAt) {
        const sz = e.tag === 'blanket' || e.tag === 'decoy' ? 0.5 : e.boss && !BOSSES[e.boss.id].asset ? 1.8 : 1;
        spawnSheet.draw(this.ctx, spawnAt.frame, e.x, foot, { sx: sz * (e.boss?.scale ?? 1), sy: sz });
        return;
      }
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
      const dieSheet = ANIMS.get(this.spriteIdOf(e) ?? '');
      const dieAt = dieSheet?.atProgress('die', k);
      if (dieSheet && dieAt) {
        const sz = e.tag === 'blanket' || e.tag === 'decoy' ? 0.5 : e.boss && !BOSSES[e.boss.id].asset ? 1.8 : 1;
        dieSheet.draw(this.ctx, dieAt.frame, e.x, foot, { sx: sz, sy: sz });
        return;
      }
      this.blit(base, e.x, foot, { alpha: 1 - k, sy: 1 - k * 0.6, sx: 1 + k * 0.2 });
      return;
    }

    const size=e.tag==='blanket'||e.tag==='decoy'?0.5:e.boss&&!BOSSES[e.boss.id].asset?1.8:1;
    const sheet = ANIMS.get(this.spriteIdOf(e) ?? '');
    if (sheet) { this.drawEnemySheet(e, sheet, base, size, foot); return; }
    let sxs = size*(1 + e.squash * 0.24 - breathe)*(e.boss?.scale??1);
    let sys = size*(1 - e.squash * 0.2 + breathe);
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
    this.blit(base, e.x + ox, foot, { sx: sxs, sy: sys, flip,alpha:e.tag==='decoy'?(Math.floor(this.clock*4)%2?0.35:0.9):e.stealth?0.25:e.boss?.invulnerable?0.55:1 });
    if(e.boss?.id==='door'){this.ctx.fillStyle='#ffe7a0';this.ctx.fillRect(Math.round(e.x+8),Math.round(foot-base.height/2),2,2);}
    if(e.boss&&e.state==='bossAct'&&this.zones.some(z=>z.source===e.id&&z.age<z.warning)&&Math.floor(this.clock*8)%2===0)this.blit(tint(base,COLOR.pale),e.x+ox,foot,{sx:sxs,sy:sys,flip,alpha:0.22});
    if(e.effects.stun){plot(this.ctx,e.x-4,foot-base.height-3,COLOR.fireHot);plot(this.ctx,e.x+4,foot-base.height-5,COLOR.fireHot);}
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

    this.drawShield();
    if (p.invuln > 0 && p.hurtT <= 0 && Math.floor(p.invuln * 16) % 2 === 0) return;

    const frame = this.walkFrame();
    const spr = SPRITES.yunseul[frame as 0 | 1 | 2 | 3];
    const bob = frame === 1 || frame === 3 ? -1 : 0;
    const behind = Math.sin(this.weaponAngle()) < -0.35;
    if (behind) this.drawWeapon();
    const sheet = ANIMS.get('yunseul');
    let at: ReturnType<NonNullable<typeof sheet>['at']> = null;
    if (sheet) {
      if (p.hurtT > 0) at = sheet.at('hurt', 0.14 - p.hurtT);
      else if (p.swingT > 0) at = sheet.atProgress('attack', 1 - p.swingT / p.swingDur);
      else if (this.clock - this.castAt < sheet.length('cast')) at = sheet.at('cast', this.clock - this.castAt);
      else if (p.moving && p.lungeT <= 0) at = sheet.at('walk', p.walkT);
      else at = sheet.at('idle', this.clock);
    }
    if (sheet && at) sheet.draw(this.ctx, at.frame, p.x, foot, { flip: p.facing < 0 });
    else this.blit(p.hurtT > 0 ? tint(spr, COLOR.white) : spr, p.x, foot + bob, { flip: p.facing < 0 });
    if (!behind) this.drawWeapon();
  }

  private drawShield(): void {
    const p = this.player, ctx = this.ctx;
    if (p.skillShield > 0) {
      // 물의 막: 몸을 감싼 물방울 (끝나갈 때 깜빡)
      if (p.skillShield > 1.5 || Math.floor(p.skillShield * 8) % 2 === 0) {
        const cx = p.x, cy = p.y - 9, steps = 44;
        for (let i = 0; i < steps; i++) {
          const a = (i / steps) * TAU + this.clock;
          ctx.fillStyle = i % 5 === 0 ? '#c8e8ff' : '#5eb0ff';
          if (i % 3 !== 2) ctx.fillRect(Math.round(cx + Math.cos(a) * 12), Math.round(cy + Math.sin(a) * 14), 1, 1);
        }
      }
    }
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
  /** 무기에서 풀려난 세나가 윤슬 곁에 잠깐 서 있다. 다시 휘두르면 손으로 돌아간다. */
  private drawSenaHuman(): void {
    const art = ART.get('sena_human_sm'), p = this.player;
    if (!art) return;
    const alpha = this.senaShowT > 0.3 ? 1 : Math.ceil(this.senaShowT / 0.1) / 3;
    this.blit(art, p.x - p.facing * 16, p.y + 4 + Math.round(Math.sin(this.clock * 3)), { flip: p.facing < 0, alpha });
  }

  private drawWeapon(): void {
    const p = this.player;
    if (this.senaShowT > 0 && p.swingT <= 0) return;
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
  /** 이 적의 그림(시트) id. 코드로 그린 대체 그림이면 null. */
  private spriteIdOf(e: Enemy): string | null {
    if (e.tag === 'chair') return null;
    if (e.spriteId && ART.has(e.spriteId)) return e.spriteId;
    if (e.kind !== 'alarm') {
      const asset = CHAPTERS[this.stage.chapter - 1]!.enemies[e.kind === 'bother' ? 0 : e.kind === 'heavy' ? 1 : 2];
      if (ART.has(asset)) return asset;
    }
    return null;
  }

  /** 같은 동작이 이어지는 동안 흐른 시간. 동작이 바뀌면 0부터. */
  private animTime(key: number, tag: string): number {
    const cur = this.animTags.get(key);
    if (!cur || cur.tag !== tag) { this.animTags.set(key, { tag, start: this.clock }); return 0; }
    return this.clock - cur.start;
  }

  /** 상태에 맞는 시트 동작(idle/move/attack/hurt)을 재생한다 */
  private drawEnemySheet(e: Enemy, sheet: NonNullable<ReturnType<typeof ANIMS.get>>, base: Sprite, size: number, foot: number): void {
    const attacking = (e.kind === 'heavy' && (e.state === 'wind' || e.state === 'slam')) || (e.kind === 'gloom' && e.state === 'aim')
      || (e.boss !== undefined && ['bossAct', 'charge', 'chargeTele', 'ring', 'ringTele', 'snoozeTele'].includes(e.state));
    let tag = e.flash > 0 || e.effects.stun || e.state === 'stun' ? 'hurt' : attacking ? 'attack' : e.state === 'move' || e.state === 'chase' ? 'move' : 'idle';
    let t = this.animTime(e.id, tag);
    let at = sheet.at(tag, t + (tag === 'idle' ? e.id * 0.13 : 0));
    // 한 번 재생하는 동작이 끝나면 숨 쉬는 자세로 돌아간다 (기절 중 피격 자세는 마지막 프레임 유지)
    if (at?.done && tag === 'attack') { tag = 'idle'; at = sheet.at('idle', t + e.id * 0.13); }
    if (!at) return;
    let ox = 0;
    if (e.kind === 'heavy' && e.state === 'wind') ox = Math.round(Math.sin(this.clock * 60));
    if (e.kind === 'alarm' && (e.state === 'ringTele' || e.state === 'snoozeTele' || e.state === 'ring')) ox = Math.round(rand(-1.5, 1.5));
    const flip = e.kind !== 'alarm' && this.player.x < e.x;
    const sx = size * (e.boss?.scale ?? 1), sy = size;
    const alpha = e.tag === 'decoy' ? (Math.floor(this.clock * 4) % 2 ? 0.35 : 0.9) : e.stealth ? 0.25 : e.boss?.invulnerable ? 0.55 : 1;
    sheet.draw(this.ctx, at.frame, e.x + ox, foot, { sx, sy, flip, alpha });
    if (e.boss?.id === 'door') { this.ctx.fillStyle = '#ffe7a0'; this.ctx.fillRect(Math.round(e.x + 8), Math.round(foot - base.height / 2), 2, 2); }
    if (e.boss && e.state === 'bossAct' && this.zones.some(z => z.source === e.id && z.age < z.warning) && Math.floor(this.clock * 8) % 2 === 0) {
      sheet.draw(this.ctx, at.frame, e.x + ox, foot, { sx, sy, flip, alpha: 0.22, tint: COLOR.pale });
    }
    if (e.effects.stun) { plot(this.ctx, e.x - 4, foot - base.height - 3, COLOR.fireHot); plot(this.ctx, e.x + 4, foot - base.height - 5, COLOR.fireHot); }
    const telegraph = (e.kind === 'gloom' && e.state === 'aim') || (e.kind === 'alarm' && e.state === 'chargeTele') || (e.kind === 'heavy' && e.state === 'wind');
    if (telegraph && Math.floor(this.clock * 14) % 2 === 0) sheet.draw(this.ctx, at.frame, e.x + ox, foot, { sx, sy, flip, alpha: 0.35, tint: COLOR.pale });
  }

  private spriteOf(e: Enemy): Sprite {
    if(e.tag==='chair')return SPRITES.chair;
    if(e.spriteId&&ART.has(e.spriteId))return ART.get(e.spriteId)!;
    if(e.kind!=='alarm'){
      const chapter=CHAPTERS[this.stage.chapter-1]!;
      const asset=chapter.enemies[e.kind==='bother'?0:e.kind==='heavy'?1:2];
      if(ART.has(asset))return ART.get(asset)!;
    }
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
    pixelEllipse(ctx, x, y + 3, 24, 8, '#160d15');
    ctx.fillStyle = '#50313c';
    ctx.fillRect(x - 20, y - 3, 40, 9);
    ctx.fillStyle = '#94604f';
    ctx.fillRect(x - 17, y - 7, 34, 6);
    ctx.fillStyle = '#d39a62';
    ctx.fillRect(x - 17, y - 7, 34, 1);
    ctx.drawImage(SPRITES.spiritRune, x - 4, y - 19);
    ctx.globalAlpha = 0.6 + Math.sin(this.clock * 3) * 0.2;
    for (let i = 0; i < 16; i += 1) {
      const a = (i / 16) * TAU + this.clock * 0.6;
      plot(ctx, x + Math.cos(a) * 23, y - 4 + Math.sin(a) * 8, col.glow);
    }
    for (let i = 0; i < 14; i += 1) {
      const rise = (this.clock * 12 + i * 11) % 55;
      plot(ctx, x + Math.sin(i * 2.4) * 80 + Math.sin(this.clock + i) * 3, y + 18 - rise, i % 3 === 0 ? COLOR.fireHot : COLOR.fire);
    }
    ctx.globalAlpha = 1;
  }

  private drawSpirit(s: Spirit): void {
    const frame = Math.floor(this.clock * 5) % 2 === 0 ? 0 : 1;
    const element=s.state==='following'?(this.equipped[this.activeSpirit]?.element??this.stage.element):this.stage.element;
    // 등급이 오르면 진화체로 (중급·상급). 이름은 기획서 미정이라 그림만 바꾼다.
    const tier=s.state==='following'?(this.equipped[this.activeSpirit]?.tier??1):1;
    const evolved=tier>=3?ART.get(`evo_${element}_upper`):tier===2?ART.get(`evo_${element}_medium`):undefined;
    const spr = evolved??ART.get(SPIRIT_ASSETS[element])??SPRITES.fireSpirit[frame];
    const sheetId = tier >= 3 ? `evo_${element}_upper` : tier === 2 ? `evo_${element}_medium` : SPIRIT_ASSETS[element];
    const sheet = ANIMS.get(sheetId);
    if (sheet) {
      const casting = this.clock - this.spiritCastAt < sheet.length('cast');
      const tagName = casting ? 'cast' : s.state === 'waiting' && s.t < sheet.length('spawn') ? 'spawn' : 'idle';
      const at = tagName === 'cast' ? sheet.at('cast', this.clock - this.spiritCastAt) : tagName === 'spawn' ? sheet.at('spawn', s.t) : sheet.at('idle', this.clock + 0.3);
      if (at) {
        const sbob = s.state === 'waiting' ? Math.sin(this.clock * 2.5) * 2 : 0;
        if (s.state === 'waiting') pixelEllipse(this.ctx, s.x, s.y + 20, 5, 1.5, COLOR.shadow);
        sheet.draw(this.ctx, at.frame, s.x, s.y + 8 + sbob, { flip: s.state === 'following' && this.player.facing < 0 });
        return;
      }
    }
    const bob = s.state === 'waiting' ? Math.sin(this.clock * 2.5) * 2 : 0;
    const appear = s.state === 'waiting' ? clamp(s.t / 0.8, 0, 1) : 1;
    if (s.state === 'waiting') pixelEllipse(this.ctx, s.x, s.y + 20, 5 * appear, 1.5, COLOR.shadow);
    const flip = s.state === 'following' && this.player.facing < 0;
    this.blit(spr, s.x, s.y + 8 + bob, { alpha: appear, sy: 0.6 + appear * 0.4, flip });
  }

  private drawBullet(b: Bullet): void {
    const ctx = this.ctx;
    const loop = b.art ? ANIMS.get(b.art) : undefined;
    const loopFrame = loop?.at('loop', this.clock + b.x * 0.01);
    if (loop && loopFrame) {
      ctx.save();
      ctx.translate(Math.round(b.x), Math.round(b.y));
      ctx.rotate(Math.atan2(b.vy, b.vx));
      loop.draw(ctx, loopFrame.frame, -Math.round(loop.cellW * 0.16 * (b.artScale ?? 1)), 0, { sx: b.artScale ?? 1, sy: b.artScale ?? 1 });
      ctx.restore();
      return;
    }
    const art = b.art ? ART.get(b.art) : undefined;
    if (art) {
      ctx.save();
      ctx.translate(Math.round(b.x), Math.round(b.y));
      ctx.rotate(Math.atan2(b.vy, b.vx));
      ctx.scale(b.artScale ?? 1, b.artScale ?? 1);
      ctx.drawImage(art, -Math.round(art.width * 0.7), -Math.round(art.height / 2));
      ctx.restore();
      return;
    }
    if (b.style === 'slash') {
      // 진행 방향을 향한 작은 초승달 (흰 날 + 붉은 그림자)
      const a = Math.atan2(b.vy, b.vx);
      pixelArc(ctx, b.x - Math.cos(a) * 4, b.y - Math.sin(a) * 4, 6, a - 1.15, a + 1.15, 1, '#e06467');
      pixelArc(ctx, b.x - Math.cos(a) * 3, b.y - Math.sin(a) * 3, 5, a - 0.95, a + 0.95, 1, '#ffffff');
      return;
    }
    if (b.style === 'dark') {
      // 어둠덩이: 검보라 몸 + 보라 테두리 + 꿈틀거리는 꼬리. 터지기 직전엔 깜빡인다.
      const x = Math.round(b.x), y = Math.round(b.y);
      const blink = b.life < 0.5 && Math.floor(b.life * 16) % 2 === 0;
      for (let i = 3; i >= 1; i--) {
        const tx = Math.round(b.x - b.vx * 0.035 * i + Math.sin(this.clock * 12 + i) * 1.5), ty = Math.round(b.y - b.vy * 0.035 * i);
        ctx.fillStyle = i === 1 ? '#4a2f8a' : '#2a1a44';
        ctx.fillRect(tx - (5 - i), ty - (5 - i), (5 - i) * 2, (5 - i) * 2);
      }
      pixelEllipse(ctx, x, y, 8, 8, blink ? '#e8e2ff' : '#7a5ee0');
      pixelEllipse(ctx, x, y, 7, 7, '#140c2c');
      pixelEllipse(ctx, x - 2, y - 2, 3, 3, '#2a1a44');
      ctx.fillStyle = '#b88aff';
      ctx.fillRect(x - 3, y - 4, 2, 1);
      return;
    }
    if (b.style === 'bubble') {
      // 물방울: 속이 비친 고리 + 하이라이트
      const x = Math.round(b.x), y = Math.round(b.y), wob = Math.sin(this.clock * 18 + b.x) > 0 ? 1 : 0;
      pixelEllipse(ctx, x, y, b.r + wob, b.r - wob, '#5eb0ff');
      pixelEllipse(ctx, x, y, b.r - 1 + wob, b.r - 1 - wob, '#1e3a66');
      ctx.fillStyle = '#c8e8ff'; ctx.fillRect(x - 2, y - 3, 2, 1); ctx.fillRect(x - 3, y - 2, 1, 2);
      return;
    }
    if (b.style === 'shadow') {
      // 그림자 단도: 검보라 칼날 + 꼬리
      const a = Math.atan2(b.vy, b.vx), c = Math.cos(a), sn = Math.sin(a);
      pixelLine(ctx, b.x - c * 14, b.y - sn * 14, b.x - c * 5, b.y - sn * 5, '#3c2452');
      pixelLine(ctx, b.x - c * 5, b.y - sn * 5, b.x + c * 3, b.y + sn * 3, '#b88aff');
      ctx.fillStyle = COLOR.white; ctx.fillRect(Math.round(b.x + c * 3), Math.round(b.y + sn * 3), 1, 1);
      return;
    }
    if(b.element && !b.fx){
      const color=ELEMENT[b.element].glow;
      pixelLine(ctx,b.x-b.vx*0.025,b.y-b.vy*0.025,b.x,b.y,color);
      ctx.fillStyle=color;ctx.fillRect(Math.round(b.x)-2,Math.round(b.y)-2,4,4);
      ctx.fillStyle='#ffffff';ctx.fillRect(Math.round(b.x)-1,Math.round(b.y)-1,2,2);return;
    }
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
    const ctx=this.healthCtx,p=this.player;
    ctx.clearRect(0,0,ctx.canvas.width,16);
    ctx.imageSmoothingEnabled=false;
    const hearts=Math.ceil(p.maxHp/20);
    for(let i=0;i<hearts;i++){
      const x=8+i*11,y=4;
      const fill=Math.ceil(clamp(p.hp-i*20,0,20)/10);
      ctx.drawImage(SPRITES.heartEmpty,x,y);
      if(fill===2)ctx.drawImage(SPRITES.heart,x,y);
      else if(fill===1)ctx.drawImage(SPRITES.heart,0,0,5,8,x,y,5,8);
    }
    drawDigits(ctx,Math.max(0,Math.ceil(p.hp)),8+hearts*11+18,5,COLOR.pale);
    const enemy=this.enemies.find(e=>e.boss&&!e.faced);
    const spec=enemy?.boss?BOSSES[enemy.boss.id]:null;
    this.ui.updateCombat({stage:this.stage.number,chapter:this.stage.chapter,within:this.stage.within,blocked:Boolean(p.effects.stun||p.effects.silence),
      energy:p.energy,maxEnergy:p.maxEnergy,infiniteEnergy:this.cheats.energy,warmth:p.warmth,armor:p.armor,equipped:this.equipped,active:this.activeSpirit,
      mode:this.mode,slots:this.slotLimit,combo:this.comboHud,
      boss:enemy?.boss&&spec?{name:spec.name,hp:enemy.hp,maxHp:enemy.maxHp,phase:enemy.boss.phase,thresholds:spec.phases,
        pattern:enemy.boss.pattern,protected:enemy.boss.invulnerable||(enemy.boss.id==='door'&&enemy.boss.elapsed%8.5>=2.5),
        qte:enemy.boss.qteTime>0?`${enemy.boss.qte}/10`:null,
        enraged:spec.enrage>0&&enemy.boss.elapsed>spec.enrage}:null});
  }
}
