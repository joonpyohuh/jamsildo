// npm run dev first. PLAYWRIGHT_MODULE may point to an existing install.
// 정령 3칸, 스테이지별 상점, 보온병, Space 줍기, 아이템 창을 실제 입력으로 확인한다.
const assert=require('node:assert/strict');
const {join}=require('node:path');
const {tmpdir}=require('node:os');
const {mkdir}=require('node:fs/promises');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.BASE_URL||'http://localhost:5173';
const output=join(tmpdir(),'jamsildo-items');

/** 지정한 종류의 방에 대사 없이 들어간다 */
const enter=(page,stage,kind)=>page.evaluate(([stage,kind])=>{
 const g=window.__jamsildo;g.skipAugments=true;g.openingSeen=true;g.opening=null;g.ui.showCine(false);
 if(g.stage.number!==stage||g.mode==='title'||g.mode==='opening'){const kept=g.artifacts;g.debugStage(stage);g.artifacts=kept;}
 g.talk=null;g.ui.hideTalk();g.mode='play';g.attackUnlocked=true;g.cheats.health=true;
 g.enterRoom(g.stage.rooms.find(r=>r.kind===kind),null);
},[stage,kind]);
const walkTo=(page,x,y)=>page.evaluate(([x,y])=>Object.assign(window.__jamsildo.player,{x,y,tx:x,ty:y,moving:false}),[x,y]);
const tap=async(page,key)=>{await page.keyboard.down(key);await page.waitForTimeout(60);await page.keyboard.up(key);await page.waitForTimeout(60);};
/** 스테이지를 옮기지 않고 방을 비운다 */
const clearRoom=page=>page.evaluate(()=>{const g=window.__jamsildo;g.skipAugments=true;for(const e of g.enemies)g.faceEnemy(e,false);});

(async()=>{
 await mkdir(output,{recursive:true});
 const browser=await chromium.launch();
 const errors=[];
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.waitForFunction(()=>!document.querySelector('#startGame').disabled);
  await page.locator('#startGuest').click();

  // 스테이지마다 상점은 정확히 하나, 시작방과 안 겹치고 닿을 수 있다
  const shops=await page.evaluate(async()=>{
   const {generateStage,DIRS,neighborOf}=await import('/src/game/stage.ts');let maps=0;
   for(let n=1;n<=20;n++)for(let i=0;i<50;i++){
    const s=generateStage(n),list=s.rooms.filter(r=>r.kind==='shop');
    if(list.length!==1||list[0]===s.start||!list[0].cleared||list[0].wave.length)throw Error(`shop ${n}`);
    const seen=new Set([s.start]),q=[s.start];
    for(const r of q)for(const d of Object.keys(DIRS))if(r.doors[d]){const x=neighborOf(s,r,d);if(x&&!seen.has(x)){seen.add(x);q.push(x);}}
    if(!seen.has(list[0]))throw Error('unreachable shop');maps++;
   }
   return maps;
  });assert.equal(shops,1000);
  console.log('PASS 상점: 20스테이지 × 50맵 전부 정확히 하나');

  // 정령: 1스테이지에서도 3개 다 유지, Tab으로 전부 순환
  await enter(page,1,'spirit');await clearRoom(page);
  for(let i=0;i<5;i++){
   await page.evaluate(()=>{const g=window.__jamsildo;g.skipAugments=true;g.room.rewarded=false;g.spirit={x:320,y:170,state:'waiting',t:1};g.takeSpirit();});
   assert.equal(await page.locator('#rewardChoices .menu-button').count(),0,'빈 슬롯이면 교체 안내 없음');
   await page.locator('.spirit-choice').first().click();
   await page.evaluate(()=>{const g=window.__jamsildo;g.skipAugments=true;g.talk=null;g.ui.hideTalk();g.mode='play';});
  }
  const owned=await page.evaluate(()=>window.__jamsildo.equipped.map(s=>s.element));
  assert.equal(owned.length,5);assert.equal(new Set(owned).size,5);
  const seen=new Set();
  for(let i=0;i<5;i++){await page.evaluate(()=>{window.__jamsildo.switchCd=0;});await page.keyboard.press('Tab');await page.waitForTimeout(40);seen.add(await page.evaluate(()=>window.__jamsildo.equipped[window.__jamsildo.activeSpirit].element));}
  assert.equal(seen.size,5,'Tab으로 다섯 다 선택');
  console.log('PASS 정령: 1스테이지 5칸, Tab으로 다섯 순환');


  // 상점: 보온병을 사면 기력 회복이 실제로 빨라진다
  const rate=()=>page.evaluate(()=>{const g=window.__jamsildo;g.skipAugments=true;g.zones=[];g.player.energy=0;g.updateSkills(1);return g.player.energy;});
  await enter(page,1,'normal');await page.evaluate(()=>{const g=window.__jamsildo;g.skipAugments=true;g.enemies=[];g.room.cleared=true;});
  assert.equal(await rate(),1);
  await page.evaluate(()=>{window.__jamsildo.player.warmth=30;});
  await enter(page,1,'shop');
  await page.waitForFunction(()=>document.querySelector('#rewardDialog').open);
  await page.screenshot({path:join(output,'shop.png')});
  await page.locator('[data-artifact=thermos]').click();
  assert(await page.evaluate(()=>document.querySelector('#rewardDialog').open),'더 살 게 있으면 창 유지');
  assert.equal(await page.locator('[data-artifact=thermos]').count(),0,'같은 방에서 두 번 못 삼');
  assert.equal(await page.evaluate(()=>window.__jamsildo.player.warmth),18);
  await page.locator('[data-artifact=meal]').click();
  await page.locator('#rewardChoices .menu-button').click();
  assert.equal(await page.evaluate(()=>window.__jamsildo.player.warmth),10);
  assert.equal(await rate(),1.25);
  await page.evaluate(()=>{const g=window.__jamsildo;g.skipAugments=true;g.room.rewarded=false;g.room.bought=[];g.artifacts.thermos=5;g.player.warmth=2;g.openShop(g.room);});
  assert.equal(await page.locator('[data-artifact=thermos]').count(),0,'보온병 5개 상한');
  assert(await page.locator('[data-artifact=meal]').isDisabled(),'온기 부족');
  await page.locator('#rewardChoices .menu-button').click();
  await page.evaluate(()=>{const g=window.__jamsildo;g.skipAugments=true;g.artifacts.thermos=1;});
  console.log('PASS 상점: 품목별 구매, 온기 차감, 보온병 25%·상한, 온기 부족');

  // 하드방: 가운데에 뜨고, 밟아도 자동으로 안 먹고, Space로 먹는다
  await enter(page,3,'hard');
  assert.equal(await page.evaluate(()=>window.__jamsildo.drop),null,'비우기 전에는 없음');
  await clearRoom(page);await page.waitForFunction(()=>window.__jamsildo.room.cleared,{timeout:8000});
  const it=await page.evaluate(()=>{const g=window.__jamsildo;g.skipAugments=true;return{x:g.drop.x,y:g.drop.y,kind:g.drop.kind};});
  assert(it.kind,'하드방 보상');const center=await page.evaluate(async()=>{const c=await import('/src/game/config.ts');return{x:c.CX,y:c.CY};});assert.equal(it.x,center.x);assert.equal(it.y,center.y);
  await walkTo(page,120,120);await tap(page,'Space');
  assert(await page.evaluate(()=>!!window.__jamsildo.drop),'멀면 안 주워짐');
  await walkTo(page,it.x,it.y+8);await page.waitForTimeout(500);
  assert(await page.evaluate(()=>!!window.__jamsildo.drop),'자동 획득 금지');
  assert.match(await page.locator('#pickHint').textContent(),/Space/);
  await page.screenshot({path:join(output,'pickup.png')});
  // 안 줍고 나갔다 와도 남아 있다
  await enter(page,3,'normal');assert.equal(await page.evaluate(()=>window.__jamsildo.drop),null,'다른 방으로 따라오지 않음');
  await page.evaluate(()=>{const g=window.__jamsildo;g.skipAugments=true;g.enemies=[];g.room.cleared=true;});
  await enter(page,3,'hard');assert(await page.evaluate(()=>!!window.__jamsildo.drop),'돌아오면 그 자리');
  const before=await page.evaluate(()=>{const g=window.__jamsildo;g.skipAugments=true;return{attack:g.runAttack,energy:g.player.maxEnergy};});
  await walkTo(page,it.x,it.y+8);await tap(page,'Space');
  const after=await page.evaluate(()=>{const g=window.__jamsildo;g.skipAugments=true;return{attack:g.runAttack,energy:g.player.maxEnergy,item:g.drop,rewarded:g.room.rewarded,hint:document.querySelector('#pickHint').hidden};});
  assert.equal(after.item,null);assert(after.rewarded);assert(after.hint);
  await enter(page,3,'normal');await page.evaluate(()=>{const g=window.__jamsildo;g.skipAugments=true;g.enemies=[];g.room.cleared=true;});
  await enter(page,3,'hard');assert.equal(await page.evaluate(()=>window.__jamsildo.drop),null,'두 번 안 나옴');
  console.log('PASS 하드방: 가운데 등장, 자동 획득 없음, Space 획득, 재입장 유지, 중복 없음');

  // 보스 드롭: 주울 때까지 클리어로 넘어가지 않는다
  await enter(page,3,'boss');
  await page.evaluate(()=>{const g=window.__jamsildo,b=g.enemies.find(e=>e.boss?.main);b.spawnT=0;g.player.maxHp=100;g.player.maxEnergy=40;g.hitEnemy(b,1e7,0,0,true);});
  await page.waitForTimeout(4600);
  const waiting=await page.evaluate(()=>{const g=window.__jamsildo;g.skipAugments=true;return{mode:g.mode,drop:g.drop&&{x:g.drop.x,y:g.drop.y},t:g.endingT};});
  assert.equal(waiting.mode,'play',`보스 드롭 대기 ${JSON.stringify(waiting)}`);assert(waiting.drop);assert(waiting.t>3.4);
  await walkTo(page,waiting.drop.x,waiting.drop.y+8);await tap(page,'Space');
  await page.waitForFunction(()=>window.__jamsildo.mode==='clear',{timeout:3000});
  console.log('PASS 보스 드롭: Space로 주워야 클리어');
  await page.waitForTimeout(800);await page.mouse.click(700,500);await page.waitForTimeout(300);

  // 아이템 창: I로 열고 닫고, 열려 있으면 멈춘다
  assert.equal(await page.evaluate(()=>window.__jamsildo.mode),'play');
  await page.evaluate(()=>{const g=window.__jamsildo;g.skipAugments=true;g.talk=null;g.ui.hideTalk();g.mode='play';});
  await page.keyboard.press('KeyI');await page.waitForTimeout(80);
  assert(await page.evaluate(()=>document.querySelector('#artifactDialog').open),'I 열기');
  const list=await page.locator('#artifactList').innerText();
  for(const name of ['보온병','선식'])assert(list.includes(name),`${name} in ${list}`);
  assert.match(await page.locator('#artifactStats').innerText(),/초당 1\.25/);
  await page.screenshot({path:join(output,'inventory.png')});
  const clock=await page.evaluate(()=>window.__jamsildo.clock);await page.waitForTimeout(200);
  assert.equal(await page.evaluate(()=>window.__jamsildo.clock),clock,'창이 열리면 게임 정지');
  await page.keyboard.press('KeyI');await page.waitForTimeout(80);
  assert.equal(await page.evaluate(()=>document.querySelector('#artifactDialog').open),false,'I 닫기');
  await page.locator('#artifactsToggle').click();assert(await page.evaluate(()=>document.querySelector('#artifactDialog').open),'버튼 열기');
  await page.keyboard.press('Escape');await page.waitForTimeout(80);
  assert.equal(await page.evaluate(()=>document.querySelector('#artifactDialog').open),false,'Esc 닫기');
  console.log('PASS 아이템 창: I·버튼·Esc, 목록, 능력치, 일시정지');

  // 재시작과 저장: 아이템과 보온병 효과가 유지된다
  const saved=await page.evaluate(()=>{const g=window.__jamsildo;g.skipAugments=true;g.cheats.health=false;g.playerDown();return JSON.parse(g.sessionCheckpoint).artifacts;});
  assert.equal(saved.thermos,1);
  await page.waitForFunction(()=>document.querySelector('#down').classList.contains('is-on'),{timeout:8000});await page.waitForTimeout(800);
  await page.mouse.click(700,500);await page.waitForTimeout(300);
  assert.deepEqual(await page.evaluate(()=>({mode:window.__jamsildo.mode,thermos:window.__jamsildo.artifacts.thermos,rate:window.__jamsildo.energyRate})),{mode:'play',thermos:1,rate:1.25});
  console.log('PASS 재시작: 아이템·기력 회복 유지');

  // 좁은 화면에서도 창이 잘리지 않는다
  await page.setViewportSize({width:667,height:375});await page.waitForTimeout(200);
  await page.evaluate(()=>{const g=window.__jamsildo;g.skipAugments=true;g.talk=null;g.ui.hideTalk();g.mode='play';});
  await page.locator('#artifactsToggle').click();await page.waitForTimeout(100);
  const box=await page.evaluate(()=>{const r=document.querySelector('#artifactDialog').getBoundingClientRect();return{top:r.top,bottom:r.bottom,h:innerHeight};});
  assert(box.top>=0&&box.bottom<=box.h,JSON.stringify(box));
  await page.screenshot({path:join(output,'inventory-small.png')});
  assert.deepEqual(errors,[]);
  console.log(`Screenshots: ${output}`);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
