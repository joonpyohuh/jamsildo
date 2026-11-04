/**
 * 텍스트는 DOM으로 그린다. 픽셀 폰트(Galmuri)를 게임 픽셀 단위(--px)의 정수배로 놓아
 * 캔버스의 도트 격자와 글자의 도트 격자가 일치하도록 한다.
 */
export type ScreenId = 'title' | 'down' | 'clear';

import { EXPR_INDEX, type Expr } from './lines';
import type { Room } from './stage';
import { CHAPTERS, PATTERN_LABELS, SKILLS, SPIRIT_ASSETS, SPIRIT_NAMES, SPIRIT_ROLES, type SpiritSlot } from './campaign';
import { ELEMENT, type Element } from './config';

/** 표정 얼굴: public/portraits/expr/{sena|yun}-{0..5}.png */
export function portrait(who: 'yunseul' | 'sena', face: Expr): string {
  return `/portraits/expr/${who === 'sena' ? 'sena' : 'yun'}-${EXPR_INDEX[face]}.png`;
}

// 표정이 바뀔 때 깜빡이지 않게 미리 받아 둔다
for (const who of ['sena', 'yunseul'] as const) {
  for (const face of Object.keys(EXPR_INDEX) as Expr[]) new Image().src = portrait(who, face);
}

export class Ui {
  private hudTime=0;
  private spiritKey='';
  private readonly screens: Record<ScreenId, HTMLElement>;
  private readonly bossName: HTMLElement;
  private readonly formTag: HTMLElement;
  private readonly clearWarmth: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly hintText: HTMLElement;
  private readonly hintFace: HTMLImageElement;
  private readonly cineFaceEl: HTMLImageElement;
  private readonly talk: HTMLElement;
  private readonly talkName: HTMLElement;
  private readonly talkText: HTMLElement;
  private readonly talkFace: HTMLImageElement;

  constructor(root: HTMLElement) {
    const q = <T extends HTMLElement = HTMLElement>(sel: string, scope: ParentNode = root): T => {
      const el = scope.querySelector<T>(sel);
      if (!el) throw new Error(`missing ui element: ${sel}`);
      return el;
    };
    this.screens = { title: q('#title'), down: q('#down'), clear: q('#clear') };
    this.bossName = q('#bossName');
    this.formTag = q('#formTag');
    this.clearWarmth = q('#clearWarmth');
    this.hint = q('#hint');
    this.hintText = q('#hintText');
    this.hintFace = q<HTMLImageElement>('#hintFace');
    this.cineFaceEl = q<HTMLImageElement>('#cineFace');
    this.talk = q('#talk');
    this.talkName = q('#talkName');
    this.talkText = q('#talkText');
    this.talkFace = q<HTMLImageElement>('#talkFace');
    if (window.matchMedia('(pointer: coarse)').matches) q('#talkNext').textContent = '터치해서 계속 ▼';
  }

  setScale(s: number): void {
    document.documentElement.style.setProperty('--px', `${s}px`);
  }

  setCampaignClear(stage:number,text:string):void {
    const label=document.querySelector('#clear .label'),headline=document.querySelector('#clear .headline'),body=document.querySelector('#clear .body'),cta=document.querySelector('#clear .cta');
    if(label)label.textContent=`${Math.ceil(stage/5)}장 · ${(stage-1)%5+1}/5 · ${stage}/20`;
    if(headline)headline.textContent=stage===20?'혼자 두지 않았다.':'마주했다.';
    if(body)body.textContent=text;
    if(cta)cta.textContent=stage===20?'눌러서 다시 걷기':'눌러서 다음 스테이지';
  }

  chooseSpirit(elements:readonly Element[],replace:boolean,onSelect:(element:Element)=>void):void {
    const dialog=document.querySelector<HTMLDialogElement>('#rewardDialog')!;
    const title=dialog.querySelector<HTMLElement>('#rewardTitle')!,body=dialog.querySelector<HTMLElement>('#rewardDescription')!,choices=dialog.querySelector<HTMLElement>('#rewardChoices')!;
    title.textContent='함께할 정령';body.textContent=replace?'선택하면 현재 활성 정령과 교체합니다.':'정령 하나를 골라 함께 걸어가세요.';
    choices.replaceChildren();
    for(const element of elements){
      const button=document.createElement('button');button.type='button';button.className='spirit-choice';button.dataset.element=element;
      const image=new Image();image.src=`/sprites/${SPIRIT_ASSETS[element]}.png`;image.alt='';
      const name=document.createElement('strong');name.textContent=`${SPIRIT_NAMES[element]} · ${ELEMENT[element].label} · ${SPIRIT_ROLES[element]}`;
      const description=document.createElement('span');description.textContent=`Q ${SKILLS[element].q.name} · W ${SKILLS[element].w.name} · E ${SKILLS[element].e.name}`;
      button.append(image,name,description);button.addEventListener('click',()=>{dialog.close();onSelect(element);},{once:true});choices.append(button);
    }
    if(!dialog.open)dialog.showModal();
    dialog.oncancel=event=>{event.preventDefault();};
  }

  chooseReward(warmth:number,buy:(cost:number)=>boolean):void {
    const dialog=document.querySelector<HTMLDialogElement>('#rewardDialog')!;
    dialog.querySelector('#rewardTitle')!.textContent='작은 가게';
    dialog.querySelector('#rewardDescription')!.textContent=`온기 ${warmth} · 이번 방에서 한 번 살 수 있어요.`;
    const choices=dialog.querySelector('#rewardChoices')!;choices.replaceChildren();
    const item=document.createElement('button');item.type='button';item.className='spirit-choice';item.textContent='선식 한 컵 · 온기 8\nHP +25 · 공격력 +15%';item.disabled=warmth<8;
    item.onclick=()=>{if(buy(8))dialog.close();};
    const close=document.createElement('button');close.type='button';close.className='menu-button';close.textContent='다음에 올게요';close.onclick=()=>dialog.close();
    choices.append(item,close);dialog.oncancel=null;if(!dialog.open)dialog.showModal();
  }

  updateCombat(state:{stage:number;chapter:number;within:number;blocked:boolean;energy:number;maxEnergy:number;warmth:number;armor:number;equipped:readonly SpiritSlot[];active:number;mode:string;slots:number;
    boss:null|{name:string;hp:number;maxHp:number;phase:number;thresholds:number[];pattern:string;protected:boolean;qte:string|null;enraged:boolean}}):void {
    const now=performance.now();if(now-this.hudTime<80)return;this.hudTime=now;
    const q=<T extends HTMLElement=HTMLElement>(selector:string)=>document.querySelector<T>(selector)!;
    q('#stageInfo').textContent=`${state.chapter}장 ${CHAPTERS[state.chapter-1]!.name} · ${state.within}/5 (${state.stage}/20)`;
    const energy=q('#energyHud');energy.hidden=!state.equipped.length||!['play','talk','slide','embrace'].includes(state.mode);
    q('#energyText').textContent=`기력 ${Math.floor(state.energy)}/${state.maxEnergy} · 온기 ${state.warmth}${state.armor?` · 방어 ${state.armor}`:''}${state.blocked?' · 스킬 봉인':''}`;
    q<HTMLProgressElement>('#energyBar').value=state.energy;q<HTMLProgressElement>('#energyBar').max=state.maxEnergy;
    const active=state.equipped[state.active];
    const key=state.equipped.map((slot,i)=>`${slot.element}${slot.tier}${i===state.active}`).join(',');
    if(key!==this.spiritKey){
      this.spiritKey=key;const slots=q('#spiritSlots');slots.replaceChildren();
      state.equipped.forEach((slot,i)=>{
        const button=document.createElement('button');button.type='button';button.dataset.spirit=String(i);button.className=i===state.active?'is-active':'';
        button.setAttribute('aria-label',`${SPIRIT_NAMES[slot.element]} ${slot.tier===1?'하급':slot.tier===2?'중급':'상급'} · 선택`);button.setAttribute('aria-pressed',String(i===state.active));
        const image=new Image();image.src=`/sprites/${SPIRIT_ASSETS[slot.element]}.png`;image.alt='';
        const badge=document.createElement('span');badge.textContent=['Ⅰ','Ⅱ','Ⅲ'][slot.tier-1]!;button.append(image,badge);slots.append(button);
      });
    }
    q('#spiritSlots').hidden=!state.equipped.length||state.mode!=='play';
    q('#spiritSummary').textContent=active?`${SPIRIT_NAMES[active.element]} · ${state.equipped.length}/${state.slots} · Tab 교체`:'';
    q('#spiritSummary').hidden=!active||state.mode!=='play';
    for(const key of ['q','w','e','r'] as const){
      const button=q<HTMLButtonElement>(`#skills [data-skill="${key}"]`),spec=active?SKILLS[active.element][key]:null;
      const cd=active?.cooldowns[key]??0;button.disabled=!active||state.blocked||cd>0||state.energy<(spec?.cost??0)||(key==='r'&&active.tier<2);
      button.dataset.cooldown=key==='r'&&active&&active.tier<2?'잠김':cd>0?String(Math.ceil(cd)):'';
      button.querySelector('.skill-name')!.textContent=spec?.name??'';
      button.title=spec?`${key.toUpperCase()} · ${spec.name} · 기력 ${spec.cost} · ${spec.cd}초`:'';
      button.setAttribute('aria-label',button.title);
      if(active)button.style.borderColor=ELEMENT[active.element].glow;
    }
    const boss=q('#bossHud');boss.hidden=!state.boss||state.mode!=='play';
    document.documentElement.toggleAttribute('data-boss',!boss.hidden);
    if(state.boss){
      q('#bossName').textContent=state.boss.name;
      q('#bossHealthFill').style.width=`${Math.max(0,state.boss.hp/state.boss.maxHp*100)}%`;
      q('#bossHealthTicks').replaceChildren(...state.boss.thresholds.map(threshold=>{const tick=document.createElement('i');tick.style.left=`${threshold*100}%`;return tick;}));
      q('#bossPattern').textContent=`P${state.boss.phase+1} · ${Math.max(0,Math.ceil(state.boss.hp))}/${state.boss.maxHp} · ${state.boss.qte?`연타 ${state.boss.qte}`:state.boss.protected?'보호 중':state.boss.enraged?'광폭화':PATTERN_LABELS[state.boss.pattern]??'예고를 보고 피하세요'}`;
    }
  }

  updateMap(rooms: readonly Room[], current: Room): void {
    const map = document.querySelector<HTMLElement>('#minimap');
    const grid = document.querySelector<HTMLElement>('#mapRooms');
    if (!map || !grid || rooms.length === 0) return;
    const minX = Math.min(...rooms.map(r => r.gx));
    const minY = Math.min(...rooms.map(r => r.gy));
    const visited = new Set(rooms.map(r => `${r.gx},${r.gy}`));
    grid.style.width = `${(Math.max(...rooms.map(r => r.gx)) - minX) * 20 + 16}px`;
    grid.style.height = `${(Math.max(...rooms.map(r => r.gy)) - minY) * 14 + 10}px`;
    grid.replaceChildren();
    for (const room of rooms) {
      const x = (room.gx - minX) * 20;
      const y = (room.gy - minY) * 14;
      for (const [dir, dx, dy] of [['e', 1, 0], ['s', 0, 1]] as const) {
        if (!room.doors[dir] || !visited.has(`${room.gx + dx},${room.gy + dy}`)) continue;
        const link = document.createElement('span');
        link.className = 'map-link';
        link.style.cssText = `left:${x + (dx ? 16 : 7)}px;top:${y + (dy ? 10 : 4)}px;width:${dx ? 4 : 2}px;height:${dy ? 4 : 2}px`;
        grid.append(link);
      }
      const cell = document.createElement('span');
      cell.className = `map-room is-${room.kind}${room === current ? ' is-current' : ''}`;
      cell.style.left = `${x}px`;
      cell.style.top = `${y}px`;
      cell.dataset.room = `${room.gx},${room.gy}`;
      if (room === current) cell.setAttribute('aria-current', 'location');
      grid.append(cell);
    }
    map.setAttribute('aria-label', `${rooms.length}개 방문한 방. 현재 위치: ${current.kind === 'home' ? '윤슬의 방' : `방 ${current.gx}, ${current.gy}`}`);
    grid.style.transform=`scale(${Math.min(1,100/parseFloat(grid.style.width),68/parseFloat(grid.style.height))})`;
  }

  showScreen(id: ScreenId | null): void {
    if (id) this.showRoomLabel(null);
    for (const [key, el] of Object.entries(this.screens)) {
      el.classList.toggle('is-on', key === id);
    }
  }

  showRoomLabel(text: string | null): void {
    const el = document.querySelector<HTMLElement>('#roomLabel');
    if (!el) return;
    el.textContent = text;
    el.hidden = text === null;
  }

  isScreenOn(): boolean {
    return Object.values(this.screens).some((el) => el.classList.contains('is-on'));
  }

  setClearWarmth(n: number): void {
    this.clearWarmth.textContent = String(n);
  }

  showBoss(name: string): void {
    this.bossName.textContent = name;
    this.bossName.classList.add('is-on');
  }

  hideBoss(): void {
    this.bossName.classList.remove('is-on');
  }

  /* ── 전투 중 세나 훈수: 왼쪽 아래, 작은 얼굴 + 한 줄 ── */

  say(text: string, face: Expr): void {
    this.hintText.textContent = text;
    setSrc(this.hintFace, portrait('sena', face));
    this.hint.classList.remove('is-on');
    void this.hint.offsetWidth;
    this.hint.classList.add('is-on');
  }

  hideLine(): void {
    this.hint.classList.remove('is-on');
  }

  /* ── 대사창: 테두리 박스, 왼쪽 글, 오른쪽 얼굴 ── */

  showTalk(who: 'yunseul' | 'sena', name: string, text: string, complete: boolean, face: Expr): void {
    this.talk.classList.add('is-on');
    this.talk.classList.toggle('is-complete', complete);
    this.talk.dataset.who = who;
    this.talkName.textContent = name;
    this.talkText.textContent = text;
    setSrc(this.talkFace, portrait(who, face));
  }

  hideTalk(): void {
    this.talk.classList.remove('is-on', 'is-complete');
  }

  /* ── 오프닝·안내 ── */

  get cineText(): HTMLElement {
    const el = document.querySelector<HTMLElement>('#cineLine');
    if (!el) throw new Error('missing #cineLine');
    return el;
  }

  /** 오프닝 세나 대사 옆 표정 (null이면 숨김) */
  cineFace(face: Expr | null): void {
    this.cineFaceEl.hidden = face === null;
    if (face) setSrc(this.cineFaceEl, portrait('sena', face));
  }

  showCine(on: boolean): void {
    document.querySelector('#cine')?.classList.toggle('is-on', on);
  }

  center(text: string): void {
    const el = document.querySelector<HTMLElement>('#center');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('is-on');
    void el.offsetWidth;
    el.classList.add('is-on');
  }

  /* ── 형태 이름 ── */

  flashForm(label: string): void {
    this.formTag.textContent = label;
    this.formTag.classList.remove('is-on');
    void this.formTag.offsetWidth;
    this.formTag.classList.add('is-on');
  }

  hideForm(): void {
    this.formTag.classList.remove('is-on');
  }

  placeForm(x: number, y: number): void {
    this.formTag.style.left = `calc(var(--px) * ${Math.round(x)})`;
    this.formTag.style.top = `calc(var(--px) * ${Math.round(y)})`;
  }
}

function setSrc(img: HTMLImageElement, src: string): void {
  if (img.getAttribute('src') !== src) img.setAttribute('src', src);
}
