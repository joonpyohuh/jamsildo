// Uses the same optional Playwright installation as tests/responsive.cjs.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
(async () => {
  const root = path.resolve(__dirname, '..');
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'game_assets/assets_manifest.json'), 'utf8'));
  const output = path.join(root, 'public/sprites');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto('http://localhost:5173');
    for (const asset of manifest.assets) {
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
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
