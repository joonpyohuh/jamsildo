import type { Game } from './game/game';
import { BOSSES, CHAPTERS, LEVELS, SPIRIT_ASSETS, SPIRIT_NAMES } from './game/campaign';
import { ELEMENT, type Element } from './game/config';
import { readSave, useSaveOwner, writeSave } from './game/storage';

interface Player { id:string; username:string; is_admin:boolean; blocked:boolean; created_at:string; last_seen:string; play_seconds:number; stage:number; max_stage:number }
interface Save { checkpoint:Record<string,unknown>|null; revision:number; updated_at:string }
interface Account { user:Player|null; save?:Save }
interface Overview { stats:{players:number;today:number;online:number;active_today:number;play_seconds:number;blocked:number;stages:{stage:number;players:number}[]}; players:Player[]; total:number; audit:{action:string;created_at:string;player:{username:string}}[] }
const el = <T extends HTMLElement = HTMLElement>(id:string):T => document.getElementById(id) as T;
const duration = (seconds:number):string => `${Math.floor(seconds/3600)}시간 ${Math.floor(seconds%3600/60)}분 ${Math.floor(seconds%60)}초`;
const date = (value:string):string => new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});

export class Accounts {
  readonly ready:Promise<void>;
  readonly dialog = el<HTMLDialogElement>('accountDialog');
  readonly adminDialog = el<HTMLDialogElement>('adminDialog');
  private user:Player|null = null;
  private revision = 0;
  private acknowledged:string|null = null;
  private session = crypto.randomUUID();
  private seconds = 0;
  private lastTick = performance.now();
  private ticks = 0;
  private inFlight:Promise<void>|null = null;
  private conflict = false;
  private testMode = false;
  private page = 0;
  private total = 0;
  private adminLoading = false;
  private guest = readSave();
  private initialized = false;
  /** 타이틀의 '회원가입 / 로그인'에서 열었으면, 성공하는 순간 게임으로 넘어간다 */
  private pendingStart:'register'|'login'|null = null;

  constructor(private game:Game) {
    el('accountToggle').addEventListener('click',()=>this.dialog.showModal());
    for (const dialog of [this.dialog,this.adminDialog]) dialog.querySelector('[data-close]')!.addEventListener('click',()=>dialog.close());
    this.dialog.addEventListener('close',()=>{this.pendingStart=null;el('accountTitle').textContent='기록을 이어서';this.orderAuthButtons('login');});
    el<HTMLFormElement>('loginForm').addEventListener('submit',event=>{event.preventDefault();void this.login((event as SubmitEvent).submitter?.getAttribute('value') === 'register' ? 'register' : 'login');});
    el('saveNow').addEventListener('click',()=>{void this.sync().then(()=>this.message('저장을 확인했습니다.')).catch(error=>this.message(error.message));});
    el('logout').addEventListener('click',()=>{void this.logout();});
    el('accountHome').addEventListener('click',()=>{
      void (this.testMode?Promise.resolve(this.leaveTest()):this.sync()).then(()=>{this.game.returnToTitle();this.refreshContinue();this.dialog.close();}).catch(error=>this.message(error.message));
    });
    el('openAdmin').addEventListener('click',()=>{this.dialog.close();this.refreshCheats();this.adminDialog.showModal();void this.loadAdmin();});
    el('refreshAdmin').addEventListener('click',()=>{void this.loadAdmin();});
    el<HTMLFormElement>('adminSearch').addEventListener('submit',event=>{event.preventDefault();this.page=0;void this.loadAdmin();});
    el('prevPlayers').addEventListener('click',()=>{this.page=Math.max(0,this.page-1);void this.loadAdmin();});
    el('nextPlayers').addEventListener('click',()=>{if((this.page+1)*25<this.total)this.page++;void this.loadAdmin();});
    el('leaveTest').addEventListener('click',()=>this.leaveTest());
    el('resumeTest').addEventListener('click',()=>this.adminDialog.close());
    for(const kind of ['health','energy'] as const) {
      el(`cheat-${kind}`).addEventListener('click',()=>{void this.applyCheat(()=>this.game.setCheat(kind,!this.game.cheats[kind]));});
    }
    for(const element of Object.keys(SPIRIT_NAMES) as Element[]) {
      const button=document.createElement('button');button.type='button';button.className='spirit-cheat';button.dataset.element=element;
      const image=new Image();image.src=`/sprites/${SPIRIT_ASSETS[element]}.png`;image.alt='';
      const label=document.createElement('span');label.textContent=`${SPIRIT_NAMES[element]} · ${ELEMENT[element].label}`;
      button.append(image,label);button.setAttribute('aria-label',`${ELEMENT[element].label} 정령 ${SPIRIT_NAMES[element]} 획득 / 선택`);
      button.addEventListener('click',()=>{void this.applyCheat(()=>this.game.equipSpirit(element));});el('adminSpirits').append(button);
    }
    el('loadCloud').addEventListener('click',()=>{if(confirm('기기 기록은 백업으로 보관하고 서버의 최신 기록을 불러올까요?')){writeSave('true','prefer-cloud');location.reload();}});
    el('backupSave').addEventListener('click',()=>{
      const backup=this.conflict?readSave():readSave('unsynced') || readSave();
      const url=URL.createObjectURL(new Blob([backup || '{}'],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download=`jamsildo-${this.user?.username || 'guest'}.json`;link.click();URL.revokeObjectURL(url);
    });
    el('importGuest').addEventListener('click',()=>{
      if(!this.guest||this.game.mode!=='title'){this.message('타이틀 화면에서 가져올 수 있습니다.');return;}
      if(confirm('이 기기에 남아 있는 이전 기록을 현재 계정으로 가져올까요?')){writeSave(this.guest);this.refreshContinue();void this.sync().then(()=>{el('importGuest').hidden=true;this.message('이전 기록을 가져왔습니다. 계속하기를 눌러 주세요.');}).catch(error=>this.message(error.message));}
    });
    el<HTMLFormElement>('passwordForm').addEventListener('submit',event=>{
      event.preventDefault();
      void this.api('password',{current:el<HTMLInputElement>('currentPassword').value,password:el<HTMLInputElement>('newPassword').value}).then(()=>{el<HTMLFormElement>('passwordForm').reset();this.message('비밀번호를 변경했습니다.');}).catch(error=>this.message(error.message));
    });
    this.renderStages();
    this.refreshCheats();
    this.ready=this.api<Account>().then(account=>this.acceptAccount(account)).catch(error=>{this.status('기기 저장 · 계정 서버 연결 실패',true);this.message(error.message);}).finally(()=>{this.initialized=true;this.refreshContinue();});
    window.setInterval(()=>this.tick(),1000);
    const saveOnExit=()=>{this.lastTick=performance.now();void this.sync(true).catch(()=>undefined);};
    document.addEventListener('visibilitychange',()=>{this.lastTick=performance.now();if(document.hidden)saveOnExit();});
    window.addEventListener('pagehide',saveOnExit);
    window.addEventListener('online',()=>{void this.sync().catch(()=>undefined);});
    window.addEventListener('beforeunload',event=>{
      if(!this.testMode)this.game.saveCheckpoint();
      if(this.user&&!this.testMode&&this.acknowledged!==readSave()){event.preventDefault();}
    });
  }

  get paused():boolean { return !!document.querySelector('dialog[open]'); }
  private status(text:string,error=false):void { el('saveStatus').textContent=text;el('saveStatus').dataset.error=String(error); }
  private message(text:string):void { el('accountMessage').textContent=text; }
  private async api<T = {ok:boolean}>(action?:string,body:Record<string,unknown>={},keepalive=false):Promise<T> {
    const response=await fetch('/api/account',{method:action?'POST':'GET',headers:action?{'Content-Type':'application/json'}:{},body:action?JSON.stringify({action,...body}):undefined,credentials:'same-origin',keepalive,signal:AbortSignal.timeout(30000)});
    const result=await response.json();
    if(!response.ok)throw Object.assign(new Error(result.error || '계정 서버에 연결하지 못했습니다.'),{status:response.status});
    return result as T;
  }
  private acceptAccount(account:Account):void {
    this.user=account.user;this.conflict=false;this.session=crypto.randomUUID();this.seconds=0;this.acknowledged=null;
    useSaveOwner(this.user?.id || '');
    if(this.user){
      this.revision=account.save?.revision || 0;
      const remote=account.save?.checkpoint ? JSON.stringify(account.save.checkpoint) : null;
      let metadata:{revision:number;raw:string|null}|null=null;
      try{metadata=JSON.parse(readSave('sync') || 'null');}catch{/* 손상된 동기화 정보는 서버 기록으로 복구한다. */}
      const local=readSave();
      const pending=local!==null && local!==metadata?.raw;
      const preferCloud=readSave('prefer-cloud')==='true';
      if(pending && metadata && metadata.revision!==this.revision && !preferCloud){
        this.conflict=true;this.status('저장 충돌 · 계정 창 확인',true);this.message('서버와 기기 양쪽에 새 기록이 있습니다. 기기 기록을 내려받은 뒤 서버 기록을 불러와 주세요.');
      }else{
        if(!pending || preferCloud || !metadata){
          if(local && local!==remote)writeSave(local,'unsynced');
          writeSave(remote || 'null');
        }
        writeSave('false','prefer-cloud');
        this.acknowledged=remote;
        writeSave(JSON.stringify({revision:this.revision,raw:remote}),'sync');
        this.status('계정 연결 · 자동 저장');
      }
      if(account.save?.checkpoint?.maxEnergy)writeSave(String(account.save.checkpoint.maxEnergy),'max-energy');
      el('accountSummary').textContent=`${this.user.username} · 누적 ${duration(this.user.play_seconds)}`;
      el('importGuest').hidden=!!remote||!this.guest;
    }else{this.status('로그인 전');}
    this.game.saveEnabled=!!this.user;
    el('signedOut').hidden=!!this.user;el('signedIn').hidden=!this.user;
    el('accountToggle').textContent=this.user?`${this.user.is_admin?'관리자 · ':''}${this.user.username}`:'로그인 / 가입';
    el('openAdmin').hidden=!this.user?.is_admin;el('loadCloud').hidden=!this.conflict;
    this.refreshContinue();
  }
  refreshContinue():void { const raw=readSave();el('continueGame').hidden=!this.user||!raw||raw==='null'; }
  get signedIn():boolean { return !!this.user; }
  /** Enter로 제출되는 첫 버튼을 모드에 맞춘다 (가입 창에서 Enter가 로그인으로 가지 않게) */
  private orderAuthButtons(mode:'register'|'login'):void {
    const form=el<HTMLFormElement>('loginForm'),actions=form.querySelector<HTMLElement>('.account-actions')!;
    const register=actions.querySelector<HTMLButtonElement>('[value="register"]')!,login=actions.querySelector<HTMLButtonElement>('[value="login"]')!;
    if(mode==='register')actions.prepend(register);else actions.prepend(login);
    register.classList.toggle('is-primary',mode==='register');login.classList.toggle('is-primary',mode==='login');
  }
  /** 타이틀 '게스트로 시작': 이번 판은 저장하지 않는다 */
  playAsGuest():void { this.game.saveEnabled=false;this.status('게스트 · 저장 안 됨',true); }
  /** 타이틀 '회원가입' / '로그인': 계정 창을 열고, 성공하면 바로 게임으로 */
  openAuth(mode:'register'|'login'):void {
    this.pendingStart=mode;
    this.orderAuthButtons(mode);
    el('accountTitle').textContent=mode==='register'?'회원가입 · 기록 저장':'로그인';
    el<HTMLInputElement>('password').autocomplete=mode==='register'?'new-password':'current-password';
    this.message(mode==='register'?'아이디와 비밀번호를 정하고 회원가입을 눌러 주세요.':'');
    if(!this.dialog.open)this.dialog.showModal();
    el<HTMLInputElement>('username').focus();
  }
  confirmStart():boolean {
    if(!this.initialized)return false;
    const raw=readSave();
    return this.game.mode!=='title'||!raw||raw==='null'||confirm('저장된 진행을 새 게임으로 바꿀까요? 이어하려면 취소 후 계속하기를 눌러 주세요.');
  }
  private async login(action:'login'|'register'):Promise<void> {
    const form=el<HTMLFormElement>('loginForm');
    this.message(action==='register'?'계정을 만드는 중…':'로그인 중…');
    for(const button of form.querySelectorAll('button'))button.disabled=true;
    try{
      if(this.game.mode!=='title' && !confirm('현재 게스트 진행은 이 기기에 보관됩니다. 로그인 계정의 기록으로 전환할까요?'))return;
      this.game.saveCheckpoint();this.guest=readSave();
      const result=await this.api<Account>(action,{username:el<HTMLInputElement>('username').value,password:el<HTMLInputElement>('password').value});
      const start=this.pendingStart;
      this.game.returnToTitle();this.acceptAccount(result);form.reset();this.message(action==='register'?'가입했습니다. 게임 시작 또는 이전 기록 가져오기를 선택해 주세요.':'로그인했습니다. 계속하기로 기록을 이어갈 수 있습니다.');
      if(start){
        // 타이틀에서 연 경우: 가입하면 새로 시작, 로그인하면 기록이 있으면 이어서
        this.dialog.close();el('startChoice').hidden=true;el('startGame').setAttribute('aria-expanded','false');
        const raw=readSave();
        if(action==='login'&&raw&&raw!=='null')this.game.resumeRun();else this.game.onScreenTap();
      }
    }catch(error){this.message((error as Error).message);}finally{for(const button of form.querySelectorAll('button'))button.disabled=false;}
  }
  private async logout():Promise<void> {
    const button=el<HTMLButtonElement>('logout');button.disabled=true;
    try{
      if(this.testMode)this.leaveTest();
      await this.sync();await this.api('logout');this.game.returnToTitle();this.acceptAccount({user:null});this.message('저장 후 로그아웃했습니다.');
    }catch(error){this.message(`로그아웃하지 않았습니다. ${(error as Error).message}`);}finally{button.disabled=false;}
  }
  private tick():void {
    if(!this.initialized)return;
    const now=performance.now(),elapsed=Math.min(2,(now-this.lastTick)/1000);this.lastTick=now;this.ticks++;
    if(!document.hidden&&!this.paused&&!this.testMode&&!['title','clear','down'].includes(this.game.mode))this.seconds+=elapsed;
    if(this.ticks%5===0&&!this.testMode){
      const stored=this.game.saveCheckpoint();this.refreshContinue();
      if(!this.user){const title=this.game.mode==='title';this.status(title?'로그인 전':'게스트 · 저장 안 됨',!title);void stored;}
    }
    if(this.ticks%15===0)void this.sync().catch(()=>undefined);
    if(this.ticks%30===0&&this.adminDialog.open)void this.loadAdmin();
  }
  async sync(keepalive=false):Promise<void> {
    if(this.inFlight){await this.inFlight;if(!keepalive)return this.sync();return;}
    if(!this.testMode)this.game.saveCheckpoint();
    this.refreshContinue();
    if(!this.user||this.testMode)return;
    if(this.conflict)throw new Error('저장 충돌을 먼저 해결해 주세요. 서버 기록은 덮어쓰지 않았습니다.');
    const raw=readSave();
    const checkpoint=raw&&raw!=='null'&&raw!==this.acknowledged?JSON.parse(raw):null;
    this.status('계정에 저장 중…');
    this.inFlight=this.api<{revision:number;updated_at:string}>('sync',{revision:this.revision,checkpoint,session:this.session,seconds:Math.floor(this.seconds)},keepalive).then(result=>{
      this.revision=result.revision;
      if(checkpoint)this.acknowledged=raw;
      writeSave(JSON.stringify({revision:this.revision,raw:this.acknowledged}),'sync');
      this.status(`계정 저장 완료 · ${new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false})}`);
    }).catch(error=>{
      if(error.status===409){this.conflict=true;el('loadCloud').hidden=false;}
      this.status(error.status===409?'저장 충돌 · 계정 창 확인':'계정 저장 실패 · 기기 기록 유지',true);
      this.message(error.message);throw error;
    }).finally(()=>{this.inFlight=null;});
    return this.inFlight;
  }
  private renderStages():void {
    const root=el('adminStages');
    for(let chapter=1;chapter<=4;chapter++){
      const heading=document.createElement('h3');heading.textContent=`${chapter}장 · ${CHAPTERS[chapter-1]!.name}`;root.append(heading);
      const grid=document.createElement('div');grid.className='stage-grid';root.append(grid);
      for(const level of LEVELS.filter(level=>level.chapter===chapter)){
        const button=document.createElement('button');button.type='button';button.dataset.stage=String(level.number);
        const title=document.createElement('span');title.textContent=`${level.number} · ${level.within}/5`;
        const boss=document.createElement('small');boss.className='stage-boss';boss.textContent=BOSSES[level.boss].name;
        const count=document.createElement('small');count.dataset.stageCount=String(level.number);
        button.append(title,boss,count);grid.append(button);
        button.addEventListener('click',()=>{void this.startTest(level.number);});
      }
    }
  }
  private async prepareTest():Promise<void> {
    const user=this.user;
    if(!user?.is_admin)throw new Error('관리자만 테스트할 수 있습니다.');
    if(!this.testMode){
      await this.sync();
      if(this.user?.id!==user.id||!this.user.is_admin)throw new Error('관리자 계정을 다시 확인해 주세요.');
      this.testMode=true;useSaveOwner(`${user.id}.test`);
    }
    el('leaveTest').hidden=false;el('resumeTest').hidden=false;
  }
  private refreshCheats():void {
    for(const [kind,label] of [['health','체력'],['energy','기력']] as const) {
      const enabled=this.game.cheats[kind];const button=el(`cheat-${kind}`);
      button.textContent=`${label} 무한: ${enabled?'켜짐':'꺼짐'}`;button.setAttribute('aria-pressed',String(enabled));
    }
    const active=this.testMode?this.game.equipped[this.game.activeSpirit]?.element:null;
    for(const button of el('adminSpirits').querySelectorAll<HTMLButtonElement>('button'))button.setAttribute('aria-pressed',String(button.dataset.element===active));
  }
  private async applyCheat(change:()=>void):Promise<void> {
    try{
      await this.prepareTest();
      if(!['play','talk','embrace'].includes(this.game.mode))this.game.debugStage(this.game.stageNumber);
      change();this.refreshCheats();this.status(`관리자 치트 테스트 · 스테이지 ${this.game.stageNumber} · 실제 기록 저장 안 함`);
    }catch(error){el('adminMessage').textContent=(error as Error).message;}
  }
  private async startTest(number:number):Promise<void> {
    try{
      await this.prepareTest();
      this.game.debugStage(number);this.refreshCheats();this.adminDialog.close();this.status(`관리자 테스트 · 스테이지 ${number}`);
    }catch(error){el('adminMessage').textContent=(error as Error).message;}
  }
  private leaveTest():void {
    if(!this.testMode||!this.user)return;
    this.testMode=false;useSaveOwner(this.user.id);this.game.returnToTitle();this.refreshCheats();this.refreshContinue();el('leaveTest').hidden=true;el('resumeTest').hidden=true;this.status('테스트 종료 · 내 기록 유지');
  }
  private async loadAdmin():Promise<void> {
    if(!this.user?.is_admin||this.adminLoading)return;
    this.adminLoading=true;el('adminMessage').textContent='운영 현황을 불러오는 중…';
    try{
      const result=await this.api<Overview>('admin',{page:this.page,search:el<HTMLInputElement>('playerSearch').value,order:el<HTMLSelectElement>('playerOrder').value});
      this.total=result.total;
      const stats=result.stats;
      el('adminKpis').replaceChildren();
      const totalTime=stats.play_seconds<60?`${stats.play_seconds}초`:`${Math.floor(stats.play_seconds/3600)}시간 ${Math.floor(stats.play_seconds%3600/60)}분`;
      for(const [label,value]of [['가입 플레이어',`${stats.players}명`],['오늘 가입 · 한국 시간',`${stats.today}명`],['접속 중',`${stats.online}명`],['오늘 방문',`${stats.active_today}명`],['누적 플레이',totalTime],['이용 제한',`${stats.blocked}명`]]){
        const article=document.createElement('article'),name=document.createElement('span'),count=document.createElement('strong');name.textContent=label;count.textContent=value;article.append(name,count);el('adminKpis').append(article);
      }
      for(const count of document.querySelectorAll<HTMLElement>('[data-stage-count]'))count.textContent=`진행 중 ${stats.stages.find(stage=>stage.stage===Number(count.dataset.stageCount))?.players || 0}명`;
      const rows=el('playerRows');rows.replaceChildren();
      for(const player of result.players){
        const row=document.createElement('tr');
        for(const value of [`${Date.now()-Date.parse(player.last_seen)<60000?'● ':''}${player.username}${player.blocked?' · 이용 제한':''}`,duration(player.play_seconds),`${player.stage} / ${player.max_stage}`,date(player.created_at),date(player.last_seen)]){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}
        const cell=document.createElement('td'),button=document.createElement('button');button.type='button';button.textContent=player.blocked?'제한 해제':'이용 제한';
        button.addEventListener('click',()=>{
          if(!confirm(`${player.username} 계정을 ${player.blocked?'제한 해제':'이용 제한'}할까요?`))return;
          button.disabled=true;
          void this.api('block',{target:player.id,blocked:!player.blocked}).then(()=>this.loadAdmin()).catch(error=>{el('adminMessage').textContent=error.message;button.disabled=false;});
        });cell.append(button);row.append(cell);rows.append(row);
      }
      if(!result.players.length){const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=6;cell.textContent='조회된 플레이어가 없습니다.';row.append(cell);rows.append(row);}
      el('playerPage').textContent=`${this.page+1} / ${Math.max(1,Math.ceil(this.total/25))} · ${this.total}명`;
      el<HTMLButtonElement>('prevPlayers').disabled=this.page===0;el<HTMLButtonElement>('nextPlayers').disabled=(this.page+1)*25>=this.total;
      el('adminAudit').replaceChildren();
      for(const entry of result.audit){const item=document.createElement('li');item.textContent=`${date(entry.created_at)} · ${entry.player?.username || '계정'} · ${entry.action==='block'?'이용 제한':'제한 해제'}`;el('adminAudit').append(item);}
      if(!result.audit.length){const item=document.createElement('li');item.textContent='운영 조작 기록이 없습니다.';el('adminAudit').append(item);}
      el('adminMessage').textContent=`${date(new Date().toISOString())} 갱신 · 30초마다 자동 새로고침`;
    }catch(error){el('adminMessage').textContent=(error as Error).message;}finally{this.adminLoading=false;}
  }
}
