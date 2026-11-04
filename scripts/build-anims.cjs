// 정지 스프라이트로 프레임 애니메이션 시트를 만든다 (Aseprite JSON-array 형식, 태그 + 프레임 시간 + pivot 슬라이스).
// 개발 서버(npm run dev)가 켜져 있어야 한다. Playwright는 build-assets.cjs와 같은 설치를 쓴다.
//   PLAYWRIGHT_MODULE=<경로> CHROME_PATH=<chrome.exe> node scripts/build-anims.cjs
// 정식 Aseprite로 같은 id의 시트를 내보내면 public/anim/<id>.png|json 을 그대로 덮어쓰면 된다 (src/game/anim.ts 참고).
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const root = path.resolve(__dirname, '..');
  const out = path.join(root, 'public/anim');
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(out, { recursive: true });
  const sprites = path.join(root, 'public/sprites');
  const list = [];
  for (const file of await fs.readdir(sprites)) if (file.endsWith('.png')) list.push({ id: file.slice(0, -4), url: `/sprites/${file}` });
  for (const file of await fs.readdir(path.join(sprites, 'fx'))) if (file.endsWith('.png')) list.push({ id: file.slice(0, -4), url: `/sprites/fx/${file}` });
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  try {
    const page = await browser.newPage();
    await page.goto('http://localhost:5173');
    await page.waitForFunction(() => document.querySelector('#startGame') !== null);
    const ids = [];
    // 윤슬은 코드로 그린 도트라 게임에서 바로 가져온다
    const results = [{ id: 'yunseul', kind: 'player' }, ...list.map(item => ({ ...item, kind: kindOf(item.id) }))];
    for (const job of results) {
      const made = await page.evaluate(buildSheet, job);
      await fs.writeFile(path.join(out, `${job.id}.png`), Buffer.from(made.png, 'base64'));
      await fs.writeFile(path.join(out, `${job.id}.json`), JSON.stringify(made.json));
      ids.push(job.id);
    }
    await fs.writeFile(path.join(out, 'index.json'), JSON.stringify({ ids }));
    console.log(`Built ${ids.length} animation sheets in public/anim.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

const AIMED = new Set(['fire_dagger', 'fire_bow', 'fire_knuckle', 'water_dagger', 'water_bow', 'water_knuckle',
  'wood_bow', 'dark_dagger', 'dark_bow', 'light_dagger', 'light_bow', 'chaos_prismatic_shadow_ray']);
function kindOf(id) {
  if (id.startsWith('fx_')) return AIMED.has(id.replace(/^fx_/, '').replace(/_sm$/, '')) ? 'fx-aimed' : 'fx';
  if (id.startsWith('vfx_')) return 'fx-monster';
  if (id.startsWith('evo_') || id.startsWith('spirit_')) return 'spirit';
  if (id.startsWith('boss_')) return 'boss';
  return 'monster';
}

/** 브라우저 안에서 실행: 한 스프라이트 → 시트 PNG(base64) + Aseprite 형식 JSON */
async function buildSheet(job) {
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  let sources;
  if (job.kind === 'player') {
    const { SPRITES } = await import('/src/game/sprites.ts');
    sources = SPRITES.yunseul;
  } else {
    const image = new Image();
    image.src = job.url;
    await image.decode();
    const c = document.createElement('canvas');
    c.width = image.width; c.height = image.height;
    c.getContext('2d').drawImage(image, 0, 0);
    sources = [c];
  }
  const w = sources[0].width, h = sources[0].height;
  const fx = job.kind.startsWith('fx');
  // 셀 여백: 늘어나고 뛰어오를 공간. 몬스터·정령은 발밑이 셀 아래, 이펙트는 중심이 셀 중앙.
  const padX = fx ? Math.ceil(w * 0.14) : Math.ceil(w * 0.22), padTop = fx ? Math.ceil(h * 0.14) : Math.ceil(h * 0.32), padBottom = fx ? padTop : 1;
  const cw = w + padX * 2, ch = h + padTop + padBottom;
  const foot = fx ? padTop + h / 2 : padTop + h; // pivot y

  // 프레임 하나를 그린다. srcIndex: 윤슬 걷기 칸. 모든 변형은 최근접(도트가 뭉개지지 않게).
  const frame = (o) => {
    const cell = document.createElement('canvas');
    cell.width = cw; cell.height = ch;
    const g = cell.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = false;
    const src = sources[o.src ?? 0];
    const dw = Math.max(1, Math.round(w * (o.sx ?? 1))), dh = Math.max(1, Math.round(h * (o.sy ?? 1)));
    const x = Math.round(cw / 2 - dw / 2 + (o.dx ?? 0));
    const y = fx ? Math.round(ch / 2 - dh / 2 + (o.dy ?? 0)) : Math.round(padTop + h - dh + (o.dy ?? 0));
    let clipW = dw;
    if (o.wipe !== undefined) clipW = Math.max(1, Math.round(dw * o.wipe));
    g.drawImage(src, 0, 0, Math.round(w * clipW / dw), h, x, y, clipW, dh);
    if (o.white) {
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = `rgba(255,255,255,${o.white})`;
      g.fillRect(0, 0, cw, ch);
      g.globalCompositeOperation = 'source-over';
    }
    if (o.fade !== undefined && o.fade < 1) {
      // 반투명 대신 베이어 디더로 지운다 (도트 느낌 유지)
      const data = g.getImageData(0, 0, cw, ch);
      for (let py = 0; py < ch; py += 1) for (let px = 0; px < cw; px += 1) {
        if (o.fade <= (bayer[(py & 3) * 4 + (px & 3)] + 0.5) / 16) data.data[(py * cw + px) * 4 + 3] = 0;
      }
      g.putImageData(data, 0, 0);
    }
    return { cell, duration: o.ms };
  };

  // [sx, sy, dy, ms, extra]
  const A = (rows) => rows.map(r => ({ sx: r[0], sy: r[1], dy: r[2], ms: r[3], ...(r[4] || {}) }));
  const tags = []; // [name, frames[], direction]
  if (job.kind === 'player') {
    tags.push(['idle', [
      { src: 0, sx: 1, sy: 1, dy: 0, ms: 520 }, { src: 0, sx: 1, sy: 0.96, dy: 0, ms: 520 },
    ]]);
    tags.push(['walk', [0, 1, 2, 3].map(i => ({ src: i, ms: 100, dy: i % 2 ? -1 : 0 }))]);
    tags.push(['attack', [
      { src: 1, dx: -1, sy: 0.97, ms: 45 }, { src: 2, dx: 2, sx: 1.04, ms: 55 }, { src: 2, dx: 3, sx: 1.06, sy: 0.98, ms: 55 }, { src: 0, dx: 1, ms: 70 },
    ]]);
    tags.push(['cast', [
      { src: 0, sy: 1.06, dy: -1, ms: 90 }, { src: 0, sy: 1.1, dy: -2, white: 0.28, ms: 130 }, { src: 0, sy: 1.04, dy: -1, ms: 90 }, { src: 0, ms: 70 },
    ]]);
    tags.push(['hurt', [
      { src: 0, sx: 0.9, sy: 1.06, dx: -2, white: 0.9, ms: 60 }, { src: 0, sx: 0.94, dx: -3, white: 0.5, ms: 70 }, { src: 0, dx: -1, ms: 80 },
    ]]);
  } else if (job.kind === 'spirit') {
    tags.push(['idle', A([[1, 1, 0, 180], [1.03, 0.97, -1, 180], [1.05, 0.95, -2, 180], [1.03, 0.97, -1, 180]])]);
    tags.push(['cast', A([[1, 1, 0, 60], [1.2, 0.82, 0, 70], [0.86, 1.22, -4, 70, { white: 0.55 }], [1.14, 1.14, -3, 80, { white: 0.25 }], [1, 1, -1, 80]])]);
    tags.push(['spawn', A([[0.4, 0.2, 0, 70, { fade: 0.3 }], [0.7, 0.55, -1, 70, { fade: 0.6 }], [1.15, 0.9, -3, 70], [0.95, 1.08, -2, 70], [1, 1, 0, 70]])]);
  } else if (job.kind === 'monster' || job.kind === 'boss') {
    const slow = job.kind === 'boss' ? 1.35 : 1;
    const ms = (n) => Math.round(n * slow);
    tags.push(['idle', A([[1, 1, 0, ms(200)], [1.03, 0.97, 0, ms(200)], [1.05, 0.94, 0, ms(200)], [1.02, 0.98, 0, ms(200)]])]);
    tags.push(['move', A([[1.06, 0.92, 0, ms(90)], [0.94, 1.08, -3, ms(90)], [0.92, 1.1, -5, ms(90)], [1.04, 0.95, -1, ms(90)], [1.08, 0.9, 0, ms(90)]])]);
    tags.push(['attack', A([[1.12, 0.82, 0, ms(120)], [1.16, 0.78, 0, ms(90)], [0.8, 1.28, -4, ms(70)], [0.86, 1.2, -2, ms(70)], [1.1, 0.88, 0, ms(90)], [1.02, 0.98, 0, ms(90)]])]);
    tags.push(['hurt', A([[0.9, 1.08, -1, 55, { white: 0.9 }], [1.12, 0.86, 0, 55, { white: 0.5 }], [1.04, 0.96, 0, 70]])]);
    tags.push(['spawn', A([[1, 0.15, 0, 80, { fade: 0.4 }], [1, 0.45, 0, 80, { fade: 0.7 }], [1, 0.8, 0, 80], [1.08, 1.12, -2, 80], [1, 1, 0, 80]])]);
    tags.push(['die', A([[1.04, 0.96, 0, 90, { white: 0.5 }], [1.1, 0.8, 0, 90, { fade: 0.85 }], [1.16, 0.6, 0, 90, { fade: 0.65 }], [1.22, 0.4, 0, 90, { fade: 0.45 }], [1.28, 0.22, 0, 90, { fade: 0.25 }], [1.32, 0.1, 0, 90, { fade: 0.1 }]])]);
  } else {
    // 이펙트: 나타남 → 정점 → 디더로 사라짐. 방향이 있는 그림(화살·찌르기)은 앞으로 뻗는 와이프.
    const aimed = job.kind === 'fx-aimed';
    const pop = [0.6, 0.85, 1, 1.06, 1.1, 1.14];
    const fades = [1, 1, 1, 0.85, 0.5, 0.2];
    const ms = job.kind === 'fx-monster' ? 70 : 50;
    tags.push(['play', pop.map((s, i) => ({
      sx: s, sy: s, ms, fade: fades[i],
      wipe: aimed ? [0.35, 0.65, 1, 1, 1, 1][i] : undefined,
      white: i === 1 ? 0.25 : 0,
    }))]);
    // 투사체용: 같은 그림이 일렁이는 반복
    tags.push(['loop', [1, 1.07, 1, 0.94].map(s => ({ sx: s, sy: s, ms: 60 }))]);
  }

  // 시트 이어붙이기: 한 줄
  const frames = [], jsonTags = [], cells = [];
  for (const [name, list, direction] of tags) {
    const from = cells.length;
    for (const f of list) { const made = frame(f); cells.push(made); }
    jsonTags.push({ name, from, to: cells.length - 1, direction: direction || 'forward' });
  }
  const sheet = document.createElement('canvas');
  sheet.width = cw * cells.length; sheet.height = ch;
  const sg = sheet.getContext('2d');
  cells.forEach((c, i) => {
    sg.drawImage(c.cell, i * cw, 0);
    frames.push({
      filename: `${job.id} ${i}.aseprite`, frame: { x: i * cw, y: 0, w: cw, h: ch }, rotated: false, trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: cw, h: ch }, sourceSize: { w: cw, h: ch }, duration: c.duration,
    });
  });
  return {
    png: sheet.toDataURL('image/png').split(',')[1],
    json: {
      frames,
      meta: {
        app: 'jamsildo build-anims (Aseprite JSON-array compatible)', version: '1', image: `${job.id}.png`, format: 'RGBA8888',
        size: { w: sheet.width, h: sheet.height }, scale: '1', frameTags: jsonTags,
        slices: [{ name: 'pivot', color: '#0000ffff', keys: [{ frame: 0, bounds: { x: 0, y: 0, w: cw, h: ch }, pivot: { x: cw / 2, y: foot } }] }],
      },
    },
  };
}
