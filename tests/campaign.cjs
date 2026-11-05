// Run with the Vite dev server running. PLAYWRIGHT_MODULE can point to an existing install.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const fs=require('node:fs/promises');
(async()=>{
 const browser=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{});
 const output=join(tmpdir(),'jamsildo-campaign');await fs.mkdir(output,{recursive:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.url().startsWith('http://localhost:5173')&&response.status()>=400)errors.push(`${response.status()} ${response.url()}`)});
  await page.goto('http://localhost:5173');await page.waitForFunction(()=>!document.querySelector('#startGame').disabled);
  const topology=await page.evaluate(async()=>{
   const {generateStage,DIRS,neighborOf}=await import('/src/game/stage.ts');
   const {ART}=await import('/src/game/assets.ts');
   let maps=0;
   for(let number=1;number<=20;number++)for(let repeat=0;repeat<50;repeat++){
    const stage=generateStage(number),boss=stage.rooms.filter(room=>room.kind==='boss');
    if(boss.length!==1||boss[0]!==stage.boss||Object.values(stage.boss.doors).filter(Boolean).length!==1)throw Error(`missing boss ${number}`);
    const visited=new Set([stage.start]),queue=[stage.start];
    for(const room of queue)for(const [dir,delta]of Object.entries(DIRS))if(room.doors[dir]){
     const next=neighborOf(stage,room,dir);if(!next||!next.doors[delta.opp])throw Error('broken doorway');
     if(!visited.has(next)){visited.add(next);queue.push(next);}
    }
    if(visited.size!==stage.rooms.length||!visited.has(stage.boss)||stage.boss.cleared)throw Error('unreachable boss');
    maps++;
   }
   const random=Math.random;try{Math.random=()=>0;const stage=generateStage(20);if(!stage.boss)throw Error('fallback failed');}finally{Math.random=random;}
   return {maps,art:ART.size};
  });assert.equal(topology.maps,1000);assert.equal(topology.art,124);console.log('PASS 1,000 maps: exactly one reachable boss, reciprocal doors, fallback, 124 sprites');
  const movement=await page.evaluate(async()=>{
   const {FLOOR,CX,CY}=await import('/src/game/config.ts');
   const g=window.__jamsildo;g.debugStage(1);g.enterRoom(g.stage.start,null);
   const reset=()=>{Object.assign(g.player,{x:320,y:180,tx:320,ty:180,vx:0,vy:0,lungeT:0,effects:{},slowFactor:0.5});g.reverseTime=0;};
   reset();g.input.move={x:1,y:0};g.updatePlayer(0.1);if(Math.abs(g.player.x-335)>0.001)throw Error('joystick speed');
   reset();g.input.move={x:Math.SQRT1_2,y:Math.SQRT1_2};g.updatePlayer(0.1);if(Math.abs(Math.hypot(g.player.x-320,g.player.y-180)-15)>0.001)throw Error('diagonal speed boost');
   reset();g.input.move={x:0.5,y:0};g.updatePlayer(0.1);if(Math.abs(g.player.x-327.5)>0.001)throw Error('analog movement');
   reset();g.input.move={x:1,y:0};g.player.effects.slow=2;g.updatePlayer(0.1);if(Math.abs(g.player.x-327.5)>0.001)throw Error('slow effect ignored');
   reset();g.reverseTime=2;g.updatePlayer(0.1);if(Math.abs(g.player.x-305)>0.001)throw Error('reversed controls');
   reset();g.player.effects.root=2;g.updatePlayer(0.1);if(g.player.x!==320)throw Error('root effect ignored');
   reset();g.input.move={x:0,y:0};g.player.moving=true;g.player.tx=380;g.updatePlayer(0.1);if(g.player.x!==320||g.player.moving)throw Error('joystick release drift');
   reset();g.moveTo(380,180,false);g.updatePlayer(0.1);if(g.player.x<=320||g.input.move!==null)throw Error('click movement regression');
   reset();g.room.cleared=false;g.player.x=FLOOR.x+g.player.r;g.input.move={x:-1,y:0};g.updatePlayer(0.5);if(g.player.x!==FLOOR.x+g.player.r)throw Error('wall collision ignored');
   let doors=0;
   for(const [dir,dx,dy]of [['w',-1,0],['e',1,0],['n',0,-1],['s',0,1]]){
    const room=g.stage.rooms.find(r=>r.kind!=='boss'&&r.doors[dir]);if(!room)throw Error(`missing test doorway ${dir}`);
    g.enterRoom(room,null);reset();g.room.cleared=true;g.enemies=[];g.endingT=-1;
    g.player.x=dx<0?FLOOR.x+g.player.r:dx>0?FLOOR.x+FLOOR.w-g.player.r:CX;
    g.player.y=dy<0?FLOOR.y+g.player.r:dy>0?FLOOR.y+FLOOR.h-g.player.r:CY;
    g.input.move={x:dx,y:dy};g.updatePlayer(0.5);g.checkExit();if(g.mode!=='slide')throw Error(`joystick cannot leave ${dir} door`);doors++;
   }
   const {HOME}=await import('/src/game/opening.ts');g.startRun();reset();g.player.x=HOME.door.x+HOME.door.w/2;g.player.y=FLOOR.y+FLOOR.h-5;g.input.move={x:0,y:1};
   for(let i=0;i<20&&g.mode==='play';i++){g.updatePlayer(0.016);g.checkExit();}
   if(g.mode!=='slide')throw Error('joystick cannot leave home over multiple frames');
   g.input.move={x:0,y:0};return doors;
  });assert.equal(movement,4);console.log('PASS joystick analog/diagonal speed, slow/root/reverse, stop, desktop click, walls, four doors and home exit');
  const mechanics=await page.evaluate(async()=>{
   const {BOSSES,newSpirit,SKILLS}=await import('/src/game/campaign.ts');
   const {contains,tickStatuses}=await import('/src/game/combat.ts');
   const g=window.__jamsildo;let patterns=0,skills=0;
   for(let number=1;number<=20;number++){
    g.debugStage(number);g.enterRoom(g.stage.boss,null);const boss=g.enemies.find(e=>e.boss?.main);
    if(!boss||boss.boss.id!==g.stage.bossId||boss.hp!==BOSSES[g.stage.bossId].hp)throw Error(`boss data ${number}`);
    g.player.invuln=10000;
    for(const pattern of BOSSES[boss.boss.id].patterns){
     g.enemies=[boss];boss.faced=false;boss.hp=boss.maxHp;boss.boss.invulnerable=false;boss.boss.phase=0;boss.boss.elapsed=0;boss.boss.flags.clear();boss.effects={};
     g.events=[];g.zones=[];g.bullets=[];g.mode='play';g.endingT=-1;g.hitstop=0;g.timeScale=1;
     g.bossPattern(boss,pattern);
     for(let step=0;step<110;step++)g.update(0.05);
     if(!Number.isFinite(g.player.x+g.player.y)||g.enemies.some(e=>!Number.isFinite(e.x+e.y+e.hp)))throw Error(`NaN ${number} ${pattern}`);
     patterns++;
    }
    g.events=[];g.zones=[];g.enemies=[boss];boss.hp=boss.maxHp*0.04;boss.boss.phase=0;boss.boss.stagger=0;boss.state='idle';boss.t=0;boss.boss.flags.clear();boss.boss.invulnerable=false;g.mode='play';
    g.aiBoss(boss,0.05);
    if(boss.boss.phase!==BOSSES[boss.boss.id].phases.length)throw Error(`phase ${number}`);
    boss.boss.stagger=0.1;boss.boss.invulnerable=false;boss.boss.flags.add('whisper');boss.boss.qteTime=0;
    g.aiBoss(boss,0.05);boss.t-=0.1;g.aiBoss(boss,0.1);
    if(boss.state==='stun')throw Error(`boss stuck after stagger ${number}`);
   }
   for(const element of ['water','wood','fire','dark','light','chaos'])for(const key of ['q','w','e','r']){
    g.debugStage(10);g.player.maxEnergy=g.player.energy=100;g.player.invuln=10000;g.player.hp=20;
    const slot=newSpirit(element);slot.tier=3;g.equipped.push(slot);g.hasSpirit=true;
    g.player.x=g.player.tx=180;g.player.y=g.player.ty=150;
    const target=g.makeEnemy('bother',250,150,0);target.hp=target.maxHp=10000;g.enemies=[target];g.events=[];g.zones=[];g.bullets=[];
    g.castSkill(key);
    if(!Number.isFinite(g.player.energy)||g.player.energy<0||g.player.energy>100)throw Error(`energy ${element} ${key}`);
    if(!(element==='chaos'&&key==='e')&&slot.cooldowns[key]!==SKILLS[element][key].cd)throw Error(`cooldown ${element} ${key}`);
    for(let i=0;i<25;i++)g.update(0.05);
    if(g.player.hp>100||!Number.isFinite(g.player.hp))throw Error(`heal ${element} ${key}`);
    skills++;
   }
   g.debugStage(1);g.player.invuln=0;g.enemies=[];g.player.x=240;g.player.y=150;
   g.addZone({x:240,y:150,r:40,warning:1,life:0.3,damage:25});g.updateZones(0.6);
   if(g.player.hp!==100)throw Error('damage before telegraph');g.updateZones(0.5);if(g.player.hp!==75)throw Error('hazard missing damage');
   g.player.effects={};g.player.invuln=0;g.player.armor=1;g.hurtPlayer(240,100,30,true);if(g.player.hp!==75||g.player.armor!==0)throw Error('armor');
   g.player.skillShield=8;g.hurtPlayer(240,100,30,true);if(g.player.hp!==75||g.player.skillShield!==0)throw Error('skill shield');
   const boss=g.makeBoss('blanket',300,150,true);g.applyStatus(boss,'stun',1.5);if(Math.abs(boss.effects.stun-0.5)>0.001)throw Error('boss stun duration');
   const state={stun:1,root:2};tickStatuses(state,0.5);if(state.stun!==0.5||state.root!==1.5)throw Error('status tick');
   const wall=g.addZone({x:280,y:150,shape:'wall',width:12,length:96,owner:'player',hp:50,life:6});if(!contains(wall,280,150)||contains(wall,300,150))throw Error('wall geometry');
   g.equipped.length=0;g.equipped.push(newSpirit('fire'),newSpirit('water'));g.equipped[0].cooldowns.q=3;g.activeSpirit=0;g.switchCd=0;g.cycleSpirit();
   if(g.activeSpirit!==1||g.equipped[0].cooldowns.q!==3)throw Error('independent cooldown');
   g.debugStage(1);g.enterRoom(g.stage.start,null);g.enemies=[g.makeEnemy('bother',g.player.x+65,g.player.y,0)];g.enemies[0].effects.root=60;g.attackUnlocked=true;g.input.attackHeld=true;
   for(let i=0;i<500&&!g.room.cleared;i++)g.update(0.05);
   if(!g.room.cleared||g.player.hp<=0)throw Error('basic weapon combat cannot clear a room');
   g.input.attackHeld=false;
   g.debugStage(20);g.enterRoom(g.stage.boss,null);const young=g.enemies.find(e=>e.boss?.main);g.player.x=young.x-20;g.player.y=young.y;g.player.fireArmor=5;g.player.invuln=0;young.fireArmor=5;
   g.hurtPlayer(young.x,young.y,10,true);if(!Number.isFinite(g.player.hp+young.hp))throw Error('recursive fire armor reflection');
   for(const element of ['water','wood','fire','dark','light','chaos'])for(const key of ['q','w','e','r']){g.events=[];g.zones=[];g.bullets=[];g.copySpiritSkill(young,element,key);for(let i=0;i<25;i++)g.updateEffects(0.05);}
   g.saveEnabled=true; // 저장 경로 검사는 로그인 상태를 가정한다 (게스트는 저장하지 않는다)
   g.debugStage(1);g.runAttack=1.3;g.player.maxEnergy=33;g.mode='clear';g.screenT=1;g.onScreenTap();
   if(Math.abs(g.runAttack-1.39)>0.001||g.player.maxEnergy!==37)throw Error('item growth lost between stages');
   const checkpoint=JSON.parse(localStorage.getItem('jamsildo.campaign'));g.resumeRun();
   if(g.stage.number!==checkpoint.stage||g.player.maxEnergy!==checkpoint.maxEnergy)throw Error('checkpoint restore');
   g.startRun();if(g.player.maxEnergy<checkpoint.maxEnergy)throw Error('permanent energy growth lost');
   localStorage.setItem('jamsildo.campaign',JSON.stringify({version:1,stage:2,hp:100,equipped:[{element:'__proto__'},null],acquired:['__proto__']}));g.resumeRun();
   if(g.equipped.length!==0||g.stage.number!==2)throw Error('invalid checkpoint inventory accepted');
   g.debugStage(8);g.enterRoom(g.stage.boss,null);const blind=g.enemies.find(e=>e.boss?.main);blind.effects.blind=4;g.events=[];g.zones=[];g.bullets=[];
   g.bossPattern(blind,'door_laser');if(g.zones.some(z=>z.damage>0))throw Error('blind boss fired laser');
   g.bossPattern(blind,'fan');for(let i=0;i<25;i++)g.updateEffects(0.05);if(g.bullets.length)throw Error('blind boss fired projectiles');
   blind.effects.blind=0;g.bossPattern(blind,'fan');for(let i=0;i<25;i++)g.updateEffects(0.05);if(!g.bullets.length)throw Error('boss did not recover from blindness');
   g.debugStage(5);g.enterRoom(g.stage.boss,null);const whisper=g.enemies.find(e=>e.boss?.main);whisper.hp=whisper.maxHp*0.09;whisper.spawnT=0;g.player.invuln=0;g.aiBoss(whisper,0.05);
   const before=whisper.hp;g.hitEnemy(whisper,1000,0,0,true);if(whisper.hp!==before)throw Error('whisper can be skipped by holding attack');
   for(let i=0;i<102;i++)g.update(0.05);if(g.player.hp!==60)throw Error(`whisper failure damage ${g.player.hp}`);
   g.debugStage(5);g.enterRoom(g.stage.boss,null);const success=g.enemies.find(e=>e.boss?.main);success.hp=success.maxHp*0.09;success.spawnT=0;g.aiBoss(success,0.05);success.boss.qteTime=2.5;
   for(let i=0;i<10;i++)g.attackPressed();g.aiBoss(success,0.05);if(success.boss.qteTime!==0||success.boss.stagger!==8)throw Error('whisper success must stagger');
   return {patterns,skills};
  });assert.equal(mechanics.skills,24);console.log(`PASS ${mechanics.patterns} boss pattern runs, all phases, 24 spirit skills, telegraphs, statuses, shields, cooldowns`);
  const progress=await page.evaluate(()=>{
   const g=window.__jamsildo;g.debugStage(1);let passed=0;
   for(let number=1;number<=19;number++){
    if(g.stage.number!==number)throw Error('stage sequence');g.player.invuln=10000;
    g.enterRoom(g.stage.boss,null);const boss=g.enemies.find(e=>e.boss?.main);boss.boss.invulnerable=false;boss.boss.elapsed=0;
    g.hitEnemy(boss,100000,0,0,true);if(g.endingT<0||!g.stage.boss.cleared)throw Error(`boss not cleared ${number}`);
    g.player.x=-30;g.player.y=147;g.checkExit();if(g.mode!=='play')throw Error('exit during boss finish');
    g.endingT=3.6;g.hitstop=0;g.timeScale=1;g.update(0.05);
    if(g.item){if(g.mode!=='play')throw Error(`left before pickup ${number}`);g.item.t=1;g.player.x=g.item.x;g.player.y=g.item.y+8;g.attackPressed();if(g.item)throw Error(`pickup ${number}`);g.update(0.05);}
    if(g.mode!=='clear')throw Error(`missing clear ${number}`);
    g.screenT=1;g.onScreenTap();if(g.stage.number!==number+1)throw Error('next stage');passed++;
   }
   g.enterRoom(g.stage.boss,null);const child=g.enemies.find(e=>e.boss?.main);g.hitEnemy(child,100000,0,0,true);
   if(g.mode!=='embrace')throw Error('young Yoonseul must wait for embrace');
   g.player.x=child.x+80;g.player.y=child.y;g.attackPressed();if(g.mode!=='embrace')throw Error('hug too far');
   g.player.x=child.x+15;g.attackPressed();if(g.mode!=='talk')throw Error('hug must start ending');
   for(let i=0;i<8&&g.mode==='talk';i++)g.advanceTalk();
   if(g.mode!=='clear')throw Error('ending did not complete');
   return passed+1;
  });assert.equal(progress,20);console.log('PASS all 20 stage transitions, boss-room retention, final embrace ending');
  for(const number of [3,5,8,10,13,15,18,20]){
   await page.evaluate(number=>{const g=window.__jamsildo;g.debugStage(number);g.enterRoom(g.stage.boss,null);g.player.invuln=10000;g.player.x=240;g.player.y=220;},number);
   await page.waitForTimeout(1150);await page.screenshot({path:join(output,`boss-${number}.png`)});
  }
  const context=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true});
  const mobile=await context.newPage();mobile.on('pageerror',e=>errors.push(e.message));
  await mobile.goto('http://localhost:5173');await mobile.waitForFunction(()=>!document.querySelector('#startGame').disabled);
  await mobile.evaluate(()=>{const g=window.__jamsildo;g.debugStage(4);g.enterRoom(g.stage.rooms.find(r=>r.kind==='spirit'),null);g.enemies.forEach(e=>g.faceEnemy(e,true));g.checkClear();g.player.x=g.spirit.x;g.player.y=g.spirit.y+10;g.updateSpirit(1);});
  await mobile.locator('#rewardDialog[open]').waitFor();assert.equal(await mobile.locator('.spirit-choice').count(),3);
  await mobile.screenshot({path:join(output,'mobile-spirit-choice.png')});
  await mobile.locator('.spirit-choice').first().tap();await mobile.waitForFunction(()=>window.__jamsildo.equipped.length===1);
  await mobile.evaluate(()=>{const g=window.__jamsildo;for(let i=0;i<6&&g.mode==='talk';i++)g.advanceTalk();g.player.invuln=10000;g.player.maxEnergy=g.player.energy=100;g.equipped[0].tier=2;});
  await mobile.locator('#skills button[data-skill="q"]:enabled').waitFor();
  const button=await mobile.locator('#skills button[data-skill="q"]').boundingBox();const cdp=await context.newCDPSession(mobile);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:button.x+22,y:button.y+20}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:250,y:200}]});
  await mobile.locator('#skillAim:not([hidden])').waitFor();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await mobile.waitForFunction(()=>window.__jamsildo.equipped[0].cooldowns.q>0);
  await mobile.screenshot({path:join(output,'mobile-skills.png')});
  assert.deepEqual(errors,[]);console.log(`PASS mobile choice, targeted skill drag, no runtime/network errors. Screenshots: ${output}`);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
