// Run against `npm run dev`: PLAYWRIGHT_MODULE may point to an existing Playwright install.
const assert = require('node:assert/strict');
const { mkdir } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const output = join(tmpdir(), 'jamsildo-responsive');
  await mkdir(output, { recursive: true });
  try {
    for (const [width, height, mobile] of [[1440, 900, false], [390, 844, true], [844, 390, true], [320, 568, true], [768, 1024, true]]) {
      const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('response', r => { if (r.url().startsWith('http://localhost:5173') && r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
      await page.goto('http://localhost:5173');
      await page.waitForFunction(() => window.__jamsildo?.screenT > 0.6);
      await page.evaluate(() => document.fonts.ready);
      const tap = (x, y) => mobile ? page.touchscreen.tap(x, y) : page.mouse.click(x, y);
      assert.equal(await page.locator('#title .tagline').textContent(), 'we can win');
      const title = await page.locator('#title .title').boundingBox();
      const actions = await page.locator('.menu-actions').boundingBox();
      assert(Math.abs(title.x + title.width / 2 - width / 2) < 1);
      assert(Math.abs((title.y + actions.y + actions.height) / 2 - height / 2) < 1, 'menu must be centered');
      await tap(8, 8);
      assert.equal(await page.evaluate(() => window.__jamsildo.mode), 'title', 'title background must not start game');
      await page.screenshot({ path: join(output, `${width}x${height}-menu.png`) });
      await page.locator('#openSettings').click();
      await page.locator('#brightness').focus();
      await page.keyboard.press('End');
      await page.locator('#volume').focus();
      await page.keyboard.press('Home');
      assert.equal(await page.locator('#brightnessValue').textContent(), '160%');
      assert.equal(await page.locator('#volumeValue').textContent(), '0%');
      assert.equal(await page.locator('#game').evaluate(el => el.style.filter), 'brightness(1.6)');
      assert.equal(await page.evaluate(() => window.__jamsildo.sfx.volume), 0);
      await page.keyboard.press('Space');
      assert.equal(await page.evaluate(() => window.__jamsildo.mode), 'title', 'settings keyboard must not start game');
      await page.screenshot({ path: join(output, `${width}x${height}-settings.png`) });
      await page.locator('#settings button').click();
      await page.reload();
      await page.waitForFunction(() => window.__jamsildo?.screenT > 0.6);
      assert.equal(await page.locator('#brightness').inputValue(), '160');
      assert.equal(await page.locator('#volume').inputValue(), '0');
      await page.locator('#openSettings').click();
      await page.locator('#brightness').evaluate(el => { el.value = '100'; el.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.locator('#volume').evaluate(el => { el.value = '50'; el.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.locator('#settings button').click();
      await page.locator('#startGame').click();
      await page.waitForFunction(() => window.__jamsildo.mode === 'opening');
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#title')).visibility === 'hidden');
      await page.evaluate(() => window.__jamsildo.debugOpening(0, 0, 3, 3));
      await page.waitForFunction(() => document.querySelector('#cineLine').textContent.length > 3);
      const opening = await page.locator('#game').boundingBox();
      assert(opening.x >= -1 && opening.y >= -1 && opening.x + opening.width <= width + 1 && opening.y + opening.height <= height + 1, 'opening must fit completely');
      assert(Number.parseFloat(await page.locator('#cineText').evaluate(el => getComputedStyle(el).fontSize)) >= 16);
      const line = await page.locator('#cineText').boundingBox();
      assert(line.y >= 0 && line.y + line.height <= height, 'subtitles must be visible');
      await page.screenshot({ path: join(output, `${width}x${height}-opening.png`) });
      await page.locator('#cineSkip').click();
      await page.waitForFunction(() => window.__jamsildo.mode === 'play');
      await page.waitForFunction(() => {
        const r = document.querySelector('#game').getBoundingClientRect();
        const scale = Math.min(innerWidth / (innerHeight > innerWidth ? 260 : 480), innerHeight / 270);
        return Math.abs(r.width - 480 * scale) < 1;
      });
      const world = await page.locator('#game').boundingBox();
      assert(Math.abs(world.width / world.height - 480 / 270) < 0.001, 'pixels must keep their proportions');
      assert(Math.abs(world.y + world.height / 2 - height / 2) < 1, 'zoomed room must stay vertically centered');
      const visible = await page.evaluate(() => window.__jamsildo.viewport);
      assert(visible.w >= (height > width ? 260 : 480) - 0.01, 'zoom must reveal more of the room');
      assert.equal(visible.h, 270, 'room height must remain visible');
      const start = await page.evaluate(() => window.__jamsildo.cameraFocus);
      const cdp = mobile ? await context.newCDPSession(page) : null;
      if (mobile) {
        await page.locator('#joystick').waitFor({ state: 'visible' });
        const stick = await page.locator('#joystick').boundingBox();
        const center = { x: stick.x + stick.width / 2, y: stick.y + stick.height / 2, id: 1 };
        await tap(width * 0.7, height * 0.55);
        await page.waitForTimeout(100);
        assert.deepEqual(await page.evaluate(() => window.__jamsildo.cameraFocus), start, 'touching the room must not replace joystick movement');
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [center] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...center, x: center.x + 3 }] });
        await page.waitForTimeout(100);
        assert.deepEqual(await page.evaluate(() => window.__jamsildo.cameraFocus), start, 'joystick dead zone must prevent drift');
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...center, x: center.x + 40 }] });
        await page.waitForFunction(start => window.__jamsildo.cameraFocus.x - start.x > 5, start);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForFunction(() => !window.__jamsildo.player.moving);
        const stopped = await page.evaluate(() => window.__jamsildo.cameraFocus);
        await page.waitForTimeout(100);
        assert.deepEqual(await page.evaluate(() => window.__jamsildo.cameraFocus), stopped, 'releasing joystick must stop immediately');
      } else {
        assert(await page.locator('#joystick').isHidden());
        await tap(width * 0.7, height * 0.55);
        await page.waitForFunction(start => Math.hypot(window.__jamsildo.cameraFocus.x - start.x, window.__jamsildo.cameraFocus.y - start.y) > 5, start);
      }
      await page.locator('#settingsToggle').click();
      const clock = await page.evaluate(() => window.__jamsildo.clock);
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => window.__jamsildo.clock), clock, 'settings must pause gameplay');
      await page.keyboard.press('Escape');
      await page.waitForFunction(clock => window.__jamsildo.clock > clock, clock);
      if (mobile) {
        await page.evaluate(() => { window.__jamsildo.attackUnlocked = true; window.__jamsildo.hasSpirit = true; });
        await page.waitForFunction(() => !document.querySelector('#attack').hidden && !document.querySelector('#skills').hidden);
        const attack = await page.locator('#attack').boundingBox();
        assert(attack.x < width / 2 && attack.width === 80 && attack.height === 80);
        const skills = await page.locator('#skills').boundingBox();
        assert(attack.x + attack.width < skills.x, 'attack and skills must not overlap');
        const stick = await page.locator('#joystick').boundingBox();
        assert(skills.y + skills.height < stick.y || skills.x + skills.width < stick.x, 'skills must not overlap joystick');
        const touches = [{ x: stick.x + stick.width / 2 + 40, y: stick.y + stick.height / 2, id: 1 }, { x: attack.x + 40, y: attack.y + 40, id: 2 }];
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches });
        await page.waitForFunction(() => window.__jamsildo.input.attackHeld && window.__jamsildo.player.moving);
        await page.screenshot({ path: join(output, `${width}x${height}-joystick.png`) });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
        await page.waitForFunction(() => !window.__jamsildo.input.attackHeld && !window.__jamsildo.player.moving);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches });
        await page.waitForFunction(() => window.__jamsildo.input.attackHeld && window.__jamsildo.player.moving);
        await page.evaluate(() => window.dispatchEvent(new Event('blur')));
        await page.waitForFunction(() => !window.__jamsildo.input.attackHeld && !window.__jamsildo.player.moving);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.evaluate(async () => {
          const { newSpirit } = await import('/src/game/campaign.ts');
          window.__jamsildo.equipped.push(newSpirit('fire'), newSpirit('water'), newSpirit('light'));
        });
        await page.waitForFunction(() => document.querySelectorAll('#spiritSlots button').length === 3);
        const slots = await page.locator('#spiritSlots').boundingBox();
        const summary = await page.locator('#spiritSummary').boundingBox();
        const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
        for (const control of [attack, skills, stick]) {
          assert(!overlaps(slots, control), 'three spirit slots must not overlap touch controls');
          assert(!overlaps(summary, control), 'spirit description must not overlap touch controls');
        }
        await page.screenshot({ path: join(output, `${width}x${height}-controls-full.png`) });
      }
      const tutorial = await page.evaluate(async () => {
        const { OPENING } = await import('/src/game/lines.ts');
        window.__jamsildo.startTalk(OPENING, () => {});
        return OPENING.map(line => line.text);
      });
      assert(tutorial.some(text => text.includes('세나') && text.includes('무기')));
      assert(tutorial.some(text => text.includes('스페이스바(Space)') && text.includes('왼쪽')));
      assert(tutorial.some(text => text.includes('오른쪽 조이스틱')));
      if (mobile) await page.waitForFunction(() => document.querySelector('#attack').hidden);
      for (let i = 0; i < tutorial.length; i += 1) {
        await page.evaluate(() => {
          const g = window.__jamsildo;
          g.talk.shown = g.talk.lines[g.talk.i].text.length;
          g.renderTalk();
        });
        assert.equal(await page.locator('#talkText').textContent(), tutorial[i]);
        const talk = await page.locator('#talk').boundingBox();
        assert(talk.x >= 0 && talk.y >= 0 && talk.x + talk.width <= width && talk.y + talk.height <= height);
        assert(Math.abs(talk.x + talk.width / 2 - width / 2) < 1 && talk.y + talk.height > height - 40, 'dialogue must sit at bottom center');
        assert(await page.locator('#talkText').evaluate(el => el.scrollHeight <= el.clientHeight));
        await page.waitForFunction(() => document.querySelector('#talkFace').naturalWidth > 0);
        if (mobile) assert(await page.locator('#attack').isHidden(), 'dialogue must not overlap attack control');
        if (i === 4) await page.screenshot({ path: join(output, `${width}x${height}-talk.png`) });
        await page.locator('#talk').click();
      }
      if (!mobile) {
        await page.evaluate(() => window.__jamsildo.enterRoom(window.__jamsildo.stage.start, null));
        await page.waitForFunction(() => window.__jamsildo.attackUnlocked);
        await page.keyboard.down('Space');
        await page.waitForFunction(() => window.__jamsildo.player.swingT > 0);
        assert.equal(await page.evaluate(() => window.__jamsildo.input.attackHeld), true);
        await page.keyboard.up('Space');
        assert.equal(await page.evaluate(() => window.__jamsildo.input.attackHeld), false);
      }
      await page.screenshot({ path: join(output, `${width}x${height}-play.png`) });
      const mapState = await page.evaluate(() => {
        const g = window.__jamsildo;
        const first = g.stage.start;
        const next = g.stage.rooms.find(r => Math.abs(r.gx - first.gx) + Math.abs(r.gy - first.gy) === 1);
        g.enterRoom(first, null);
        const firstCount = document.querySelectorAll('.map-room').length;
        g.enterRoom(next, null);
        return { firstCount, nextCount: document.querySelectorAll('.map-room').length, current: document.querySelector('.map-room[aria-current="location"]').dataset.room, expected: `${next.gx},${next.gy}` };
      });
      assert.equal(mapState.firstCount, 1, 'unvisited rooms must stay hidden');
      assert.equal(mapState.nextCount, 2);
      assert.equal(mapState.current, mapState.expected);
      assert.equal(await page.locator('.map-link').count(), 1);
      const map = await page.locator('#minimap').boundingBox();
      assert(map.x > width / 2 && map.y < 50 && map.x + map.width <= width);
      await page.screenshot({ path: join(output, `${width}x${height}-map.png`) });
      await page.evaluate(() => window.__jamsildo.enterRoom(window.__jamsildo.stage.start, null));
      assert.equal(await page.locator('.map-room').count(), 2, 'revisits must not duplicate rooms');
      const decoration = await page.evaluate(() => {
        const g = window.__jamsildo;
        const spirit = g.stage.rooms.find(r => r.kind === 'spirit');
        g.enterRoom(spirit, null);
        const orangePixels = room => {
          const pixels = g.roomCanvas(room).getContext('2d').getImageData(0, 0, 480, 270).data;
          let count = 0;
          for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 80 && pixels[i] > pixels[i + 1] * 1.4) count += 1;
          return count;
        };
        return { spirit: orangePixels(spirit), normal: orangePixels(g.stage.start) };
      });
      assert(decoration.spirit > decoration.normal + 500, 'spirit room must have distinct pixel decoration');
      assert.equal(await page.locator('#roomLabel').textContent(), '불의 정령방');
      await page.locator('#roomLabel').waitFor({ state: 'visible' });
      await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('#hint')).opacity) > 0.8);
      assert.equal(await page.locator('.map-room.is-spirit.is-current').count(), 1);
      await page.screenshot({ path: join(output, `${width}x${height}-spirit.png`) });
      const spiritState = await page.evaluate(() => {
        const g = window.__jamsildo;
        g.enemies.forEach(enemy => { enemy.faced = true; });
        g.checkClear();
        return { state: g.spirit.state, hint: document.querySelector('#hintText').textContent };
      });
      assert.equal(spiritState.state, 'waiting');
      assert(spiritState.hint.includes('제단'));
      await page.evaluate(() => window.__jamsildo.startRun());
      assert(await page.locator('#roomLabel').isHidden(), 'room label must disappear when leaving spirit room');
      assert.equal(await page.locator('.map-room').count(), 1);
      assert.equal(await page.locator('.map-room').getAttribute('data-room'), '99,99', 'new run must reset discovery');
      if (mobile) {
        const stick = await page.locator('#joystick').boundingBox();
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: stick.x + stick.width / 2 + 35, y: stick.y + stick.height / 2, id: 1 }] });
        await page.waitForFunction(() => window.__jamsildo.player.moving);
      }
      await page.setViewportSize({ width: height, height: width });
      await page.waitForFunction(() => {
        const r = document.querySelector('#game').getBoundingClientRect();
        const scale = Math.min(innerWidth / (innerHeight > innerWidth ? 260 : 480), innerHeight / 270);
        return Math.abs(r.width - 480 * scale) < 1;
      });
      if (mobile) {
        await page.waitForFunction(() => !window.__jamsildo.player.moving);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        const stick = await page.locator('#joystick').boundingBox();
        assert(stick.x >= 0 && stick.y >= 0 && stick.x + stick.width <= height && stick.y + stick.height <= width, 'rotated joystick must stay on screen');
      }
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}x${height}: menu, settings, persistence, pause, map discovery/reset, opening, wider camera, input, resize${mobile ? ', joystick, dead zone, stop, multitouch, cancel, blur, rotation, dialogue' : ''}`);
      await context.close();
    }
    console.log(`Screenshots: ${output}`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
