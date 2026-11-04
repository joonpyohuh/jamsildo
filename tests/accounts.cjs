// npm run dev first. PLAYWRIGHT_MODULE may point to an existing install.
// Set JAMSILDO_ADMIN_PASSWORD to run the administrator checks too.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {writeFile,mkdir}=require('node:fs/promises');
const {join}=require('node:path');
const {tmpdir}=require('node:os');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.BASE_URL||'http://localhost:5173';
const local=new URL(base).hostname==='localhost';
const output=join(tmpdir(),'jamsildo-accounts');
const users=[];
const password=`Qa!${randomUUID()}`;
const suffix=Date.now().toString(36);
const username=`qa_${suffix}`;
async function ready(page){await page.goto(base);await page.waitForFunction(()=>!document.querySelector('#startGame').disabled);}
async function signIn(page,name,pass,register=false){
  await page.locator('#accountToggle').click();await page.locator('#username').fill(name);await page.locator('#password').fill(pass);
  await page.locator(`#loginForm button[value=${register?'register':'login'}]`).click();
  await page.waitForFunction(name=>document.querySelector('#accountToggle').textContent.includes(name),name);
}
const post=(page,body)=>page.request.post(`${base}/api/account`,{data:body});
(async()=>{
 await mkdir(output,{recursive:true});
 const browser=await chromium.launch();
 const errors=[];
 try{
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await ready(page);await signIn(page,username,password,true);
  let account=await(await page.request.get(`${base}/api/account`)).json();users.push(account.user.id);
  assert.equal(account.user.is_admin,false);assert.equal(account.save.checkpoint,null);
  assert.equal((await post(page,{action:'admin'})).status(),403);
  assert.equal((await post(page,{action:'block',target:account.user.id,blocked:true})).status(),403);
  assert.equal((await post(page,{action:'register',username:'jp0405',password})).status(),409);
  console.log('PASS ID/password signup, ordinary account denied administrator access and reserved ID');
  if(local){
   const result=await page.evaluate(async()=>{
    const g=window.__jamsildo,{newSpirit}=await import('/src/game/campaign.ts');g.debugStage(7);
    const room=g.stage.rooms.find(r=>r.kind==='spirit');g.enterRoom(room,null);room.cleared=true;room.rewarded=true;
    g.equipped.push(newSpirit('fire'));g.equipped[0].uses.projectile=9;g.acquired.add('fire');g.hasSpirit=true;g.player.warmth=77;g.player.maxEnergy=54;g.player.energy=0;g.player.armor=2;g.player.hp=73;g.saveCheckpoint();
    return{room:[room.gx,room.gy],rooms:g.stage.rooms.map(r=>[r.gx,r.gy,r.kind])};
   });
   await page.locator('#saveNow').click();await page.waitForFunction(()=>document.querySelector('#accountMessage').textContent==='저장을 확인했습니다.');
   account=await(await page.request.get(`${base}/api/account`)).json();
   assert.equal(account.save.checkpoint.stage,7);assert.equal(account.save.checkpoint.warmth,77);assert.deepEqual(account.save.checkpoint.room,result.room);
   await page.reload();await page.waitForFunction(()=>!document.querySelector('#startGame').disabled);await page.locator('#continueGame').click();
   const restored=await page.evaluate(()=>{const g=window.__jamsildo;g.resumeRun();return{stage:g.stage.number,warmth:g.player.warmth,armor:g.player.armor,energy:g.player.energy,uses:g.equipped[0]?.uses.projectile,spirit:g.equipped[0]?.element,room:[g.room.gx,g.room.gy],rooms:g.stage.rooms.map(r=>[r.gx,r.gy,r.kind]),cleared:g.room.cleared,rewarded:g.room.rewarded};});
   assert.equal(restored.stage,7);assert.equal(restored.warmth,77);assert.equal(restored.armor,2);assert.equal(restored.spirit,'fire');assert(restored.cleared&&restored.rewarded);assert.deepEqual(restored.room,result.room);assert.deepEqual(restored.rooms,result.rooms);
   assert.equal(restored.energy,0);assert.equal(restored.uses,9);
   await page.evaluate(async()=>{
    const {generateStage,restoreStage}=await import('/src/game/stage.ts');
    for(let number=1;number<=20;number++){
     const stage=generateStage(number),rooms=JSON.parse(JSON.stringify(stage.rooms));
     if(restoreStage(number,rooms,stage.element).rooms.length!==stage.rooms.length)throw Error('map restore');
     rooms[0].gx=100;
     let rejected=false;try{restoreStage(number,rooms,stage.element);}catch{rejected=true;}
     if(!rejected)throw Error('corrupt map accepted');
    }
    const storage=await import('/src/game/storage.ts'),write=Storage.prototype.setItem;
    storage.writeSave('old','quota-check');
    Storage.prototype.setItem=function(){throw new DOMException('Quota','QuotaExceededError');};
    try{if(storage.writeSave('new','quota-check')!==false||storage.readSave('quota-check')!=='new')throw Error('quota fallback lost latest record');}
    finally{Storage.prototype.setItem=write;}
   });
   console.log('PASS cloud checkpoint and reload restore map, room progress, inventory and growth');
  }
  const secondContext=await browser.newContext();const second=await secondContext.newPage();await ready(second);await signIn(second,username,password);
  const old=(await(await second.request.get(`${base}/api/account`)).json()).save;
  const checkpoint=old.checkpoint?{...old.checkpoint,warmth:88}:{version:1,stage:4,hp:100,warmth:88};
  const session=randomUUID();
  let response=await post(page,{action:'sync',revision:old.revision,checkpoint,session,seconds:12});assert.equal(response.status(),200,await response.text());
  const saved=await response.json();
  response=await post(page,{action:'sync',revision:saved.revision,checkpoint:null,session,seconds:12});assert.equal(response.status(),200);
  const after=(await(await page.request.get(`${base}/api/account`)).json()).user.play_seconds;
  response=await post(page,{action:'sync',revision:saved.revision,checkpoint:null,session,seconds:12});assert.equal(response.status(),200);
  assert.equal((await(await page.request.get(`${base}/api/account`)).json()).user.play_seconds,after,'repeated heartbeat double-counted');
  response=await post(second,{action:'sync',revision:old.revision,checkpoint:{version:1,stage:1},session:randomUUID(),seconds:0});assert.equal(response.status(),409);
  assert.equal((await(await page.request.get(`${base}/api/account`)).json()).save.checkpoint.warmth,88);
  console.log('PASS concurrent save conflict prevents overwrite; repeated heartbeat counts once');
  // A fresh device must receive the latest cloud checkpoint.
  const thirdContext=await browser.newContext();const third=await thirdContext.newPage();await ready(third);await signIn(third,username,password);
  assert.equal((await(await third.request.get(`${base}/api/account`)).json()).save.checkpoint.warmth,88);
  const cookies=await thirdContext.cookies();
  await thirdContext.clearCookies({name:'jamsildo_access'});
  assert(cookies.some(c=>c.name==='jamsildo_refresh'&&c.httpOnly&&c.secure));
  assert.equal((await(await third.request.get(`${base}/api/account`)).json()).user.username,username);
  assert((await thirdContext.cookies()).some(c=>c.name==='jamsildo_access'));
  console.log('PASS new-device restore and HttpOnly refresh-token session renewal');
  if(process.env.SUPABASE_PUBLISHABLE_KEY){
   const cookies=await thirdContext.cookies();const token=cookies.find(c=>c.name==='jamsildo_access').value;
   const url=process.env.SUPABASE_URL;const headers={apikey:process.env.SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${decodeURIComponent(token)}`,'Content-Type':'application/json'};
   let r=await fetch(`${url}/rest/v1/jamsildo_players?username=eq.jp0405&select=*`,{headers});assert.deepEqual(await r.json(),[]);
   r=await fetch(`${url}/rest/v1/jamsildo_players?id=eq.${users[0]}`,{method:'PATCH',headers,body:JSON.stringify({is_admin:true})});assert.equal(r.status,403);
   r=await fetch(`${url}/rest/v1/rpc/jamsildo_admin_overview`,{method:'POST',headers,body:'{}'});assert.equal(r.status,400);
   console.log('PASS database RLS isolates accounts, denies role changes and admin RPC');
  }
  if(process.env.JAMSILDO_ADMIN_PASSWORD){
   const adminContext=await browser.newContext({viewport:{width:1440,height:900}});const admin=await adminContext.newPage();admin.on('pageerror',e=>errors.push(e.message));
   await ready(admin);await signIn(admin,'jp0405',process.env.JAMSILDO_ADMIN_PASSWORD);await admin.locator('#openAdmin').click();
   await admin.waitForFunction(()=>document.querySelectorAll('#adminKpis article').length===6);
   assert.equal(await admin.locator('#adminStages button').count(),20);assert.equal(await admin.locator('#adminKpis article').count(),6);
   await admin.locator('#playerSearch').fill(username);await admin.locator('#adminSearch button[type=submit]').click();await admin.waitForFunction(name=>document.querySelector('#playerRows').textContent.includes(name),username);
   await admin.screenshot({path:join(output,'admin-desktop.png')});
   response=await post(admin,{action:'block',target:users[0],blocked:true});assert.equal(response.status(),200,await response.text());
   response=await post(third,{action:'sync',revision:saved.revision,checkpoint:null,session:randomUUID(),seconds:0});assert.equal(response.status(),403);
   response=await post(admin,{action:'block',target:users[0],blocked:false});assert.equal(response.status(),200);
   const original=(await(await admin.request.get(`${base}/api/account`)).json()).save;
   await admin.locator('#adminStages button[data-stage="20"]').click();
   if(local)await admin.waitForFunction(()=>window.__jamsildo.stage.number===20&&window.__jamsildo.mode==='play');
   else await admin.waitForFunction(()=>document.querySelector('#saveStatus').textContent.includes('스테이지 20'));
   assert.deepEqual((await(await admin.request.get(`${base}/api/account`)).json()).save,original,'stage test overwrote real save');
   await admin.locator('#accountToggle').click();await admin.locator('#openAdmin').click();await admin.locator('#leaveTest').click();
   await admin.setViewportSize({width:390,height:844});await admin.screenshot({path:join(output,'admin-mobile.png')});
   assert(await admin.locator('#adminDialog').evaluate(e=>e.getBoundingClientRect().width<=window.innerWidth));
   console.log('PASS administrator metrics, player search, block/unblock and isolated stage 20 test; desktop/mobile screenshots');
  }
  const newPassword=`New!${randomUUID()}`;
  response=await post(third,{action:'password',current:'incorrect',password:newPassword});assert.equal(response.status(),400);
  response=await post(third,{action:'password',current:password,password:newPassword});assert.equal(response.status(),200,await response.text());
  response=await post(third,{action:'logout'});assert.equal(response.status(),200);assert.equal((await(await third.request.get(`${base}/api/account`)).json()).user,null);
  response=await post(third,{action:'login',username,password});assert.equal(response.status(),401);
  response=await post(third,{action:'login',username,password:newPassword});assert.equal(response.status(),200);
  assert.deepEqual(errors,[]);console.log('PASS password verification, change, logout and new-password login; no browser errors');
 }finally{await writeFile(join(output,'test-users.json'),JSON.stringify(users));await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
