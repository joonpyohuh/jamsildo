// npm run dev first. PLAYWRIGHT_MODULE may point to an existing install.
// 모바일 세로: 기기별 배치·안전 영역, 회전 시 상태 유지, 실제 멀티터치. 뷰포트 에뮬레이션이며 인셋은 공개된 동급 기기 값의 추정치다.
const assert=require('node:assert/strict');
const {join}=require('node:path');
const {tmpdir}=require('node:os');
const {mkdir}=require('node:fs/promises');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.BASE_URL||'http://localhost:5173';
const output=join(tmpdir(),'jamsildo-portrait');
// safe: [위, 오른쪽, 아래, 왼쪽]
const DEVICES=[
 {name:'iPhone SE',w:375,h:667,dpr:2,safe:[20,0,0,0]},
 {name:'iPhone 15 Pro Max',w:430,h:932,dpr:3,safe:[59,0,34,0]},
 {name:'iPhone 15 Pro Max Safari',w:430,h:739,dpr:3,safe:[59,0,0,0]},
 {name:'Galaxy S24',w:360,h:780,dpr:3,safe:[32,0,16,0]},
 {name:'Galaxy S Ultra',w:412,h:891,dpr:3.5,safe:[32,0,16,0]},
 {name:'Galaxy Fold cover',w:344,h:882,dpr:3,safe:[28,0,16,0]},
 {name:'Galaxy Fold open',w:673,h:841,dpr:2.6,safe:[28,0,16,0]},
];
const BUTTONS=['#attack','#dash','#swapSpirit','#comboSkill',...['q','w','e','r'].map(k=>`[data-skill="${k}"]`)];
const SIZES={'#attack':76,'#dash':56,'#swapSpirit':40,'#comboSkill':52,'[data-skill="q"]':52,'[data-skill="w"]':52,'[data-skill="e"]':52,'[data-skill="r"]':52};

const setSafe=(page,safe)=>page.evaluate(([t,r,b,l])=>{const s=document.documentElement.style;s.setProperty('--sa-t',`${t}px`);s.setProperty('--sa-r',`${r}px`);s.setProperty('--sa-b',`${b}px`);s.setProperty('--sa-l',`${l}px`);window.dispatchEvent(new Event('resize'));},safe);
const play=(page,boss=false)=>page.evaluate(async boss=>{
 const g=window.__jamsildo,{newSpirit}=await import('/src/game/campaign.ts');
 g.openingSeen=true;g.opening=null;g.ui.showCine(false);g.cineSkip?.();g.debugStage(3);g.talk=null;g.ui.hideTalk();
 g.enterRoom(boss?g.stage.boss:g.stage.rooms.find(r=>r.kind==='normal'),null);g.talk=null;g.ui.hideTalk();g.mode='play';g.attackUnlocked=true;g.cheats.health=true;g.cheats.energy=true;
 g.equipped.length=0;for(const el of ['fire','water']){const s=newSpirit(el);s.tier=3;g.equipped.push(s);g.acquired.add(el);}g.hasSpirit=true;g.comboHinted=true;g.skillHinted=true;
 Object.assign(g.player,{x:320,y:190,tx:320,ty:190,moving:false});
},boss);
const rect=(page,sel)=>page.evaluate(sel=>{const e=document.querySelector(sel);if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,shown:r.width>0&&getComputedStyle(e).visibility!=='hidden'};},sel);
/** 실제 멀티터치: CDP로 손가락 여러 개를 동시에 올린다 */
const touch=async(cdp,type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([x,y,id])=>({x,y,id,radiusX:6,radiusY:6,force:1}))});

(async()=>{
 await mkdir(output,{recursive:true});
 const browser=await chromium.launch();
 const errors=[];
 try{
  for(const d of DEVICES){
   const context=await browser.newContext({viewport:{width:d.w,height:d.h},deviceScaleFactor:d.dpr,isMobile:true,hasTouch:true});
   const page=await context.newPage();page.on('pageerror',e=>errors.push(`${d.name}: ${e.message}`));
   await page.goto(base);await page.waitForFunction(()=>!document.querySelector('#startGame').disabled);
   await setSafe(page,d.safe);
   assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('portrait')),true,`${d.name}: 세로 감지`);
   assert.equal(await page.evaluate(()=>!!document.querySelector('#pauseOverlay').open),false,`${d.name}: 타이틀에서 막지 않음`);
   await page.screenshot({path:join(output,`${d.name}-title.png`)});
   await page.locator('#startGuest').tap();
   await play(page);await page.waitForTimeout(260);
   await page.screenshot({path:join(output,`${d.name}-play.png`)});
   const [t,r,b,l]=d.safe;

   // 세로 순서와 16:9
   const stage=await rect(page,'#stage'),status=await rect(page,'#statusBar'),top=await rect(page,'#topBar');
   assert(Math.abs(stage.w/stage.h-16/9)<0.01,`${d.name}: 16:9`);
   assert(stage.x>=l+7.5,`${d.name}: 왼쪽 여백 ${stage.x}`);assert(d.w-r-stage.x-stage.w>=7.5,`${d.name}: 오른쪽 여백`);
   assert.equal(Math.round(top.h),t+44,`${d.name}: 상단 바 높이`);
   assert(stage.y>=top.y+top.h,`${d.name}: 게임이 상단 바 아래`);
   assert(status.y>=stage.y+stage.h-0.5,`${d.name}: 상태 줄이 게임 아래`);

   // 버튼: 조작 영역과 안전 영역 안, 규격 크기, 서로 안 겹침
   const ctrlTop=status.y+status.h,boxes={};
   for(const sel of BUTTONS)boxes[sel]=await rect(page,sel);
   for(const [sel,box] of Object.entries(boxes)){
    assert(box.shown,`${d.name}: ${sel} 안 보임`);
    assert.equal(Math.round(box.w),SIZES[sel],`${d.name}: ${sel} 크기`);
    assert(box.y>=ctrlTop-0.5,`${d.name}: ${sel}이 상태 줄 침범 ${JSON.stringify(box)}`);
    assert(box.y+box.h<=d.h-b-15.5,`${d.name}: ${sel}이 홈 바 침범 ${JSON.stringify(box)}`);
    assert(box.x>=l&&box.x+box.w<=d.w-r,`${d.name}: ${sel}이 화면 밖 ${JSON.stringify(box)}`);
   }
   const list=Object.entries(boxes);
   for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){
    const [na,a]=list[i],[nb,c]=list[j],gap=Math.hypot(a.x+a.w/2-c.x-c.w/2,a.y+a.h/2-c.y-c.h/2)-(a.w+c.w)/2;
    assert(gap>=-0.5,`${d.name}: ${na}·${nb} 겹침 ${gap.toFixed(1)}`);
   }
   // HUD: 상단 바 안에서 노치를 피한다, 서로 겹치지 않는다
   const health=await rect(page,'#healthHud'),pause=await rect(page,'#pauseToggle');
   assert(health.y>=t&&pause.y>=t,`${d.name}: HUD가 노치 침범`);
   assert(health.y+health.h<=top.y+top.h&&pause.y+pause.h<=top.y+top.h,`${d.name}: 상단 바 벗어남`);

   // 상단 바에 기력·재화가 실제로 그려진다: 배경에 덮여도 DOM 위치는 멀쩡해서 화면 픽셀로 본다
   const energyBox=await rect(page,'#energyHud');assert(energyBox.shown&&energyBox.w>100,`${d.name}: 기력 HUD`);
   assert.match(await page.locator('#energyText').textContent(),/기력 .* 온기/);
   const shot=await page.screenshot({clip:{x:energyBox.x,y:energyBox.y,width:energyBox.w,height:energyBox.h}});
   const lit=await page.evaluate(async b64=>{const i=new Image();i.src=`data:image/png;base64,${b64}`;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const g=c.getContext('2d');g.drawImage(i,0,0);const d=g.getImageData(0,0,c.width,c.height).data;let n=0;for(let k=0;k<d.length;k+=4)if(d[k]+d[k+1]+d[k+2]>300)n++;return n;},shot.toString('base64'));
   assert(lit>40,`${d.name}: 기력 글자가 안 그려짐 ${lit}`);

   // 보스 HP바는 게임 바로 위
   await play(page,true);await page.waitForFunction(()=>!document.querySelector('#bossHud').hidden);await page.waitForTimeout(120);
   const boss=await rect(page,'#bossHud'),stage2=await rect(page,'#stage');
   assert(boss.y>=top.y+top.h-0.5&&boss.y+boss.h<=stage2.y+0.5,`${d.name}: 보스바 위치 ${JSON.stringify(boss)} ${stage2.y}`);
   assert.equal(stage2.y,stage.y,`${d.name}: 보스전에서 화면이 밀리면 안 됨`);
   await page.screenshot({path:join(output,`${d.name}-boss.png`)});
   await context.close();
   console.log(`PASS ${d.name} ${d.w}x${d.h}: 게임 ${Math.round(stage.w)}x${Math.round(stage.h)}, 조작 영역 ${Math.round(d.h-b-16-ctrlTop)}px, 버튼·HUD 안전 영역`);
  }

  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const cdp=await context.newCDPSession(page);
  await page.goto(base);await page.waitForFunction(()=>!document.querySelector('#startGame').disabled);
  await page.locator('#startGuest').tap();await play(page);await page.waitForTimeout(700);
  const center=async sel=>{const r=await rect(page,sel);return[r.x+r.w/2,r.y+r.h/2];};
  const ctrl=await page.evaluate(()=>parseFloat(document.documentElement.style.getPropertyValue('--ct')));

  // 플로팅 조이스틱: 누른 자리에 생기고, 떼면 사라지고, 데드존이 있다
  assert.equal(await page.locator('#joystick').isVisible(),false,'평소엔 안 보임');
  const sx=90,sy=ctrl+120;
  await touch(cdp,'touchStart',[[sx,sy,1]]);await page.waitForTimeout(40);
  const stick=await rect(page,'#joystick');assert(stick.shown,'누르면 생김');assert.equal(Math.round(stick.x+stick.w/2),sx);assert.equal(Math.round(stick.w),100,'반경 50');
  await touch(cdp,'touchMove',[[sx+3,sy,1]]);await page.waitForTimeout(40);
  assert.equal(await page.evaluate(()=>window.__jamsildo.input.move.x),0,'데드존');
  const x0=await page.evaluate(()=>window.__jamsildo.player.x);
  await touch(cdp,'touchMove',[[sx+60,sy,1]]);await page.waitForTimeout(200);
  assert.equal(await page.evaluate(()=>window.__jamsildo.input.move.x),1,'끝까지 밀면 전속력');
  assert(await page.evaluate(x=>window.__jamsildo.player.x>x+10,x0),'이동');
  await touch(cdp,'touchEnd',[]);await page.waitForTimeout(40);
  assert.equal(await page.locator('#joystick').isVisible(),false,'떼면 사라짐');
  console.log('PASS 조이스틱: 플로팅, 반경 50, 데드존, 사라짐');

  // 멀티터치: 조이스틱을 잡은 채 공격, 스킬까지 세 손가락
  await page.evaluate(()=>{const g=window.__jamsildo;const e=g.makeEnemy('bother',360,190,0);e.hp=e.maxHp=100000;e.weight=1000;e.state='rest';e.t=999;e.effects={stun:999};g.enemies=[e];g.room.cleared=false;Object.assign(g.player,{x:320,y:190,tx:320,ty:190,moving:false});g.equipped[0].cooldowns.q=0;});
  const [ax,ay]=await center('#attack'),[qx,qy]=await center('[data-skill="q"]');
  await touch(cdp,'touchStart',[[sx,sy,1]]);await touch(cdp,'touchMove',[[sx,sy+40,1]]);await page.waitForTimeout(40);
  await touch(cdp,'touchStart',[[sx,sy+40,1],[ax,ay,2]]);await page.waitForTimeout(60);
  const both=await page.evaluate(()=>({move:window.__jamsildo.input.move,held:window.__jamsildo.input.attackHeld}));
  assert(both.move.y>0.5,'공격 중에도 이동 유지');assert.equal(both.held,true,'이동 중 공격');
  await touch(cdp,'touchStart',[[sx,sy+40,1],[ax,ay,2],[qx,qy,3]]);await page.waitForTimeout(30);
  await page.waitForTimeout(120);
  const three=await page.evaluate(()=>{const g=window.__jamsildo;return{move:g.input.move.y,held:g.input.attackHeld,hurt:g.enemies[0].maxHp-g.enemies[0].hp};});
  assert(three.move>0.5&&three.held,'세 손가락 중에도 이동·공격 유지');assert(three.hurt>0,'이동 중 실제 타격');
  // CDP는 손가락 하나만 뗄 수 없어 한 번에 뗀다. 스킬은 떼는 순간 나가는 규칙이다.
  await touch(cdp,'touchEnd',[]);await page.waitForTimeout(100);
  assert(await page.evaluate(()=>window.__jamsildo.equipped[0].cooldowns.q>0),'세 손가락 스킬');
  assert.equal(await page.evaluate(()=>window.__jamsildo.input.attackHeld),false,'떼면 공격 끝');
  console.log('PASS 멀티터치: 조이스틱+공격+스킬 동시 입력');

  // 스킬: 탭은 자동, 드래그는 조준, 크게 벗어나면 취소
  await page.evaluate(()=>{window.__jamsildo.equipped[0].cooldowns.q=0;});await page.waitForTimeout(120); // 버튼은 HUD 갱신(80ms) 뒤에 풀린다
  await touch(cdp,'touchStart',[[qx,qy,1]]);await touch(cdp,'touchMove',[[qx-60,qy-40,1]]);await page.waitForTimeout(40);
  assert(await page.evaluate(()=>!!window.__jamsildo.aimPreview&&!window.__jamsildo.aimPreview.cancel),'조준 표시');
  await page.screenshot({path:join(output,'aim.png')});
  await touch(cdp,'touchMove',[[qx-200,qy-60,1]]);await page.waitForTimeout(40);
  assert(await page.evaluate(()=>window.__jamsildo.aimPreview.cancel),'취소 표시');
  await touch(cdp,'touchEnd',[]);await page.waitForTimeout(80);
  const cancelled=await page.evaluate(()=>({cd:window.__jamsildo.equipped[0].cooldowns.q,aim:window.__jamsildo.aimPreview}));
  assert.equal(cancelled.cd,0,'취소하면 안 나감');assert.equal(cancelled.aim,null);
  await page.evaluate(()=>{window.__jamsildo.equipped[0].cooldowns.q=0;});await page.waitForTimeout(120);
  await page.evaluate(()=>{const g=window.__jamsildo;g.lastAim=null;const c=g.castSkill.bind(g);g.castSkill=k=>{g.lastAim=g.aimPoint&&{...g.aimPoint};c(k);};});
  await touch(cdp,'touchStart',[[qx,qy,1]]);await touch(cdp,'touchMove',[[qx-45,qy,1]]);await touch(cdp,'touchEnd',[]);await page.waitForTimeout(80);
  const aimed=await page.evaluate(()=>{const g=window.__jamsildo;return{aim:g.lastAim,x:g.player.x,cd:g.equipped[0].cooldowns.q};});
  assert(aimed.cd>0,'드래그 시전');assert(aimed.aim&&aimed.aim.x<aimed.x,'끈 방향이 윤슬 기준');
  await page.evaluate(()=>{const g=window.__jamsildo;g.equipped[0].cooldowns.q=0;g.lastAim='unset';});await page.waitForTimeout(120);
  await touch(cdp,'touchStart',[[qx,qy,1]]);await touch(cdp,'touchEnd',[]);await page.waitForTimeout(80);
  assert.equal(await page.evaluate(()=>window.__jamsildo.lastAim),null,'탭은 자동 조준');
  await page.waitForTimeout(150);
  const gauge=await page.evaluate(()=>{const b=document.querySelector('[data-skill="q"]');return{text:b.dataset.cooldown,cd:b.style.getPropertyValue('--cd')};});
  assert(Number(gauge.text)>0&&Number(gauge.cd)>0,`쿨타임 표시 ${JSON.stringify(gauge)}`);
  console.log('PASS 스킬: 탭 자동, 드래그 조준, 취소, 쿨타임 게이지');

  // 버튼 터치 영역 +10px, 왼쪽 절반 밖은 조이스틱 없음
  const box=await rect(page,'#dash');
  await page.evaluate(()=>{const g=window.__jamsildo;g.dashCd=0;Object.assign(g.player,{x:320,y:190,tx:320,ty:190,moving:false,facing:1,invuln:0});});
  await touch(cdp,'touchStart',[[box.x-6,box.y+box.w/2,1]]);await touch(cdp,'touchEnd',[]);await page.waitForTimeout(30);
  const dash=await page.evaluate(()=>({cd:window.__jamsildo.dashRatio,inv:window.__jamsildo.player.invuln}));
  assert(dash.cd>0,'버튼 밖 6px도 눌림');assert(dash.inv>0&&dash.inv<=0.3,`0.3초 무적 ${dash.inv}`);
  assert.equal(await page.locator('#joystick').isVisible(),false,'버튼 터치가 조이스틱으로 새지 않음');
  await page.waitForTimeout(200);
  const moved=await page.evaluate(()=>window.__jamsildo.player.x);assert(moved>340,`바라보는 쪽 대시 ${moved}`);
  await touch(cdp,'touchStart',[[box.x+box.w/2,box.y+box.h/2,1]]);await touch(cdp,'touchEnd',[]);await page.waitForTimeout(30);
  assert.equal(await page.evaluate(x=>Math.abs(window.__jamsildo.player.x-x)<3,moved),true,'쿨 1초');
  console.log('PASS 대시: 무적, 재사용, 터치 영역 +10px, 입력 분리');

  // 회전: 상태가 그대로, 자동 일시정지, 계속하기
  await page.evaluate(()=>{const g=window.__jamsildo;g.player.hp=44;g.player.warmth=77;g.enterRoom(g.stage.rooms.find(r=>r.kind==='normal'),null);g.enemies=[];g.room.cleared=true;Object.assign(g.player,{x:222,y:188,tx:222,ty:188,moving:false});g.mode='play';});
  const snap=()=>page.evaluate(()=>{const g=window.__jamsildo;return{mode:g.mode,stage:g.stage.number,room:[g.room.gx,g.room.gy],x:Math.round(g.player.x),y:Math.round(g.player.y),hp:g.player.hp,warmth:g.player.warmth,spirits:g.equipped.map(s=>s.element)};});
  const before=await snap();
  await page.setViewportSize({width:844,height:390});
  await page.waitForFunction(()=>document.querySelector('#pauseOverlay').open);
  assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('portrait')),false);
  assert.deepEqual(await snap(),before,'세로→가로 상태 유지');
  const clock=await page.evaluate(()=>window.__jamsildo.clock);await page.waitForTimeout(200);
  assert.equal(await page.evaluate(()=>window.__jamsildo.clock),clock,'자동 일시정지');
  await page.screenshot({path:join(output,'rotate-pause.png')});
  await page.locator('#pauseResume').tap();await page.waitForFunction(c=>window.__jamsildo.clock>c,clock);
  assert.equal(await page.locator('#joystick').isVisible(),true,'가로는 고정 조이스틱');
  assert.equal(await page.locator('#dash').isVisible(),true,'가로에도 대시');
  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(()=>document.querySelector('#pauseOverlay').open);
  assert.deepEqual(await snap(),before,'가로→세로 상태 유지');
  await page.locator('#pauseResume').tap();
  console.log('PASS 회전: 양방향 상태 유지, 자동 일시정지, 계속하기');

  // 일시정지 버튼과 메뉴
  await page.locator('#pauseToggle').tap();await page.waitForFunction(()=>document.querySelector('#pauseOverlay').open);
  await page.screenshot({path:join(output,'pause.png')});
  await page.locator('#pauseArtifacts').tap();assert(await page.evaluate(()=>document.querySelector('#artifactDialog').open),'아이템');
  await page.locator('#artifactClose').tap();

  // 버튼 배치: 가로·세로 따로 저장
  await page.locator('#pauseToggle').tap();await page.locator('#pauseSettings').tap();await page.locator('#editLayout').tap();
  await page.waitForFunction(()=>!document.querySelector('#layoutEdit').hidden);
  const a0=await rect(page,'#attack');
  await touch(cdp,'touchStart',[[a0.x+38,a0.y+38,1]]);await touch(cdp,'touchMove',[[a0.x+8,a0.y+8,1]]);await touch(cdp,'touchEnd',[]);await page.waitForTimeout(40);
  await page.screenshot({path:join(output,'edit.png')});
  await page.locator('#layoutDone').tap();
  const a1=await rect(page,'#attack');assert(a1.x<a0.x-20,'세로에서 옮김');
  const saved=await page.evaluate(()=>({p:localStorage.getItem('jamsildo.layout.portrait'),l:localStorage.getItem('jamsildo.layout.landscape')}));
  assert(saved.p.includes('attack'));assert(!saved.l||!saved.l.includes('attack'),'가로 저장은 따로');
  await page.reload();await page.waitForFunction(()=>!document.querySelector('#startGame').disabled);
  await page.locator('#startGuest').tap();await play(page);await page.waitForTimeout(300);
  assert.equal((await rect(page,'#attack')).x,a1.x,'새로고침 후 유지');
  await page.evaluate(()=>localStorage.removeItem('jamsildo.layout.portrait'));
  console.log('PASS 메뉴·버튼 배치: 일시정지, 아이템, 편집, 방향별 저장');

  // 대사·오프닝·카드
  await page.reload();await page.waitForFunction(()=>!document.querySelector('#startGame').disabled);
  await page.locator('#startGuest').tap();await page.waitForTimeout(1500);
  await page.screenshot({path:join(output,'opening.png')});
  // 오프닝 글자는 조작 영역에
  await page.evaluate(()=>{document.querySelector('#cineLine').textContent='오프닝 대사는 게임 화면 아래에 뜬다.';});
  const cine=await rect(page,'#cineText'),cineTop=await page.evaluate(()=>parseFloat(document.documentElement.style.getPropertyValue('--ct'))-40);
  assert(cine.y>=cineTop,`오프닝 글자 ${JSON.stringify(cine)}`);
  await play(page);
  await page.evaluate(()=>{const g=window.__jamsildo;g.startTalk([{who:'sena',text:'세로에서는 조작 영역 자리에 대사가 뜬다. 길어져도 넘치지 않아야 해.',face:'smile'},{who:'yunseul',text:'둘째 줄.',face:'blank'}],()=>undefined);});
  await page.waitForTimeout(1600);
  const talk=await rect(page,'#talk'),ct=await page.evaluate(()=>parseFloat(document.documentElement.style.getPropertyValue('--ct')));
  assert(talk.y>=ct,`대사창이 조작 영역에 ${JSON.stringify(talk)}`);
  assert.equal(await page.locator('#attack').isVisible(),false,'대사 중 버튼 숨김');
  assert(talk.h<260,`대사창이 내용 크기 ${talk.h}`);
  await page.screenshot({path:join(output,'talk.png')});
  // 대사창 아래 빈 곳을 눌러도 넘어간다
  await page.touchscreen.tap(195,talk.y+talk.h+60);await page.waitForTimeout(1500);
  assert.equal(await page.locator('#talkName').textContent(),'윤슬','아래를 눌러 다음 대사');
  await page.evaluate(()=>{const g=window.__jamsildo;g.talk=null;g.ui.hideTalk();g.mode='play';g.player.warmth=99;g.ui.chooseSpirit(['fire','water','wood'],'메르',()=>{},()=>{});});
  await page.waitForTimeout(200);await page.screenshot({path:join(output,'cards.png')});
  const cards=await page.evaluate(()=>[...document.querySelectorAll('.spirit-choice')].map(e=>e.getBoundingClientRect()).map(r=>({x:r.x,y:r.y,b:r.bottom})));
  assert.equal(new Set(cards.map(c=>Math.round(c.x))).size,1,'세로 목록');assert(cards[1].y>=cards[0].b,'겹치지 않음');
  console.log('PASS 전투 외: 대사 위치, 대사 넘김, 오프닝, 카드 세로 목록');
  await context.close();

  assert.deepEqual(errors,[]);
  console.log(`Screenshots: ${output}`);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
