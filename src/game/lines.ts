/**
 * 세나 대사: 고정 대사 세트 (AI 생성 없음).
 * 츤데레 — 걱정은 하지만 걱정한다고 말하지 않는다. 짧게, 명령형으로.
 * 짧은 문장으로 쓰고, 좁은 화면에서는 대사창 안에서 줄바꿈한다.
 */
export type LineKey =
  | 'start' | 'enter' | 'clear' | 'hurt' | 'low'
  | 'dagger' | 'sword' | 'bow' | 'knuckle'
  | 'spiritRoom' | 'spiritReady' | 'skillHint' | 'goOut' | 'firstAttack'
  | 'bossIntro' | 'bossIntroFire' | 'bossSnooze' | 'bossFaced';

export type Speaker = 'yunseul' | 'sena';

/** 표정 (표정 시트 sena.expression.png / yunseul.expression.png 의 칸 순서) */
export type Expr = 'smile' | 'angry' | 'flat' | 'troubled' | 'blank' | 'laugh';
export const EXPR_INDEX: Readonly<Record<Expr, number>> = { smile: 0, angry: 1, flat: 2, troubled: 3, blank: 4, laugh: 5 };
export const SPEAKER_NAME: Readonly<Record<Speaker, string>> = { yunseul: '윤슬', sena: '세나' };

export interface Talk {
  who: Speaker;
  text: string;
  face: Expr;
}

/** 첫 방 대사창 */
export const OPENING: readonly Talk[] = [
  { who: 'yunseul', text: '여기가 어디지..?', face: 'blank' },
  { who: 'sena', text: '야 여기 니 심상세계야. 정신차리고 빨리 싸워.', face: 'angry' },
  { who: 'yunseul', text: '잠깐, 내 손에 있는 이 무기는...?', face: 'troubled' },
  { who: 'sena', text: '나야, 세나. 네 손에 든 무기가 나라고. 적에 맞춰 단검, 검, 활, 너클로 변해.', face: 'flat' },
  { who: 'sena', text: '공격은 스페이스바(Space)를 꾹 눌러. 휴대폰에선 왼쪽 아래 공격 버튼을 누르면 돼.', face: 'flat' },
  { who: 'sena', text: '휴대폰은 오른쪽 조이스틱으로 이동해. 컴퓨터는 바닥을 클릭하면 돼. 움직이면서 공격해. 적은 내가 알아서 노릴게.', face: 'smile' },
];

/** 불의 정령을 얻었을 때 */
export const FIRE_SPIRIT_TAKEN: readonly Talk[] = [
  { who: 'sena', text: '불의 정령이네. 이제 네 곁을 따라다니며 불 스킬을 빌려줄 거야.', face: 'smile' },
  { who: 'sena', text: 'Q 불덩이, W 불 두르기, E 불꽃 질주, R 연속 불덩이. 휴대폰에선 오른쪽 버튼을 눌러.', face: 'flat' },
];

export const LINES: Readonly<Record<LineKey, readonly string[]>> = {
  start: ['네 손에 든 무기가 나야, 세나.'],
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
  firstAttack: ['스페이스바(Space)나 왼쪽 공격 버튼을 꾹 눌러.'],
  spiritRoom: ['정령방이야. 그늘을 걷어내면 정령이 나타나.'],
  spiritReady: ['가운데 제단으로 가 봐. 정령이 기다려.'],
  skillHint: ['Q 눌러. 불덩이 나가.', '몰리면 W. 불 둘러.', '도망칠 땐 E.', '아껴둔 R, 지금이야.'],
  bossIntroFire: ['뭐야.. 시계? 넌 알람소리가 그렇게 싫었냐?'],
  bossSnooze: ['스누즈 누르지 마. 이번엔.'],
  bossFaced: ['뭐.. 나쁘지않게 싸우네.'],
};

/** 세나 훈수의 표정 */
export const LINE_FACE: Readonly<Record<LineKey, Expr>> = {
  start: 'blank', enter: 'flat', clear: 'smile', hurt: 'angry', low: 'troubled',
  dagger: 'flat', sword: 'flat', bow: 'flat', knuckle: 'flat',
  spiritRoom: 'blank', spiritReady: 'smile', skillHint: 'smile', goOut: 'flat', firstAttack: 'flat',
  bossIntro: 'flat', bossIntroFire: 'flat', bossSnooze: 'angry', bossFaced: 'smile',
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
