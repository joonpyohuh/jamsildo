// npm run dev first. PLAYWRIGHT_MODULE may point to an existing install.
// 콤보·초필살기·인간형 세나 팩을 게임 크기로 줄인다. 원본은 알파 1~63의 잡색 헤일로가 넓게 깔려 있어
// 먼저 지운 뒤 부드럽게 줄이고, 알파를 다시 딱 끊어 도트 경계로 만든다.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');

const PACK = 'jamsildo_vfx_combo_ultimate_sena_v1';
/** id → 출력 크기. VFX는 앵커를 원본 비율로 쓰므로 자르지 않고, 세나는 발밑 기준이라 잘라낸다. */
const JOBS = {
  combo_fire_water_mer_kui_steam_vortex: { out: 'combo_steam', width: 560 },
  combo_light_dark_luna_kai_eclipse_slash: { out: 'combo_eclipse', width: 560 },
  ultimate_fire_mer_gigantic_flame_cannon: { out: 'ult_fire', width: 512 },
  ultimate_water_kui_horizontal_tsunami: { out: 'ult_water', width: 720 },
  ultimate_light_luna_divine_sword_slash: { out: 'ult_light', width: 320 },
  ultimate_dark_kai_reaper_scythe_slash: { out: 'ult_dark', width: 440 },
};
const SENA = [{ out: 'sena_human', height: 172 }, { out: 'sena_human_sm', height: 40 }];

(async () => {
  const root = path.resolve(__dirname, '..');
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'game_assets', PACK, 'asset_manifest.json'), 'utf8'));
  const byId = new Map(manifest.assets.map(asset => [asset.id, asset]));
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const render = (page, job) => page.evaluate(async job => {
    const image = new Image();
    image.src = job.src;
    await image.decode();
    const source = document.createElement('canvas');
    source.width = image.width; source.height = image.height;
    const g = source.getContext('2d', { willReadFrequently: true });
    g.drawImage(image, 0, 0);
    const pixels = g.getImageData(0, 0, source.width, source.height);
    let x0 = image.width, y0 = image.height, x1 = 0, y1 = 0;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4;
      if (pixels.data[i + 3] < 128) { pixels.data[i + 3] = 0; continue; }
      pixels.data[i + 3] = 255;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    g.putImageData(pixels, 0, 0);
    const crop = job.trim ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : { x: 0, y: 0, w: image.width, h: image.height };
    const scale = job.height ? job.height / crop.h : job.width / crop.w;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(crop.w * scale));
    canvas.height = Math.max(1, Math.round(crop.h * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height);
    const small = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 3; i < small.data.length; i += 4) small.data[i] = small.data[i] < 128 ? 0 : 255;
    ctx.putImageData(small, 0, 0);
    return { data: canvas.toDataURL('image/png').split(',')[1], width: canvas.width, height: canvas.height };
  }, job);
  try {
    const page = await browser.newPage();
    await page.goto('http://localhost:5173');
    const output = path.join(root, 'public/sprites/fx');
    const write = async (name, job) => {
      const result = await render(page, job);
      await fs.writeFile(path.join(output, `${name}.png`), Buffer.from(result.data, 'base64'));
      console.log(`${name} ${result.width}x${result.height}`);
    };
    for (const [id, job] of Object.entries(JOBS)) await write(job.out, { src: `/game_assets/${PACK}/${byId.get(id).path}`, width: job.width });
    const sena = byId.get('character_sena_human_idle_3q');
    for (const job of SENA) await write(job.out, { src: `/game_assets/${PACK}/${sena.alternate_path}`, height: job.height, trim: true });
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
