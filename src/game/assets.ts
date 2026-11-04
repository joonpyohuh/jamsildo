import manifest from '../../game_assets/assets_manifest.json';
import type { Sprite } from './sprites';

export const ART = new Map<string, Sprite>();
export async function loadArt(): Promise<void> {
  await Promise.all(manifest.assets.map(async asset => {
    const image = new Image();
    image.src = `/sprites/${asset.id}.png`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('sprite context unavailable');
    ctx.drawImage(image, 0, 0);
    ART.set(asset.id, canvas);
  }));
}
