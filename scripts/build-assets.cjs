// Uses the same optional Playwright installation as tests/responsive.cjs.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
(async () => {
  const root = path.resolve(__dirname, '..');
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'game_assets/assets_manifest.json'), 'utf8'));
  const output = path.join(root, 'public/sprites');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  try {
    const page = await browser.newPage();
    await page.goto('http://localhost:5173');
    // ASSET_ONLY=접두어: 그 이름의 시트 조각만 다시 만든다 (나머지 산출물은 건드리지 않는다)
    const only = process.env.ASSET_ONLY;
    for (const asset of only ? [] : manifest.assets) {
      const encoded = await page.evaluate(async asset => {
        const image = new Image();
        image.src = `/game_assets/${asset.path}`;
        await image.decode();
        const source = document.createElement('canvas');
        source.width = image.width; source.height = image.height;
        const g = source.getContext('2d');
        g.drawImage(image, 0, 0);
        const pixels = g.getImageData(0, 0, source.width, source.height);
        let x0 = image.width, y0 = image.height, x1 = 0, y1 = 0;
        for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
          const i = (y * image.width + x) * 4;
          if (pixels.data[i + 3] < 100) { pixels.data[i + 3] = 0; continue; }
          x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
        if (x1 <= x0 || y1 <= y0) throw new Error(`Empty sprite: ${asset.id}`);
        g.putImageData(pixels, 0, 0);
        const maxH = asset.type === 'boss' ? (asset.id.endsWith('young_yoonseul') ? 40 : 56) : asset.type === 'spirit' ? 20 : 27;
        const maxW = asset.type === 'boss' ? 76 : asset.type === 'spirit' ? 22 : 34;
        const scale = Math.min(maxW / (x1 - x0 + 1), maxH / (y1 - y0 + 1));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round((x1 - x0 + 1) * scale));
        canvas.height = Math.max(1, Math.round((y1 - y0 + 1) * scale));
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.filter = 'brightness(1.3)';
        ctx.drawImage(source, x0, y0, x1 - x0 + 1, y1 - y0 + 1, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/png').split(',')[1];
      }, asset);
      await fs.writeFile(path.join(output, `${asset.id}.png`), Buffer.from(encoded, 'base64'));
    }
    console.log(`Built ${manifest.assets.length} game sprites from original concept assets.`);

    /* 확장팩: 시트를 칸으로 자르고, 투명 경계로 트리밍한 뒤 게임 크기로 줄인다.
       큰 원화를 그대로 최근접 축소하면 지저분해서 부드럽게 줄인 다음 알파를 딱 끊어 도트 경계로 만든다. */
    const extension = JSON.parse(await fs.readFile(path.join(root, 'game_assets/extension_manifest.json'), 'utf8'));
    const jobs = [];
    const cellOf = (sheet, cell) => ({ path: sheet.path, columns: sheet.columns, rows: sheet.rows, row: cell.row, column: cell.column });
    for (const sheet of extension.evolution_sheets) for (const cell of sheet.cells) {
      jobs.push({ ...cellOf(sheet, cell), id: `evo_${sheet.element}_${cell.stage}`, max: cell.stage === 'upper' ? 36 : 28, gapSplit: true });
      // 초필살기 컷인: 세나 옆에 나란히 서므로 늘리지 않고 큰 크기로 따로 뽑는다
      jobs.push({ ...cellOf(sheet, cell), id: `cut_evo_${sheet.element}_${cell.stage}`, max: 76, gapSplit: true });
    }
    for (const sheet of extension.spirit_effect_sheets) for (const cell of sheet.cells) {
      const id = `fx_${sheet.element}_${cell.weapon ?? cell.variation}`;
      jobs.push({ ...cellOf(sheet, cell), id, max: 96 }, { ...cellOf(sheet, cell), id: `${id}_sm`, max: 44 });
    }
    for (const sheet of extension.monster_effect_sheets) for (const cell of sheet.cells) {
      jobs.push({ ...cellOf(sheet, cell), id: cell.effect_id, max: cell.monster_id.startsWith('boss') ? 120 : 64 });
    }
    await fs.mkdir(path.join(output, 'fx'), { recursive: true });
    for (const job of only ? jobs.filter(job => job.id.startsWith(only)) : jobs) {
      const encoded = await page.evaluate(async job => {
        const image = new Image();
        image.src = `/game_assets/${job.path}`;
        await image.decode();
        const cw = image.width / job.columns, ch = image.height / job.rows;
        let left = Math.floor(job.column * cw), width = Math.floor(cw);
        if (job.gapSplit) {
          // 진화 시트는 상급 그림이 중앙선을 넘는다: 가운데 근처에서 가장 빈 세로줄로 나눈다
          const whole = document.createElement('canvas');
          whole.width = image.width; whole.height = image.height;
          const wg = whole.getContext('2d', { willReadFrequently: true });
          wg.drawImage(image, 0, 0);
          const all = wg.getImageData(0, 0, image.width, image.height).data;
          let best = Math.floor(image.width / 2), bestCount = Infinity;
          for (let x = Math.floor(image.width * 0.3); x < image.width * 0.62; x++) {
            let count = 0;
            for (let y = 0; y < image.height; y++) if (all[(y * image.width + x) * 4 + 3] >= 60) count++;
            if (count < bestCount) { bestCount = count; best = x; }
          }
          left = job.column === 0 ? 0 : best;
          width = job.column === 0 ? best : image.width - best;
        }
        const source = document.createElement('canvas');
        source.width = width; source.height = Math.floor(ch);
        const g = source.getContext('2d', { willReadFrequently: true });
        g.drawImage(image, left, Math.floor(job.row * ch), source.width, source.height, 0, 0, source.width, source.height);
        const cell = g.getImageData(0, 0, source.width, source.height);
        const data = cell.data;
        // 칸 가장자리에 걸친 작은 덩어리 = 옆 칸에서 넘어온 조각. 지운다.
        {
          const W = source.width, H = source.height, label = new Int32Array(W * H), sizes = [0], edge = [false], stack = [];
          for (let start = 0; start < W * H; start++) {
            if (label[start] || data[start * 4 + 3] < 60) continue;
            const id = sizes.length; sizes.push(0); edge.push(false); label[start] = id; stack.push(start);
            while (stack.length) {
              const i = stack.pop(), x = i % W, y = (i / W) | 0;
              sizes[id]++;
              if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge[id] = true;
              for (const n of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
                if (n >= 0 && !label[n] && data[n * 4 + 3] >= 60) { label[n] = id; stack.push(n); }
              }
            }
          }
          const biggest = Math.max(...sizes);
          for (let i = 0; i < W * H; i++) if (label[i] && edge[label[i]] && sizes[label[i]] < biggest * 0.25) data[i * 4 + 3] = 0;
          g.putImageData(cell, 0, 0);
        }
        let x0 = source.width, y0 = source.height, x1 = 0, y1 = 0;
        for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
          if (data[(y * source.width + x) * 4 + 3] < 60) continue;
          x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
        if (x1 <= x0 || y1 <= y0) throw new Error(`Empty cell: ${job.id}`);
        const w = x1 - x0 + 1, h = y1 - y0 + 1, scale = Math.min(1, job.max / Math.max(w, h));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * scale)); canvas.height = Math.max(1, Math.round(h * scale));
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(source, x0, y0, w, h, 0, 0, canvas.width, canvas.height);
        const out = ctx.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 3; i < out.data.length; i += 4) out.data[i] = out.data[i] < 110 ? 0 : 255;
        ctx.putImageData(out, 0, 0);
        return canvas.toDataURL('image/png').split(',')[1];
      }, job);
      await fs.writeFile(path.join(output, 'fx', `${job.id}.png`), Buffer.from(encoded, 'base64'));
    }
    console.log(`Built ${jobs.length} evolution and effect sprites.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
