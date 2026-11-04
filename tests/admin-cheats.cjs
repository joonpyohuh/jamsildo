// npm run dev first. Account responses are mocked; no real accounts or saves are changed.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const base = 'http://localhost:5173';
const owner = '11111111-1111-4111-8111-111111111111';
const checkpoint = { version: 1, stage: 7, hp: 57, maxEnergy: 54, equipped: [{ element: 'water', tier: 2 }], acquired: ['water'] };
const account = is_admin => ({ user: { id: owner, username: 'qa_admin', is_admin, play_seconds: 0 }, save: { checkpoint, revision: 1 } });
const overview = { stats: { players: 0, today: 0, online: 0, active_today: 0, play_seconds: 0, blocked: 0, stages: [] }, players: [], total: 0, audit: [] };

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [], syncs = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/account', route => {
      const body = route.request().postDataJSON();
      if (body?.action === 'sync') syncs.push(body);
      return route.fulfill({ json: body?.action === 'admin' ? overview : body?.action === 'sync' ? { revision: 1 } : account(true) });
    });
    await page.goto(base);
    await page.waitForFunction(() => !document.querySelector('#startGame').disabled);
    const original = await page.evaluate(owner => localStorage.getItem(`jamsildo.${owner}.campaign`), owner);
    const openAdmin = async () => { await page.locator('#accountToggle').click(); await page.locator('#openAdmin').click(); };
    await openAdmin();
    await page.waitForFunction(() => document.querySelectorAll('#adminKpis article').length === 6);
    assert.equal(await page.locator('#adminSpirits button').count(), 6);
    await page.locator('#cheat-health').click();
    await page.waitForFunction(() => window.__jamsildo.cheats.health);
    await page.locator('#cheat-energy').click();
    await page.waitForFunction(() => window.__jamsildo.cheats.energy);
    const beforeCheats = syncs.length;
    for (const element of ['fire', 'water', 'wood', 'dark', 'light', 'chaos']) {
      await page.locator(`#adminSpirits [data-element=${element}]`).click();
      await page.waitForFunction(element => {
        const g = window.__jamsildo;
        return g.equipped[g.activeSpirit]?.element === element && g.hasSpirit && g.spirit.state === 'following';
      }, element);
      assert(await page.evaluate(() => window.__jamsildo.equipped.length <= window.__jamsildo.slotLimit));
    }
    await page.evaluate(() => { const g = window.__jamsildo; g.equipped[g.activeSpirit].xp = 19; });
    await page.locator('#adminSpirits [data-element=chaos]').click();
    assert.equal(await page.evaluate(() => { const g = window.__jamsildo; return g.equipped[g.activeSpirit].xp; }), 19, 'selecting an owned spirit must retain growth');
    assert.equal(await page.locator('#adminSpirits [data-element=chaos]').getAttribute('aria-pressed'), 'true');
    await page.locator('#adminStages [data-stage="20"]').click();
    await page.waitForFunction(() => window.__jamsildo.stageNumber === 20 && !document.querySelector('#adminDialog').open);
    assert.deepEqual(await page.evaluate(() => window.__jamsildo.cheats), { health: true, energy: true });
    await openAdmin();
    for (const element of ['dark', 'light', 'fire']) await page.locator(`#adminSpirits [data-element=${element}]`).click();
    assert.equal(await page.evaluate(() => window.__jamsildo.equipped.length), 3);
    const mechanics = await page.evaluate(async () => {
      const g = window.__jamsildo, p = g.player;
      const { SKILLS } = await import('/src/game/campaign.ts');
      p.effects = {}; p.invuln = 0; p.armor = 2; p.skillShield = 3;
      g.hurtPlayer(p.x, p.y - 10, 100000, true);
      if (p.hp !== p.maxHp || p.armor !== 2 || p.skillShield !== 3 || g.mode !== 'play') throw Error('infinite health consumed HP or shields');
      p.maxEnergy = p.energy = 1;
      g.equipSpirit('fire'); const slot = g.equipped[g.activeSpirit]; slot.tier = 2;
      g.castSkill('r');
      if (p.energy !== 1 || slot.cooldowns.r !== SKILLS.fire.r.cd) throw Error('infinite energy must bypass costs but preserve cooldowns');
      const random = Math.random;
      try { Math.random = () => 0.9; g.executeSkill('chaos', 'e'); } finally { Math.random = random; }
      if (p.energy !== 1) throw Error('chaos energy drain bypassed cheat');
      g.activeSpirit = g.equipped.findIndex(s => s.element === 'dark'); g.reactionCd = 0;
      g.castSkill('q'); if (p.hp !== p.maxHp) throw Error('dark/light reaction bypassed infinite health');
      g.equipSpirit('fire'); slot.cooldowns.r = 0;
      return { maxHp: p.maxHp, cost: SKILLS.fire.r.cost };
    });
    assert(mechanics.cost > 1);
    await page.waitForFunction(() => !document.querySelector('#skills [data-skill=r]').disabled);
    await page.locator('#cheat-energy').click();
    await page.waitForFunction(() => !window.__jamsildo.cheats.energy && document.querySelector('#skills [data-skill=r]').disabled);
    await page.locator('#cheat-health').click();
    const normal = await page.evaluate(() => {
      const g = window.__jamsildo, p = g.player, slot = g.equipped[g.activeSpirit];
      p.invuln = p.armor = p.skillShield = 0; p.effects = {};
      g.hurtPlayer(p.x, p.y - 10, 10); g.castSkill('r');
      const energy = p.energy;
      const random = Math.random;
      try { Math.random = () => 0.9; g.executeSkill('chaos', 'e'); } finally { Math.random = random; }
      return { hp: p.hp, energy, drained: p.energy, cooldown: slot.cooldowns.r };
    });
    assert.equal(normal.hp, mechanics.maxHp - 10);
    assert.equal(normal.energy, 1); assert.equal(normal.drained, 0); assert.equal(normal.cooldown, 0);
    await page.locator('#cheat-health').click(); await page.locator('#cheat-energy').click();
    await page.evaluate(() => { window.__jamsildo.saveCheckpoint(); window.dispatchEvent(new Event('pagehide')); });
    assert.equal(syncs.length, beforeCheats, 'cheat progress must never sync to the account');
    assert.equal(await page.evaluate(owner => localStorage.getItem(`jamsildo.${owner}.campaign`), owner), original);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#adminTitle').scrollIntoViewIfNeeded();
    assert(await page.locator('#adminDialog').evaluate(el => el.scrollWidth === el.clientWidth), 'mobile console must not overflow horizontally');
    await page.screenshot({ path: join(tmpdir(), 'jamsildo-admin-cheats.png') });
    await page.locator('#resumeTest').click(); await openAdmin();
    await page.locator('#leaveTest').click();
    await page.waitForFunction(() => window.__jamsildo.mode === 'title');
    assert.deepEqual(await page.evaluate(() => window.__jamsildo.cheats), { health: false, energy: false });
    assert.equal(await page.locator('#cheat-health').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.evaluate(owner => localStorage.getItem(`jamsildo.${owner}.campaign`), owner), original);
    await page.locator('#adminDialog [data-close]').click();
    await page.locator('#continueGame').click();
    assert.equal(await page.evaluate(() => window.__jamsildo.stageNumber), 7);
    assert.deepEqual(await page.evaluate(() => window.__jamsildo.equipped.map(slot => slot.element)), ['water']);
    assert.deepEqual(await page.evaluate(() => window.__jamsildo.cheats), { health: false, energy: false });
    assert.deepEqual(errors, []);
    console.log('PASS six spirits, duplicate selection, slot replacement, independent cheats, lethal damage, energy costs, cooldowns, chaos drain, reactions, mobile UI, isolated saves, exit and normal continue');
    const ordinary = await browser.newPage();
    await ordinary.route('**/api/account', route => route.fulfill({ json: account(false) }));
    await ordinary.goto(base); await ordinary.waitForFunction(() => !document.querySelector('#startGame').disabled);
    assert(await ordinary.locator('#openAdmin').isHidden());
    await ordinary.evaluate(() => document.querySelector('#adminDialog').showModal());
    await ordinary.locator('#cheat-health').click();
    await ordinary.waitForFunction(() => document.querySelector('#adminMessage').textContent.includes('관리자만'));
    assert.deepEqual(await ordinary.evaluate(() => window.__jamsildo.cheats), { health: false, energy: false });
    assert.equal(await ordinary.evaluate(() => window.__jamsildo.mode), 'title');
    console.log('PASS ordinary-account guard: forced console opening cannot activate cheats');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
