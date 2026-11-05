// npm run dev first. PLAYWRIGHT_MODULE may point to an existing install.
// PC 조작(방향키·우클릭·좌클릭·QWER), 타이틀 시작, 게스트 재시작을 실제 입력으로 확인한다.
const assert=require('node:assert/strict');
const {join}=require('node:path');
const {tmpdir}=require('node:os');
const {mkdir}=require('node:fs/promises');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.BASE_URL||'http://localhost:5173';
const output=join(tmpdir(),'jamsildo-controls');

async function arena(page,stage=3){
 await page.evaluate(stage=>{
  const g=window.__jamsildo;g.openingSeen=true;g.opening=null;g.ui.showCine(false);g.debugStage(stage);
  const room=g.stage.rooms.find(r=>r.kind==='normal'||r.kind==='fight')??g.stage.start;
  g.enterRoom(room,null);g.talk=null;g.ui.hideTalk();g.mode='play';g.attackUnlocked=true;
  g.cheats.health=true;
 },stage);
 await page.waitForFunction(()=>window.__jamsildo.enemies.some(e=>e.spawnT<=0&&!e.faced),{timeout:8000});
}
/** 적 하나만 남겨 세워 둔다: 입력 결과만 본다 */
const pin=(page,x,y)=>page.evaluate(([x,y])=>{
 const g=window.__jamsildo,e=g.activeEnemies()[0];g.enemies=[e];
 e.x=x;e.y=y;e.hp=e.maxHp=100000;e.weight=1000;e.state='rest';e.t=999;e.effects={stun:999};
 Object.assign(g.player,{x:200,y:180,tx:200,ty:180,vx:0,vy:0,moving:false,cd:0});g.bullets=[];g.zones=[];
 return e.id;
},[x,y]);
const screen=async(page,x,y)=>{const b=await page.locator('#game').boundingBox();return[b.x+x/640*b.width,b.y+y/360*b.height];};

(async()=>{
 await mkdir(output,{recursive:true});
 const browser=await chromium.launch();
 const errors=[];
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.waitForFunction(()=>!document.querySelector('#startGame').disabled);

  // 타이틀: 로그인 전에는 눌러도 제자리인 버튼이 없다. 게스트 한 번이면 시작한다.
  assert.equal(await page.locator('#startGame').isVisible(),false);
  for(const id of ['#startGuest','#startRegister','#startLogin'])assert(await page.locator(id).isVisible(),id);
  await page.screenshot({path:join(output,'title.png')});
  await page.locator('#startGuest').click();
  assert.equal(await page.evaluate(()=>window.__jamsildo.mode),'opening');
  console.log('PASS 타이틀: 게스트 한 번에 시작');

  // 방향키
  await arena(page);await pin(page,520,300);
  await page.keyboard.down('ArrowRight');await page.waitForTimeout(200);
  let p=await page.evaluate(()=>({x:window.__jamsildo.player.x,y:window.__jamsildo.player.y}));
  assert(p.x>205&&Math.abs(p.y-180)<1,`방향키 오른쪽 ${JSON.stringify(p)}`);
  await page.keyboard.down('ArrowDown');await page.waitForTimeout(150);
  const q=await page.evaluate(()=>({x:window.__jamsildo.player.x,y:window.__jamsildo.player.y}));
  assert(q.x>p.x&&q.y>p.y,'방향키 대각선');
  await page.keyboard.up('ArrowRight');await page.keyboard.up('ArrowDown');await page.waitForTimeout(60);
  const stopped=await page.evaluate(()=>window.__jamsildo.player.x);await page.waitForTimeout(120);
  assert.equal(await page.evaluate(()=>window.__jamsildo.player.x),stopped,'손을 떼면 멈춤');
  console.log('PASS 방향키: 이동·대각선·정지');

  // 좌클릭: 바닥은 이동하지 않고, 적은 정보만 연다
  await pin(page,420,180);
  await page.mouse.click(...await screen(page,300,250));await page.waitForTimeout(80);
  assert.equal(await page.evaluate(()=>window.__jamsildo.player.moving),false,'좌클릭으로 이동하면 안 됨');
  assert.equal(await page.locator('#enemyInfo').isVisible(),false);
  await page.mouse.click(...await screen(page,420,176));await page.waitForTimeout(80);
  assert(await page.locator('#enemyInfo').isVisible(),'적 정보');
  const info=await page.locator('#enemyInfo').innerText();assert(/체력/.test(info),info);
  const hit=await page.evaluate(()=>({moving:window.__jamsildo.player.moving,order:window.__jamsildo.attackOrder}));
  assert.equal(hit.moving,false);assert.equal(hit.order,null,'좌클릭은 공격 아님');
  await page.screenshot({path:join(output,'info.png')});
  await page.mouse.click(...await screen(page,300,250));await page.waitForTimeout(80);
  assert.equal(await page.locator('#enemyInfo').isVisible(),false,'빈 곳 좌클릭으로 닫힘');
  console.log('PASS 좌클릭: 적 정보, 이동·공격 안 함');

  // 우클릭: 바닥은 이동, 적은 쫓아가서 공격
  await pin(page,520,180);
  await page.mouse.click(...await screen(page,300,250),{button:'right'});await page.waitForTimeout(60);
  assert(await page.evaluate(()=>window.__jamsildo.player.moving),'우클릭 이동');
  await pin(page,520,180);
  await page.mouse.click(...await screen(page,520,176),{button:'right'});await page.waitForTimeout(2800);
  const chase=await page.evaluate(()=>{const g=window.__jamsildo,e=g.enemies[0];return{x:g.player.x,hp:e.hp,max:e.maxHp,order:!!g.attackOrder};});
  assert(chase.x>300,`쫓아감 ${chase.x}`);assert(chase.hp<chase.max,'때림');assert(chase.order,'지시 유지');
  await page.screenshot({path:join(output,'attack.png')});
  await page.keyboard.down('ArrowLeft');await page.waitForTimeout(80);await page.keyboard.up('ArrowLeft');
  assert(await page.evaluate(()=>!!window.__jamsildo.attackOrder),'방향키로 피해도 지시 유지');
  await pin(page,520,180);
  await page.mouse.click(...await screen(page,520,176),{button:'right'});await page.waitForTimeout(60);
  await page.mouse.click(...await screen(page,240,120),{button:'right'});await page.waitForTimeout(60);
  assert.equal(await page.evaluate(()=>window.__jamsildo.attackOrder),null,'바닥 우클릭으로 지시 취소');
  console.log('PASS 우클릭: 이동, 적 추적 공격, 취소');

  // QWER
  await page.evaluate(async()=>{const g=window.__jamsildo,{newSpirit}=await import('/src/game/campaign.ts');g.equipped.length=0;const s=newSpirit('fire');s.tier=3;g.equipped.push(s);g.acquired.add('fire');g.hasSpirit=true;g.activeSpirit=0;g.cheats.energy=true;});
  for(const key of ['q','w','e','r']){
   await page.evaluate(()=>{const g=window.__jamsildo;for(const k of 'qwer')g.equipped[0].cooldowns[k]=0;g.player.energy=g.player.maxEnergy;g.pendingCast=null;});
   await page.keyboard.press(`Key${key.toUpperCase()}`);await page.waitForTimeout(90);
   assert(await page.evaluate(k=>window.__jamsildo.equipped[0].cooldowns[k]>0,key),`스킬 ${key}`);
  }
  console.log('PASS QWER: 네 스킬 발동');

  // 게스트 재시작: 쓰러진 스테이지에서 다시 시작하고, 기기에는 남기지 않는다
  await page.evaluate(()=>{const g=window.__jamsildo;g.cheats.health=false;g.player.warmth=33;g.saveCheckpoint();g.playerDown();});
  await page.waitForFunction(()=>document.querySelector('#down').classList.contains('is-on'),{timeout:8000});
  await page.waitForTimeout(800);await page.screenshot({path:join(output,'down.png')});
  await page.mouse.click(700,500);await page.waitForTimeout(300);
  const retry=await page.evaluate(()=>{const g=window.__jamsildo;return{mode:g.mode,stage:g.stage.number,hp:g.player.hp,max:g.player.maxHp,warmth:g.player.warmth,on:document.querySelector('#down').classList.contains('is-on'),saved:Object.keys(localStorage).filter(k=>k.endsWith('campaign'))};});
  assert.equal(retry.mode,'play');assert.equal(retry.on,false);assert.equal(retry.stage,3);assert.equal(retry.hp,retry.max);assert.equal(retry.warmth,33);assert.deepEqual(retry.saved,[]);
  // 키보드로도, 두 번째 쓰러짐에서도
  await page.evaluate(()=>window.__jamsildo.playerDown());
  await page.waitForFunction(()=>document.querySelector('#down').classList.contains('is-on'),{timeout:8000});await page.waitForTimeout(800);
  await page.keyboard.press('Enter');await page.waitForTimeout(200);
  assert.equal(await page.evaluate(()=>window.__jamsildo.mode),'play');
  console.log('PASS 게스트 재시작: 클릭·Enter, 스테이지 유지, 기기 저장 없음');

  // 로그인 상태 타이틀: 선택지 대신 게임 시작 (계정 서버는 응답만 흉내 낸다)
  const signed=await browser.newPage({viewport:{width:1440,height:900}});
  signed.on('pageerror',e=>errors.push(e.message));
  await signed.route('**/api/account',route=>route.fulfill({json:{user:{id:'qa-local',username:'qa',is_admin:false,blocked:false,created_at:new Date().toISOString(),last_seen:new Date().toISOString(),play_seconds:0,stage:1,max_stage:1},save:{checkpoint:null,revision:0,updated_at:new Date().toISOString()}}}));
  await signed.goto(base);await signed.waitForFunction(()=>!document.querySelector('#startGame').disabled);
  assert(await signed.locator('#startGame').isVisible());assert.equal(await signed.locator('#startChoice').isVisible(),false);
  await signed.locator('#startGame').click();
  assert.equal(await signed.evaluate(()=>window.__jamsildo.mode),'opening');
  console.log('PASS 로그인 타이틀: 게임 시작 한 번에 시작');
  assert.deepEqual(errors,[]);
  console.log(`Screenshots: ${output}`);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
