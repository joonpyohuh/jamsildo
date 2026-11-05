/**
 * 런 안에서 쌓이는 강화: 증강(숫자)과 아티팩트(고유 효과)의 데이터와 순수 계산.
 * 수치는 data/*.json에서 조정한다. 효과를 실제로 거는 곳은 game.ts다.
 */
import augmentData from './data/augments.json';
import artifactData from './data/artifacts.json';

export type Grade = 'silver' | 'gold' | 'prism';
export type AugmentStat = 'attackFlat' | 'maxHp' | 'energyRegen' | 'moveSpeed' | 'critChance' | 'cooldown' | 'dashCooldown' | 'maxEnergy' | 'attackPct' | 'critDamage' | 'formBoost' | 'lastStand';
export interface Augment { id: string; name: string; stat: string; value: number }

export type ArtifactId = keyof typeof artifactData;
export interface ArtifactSpec { name: string; story: string; effect: string; cost?: number; limit?: number; price?: string; curse?: boolean; repeat?: boolean; hidden?: boolean }
export const ARTIFACTS: Readonly<Record<ArtifactId, ArtifactSpec>> = artifactData;
export const ARTIFACT_IDS = Object.keys(ARTIFACTS) as ArtifactId[];
export type Owned = Partial<Record<ArtifactId, number>>;

export type FormBoost = 'dagger' | 'sword' | 'bow' | 'knuckle';
export interface Mods extends Record<AugmentStat, number> { forms: FormBoost[] }
export const newMods = (): Mods => ({ attackFlat: 0, maxHp: 0, energyRegen: 0, moveSpeed: 0, critChance: 0, cooldown: 0, dashCooldown: 0, maxEnergy: 0, attackPct: 0, critDamage: 0, formBoost: 0, lastStand: 0, forms: [] });

/** 치명타 기본값 */
export const CRIT_CHANCE = 0.05, CRIT_DAMAGE = 1.5;
/** 보스 처치·하드방 보상에 저주가 섞이는 비율 (가안) */
const CURSE_ODDS = 0.25;

function shuffled<T>(list: readonly T[]): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [copy[i], copy[j]] = [copy[j]!, copy[i]!]; }
  return copy;
}

/** 등급을 뽑는다. 천장에 닿으면 골드 이상 확정. */
export function rollGrade(roomsSinceGold: number): Grade {
  const { silver, gold } = augmentData.gradeOdds, roll = Math.random() * 100;
  if (roll >= silver + gold) return 'prism';
  if (roll >= silver || roomsSinceGold >= augmentData.pityRooms) return 'gold';
  return 'silver';
}

export const rollCards = (grade: Grade): Augment[] => shuffled(augmentData.cards[grade]).slice(0, 3);

const unowned = (owned: Owned): ArtifactId[] => ARTIFACT_IDS.filter(id => !owned[id] && !ARTIFACTS[id].repeat && !ARTIFACTS[id].hidden);

/** 아직 없는 아티팩트 하나 */
export function rollArtifact(owned: Owned): ArtifactId | null {
  const curse = Math.random() < CURSE_ODDS, free = unowned(owned), pool = free.filter(id => !!ARTIFACTS[id].curse === curse);
  return shuffled(pool.length ? pool : free)[0] ?? null;
}

/** 상점 진열: 소모품 둘 + 아직 없는 아티팩트 둘 */
export const shopStock = (owned: Owned): ArtifactId[] => [...ARTIFACT_IDS.filter(id => ARTIFACTS[id].repeat), ...shuffled(unowned(owned)).slice(0, 2)];

/** 도감: 런이 끝나도 남는다 */
const CODEX_KEY = 'jamsildo.codex';
export function readCodex(): ArtifactId[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(CODEX_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((id): id is ArtifactId => id in ARTIFACTS) : [];
  } catch { return []; }
}
export function addCodex(id: ArtifactId): void {
  const list = readCodex();
  if (list.includes(id)) return;
  try { localStorage.setItem(CODEX_KEY, JSON.stringify([...list, id])); } catch { /* 저장이 막혀도 플레이는 계속한다. */ }
}
