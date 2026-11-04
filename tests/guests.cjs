// npm run dev first. PLAYWRIGHT_MODULE may point to an existing install.
// 게스트 기록: 서버 처리(handler)는 가짜 fetch로, 브라우저와 콘솔은 가짜 API로 확인한다. 운영 DB는 건드리지 않는다.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {join}=require('node:path');
const {tmpdir}=require('node:os');
const {mkdir}=require('node:fs/promises');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.BASE_URL||'http://localhost:5173';
const output=join(tmpdir(),'jamsildo-guests');

async function handlerChecks(){
 const {createHandler}=await import(pathToFileURL(join(__dirname,'../supabase/functions/jamsildo-account/handler.js')));
 const calls=[];let allowed=true;
 const realFetch=global.fetch;
 global.fetch=async(url,options)=>{calls.push({url:String(url),body:options.body&&JSON.parse(options.body),apikey:options.headers.apikey});
  return new Response(String(url).includes('rate_limit')?JSON.stringify(allowed):'null',{status:200});};
 try{
  const handle=createHandler({url:'http://db',key:'public-key',serviceKey:'service-key'});
  const post=body=>handle(new Request('http://api/',{method:'POST',headers:{'content-type':'application/json','x-jamsildo-client-ip':'1.2.3.4'},body:JSON.stringify(body)}));
  const good={action:'guest',guest:randomUUID(),session:randomUUID(),seconds:42,stage:3};
  assert.equal((await post(good)).status,200);
  const ping=calls.find(c=>c.url.includes('guest_ping'));
  assert.deepEqual(ping.body,{p_guest:good.guest,p_session:good.session,p_seconds:42,p_stage:3});
  assert.equal(ping.apikey,'service-key','서버 권한으로만 쓴다');
  const limit=calls.find(c=>c.url.includes('rate_limit'));
  assert(!JSON.stringify(limit.body).includes('1.2.3.4'),'IP 원문이 나가지 않는다');
  for(const bad of [{guest:'x'},{session:"'; drop table"},{seconds:-1},{seconds:1.5},{seconds:'9'},{stage:0},{stage:21},{stage:null}]){
   calls.length=0;
   assert.equal((await post({...good,...bad})).status,400,JSON.stringify(bad));
   assert.equal(calls.length,0,'잘못된 요청은 DB까지 가지 않는다');
  }
  allowed=false;calls.length=0;
  assert.equal((await post(good)).status,429);
  assert(!calls.some(c=>c.url.includes('guest_ping')),'횟수 초과면 기록 안 함');
 }finally{global.fetch=realFetch;}
 console.log('PASS 서버: 형식 검증, 서버 권한 기록, IP 해시, 횟수 제한');
}

const now=()=>new Date().toISOString();
const player=admin=>({id:randomUUID(),username:admin?'jp0405':'qa',is_admin:admin,blocked:false,created_at:now(),last_seen:now(),play_seconds:0,stage:1,max_stage:1});

(async()=>{
 await handlerChecks();
 await mkdir(output,{recursive:true});
 const browser=await chromium.launch();
 const errors=[];
 try{
  // 게스트가 플레이하면 ID·시간·스테이지가 간다
  const context=await browser.newContext({viewport:{width:1280,height:720}});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const pings=[];
  await page.route('**/api/account',route=>{
   const body=route.request().postDataJSON();
   if(body?.action==='guest'){pings.push(body);return route.fulfill({json:{ok:true}});}
   return route.fulfill({json:{user:null}});
  });
  await page.addInitScript(()=>localStorage.setItem('jamsildo.guest-ping','on'));
  await page.goto(base);await page.waitForFunction(()=>!document.querySelector('#startGame').disabled);
  await page.waitForTimeout(1200);assert.equal(pings.length,0,'타이틀만 보면 기록 안 함');
  await page.locator('#startGuest').click();
  await page.evaluate(()=>{const g=window.__jamsildo;g.openingSeen=true;g.opening=null;g.ui.showCine(false);g.debugStage(4);g.talk=null;g.ui.hideTalk();g.mode='play';});
  await page.waitForTimeout(3200);
  // 탭이 숨겨질 때 보내는 경로로 바로 확인한다 (주기 전송과 같은 함수)
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});});
  await page.waitForFunction(()=>true);await page.waitForTimeout(200);
  assert(pings.length>=1,'게스트 기록 전송');
  const first=pings.at(-1);
  assert.match(first.guest,/^[0-9a-f-]{36}$/);assert.equal(first.stage,4);assert(first.seconds>=1,`시간 ${first.seconds}`);
  assert.deepEqual(Object.keys(first).sort(),['action','guest','seconds','session','stage'],'정해진 값만 보낸다');
  // 새로고침해도 같은 게스트, 세션은 새로
  await page.reload();await page.waitForFunction(()=>!document.querySelector('#startGame').disabled);
  assert.equal(await page.evaluate(()=>localStorage.getItem('jamsildo.guest-id')),first.guest);
  console.log('PASS 브라우저: 플레이해야 전송, 익명 ID 유지, 정해진 값만');
  await context.close();

  // 서버 오류가 나도 플레이는 그대로
  const broken=await browser.newContext();const down=await broken.newPage();down.on('pageerror',e=>errors.push(e.message));
  await down.route('**/api/account',route=>route.request().method()==='GET'?route.fulfill({json:{user:null}}):route.fulfill({status:500,json:{error:'x'}}));
  await down.addInitScript(()=>localStorage.setItem('jamsildo.guest-ping','on'));
  await down.goto(base);await down.waitForFunction(()=>!document.querySelector('#startGame').disabled);
  await down.locator('#startGuest').click();
  await down.evaluate(()=>{const g=window.__jamsildo;g.openingSeen=true;g.opening=null;g.ui.showCine(false);g.debugStage(2);g.talk=null;g.ui.hideTalk();g.mode='play';});
  await down.waitForTimeout(2200);
  await down.evaluate(()=>window.dispatchEvent(new Event('online')));await down.waitForTimeout(200);
  assert.equal(await down.evaluate(()=>window.__jamsildo.mode),'play');
  await broken.close();
  console.log('PASS 서버 오류: 플레이 영향 없음');

  // 콘솔
  const guests=Array.from({length:3},(_,i)=>({id:randomUUID(),created_at:now(),last_seen:i?'2026-11-01T03:00:00Z':now(),play_seconds:3725*(i+1),sessions:i+1,stage:i+2,max_stage:i+5}));
  const overview=extra=>({stats:{players:2,today:1,online:0,active_today:1,play_seconds:90,blocked:0,stages:[{stage:3,players:1}]},players:[],total:0,audit:[],...extra});
  let guestData={total:53,today:4,active_today:6,online:1,play_seconds:7450,stages:[{stage:3,players:2}],guests};
  const pages=[];
  const admin=await browser.newPage({viewport:{width:1280,height:900}});admin.on('pageerror',e=>errors.push(e.message));
  await admin.route('**/api/account',route=>{
   const body=route.request().postDataJSON();
   if(body?.action==='admin'){pages.push(body.guestPage);return route.fulfill({json:overview({guests:guestData})});}
   if(body)return route.fulfill({json:{ok:true,revision:0}});
   return route.fulfill({json:{user:player(true),save:{checkpoint:null,revision:0,updated_at:now()}}});
  });
  await admin.goto(base);await admin.waitForFunction(()=>!document.querySelector('#startGame').disabled);
  await admin.locator('#accountToggle').click();await admin.locator('#openAdmin').click();
  await admin.waitForFunction(()=>document.querySelectorAll('#guestRows tr').length===3);
  const text=await admin.locator('#guestSection').innerText();
  assert.match(text,new RegExp(`게스트 ${guests[0].id.slice(0,8)}`));assert.match(text,/● 게스트/,'접속 중 표시');assert.match(text,/1시간 2분 5초/);assert.match(text,/2 \/ 5/);assert.match(text,/1 \/ 3 · 53명/);
  const kpis=await admin.locator('#adminKpis').innerText();
  assert.match(kpis,/게스트\s*53명/);assert.match(kpis,/게스트 누적 플레이\s*2시간 4분/);
  assert.match(await admin.locator('[data-stage-count="3"]').textContent(),/진행 중 1명 · 게스트 2/);
  await admin.locator('#guestSection').scrollIntoViewIfNeeded();await admin.screenshot({path:join(output,'console.png')});
  await admin.locator('#nextGuests').click();await admin.waitForFunction(()=>document.querySelector('#guestPage').textContent.startsWith('2 /'));
  assert.equal(pages.at(-1),1,'다음 쪽 요청');
  // 게스트 표가 아직 없는 서버
  guestData=null;await admin.locator('#refreshAdmin').click();await admin.waitForFunction(()=>document.querySelector('#guestSection').hidden);
  assert.doesNotMatch(await admin.locator('#adminKpis').innerText(),/게스트/);
  assert.match(await admin.locator('#adminKpis').innerText(),/가입 플레이어/);
  console.log('PASS 콘솔: 표·KPI·스테이지·쪽 이동, 서버 미적용 시 숨김');
  assert.deepEqual(errors,[]);
  console.log(`Screenshots: ${output}`);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
