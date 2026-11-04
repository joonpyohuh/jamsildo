import manifest from '../../game_assets/assets_manifest.json';
import extension from '../../game_assets/extension_manifest.json';
import type { Sprite } from './sprites';

export const ART = new Map<string, Sprite>();

/** 몬스터 → 대표 스킬 이펙트 (extension_manifest의 19종) */
export const MONSTER_VFX = new Map<string, string>(
  extension.monster_effect_sheets.flatMap(sheet => sheet.cells.map(cell => [cell.monster_id, cell.effect_id] as [string, string])),
);

/** public/sprites/fx 파일 이름 (scripts/build-assets.cjs와 같은 규칙) */
function effectIds(): string[] {
  const ids: string[] = [];
  for (const sheet of extension.evolution_sheets) for (const cell of sheet.cells) ids.push(`evo_${sheet.element}_${cell.stage}`);
  for (const sheet of extension.spirit_effect_sheets) for (const cell of sheet.cells) {
    const c = cell as { weapon?: string; variation?: string };
    const id = `fx_${sheet.element}_${c.weapon ?? c.variation}`;
    ids.push(id, `${id}_sm`);
  }
  for (const sheet of extension.monster_effect_sheets) for (const cell of sheet.cells) ids.push(cell.effect_id);
  return ids;
}

async function load(id: string, url: string): Promise<void> {
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('sprite context unavailable');
  ctx.drawImage(image, 0, 0);
  ART.set(id, canvas);
}

export async function loadArt(): Promise<void> {
  await Promise.all([
    ...manifest.assets.map(asset => load(asset.id, `/sprites/${asset.id}.png`)),
    ...effectIds().map(id => load(id, `/sprites/fx/${id}.png`)),
  ]);
}
