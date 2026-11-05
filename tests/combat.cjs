// npm run dev first. PLAYWRIGHT_MODULE may point to an existing install.
// 플레이어 피드백 회귀: 벽 순간이동, 근접 중 방사 탄막, 뒤로 빠질 때의 돌진, 방향키로 피하며 공격.
const assert=require('node:assert/strict');
const {join}=require('node:path');
const {tmpdir}=require('node:os');
const {mkdir}=require('node:fs/promises');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.BASE_URL||'http://localhost:5173';
const output=join(tmpdir(),'jamsildo-combat');

(async()=>{
 await mkdir(output,{recursive:true});
 const browser=await chromium.launch();
 const errors=[];
 try{
  const page=await browser.newPage({viewport:{width:1280,height:720}});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.waitForFunction(()=>!document.querySelector('#startGame').disabled);
  await page.locator('#startGuest').click();

  // 벽을 밀어도 벽을 따라갈 뿐 튀지 않는다: 잠긴 방, 열린 방, 집
  const walls=await page.evaluate(async()=>{
   const {FLOOR,CX,CY}=await import('/src/game/config.ts');const g=window.__jamsildo;
   g.openingSeen=true;g.opening=null;g.ui.showCine(false);g.debugStage(3);g.talk=null;g.ui.hideTalk();g.mode='play';
   const room=g.stage.rooms.find(r=>r.kind==='normal');g.enterRoom(room,null);g.enemies=[];
   const r=g.player.r,x0=FLOOR.x+r,x1=FLOOR.x+FLOOR.w-r,y0=FLOOR.y+r,y1=FLOOR.y+FLOOR.h-r,bad=[];
   const push=(x,y,mx,my,label)=>{
    Object.assign(g.player,{x,y,tx:x,ty:y,vx:0,vy:0,moving:false,effects:{},lungeT:0});g.input.move={x:mx,y:my};
    let worst=0;for(let i=0;i<40;i++){const a=g.player.x,b=g.player.y;g.updatePlayer(1/60);worst=Math.max(worst,Math.hypot(g.player.x-a,g.player.y-b));}
    if(worst>4)bad.push(`${label} 한 프레임 ${worst.toFixed(0)}px`);
    return{x:g.player.x,y:g.player.y};
   };
   for(const cleared of [false,true]){room.cleared=cleared;room.doors={n:true,s:true,e:true,w:true};
    for(const x of [x0+6,CX-60,CX+60,x1-6]){const a=push(x,y1,0,1,`아래 ${cleared} ${x}`);if(Math.abs(a.x-x)>0.01||a.y!==y1)bad.push(`아래 ${x}→${a.x}`);const b=push(x,y0,0,-1,`위 ${cleared} ${x}`);if(Math.abs(b.x-x)>0.01)bad.push(`위 ${x}→${b.x}`);}
    for(const y of [y0+6,CY-60,CY+60,y1-6]){const a=push(x0,y,-1,0,`왼쪽 ${cleared} ${y}`);if(Math.abs(a.y-y)>0.01||a.x!==x0)bad.push(`왼쪽 ${y}→${a.y}`);const b=push(x1,y,1,0,`오른쪽 ${cleared} ${y}`);if(Math.abs(b.y-y)>0.01)bad.push(`오른쪽 ${y}→${b.y}`);}
    // 벽을 따라 비비듯 대각선으로 가도 매끄럽다
    push(x0+20,y1,Math.SQRT1_2,Math.SQRT1_2,`비비기 ${cleared}`);
   }
   // 넉백으로 벽에 박혀도 같다
   room.cleared=false;Object.assign(g.player,{x:120,y:y1,tx:120,ty:y1,vy:900,vx:0,moving:false});g.input.move={x:0,y:0};g.updatePlayer(1/60);
   if(g.player.x!==120)bad.push(`넉백 ${g.player.x}`);
   // 문은 그대로 지나간다, 통로 안에서 옆으로 비벼도 튀지 않는다
   room.cleared=true;Object.assign(g.player,{x:CX,y:y1,tx:CX,ty:y1,vx:0,vy:0});g.input.move={x:0,y:1};for(let i=0;i<4;i++)g.updatePlayer(1/60);
   const deep=g.player.y;if(deep<=y1)bad.push('문으로 못 나감');
   g.input.move={x:1,y:0};let worst=0;for(let i=0;i<30;i++){const a=g.player.y;g.updatePlayer(1/60);worst=Math.max(worst,Math.abs(g.player.y-a));}
   if(worst>0.01)bad.push(`통로 안에서 y 튐 ${worst}`);
   g.input.move={x:0,y:0};
   return bad;
  });
  assert.deepEqual(walls,[]);
  console.log('PASS 벽: 잠긴 방·열린 방 네 벽, 넉백, 문 통과, 통로 안 비비기 순간이동 없음');

  // 집: 현관 밖 아래 벽을 밀어도 현관으로 튀지 않는다
  const home=await page.evaluate(async()=>{
   const {FLOOR}=await import('/src/game/config.ts');const {HOME}=await import('/src/game/opening.ts');const g=window.__jamsildo;
   g.startRun();g.mode='play';const r=g.player.r,x=HOME.door.x-60,y=FLOOR.y+FLOOR.h-r;
   Object.assign(g.player,{x,y,tx:x,ty:y,moving:false,vx:0,vy:0});g.input.move={x:0,y:1};for(let i=0;i<20;i++)g.updatePlayer(1/60);g.input.move={x:0,y:0};
   return{moved:Math.abs(g.player.x-x)};
  });
  assert(home.moved<0.01,`집 ${home.moved}`);
  console.log('PASS 집: 현관 밖 벽');

  // 방사 탄: 붙어 있으면 안 맞고, 예고 원이 먼저 뜬다
  const ring=await page.evaluate(()=>{
   const g=window.__jamsildo;g.debugStage(1);g.talk=null;g.ui.hideTalk();g.mode='play';g.attackUnlocked=true;g.enterRoom(g.stage.boss,null);g.talk=null;g.mode='play';
   const boss=g.enemies.find(e=>e.boss?.main);boss.spawnT=0;boss.x=320;boss.y=190;boss.boss.flags.clear();
   const run=(px,py,hold)=>{g.player.hp=g.player.maxHp;g.player.invuln=0;g.bullets=[];g.zones=[];g.events=[];Object.assign(g.player,{x:px,y:py,tx:px,ty:py,moving:false,vx:0,vy:0});g.input.move={x:0,y:0};
    boss.state='idle';boss.t=999;boss.vx=boss.vy=0;g.bossPattern(boss,'slash_ring');
    const warned=g.zones.some(z=>z.shape==='ring');let first=null;
    for(let i=0;i<200&&g.mode==='play';i++){g.updateEffects(1/60);g.updateBullets(1/60);g.updateZones(1/60);g.player.invuln=0;if(g.bullets.length&&first===null)first=i/60;Object.assign(g.player,{x:px,y:py});if(i>=hold)break;}
    return{warned,first,hp:g.player.hp,max:g.player.maxHp,nearest:g.bullets.length?Math.min(...g.bullets.map(b=>Math.hypot(b.x-boss.x,b.y-boss.y))):null};};
   const hug=run(boss.x-boss.r-10,boss.y,110);
   const mid=run(boss.x-boss.r-44,boss.y,200);
   return{hug,mid,r:boss.r};
  });
  assert(ring.hug.warned,'예고 원');assert(ring.hug.first>=0.7,`예고 시간 ${ring.hug.first}`);
  assert.equal(ring.hug.hp,ring.hug.max,`붙어 있으면 안 맞음 ${JSON.stringify(ring.hug)}`);
  assert(ring.mid.hp<ring.mid.max||ring.mid.first!==null,'원 밖은 위험');
  console.log(`PASS 방사 탄: 예고 ${ring.hug.first.toFixed(2)}초, 원 안쪽 무피해`);

  // 뒤로 빠질 때는 돌진 없음, 앞으로 갈 때는 그대로
  const lunge=await page.evaluate(()=>{
   const g=window.__jamsildo;g.debugStage(3);g.talk=null;g.ui.hideTalk();g.mode='play';g.attackUnlocked=true;
   const rm=g.stage.rooms.find(r=>r.kind==='normal');g.enterRoom(rm,null);const e=g.makeEnemy('bother',360,190,0);e.effects={stun:99};g.enemies=[e];
   const swing=tx=>{Object.assign(g.player,{x:320,y:190,tx,ty:190,moving:true,cd:0,lungeT:0,effects:{}});g.pending=null;g.startAttack();return g.player.lungeT;};
   return{away:swing(200),toward:swing(400)};
  });
  assert.equal(lunge.away,0,'뒤로 빠질 때 돌진 금지');assert(lunge.toward>0,'다가갈 때 돌진');
  console.log('PASS 돌진: 뒤로 빠지면 끌려가지 않음');

  // 우클릭 지정 후 방향키로 피해도 닿으면 계속 친다
  const box=await page.locator('#game').boundingBox();
  await page.evaluate(()=>{const g=window.__jamsildo;g.debugStage(3);g.talk=null;g.ui.hideTalk();g.mode='play';g.attackUnlocked=true;g.cheats.health=true;g.weapon='bow';
   const rm=g.stage.rooms.find(r=>r.kind==='normal');g.enterRoom(rm,null);rm.cleared=false;const e=g.makeEnemy('bother',360,190,0);e.hp=e.maxHp=100000;e.weight=1000;e.state='rest';e.t=999;e.effects={stun:999};g.enemies=[e];Object.assign(g.player,{x:330,y:190,tx:330,ty:190,moving:false,cd:0});});
  await page.mouse.click(box.x+360/640*box.width,box.y+186/360*box.height,{button:'right'});await page.waitForTimeout(100);
  await page.keyboard.down('ArrowDown');await page.waitForTimeout(160);
  const hp=await page.evaluate(()=>window.__jamsildo.enemies[0].hp);await page.waitForTimeout(340);
  await page.keyboard.up('ArrowDown');await page.waitForTimeout(450); // 활 재사용 0.62초 + 화살 비행
  const during=await page.evaluate(()=>({hp:window.__jamsildo.enemies[0].hp,order:!!window.__jamsildo.attackOrder,form:window.__jamsildo.player.form,edge:Math.hypot(window.__jamsildo.player.x-360,window.__jamsildo.player.y-190)-9}));
  assert(during.order,'지시 유지');assert(during.hp<hp,`피하면서 계속 공격 ${JSON.stringify(during)} ${hp}`);
  await page.waitForTimeout(300);
  const after=await page.evaluate(()=>({moving:window.__jamsildo.player.moving}));
  assert.equal(after.moving,false,'방향키를 떼도 적에게 다시 끌려가지 않음');
  console.log('PASS 지시: 방향키로 피하며 공격, 뗀 뒤 자동 추적 없음');
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
