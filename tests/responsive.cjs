// 가로 16:9 화면 검사. Vite 개발 서버를 켠 뒤 실행한다.
// 실기기가 아니라 뷰포트 에뮬레이션이다. 노치·홈바는 --sa-* 변수에 인셋 값을 넣어 흉내 낸다.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const fs = require('node:fs/promises');

const BASE = process.env.BASE_URL || 'http://localhost:5173';
// 가로 기준 CSS 픽셀. 인셋은 공개된 동급 기기 값을 쓴 추정치다.
const PHONES = [
  { name: 'iPhone SE', w: 667, h: 375, dpr: 2, safe: [0, 0, 0, 0] },
  { name: 'iPhone SE + Safari bars', w: 667, h: 331, dpr: 2, safe: [0, 0, 0, 0] },
  { name: 'iPhone Pro Max', w: 956, h: 440, dpr: 3, safe: [0, 62, 21, 62] },
  { name: 'iPhone Pro Max + Safari bars', w: 956, h: 390, dpr: 3, safe: [0, 62, 21, 62] },
  { name: 'Galaxy S', w: 780, h: 360, dpr: 3, safe: [0, 0, 0, 32] },
  { name: 'Galaxy S Ultra', w: 824, h: 384, dpr: 3.75, safe: [0, 0, 0, 32] },
];
const DESKTOPS = [{ name: 'FHD', w: 1920, h: 1080, scale: 3 }, { name: 'Laptop', w: 1366, h: 768, scale: 2 }, { name: 'Odd window', w: 1500, h: 700, scale: 1 }];

const stageBox = page => page.locator('#stage').evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const startPlay = page => page.evaluate(async () => {
  const g = window.__jamsildo;
  const { newSpirit } = await import('/src/game/campaign.ts');
  g.cineSkip(); g.debugStage(3);
  g.enterRoom(g.stage.rooms.find(room => room.kind === 'normal'), null);
  g.mode = 'play'; g.attackUnlocked = true; g.player.invuln = 999;
  g.equipped.push(newSpirit('fire'), newSpirit('water')); g.hasSpirit = true;
});

(async () => {
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const output = join(tmpdir(), 'jamsildo-responsive');
  await fs.mkdir(output, { recursive: true });
  try {
    for (const d of PHONES) {
      const context = await browser.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: d.dpr, isMobile: true, hasTouch: true });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(BASE);
      await page.waitForFunction(() => !document.querySelector('#startGame').disabled);
      const [t, r, b, l] = d.safe;
      await page.evaluate(([t, r, b, l]) => {
        const root = document.documentElement.style;
        root.setProperty('--sa-t', `${t}px`); root.setProperty('--sa-r', `${r}px`); root.setProperty('--sa-b', `${b}px`); root.setProperty('--sa-l', `${l}px`);
        window.dispatchEvent(new Event('resize'));
      }, d.safe);
      await page.waitForTimeout(100);
      assert.equal(await page.locator('#startGame').textContent(), '터치해서 시작');
      await page.screenshot({ path: join(output, `${d.name}-title.png`) });

      // 로그인 전: 시작 선택지가 처음부터 보인다. 전체화면이 막혀도 에러 없이 진행
      assert.equal(await page.locator('#startGame').isVisible(), false);
      await page.screenshot({ path: join(output, `${d.name}-choice.png`) });
      const clipped = await page.evaluate(() => [...document.querySelectorAll('#title .menu-button:not([hidden]), #startLogin')].filter(el => el.offsetParent).map(el => el.getBoundingClientRect()).filter(r => r.top < 0 || r.bottom > innerHeight).length);
      assert.equal(clipped, 0, `${d.name}: 타이틀 메뉴가 화면을 벗어남`);
      await page.locator('#startGuest').tap();
      await page.waitForFunction(() => window.__jamsildo.mode === 'opening');

      await startPlay(page);
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(output, `${d.name}-play.png`) });

      // 화면 크기: 16:9, 안전 영역 안, 물리 픽셀 정수배 (예외는 쪼그라드는 경우뿐)
      const s = await stageBox(page);
      assert(Math.abs(s.w / s.h - 16 / 9) < 0.001, `${d.name}: 16:9`);
      assert(s.x >= l - 0.5 && s.x + s.w <= d.w - r + 0.5 && s.y >= t - 0.5 && s.y + s.h <= d.h - b + 0.5, `${d.name}: 게임 화면이 안전 영역 밖 ${JSON.stringify(s)}`);
      const device = s.w / 640 * d.dpr;
      const whole = Math.abs(device - Math.round(device)) < 0.01;

      // 버튼: 안전 영역 안, 서로 안 겹침, 크기 규격
      const boxes = await page.evaluate(() => Object.fromEntries(['#attack', '#joystick', '#swapSpirit', ...['q', 'w', 'e', 'r'].map(k => `[data-skill="${k}"]`)].map(sel => { const r = document.querySelector(sel).getBoundingClientRect(); return [sel, { x: r.x, y: r.y, w: r.width, h: r.height }]; })));
      assert.equal(boxes['#attack'].w, 80); assert.equal(boxes['[data-skill="q"]'].w, 56);
      const list = Object.entries(boxes);
      for (const [name, box] of list) {
        assert(box.w > 0, `${d.name}: ${name} 안 보임`);
        assert(box.x >= l && box.x + box.w <= d.w - r && box.y >= t && box.y + box.h <= d.h - b, `${d.name}: ${name}이 노치/홈바 영역 침범 ${JSON.stringify(box)}`);
      }
      for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) {
        const [na, a] = list[i], [nb, c] = list[j];
        // 원형 버튼이라 중심 거리로 본다
        const gap = Math.hypot(a.x + a.w / 2 - c.x - c.w / 2, a.y + a.h / 2 - c.y - c.h / 2) - (a.w + c.w) / 2;
        assert(gap >= 0, `${d.name}: ${na}와 ${nb} 겹침 ${gap}`);
      }
      const hud = await page.locator('#healthHud').evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y }; });
      assert(hud.x >= l && hud.y >= t && hud.x < d.w / 2 && hud.y < d.h / 2, `${d.name}: 체력은 왼쪽 위`);

      // 버튼을 누른 터치는 이동이 아니다
      const before = await page.evaluate(() => { const p = window.__jamsildo.player; return [p.x, p.y]; });
      await page.locator('#attack').tap();
      await page.locator('[data-skill="q"]').tap();
      await page.waitForTimeout(100);
      const after = await page.evaluate(() => { const g = window.__jamsildo; return { pos: [g.player.x, g.player.y], moving: g.player.moving }; });
      assert.equal(after.moving, false, `${d.name}: 버튼 터치가 이동으로 처리됨`);
      assert(Math.hypot(after.pos[0] - before[0], after.pos[1] - before[1]) < 60, `${d.name}: 공격 돌진 외 이동 없음`);

      // 정령 교체 버튼
      const active = await page.evaluate(() => window.__jamsildo.activeSpirit);
      await page.waitForTimeout(300);
      await page.locator('#swapSpirit').tap();
      assert.notEqual(await page.evaluate(() => window.__jamsildo.activeSpirit), active, `${d.name}: 정령 교체`);

      // 세로로 돌리면 멈춘다 → 가로로 돌아와도 계속하기 전까지 멈춰 있다
      await page.setViewportSize({ width: d.h, height: d.w });
      await page.waitForFunction(() => document.querySelector('#pauseOverlay').open);
      assert.equal(await page.locator('#pauseResume').isVisible(), true);
      await page.screenshot({ path: join(output, `${d.name}-portrait.png`) });
      const clock = await page.evaluate(() => window.__jamsildo.clock);
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(() => window.__jamsildo.clock), clock, `${d.name}: 세로에서 멈춰야 함`);
      await page.setViewportSize({ width: d.w, height: d.h });
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(() => window.__jamsildo.clock), clock, `${d.name}: 자동 재개 금지`);
      await page.locator('#pauseResume').tap();
      await page.waitForFunction(c => window.__jamsildo.clock > c, clock);
      assert.equal(await page.evaluate(() => document.querySelector('#pauseOverlay').open), false);

      assert.deepEqual(errors, [], `${d.name}: 런타임 에러`);
      console.log(`PASS ${d.name} ${d.w}x${d.h}: 화면 ${Math.round(s.w)}x${Math.round(s.h)} (물리 ${device.toFixed(2)}배${whole ? '' : ', 예외: 꽉 채움'}), 버튼 안전 영역·비겹침, 회전 일시정지`);
      await context.close();
    }
    for (const d of DESKTOPS) {
      const page = await browser.newPage({ viewport: { width: d.w, height: d.h } });
      await page.goto(BASE);
      await page.waitForFunction(() => !document.querySelector('#startGame').disabled);
      assert.equal(await page.locator('#startGame').textContent(), '게임 시작');
      const s = await stageBox(page);
      assert.equal(s.w, 640 * d.scale, `${d.name}: 정수 배율`);
      assert.equal(s.x, Math.round((d.w - s.w) / 2), `${d.name}: 가운데`);
      await page.locator('#startGuest').click();
      await page.waitForFunction(() => window.__jamsildo.mode === 'opening');
      await startPlay(page);
      await page.waitForTimeout(150);
      for (const sel of ['#attack', '#joystick', '#swapSpirit']) assert.equal(await page.locator(sel).isVisible(), false, `${d.name}: PC에 터치 버튼 ${sel}`);
      const active = await page.evaluate(() => window.__jamsildo.activeSpirit);
      await page.keyboard.press('Tab');
      assert.notEqual(await page.evaluate(() => window.__jamsildo.activeSpirit), active);
      await page.evaluate(() => { const g = window.__jamsildo; g.equipped[g.activeSpirit].cooldowns.q = 0; g.player.energy = 30; });
      await page.keyboard.press('KeyQ');
      await page.waitForTimeout(80);
      assert(await page.evaluate(() => window.__jamsildo.equipped[window.__jamsildo.activeSpirit].cooldowns.q > 0), `${d.name}: Q`);
      const box = await page.locator('#game').boundingBox();
      await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.6, { button: 'right' });
      await page.waitForTimeout(60);
      assert(await page.evaluate(() => window.__jamsildo.player.moving), `${d.name}: 우클릭 이동`);
      // PC는 창이 세로로 길어도 안내를 띄우지 않는다
      await page.setViewportSize({ width: 700, height: 900 });
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => document.querySelector('#pauseOverlay').open), false);
      await page.setViewportSize({ width: d.w, height: d.h });
      await page.screenshot({ path: join(output, `${d.name}-play.png`) });
      console.log(`PASS ${d.name} ${d.w}x${d.h}: ${d.scale}배, 터치 버튼 숨김, Q·Tab·우클릭 이동`);
      await page.close();
    }
    console.log(`Screenshots: ${output}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
