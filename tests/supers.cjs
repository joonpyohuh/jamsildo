// npm run dev first. PLAYWRIGHT_MODULE may point to an existing install.
// 초필살기 컷인, 그림별 판정, 합동 궁극기, 인간형 세나를 실제 키 입력으로 확인한다.
const assert=require('node:assert/strict');
const {join}=require('node:path');
const {tmpdir}=require('node:os');
const {mkdir}=require('node:fs/promises');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.BASE_URL||'http://localhost:5173';
const output=join(tmpdir(),'jamsildo-supers');

/** 빈 방에 정령과 허수아비 그늘을 세운다. place: [[x,y],...] */
const arena=(page,elements,place,tier=2)=>page.evaluate(async([elements,place,tier])=>{
 const g=window.__jamsildo,{newSpirit}=await import('/src/game/campaign.ts');
 g.openingSeen=true;g.opening=null;g.ui.showCine(false);g.debugStage(12);g.talk=null;g.ui.hideTalk();
 g.enterRoom(g.stage.rooms.find(r=>r.kind==='normal'),null);
 g.mode='play';g.attackUnlocked=true;g.cheats.health=true;g.room.cleared=false;g.bullets=[];g.zones=[];g.events=[];
 g.equipped.length=0;g.acquired.clear();for(const el of elements){const s=newSpirit(el);s.tier=tier;g.equipped.push(s);g.acquired.add(el);}
 g.hasSpirit=true;g.activeSpirit=0;g.switchCd=0;g.comboHinted=true;g.skillHinted=true;
 g.player.maxEnergy=g.player.energy=100;g.player.effects={};
 Object.assign(g.player,{x:150,y:190,tx:150,ty:190,moving:false,vx:0,vy:0,facing:1});
 g.enemies=place.map(([x,y])=>{const e=g.makeEnemy('bother',x,y,0);e.hp=e.maxHp=100000;e.weight=1000;e.state='rest';e.t=999;e.effects={stun:999};return e;});
},[elements,place,tier]);
const tap=async(page,key)=>{await page.keyboard.down(key);await page.waitForTimeout(50);await page.keyboard.up(key);};
const damaged=page=>page.evaluate(()=>window.__jamsildo.enemies.map(e=>Math.round(e.maxHp-e.hp)));
const cutOver=page=>page.waitForFunction(()=>!window.__jamsildo.cut,{timeout:4000});

(async()=>{
 await mkdir(output,{recursive:true});
 const browser=await chromium.launch();
 const errors=[];
 try{
  const page=await browser.newPage({viewport:{width:1280,height:720}});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.status()>=400&&r.url().includes('/sprites/'))errors.push(`${r.status()} ${r.url()}`);});
  await page.goto(base);await page.waitForFunction(()=>!document.querySelector('#startGame').disabled);
  await page.locator('#startGuest').click();
  const art=await page.evaluate(async()=>{const {ART}=await import('/src/game/assets.ts');return['combo_steam','combo_eclipse','ult_fire','ult_water','ult_light','ult_dark','sena_human','sena_human_sm'].filter(id=>!ART.has(id));});
  assert.deepEqual(art,[]);

  // 컷인: 세상이 멈추고, 기력·쿨타임은 먼저 빠지고, 끝나야 맞는다
  await arena(page,['fire'],[[400,190],[400,70]]);
  await tap(page,'KeyR');
  const frozen=await page.evaluate(()=>{const g=window.__jamsildo;return{cut:!!g.cut,clock:g.clock,cd:g.equipped[0].cooldowns.r,energy:g.player.energy,shown:!document.querySelector('#superCut').hidden,name:document.querySelector('#superName').textContent};});
  assert(frozen.cut&&frozen.shown);assert.equal(frozen.name,'초대형 불대포');assert(frozen.cd>0);assert(frozen.energy<100);
  assert.deepEqual(await damaged(page),[0,0],'컷인 중에는 안 맞음');
  await tap(page,'KeyQ');
  await page.waitForTimeout(250);await page.screenshot({path:join(output,'cut-fire.png')});
  assert.equal(await page.evaluate(()=>window.__jamsildo.clock),frozen.clock,'컷인 중 세상 정지');
  assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#minimap')).visibility),'hidden','HUD 물러남');
  await cutOver(page);await page.waitForTimeout(620);
  await page.screenshot({path:join(output,'ult-fire.png')});
  const fire=await damaged(page);
  assert(fire[0]>0,'조준선 위 적');assert.equal(fire[1],0,'조준선 밖 적은 안 맞음');
  assert.equal(await page.evaluate(()=>window.__jamsildo.equipped[0].cooldowns.q),0,'컷인 중 누른 Q는 버려짐');
  assert(await page.evaluate(()=>window.__jamsildo.enemies[0].effects.burn>0),'화상');
  assert(await page.evaluate(()=>window.__jamsildo.senaShowT>0),'세나가 곁에 선다');
  assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#minimap')).visibility),'visible','HUD 복귀');
  console.log('PASS 컷인: 세상 정지, 입력 차단, HUD 복귀, 불대포는 조준선만 타격');

  // 대해일: 조준과 무관하게 방 전체. 지나간 자리의 탄이 씻긴다
  await arena(page,['water'],[[420,120],[520,280]]);
  await page.evaluate(()=>{const g=window.__jamsildo;g.fireEnemy(500,200,Math.PI/2,1,'tear',5,false,'water');});
  assert(await page.evaluate(()=>window.__jamsildo.bullets.length>0));
  await tap(page,'KeyR');await cutOver(page);await page.waitForTimeout(500);
  await page.screenshot({path:join(output,'ult-water.png')});
  await page.waitForTimeout(500);
  const wave=await damaged(page);assert(wave[0]>0&&wave[1]>0,`파도는 방 전체 ${wave}`);
  assert.equal(await page.evaluate(()=>window.__jamsildo.bullets.filter(b=>b.owner==='enemy').length),0,'탄 소거');
  await page.waitForFunction(()=>!window.__jamsildo.supers.length,{timeout:3000});
  assert.equal(await page.evaluate(()=>window.__jamsildo.enemies.filter(e=>e.maxHp-e.hp>0).length),2);
  console.log('PASS 대해일: 방 전체 타격, 탄 소거, 연출 종료');

  // 왼쪽으로도 쏜다
  await arena(page,['water'],[[60,190]]);
  await page.evaluate(()=>{const g=window.__jamsildo;Object.assign(g.player,{x:500,tx:500});});
  await tap(page,'KeyR');await cutOver(page);
  assert.equal(await page.evaluate(()=>window.__jamsildo.supers[0].dir),-1,'왼쪽이면 뒤집힘');
  await page.waitForTimeout(1500);assert((await damaged(page))[0]>0);

  // 빛의 검: 칼이 닿을 때 맞고 성역이 남는다
  await arena(page,['light'],[[230,190]]);
  await tap(page,'KeyR');await cutOver(page);
  assert.equal((await damaged(page))[0],0,'칼이 닿기 전');
  await page.waitForTimeout(650);await page.screenshot({path:join(output,'ult-light.png')});
  assert((await damaged(page))[0]>0,'빛의 검');
  assert(await page.evaluate(()=>window.__jamsildo.zones.some(z=>z.effect==='light')),'성역');
  // 리퍼: 낫이 돌아간 뒤 표식을 벤다
  await arena(page,['dark'],[[240,190]]);
  await page.evaluate(()=>{window.__jamsildo.enemies[0].effects.mark=9;});
  await tap(page,'KeyR');await cutOver(page);
  assert.equal((await damaged(page))[0],0,'낫이 돌기 전');
  await page.waitForTimeout(850);await page.screenshot({path:join(output,'ult-dark.png')});
  assert((await damaged(page))[0]>0,'리퍼');
  console.log('PASS 빛의 검·리퍼: 그림 타이밍에 맞춘 타격, 왼쪽 뒤집기');

  // 그림이 없는 정령도 컷인 후 기존 효과
  await arena(page,['wood'],[[230,190]]);
  await tap(page,'KeyR');
  assert.equal(await page.locator('#superName').textContent(),'숲의 성역');
  await cutOver(page);await page.waitForTimeout(150);
  assert(await page.evaluate(()=>window.__jamsildo.zones.some(z=>z.effect==='heal')),'숲의 성역');
  assert.equal(await page.evaluate(()=>window.__jamsildo.supers.length),0);
  console.log('PASS 나무: 컷인 후 기존 R');

  // 합동 궁극기: 조건과 안내
  await arena(page,['fire'],[[420,190]]);
  assert.equal(await page.locator('#comboSkill').isVisible(),false,'짝 없으면 버튼 없음');
  await tap(page,'KeyF');assert.equal(await page.evaluate(()=>!!window.__jamsildo.cut),false);
  await arena(page,['fire','water'],[[420,190]],1);
  await page.waitForFunction(()=>!document.querySelector('#comboSkill').hidden);
  assert(await page.locator('#comboSkill').isDisabled(),'하급이면 잠김');
  await tap(page,'KeyF');assert.equal(await page.evaluate(()=>!!window.__jamsildo.cut),false,'하급은 불가');
  await arena(page,['fire','water'],[[420,190],[600,60]]);
  await page.evaluate(()=>{window.__jamsildo.equipped[1].cooldowns.r=9;});
  await tap(page,'KeyF');assert.equal(await page.evaluate(()=>!!window.__jamsildo.cut),false,'R 쿨타임 중 불가');
  await page.evaluate(()=>{const g=window.__jamsildo;g.equipped[1].cooldowns.r=0;g.player.energy=10;});
  await tap(page,'KeyF');assert.equal(await page.evaluate(()=>!!window.__jamsildo.cut),false,'기력 부족 불가');
  await page.evaluate(()=>{window.__jamsildo.player.energy=100;});
  await page.waitForFunction(()=>!document.querySelector('#comboSkill').disabled);
  await page.screenshot({path:join(output,'combo-ready.png')});
  await tap(page,'KeyF');
  assert.equal(await page.locator('#superName').textContent(),'증기 나선');
  assert.match(await page.locator('#superLabel').textContent(),/메르 × 쿠이/);
  await page.waitForTimeout(300);await page.screenshot({path:join(output,'cut-steam.png')});
  const spent=await page.evaluate(()=>{const g=window.__jamsildo;return{e:g.player.energy,r:g.equipped.map(s=>s.cooldowns.r)};});
  assert(spent.e<=60);assert(spent.r[0]>0&&spent.r[1]>0,'둘의 R이 함께 돈다');
  await cutOver(page);await page.waitForTimeout(800);await page.screenshot({path:join(output,'combo-steam.png')});
  await page.waitForTimeout(600);
  const steam=await damaged(page);assert(steam[0]>0);assert.equal(steam[1],0,'앞줄 밖은 안 맞음');
  const hits=await page.evaluate(()=>window.__jamsildo.enemies[0].effects.burn>0);assert(hits,'마지막 타격 화상');
  console.log('PASS 증기 나선: 조건 거부 4종, 기력·쿨타임, 판정');

  await arena(page,['light','dark'],[[440,190],[470,120]]);
  await page.evaluate(()=>{const g=window.__jamsildo;g.fireEnemy(100,100,0,1,'tear',5,false,'dark');});
  await tap(page,'KeyF');await cutOver(page);await page.waitForTimeout(800);
  await page.screenshot({path:join(output,'combo-eclipse.png')});
  const eclipse=await page.evaluate(()=>{const g=window.__jamsildo;return{hurt:g.enemies.map(e=>e.maxHp-e.hp),blind:g.enemies.every(e=>e.effects.blind>0),bullets:g.bullets.filter(b=>b.owner==='enemy').length};});
  assert(eclipse.hurt.every(v=>v>0),`일식 범위 ${eclipse.hurt}`);assert(eclipse.blind);assert.equal(eclipse.bullets,0,'탄 전부 소거');
  // 왼쪽이면 정령이 뒤집히지 않고 좌우만 바뀐다
  await arena(page,['light','dark'],[[60,120]]);
  await page.evaluate(()=>{const g=window.__jamsildo;Object.assign(g.player,{x:480,tx:480});});
  await tap(page,'KeyF');await cutOver(page);
  const flip=await page.evaluate(()=>{const s=window.__jamsildo.supers[0];return{dir:s.dir,tilt:s.tilt};});
  assert.equal(flip.dir,-1);assert(Math.abs(flip.tilt)<=0.45,'정령은 크게 기울지 않음');
  await page.waitForTimeout(300);await page.screenshot({path:join(output,'combo-eclipse-left.png')});
  console.log('PASS 일식 베기: 범위, 기절·실명, 탄 소거, 왼쪽 뒤집기');

  // 스테이지 이동·쓰러짐이 컷인을 남기지 않는다
  await arena(page,['fire'],[[420,190]]);
  await tap(page,'KeyR');
  await page.evaluate(()=>{const g=window.__jamsildo;g.enterRoom(g.stage.start,null);});
  assert.deepEqual(await page.evaluate(()=>({cut:window.__jamsildo.cut,hidden:document.querySelector('#superCut').hidden,cls:document.documentElement.classList.contains('super-cut')})),{cut:null,hidden:true,cls:false});
  console.log('PASS 방 이동 시 컷인 정리');

  // 터치: 합동 버튼이 화면 안
  const phone=await browser.newContext({viewport:{width:844,height:390},hasTouch:true,isMobile:true});
  const mobile=await phone.newPage();mobile.on('pageerror',e=>errors.push(e.message));
  await mobile.goto(base);await mobile.waitForFunction(()=>!document.querySelector('#startGame').disabled);
  await mobile.locator('#startGuest').tap();
  await arena(mobile,['fire','water'],[[420,190]]);
  await mobile.waitForFunction(()=>!document.querySelector('#comboSkill').hidden);
  const box=await mobile.evaluate(()=>{const r=document.querySelector('#comboSkill').getBoundingClientRect();return{l:r.left,t:r.top,r:r.right,b:r.bottom,w:innerWidth,h:innerHeight};});
  assert(box.l>=0&&box.t>=0&&box.r<=box.w&&box.b<=box.h,JSON.stringify(box));
  await mobile.locator('#comboSkill').dispatchEvent('pointerdown');
  assert.equal(await mobile.evaluate(()=>!!window.__jamsildo.cut),true,'터치 합동 궁극기');
  await mobile.waitForTimeout(300);await mobile.screenshot({path:join(output,'mobile-cut.png')});
  await phone.close();
  console.log('PASS 터치: 합동 버튼');
  assert.deepEqual(errors,[]);
  console.log(`Screenshots: ${output}`);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
