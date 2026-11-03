/**
 * 세나 대사: 고정 대사 세트 (AI 생성 없음).
 * 츤데레 — 걱정은 하지만 걱정한다고 말하지 않는다. 짧게, 명령형으로.
 * 한 줄은 22자 이내 (아래 벽 자막 칸 폭).
 */
export type LineKey =
  | 'start' | 'enter' | 'clear' | 'hurt' | 'low'
  | 'dagger' | 'sword' | 'bow' | 'knuckle'
  | 'spiritRoom' | 'skillHint' | 'goOut' | 'firstAttack'
  | 'bossIntro' | 'bossIntroFire' | 'bossSnooze' | 'bossFaced';

export type Speaker = 'yunseul' | 'sena';
export const SPEAKER_NAME: Readonly<Record<Speaker, string>> = { yunseul: '윤슬', sena: '세나' };

export interface Talk {
  who: Speaker;
  text: string;
}

/** 첫 방 대사창 */
export const OPENING: readonly Talk[] = [
  { who: 'yunseul', text: '여기가 어디지..?' },
  { who: 'sena', text: '야 여기 니 심상세계야. 정신차리고 빨리 싸워.' },
  { who: 'yunseul', text: '심상세계..? 이젠 헛 것이 다 보이는군.' },
];

/** 불의 정령을 얻었을 때 */
export const FIRE_SPIRIT_TAKEN: readonly Talk[] = [
  { who: 'sena', text: '불의 정령이네, 잘 쓰면 유용할거야. 귀엽게 생겼다고 너무 가까이 가진 마라' },
];

export const LINES: Readonly<Record<LineKey, readonly string[]>> = {
  start: ['아 뭐야..'],
  enter: [
    '또 있네. 빨리 끝내.',
    '몸은 내가 끌게. 넌 버티기만 해.',
    '눈 감지 마. 봐야 벨 수 있어.',
    '…뭘 봐. 앞에 봐.',
  ],
  clear: [
    '나쁘지 않았어. 칭찬 아니야.',
    '숨 쉬어. 천천히.',
    '끝. 다음.',
    '봐. 아까보다 덜 무섭지?',
  ],
  hurt: [
    '야, 정신 차려.',
    '괜찮아? …물어본 거 아니야.',
    '피하라고 했잖아.',
  ],
  low: [
    '119 부르지 마. 부르면 죽어.',
    '조금만 더. 내가 있잖아.',
  ],
  dagger: ['가까워. 짧게 간다.'],
  sword: ['여럿이네. 크게 벤다.'],
  bow: ['멀어. 쏠게.'],
  knuckle: ['붙지 마. 밀어낸다.'],
  bossIntro: ['뭐야.. 시계? 넌 알람소리가 그렇게 싫었냐?'],
  goOut: ['뭐 해. 나가.'],
  firstAttack: ['눌러. 한 번만.'],
  spiritRoom: ['...뭔가 뜨거운데?'],
  skillHint: ['Q 눌러. 불덩이 나가.', '몰리면 W. 불 둘러.', '도망칠 땐 E.', '아껴둔 R, 지금이야.'],
  bossIntroFire: ['뭐야.. 시계? 넌 알람소리가 그렇게 싫었냐?'],
  bossSnooze: ['스누즈 누르지 마. 이번엔.'],
  bossFaced: ['뭐.. 나쁘지않게 싸우네.'],
};

const lastPicked = new Map<LineKey, string>();

/** 같은 줄이 연달아 나오지 않게 고른다 */
export function pickLine(key: LineKey): string {
  const pool = LINES[key];
  const prev = lastPicked.get(key);
  const options = pool.length > 1 ? pool.filter((l) => l !== prev) : pool;
  const line = options[Math.floor(Math.random() * options.length)] ?? pool[0] ?? '';
  lastPicked.set(key, line);
  return line;
}
