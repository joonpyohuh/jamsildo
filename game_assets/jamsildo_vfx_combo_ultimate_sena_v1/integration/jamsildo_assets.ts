/**
 * Drop the full jamsildo_vfx_combo_ultimate_sena_v1 folder into
 * public/game_assets/ and import this registry from your game.
 * These are one-frame RGBA PNG assets, not animated frame sheets.
 */
const root = "/game_assets/jamsildo_vfx_combo_ultimate_sena_v1/assets";

export const JAMSILDO_ASSETS = {
  combo_fire_water_mer_kui_steam_vortex: {
    src: `${root}/combos/combo_fire_water_mer_kui_steam_vortex.png`,
    width: 1024,
    height: 512,
    category: "combo",
  },
  combo_light_dark_luna_kai_eclipse_slash: {
    src: `${root}/combos/combo_light_dark_luna_kai_eclipse_slash.png`,
    width: 1024,
    height: 512,
    category: "combo",
  },
  ultimate_fire_mer_gigantic_flame_cannon: {
    src: `${root}/ultimates/ultimate_fire_mer_gigantic_flame_cannon.png`,
    width: 1024,
    height: 435,
    category: "ultimate",
  },
  ultimate_water_kui_horizontal_tsunami: {
    src: `${root}/ultimates/ultimate_water_kui_horizontal_tsunami.png`,
    width: 1024,
    height: 341,
    category: "ultimate",
  },
  ultimate_light_luna_divine_sword_slash: {
    src: `${root}/ultimates/ultimate_light_luna_divine_sword_slash.png`,
    width: 1024,
    height: 683,
    category: "ultimate",
  },
  ultimate_dark_kai_reaper_scythe_slash: {
    src: `${root}/ultimates/ultimate_dark_kai_reaper_scythe_slash.png`,
    width: 1024,
    height: 512,
    category: "ultimate",
  },
  character_sena_human_idle_3q: {
    src: `${root}/characters/character_sena_human_idle_3q_128x192.png`,
    width: 128,
    height: 192,
    category: "character",
  },
} as const;

export type JamsildoAssetId = keyof typeof JAMSILDO_ASSETS;
