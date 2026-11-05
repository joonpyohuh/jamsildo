/**
 * 세나의 형태.
 * 플레이어는 공격 버튼 하나만 누른다. 형태 선택은 세나의 몫 — "세나가 몸을 끌고 간다".
 */
export type FormId = 'dagger' | 'sword' | 'bow' | 'knuckle';

export interface FormSpec {
  id: FormId;
  label: string;
  cooldown: number;
  /** 근접 판정 거리 (중심 기준, 적 반지름은 별도로 더함) */
  range: number;
  /** 근접 판정 부채꼴 각도 */
  arc: number;
  damage: number;
  knockback: number;
  hitstop: number;
  shake: number;
  /** 세나가 몸을 끌어당기는 최대 거리 */
  lunge: number;
  swing: number;
}

export const FORMS: Readonly<Record<FormId, FormSpec>> = {
  dagger: {
    id: 'dagger', label: '단검', cooldown: 0.17, range: 34, arc: Math.PI * 0.55,
    damage: 10, knockback: 85, hitstop: 0.04, shake: 1.5, lunge: 42, swing: 0.1,
  },
  sword: {
    id: 'sword', label: '장검', cooldown: 0.44, range: 58, arc: Math.PI * 1.15,
    damage: 20, knockback: 180, hitstop: 0.04, shake: 3.5, lunge: 12, swing: 0.16,
  },
  bow: {
    // 안전한 원거리 공격은 근접 형태보다 피해량과 공격속도를 낮게 유지한다.
    id: 'bow', label: '활', cooldown: 0.62, range: 0, arc: 0,
    damage: 8, knockback: 40, hitstop: 0.04, shake: 0.8, lunge: 0, swing: 0.14,
  },
  knuckle: {
    id: 'knuckle', label: '너클', cooldown: 0.3, range: 30, arc: Math.PI * 0.7,
    damage: 15, knockback: 330, hitstop: 0.04, shake: 4.5, lunge: 0, swing: 0.12,
  },
};

/** 판정 거리. 적의 '가장자리'까지의 거리 기준. */
export const SENSE = {
  touch: 13,
  /** 58→74: 단검이 더 멀리서 몸을 끌어당긴다 → 활이 덜 나온다 */
  near: 74,
  cluster: 64,
} as const;

export interface Target {
  x: number;
  y: number;
  r: number;
}

export interface FormChoice<T extends Target> {
  form: FormId;
  target: T | null;
}

/**
 * 형태 판정 우선순위 (기획서 '보완 필요' 항목에 대한 1차안)
 *  1. 장검 — 가까운 거리에 적이 둘 이상. 여럿을 한 번에 베는 게 가장 이득이라 최우선.
 *  2. 너클 — 적이 바짝 붙음. 밀쳐내서 숨 쉴 거리를 만든다.
 *  3. 단검 — 가까운 적이 하나. 세나가 몸을 끌어당기며 연타.
 *  4. 활   — 그 외 (멀리 있음).
 */
export function chooseForm<T extends Target>(
  px: number,
  py: number,
  targets: readonly T[],
  fallback: FormId,
): FormChoice<T> {
  let nearest: T | null = null;
  let nearestEdge = Infinity;
  let clustered = 0;

  for (const t of targets) {
    const edge = Math.hypot(t.x - px, t.y - py) - t.r;
    if (edge < nearestEdge) {
      nearestEdge = edge;
      nearest = t;
    }
    if (edge <= SENSE.cluster) clustered += 1;
  }

  if (!nearest) return { form: fallback, target: null };
  if (clustered >= 2) return { form: 'sword', target: nearest };
  if (nearestEdge <= SENSE.touch) return { form: 'knuckle', target: nearest };
  if (nearestEdge <= SENSE.near) return { form: 'dagger', target: nearest };
  return { form: 'bow', target: nearest };
}
