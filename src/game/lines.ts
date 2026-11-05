/**
 * 세나 대사: 고정 대사 세트 (AI 생성 없음).
 * 츤데레 — 걱정은 하지만 걱정한다고 말하지 않는다. 짧게, 명령형으로.
 * 짧은 문장으로 쓰고, 좁은 화면에서는 대사창 안에서 줄바꿈한다.
 */
import senaLines from './dialogue/sena.json';

export type LineKey =
  | keyof typeof senaLines
  | 'start' | 'low'
  | 'dagger' | 'sword' | 'bow' | 'knuckle'
  | 'spiritRoom' | 'spiritReady' | 'skillHint' | 'goOut' | 'firstAttack'
  | 'bossIntro' | 'bossIntroFire' | 'bossSnooze' | 'super' | 'combo';

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
  { who: 'sena', text: '나야, 세나. 네 손에 든 무기가 나라고. 단검, 장검, 활, 너클 중에 네가 골라.', face: 'flat' },
  { who: 'sena', text: '공격은 적을 우클릭하거나 Z를 꾹 눌러. Space는 대시야, 짧게 튀어나가면서 잠깐 안 맞아. 휴대폰은 공격·대시 버튼이야.', face: 'flat' },
  { who: 'sena', text: '휴대폰은 왼쪽 조이스틱으로 이동해. 컴퓨터는 방향키나 바닥 우클릭이야. 적을 좌클릭하면 정보가 보여. 움직이면서 공격해.', face: 'smile' },
];

export type TutorialKey = 'forms' | 'hurt' | 'clear' | 'shop' | 'spirit' | 'skills' | 'boss';

/** 1스테이지에서 상황마다 한 번씩 나오는 세나의 설명. 조작 이름만 기기에 맞춰 바뀐다. */
export function tutorialLines(key: TutorialKey, touch: boolean): readonly Talk[] {
  const say = (text: string, face: Expr = 'flat'): Talk => ({ who: 'sena', text, face });
  const pick = touch ? '공격 버튼' : '스페이스바(Space)';
  switch (key) {
    case 'forms': return [
      say(touch ? '무기는 네가 골라. 위쪽 버튼으로 단검, 장검, 활, 너클을 바꿔.' : '무기는 네가 골라. 1 단검, 2 장검, 3 활, 4 너클.'),
      say('단검은 빠르고, 장검은 넓고, 활은 멀리, 너클은 세게 밀어내. 상황 봐서 바꿔.', 'smile'),
      say(touch ? '공격 버튼을 누른 채로 조이스틱을 움직여. 탄이 오면 대시 버튼으로 빠져.' : '공격은 Z를 꾹 누르거나 적을 우클릭해. Space는 대시야. 탄이 오면 튀어나가.'),
    ];
    case 'hurt': return [
      say('맞았지? 하트가 네 체력이야. 다 없어지면 쓰러져.', 'angry'),
      say('맞은 직후엔 잠깐 무적이야. 그 틈에 빠져나와. 붉게 표시되는 곳은 곧 공격이 들어오는 자리고.'),
    ];
    case 'clear': return [
      say('봐, 그늘을 다 마주하면 문이 열려. 체력이랑 기력도 조금 차.', 'smile'),
      say('방을 비울 때마다 증강을 하나 골라. 세 장 다 같은 등급으로 나와.', 'smile'),
      say('떨어진 빛은 온기야. 가게에서 돈처럼 써. 미니맵엔 가본 방만 보이니까 문을 하나씩 열어봐.'),
      say('이 층 어딘가에 보스방이 있어. 거길 넘어야 다음 스테이지로 가. 가게랑 정령방부터 들르는 게 좋아.'),
    ];
    case 'shop': return [
      say('여긴 가게야. 온기로 물건을 사. 품목마다 한 번씩 살 수 있어.', 'smile'),
      say(touch ? '산 건 일시정지 메뉴의 아티팩트에서 볼 수 있어. 저주 붙은 건 대가를 잘 읽어.' : '산 건 I를 누르면 볼 수 있어. 저주 붙은 건 대가를 잘 읽어.'),
    ];
    case 'spirit': return [
      say('정령방이야. 지키는 놈을 넘기면 가운데에 정령이 나타나.'),
      say('정령은 세 마리까지 데리고 다녀. 고르면 스킬을 쓸 수 있어. 저놈, 평범한 그늘보다 세니까 조심해.', 'troubled'),
    ];
    case 'skills': return [
      say(touch ? 'Q W E 버튼이 정령 스킬이야. 탭하면 가까운 적에게, 끌면 원하는 곳에 나가.' : 'QWER이 정령 스킬이야. 가까운 적에게 알아서 나가.'),
      say('기력을 쓰고, 기력은 천천히 차. 스킬은 쓸수록 정령이 자라고, 중급이 되면 R 초필살기가 열려.', 'smile'),
      say(touch ? '정령이 둘이면 교체 버튼으로 바꿔. 쿨타임은 정령마다 따로 돌아.' : '정령이 둘이면 Tab으로 바꿔. 쿨타임은 정령마다 따로 돌아.'),
    ];
    case 'boss': return [
      say('보스야. 위에 체력바가 보이지? 패턴마다 공격 전에 바닥이나 선으로 예고가 나와.', 'troubled'),
      say('보스 둘레에 붉은 원이 뜨면 탄이 그 원에서 퍼져 나가. 안쪽에 붙어 있으면 안 맞아.'),
      say(`이기면 아티팩트가 떨어져. 가까이 가서 ${pick}를 눌러야 주워져. 주워야 다음으로 넘어가.`, 'smile'),
    ];
  }
}

/** 불의 정령을 얻었을 때 */
export const FIRE_SPIRIT_TAKEN: readonly Talk[] = [
  { who: 'sena', text: '불의 정령이네. 이제 네 곁을 따라다니며 불 스킬을 빌려줄 거야.', face: 'smile' },
  { who: 'sena', text: 'Q 불덩이, W 불 두르기, E 불꽃 질주, R 연속 불덩이. 휴대폰에선 오른쪽 버튼을 눌러.', face: 'flat' },
];

export const LINES: Readonly<Record<LineKey, readonly string[]>> = {
  ...senaLines,
  start: ['네 손에 든 무기가 나야, 세나.'],
  super: ['잠깐 비켜. 이건 내가 해.', '눈 뜨고 봐. 한 번만 보여줄 거야.', '…오늘만이야.'],
  combo: ['둘 다 맞춰. 박자 놓치면 죽어.', '같이 가. 나 혼자 하는 거 아니니까.'],
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
  firstAttack: ['적을 우클릭하거나, Z나 공격 버튼을 꾹 눌러.'],
  spiritRoom: ['정령방이야. 그늘을 걷어내면 정령이 나타나.'],
  spiritReady: ['가운데 제단으로 가 봐. 정령이 기다려.'],
  skillHint: ['Q 눌러. 불덩이 나가.', '몰리면 W. 불 둘러.', '도망칠 땐 E.', '아껴둔 R, 지금이야.'],
  bossIntroFire: ['뭐야.. 시계? 넌 알람소리가 그렇게 싫었냐?'],
  bossSnooze: ['스누즈 누르지 마. 이번엔.'],
};

/** 세나 훈수의 표정 */
export const LINE_FACE: Readonly<Partial<Record<LineKey, Expr>>> = {
  start: 'blank', enter: 'flat', clear: 'smile', hurt: 'angry', low: 'troubled', crit: 'smile', streak: 'laugh', curse: 'troubled', awaken: 'angry', rest: 'smile', prism: 'laugh',
  dagger: 'flat', sword: 'flat', bow: 'flat', knuckle: 'flat',
  spiritRoom: 'blank', spiritReady: 'smile', skillHint: 'smile', goOut: 'flat', firstAttack: 'flat',
  bossIntro: 'flat', bossIntroFire: 'flat', bossSnooze: 'angry', bossFaced: 'smile',
  super: 'flat', combo: 'smile',
};

/** 직전 세 줄과 겹치지 않게 고른다 */
const RECENT = 3;
const recent = new Map<LineKey, string[]>();

export function pickLine(key: LineKey): string {
  const pool = LINES[key];
  const seen = recent.get(key) ?? [];
  const fresh = pool.filter((l) => !seen.includes(l));
  const options = fresh.length ? fresh : pool;
  const line = options[Math.floor(Math.random() * options.length)] ?? pool[0] ?? '';
  recent.set(key, [...seen, line].slice(-Math.min(RECENT, pool.length - 1)));
  return line;
}
