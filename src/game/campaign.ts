import bossData from './bosses.json';
import skillData from './skills.json';
import patternData from './patterns.json';
import type { Element } from './config';

export type SkillKey = 'q' | 'w' | 'e' | 'r';
export type BossId = keyof typeof bossData;
export type StatusId = 'stun' | 'slow' | 'root' | 'burn' | 'mark' | 'blind' | 'silence';
export interface SkillSpec { name: string; type: string; cost: number; cd: number; range?: number; damage?: number; status?: string; duration?: number; heal?: number }
export interface BossSpec { name: string; chapter: number; hp: number; enrage: number; phases: number[]; asset?: string; patterns: string[] }
export const BOSSES: Readonly<Record<BossId, BossSpec>> = bossData;
export const SKILLS = skillData as Record<Element, Record<SkillKey, SkillSpec>>;
export const PATTERNS:Record<string,{warning:number;damage:number;count?:number;radius?:number;duration?:number}>=patternData;
export const SPIRIT_NAMES: Record<Element, string> = { fire: '메르', water: '쿠이', wood: '매매', dark: '카이', light: '루나', chaos: '혼돈' };
/** 스킬 설명 (실제 동작 기준). 마우스를 올리면 툴팁으로 보인다. */
export const SKILL_DESC: Record<Element, Record<SkillKey, string>> = {
  fire: {
    q: '불덩이를 날려 맞은 자리에서 폭발한다. 주변의 그늘까지 화상.',
    w: '바라보는 쪽으로 순간 돌진. 지나간 길의 그늘에게 피해와 화상을 주고 바닥에 불길을 남긴다. 잠깐 무적.',
    e: '5초 동안 불을 두른다. 가까운 그늘을 계속 태우고, 때린 그늘에게 화상을 되돌려준다.',
    r: '조준한 쪽으로 거대한 불기둥을 쏜다. 닿은 그늘을 모두 태우고 탄도 지운다.',
  },
  water: {
    q: '크고 느린 물방울이 그늘을 꿰뚫으며 멀리 밀쳐내고 기절시킨다.',
    w: '체력 30% 회복. 걸려 있던 상태이상을 전부 씻어낸다.',
    e: '다음 공격 한 번을 무엇이든 막는다. 막는 순간 터지며 주변을 밀어낸다.',
    r: '방을 가로지르는 거대한 파도. 그늘을 전부 쓸어 밀어내고 탄도 씻어낸다.',
  },
  wood: {
    q: '탄을 막는 나무벽을 세운다. 벽에 닿은 그늘은 가시에 찔리고 묶인다.',
    w: '다음 피해 한 번을 막는 껍질을 두르고 체력을 조금 회복한다.',
    e: '앞으로 뻗는 덩굴 한 줄. 닿은 그늘을 전부 묶는다.',
    r: '시전하는 순간 주변 그늘을 모두 묶고, 8초 동안 성역을 편다. 안에서는 체력이 차오르고 그늘은 계속 상처를 입는다.',
  },
  dark: {
    q: '그림자 단도 세 자루. 맞은 그늘에 표식을 새긴다.',
    w: '가장 가까운 그늘의 등 뒤로 숨어들어 벤다. 표식을 남기고 잠시 모습을 감춘다.',
    e: '4초 동안 안에 있는 그늘의 눈을 멀게 한다. 공격을 못 맞춘다.',
    r: '리퍼를 불러 낫을 휘두른다. 표식이 있는 그늘을 전부 크게 베고, 체력이 낮은 일반 그늘은 즉시 쓰러진다.',
  },
  light: {
    q: '날아가지 않고 그 자리에서 일직선을 꿰뚫는 빛줄기.',
    w: '즉시 체력 15% 회복, 이후 5초 동안 서서히 회복.',
    e: '주변 그늘을 기절시키고 날아오던 탄을 모두 지운다.',
    r: '하늘에서 빛의 검이 내리꽂혀 주변 그늘을 기절시킨다. 6초 동안 그 자리에서 받는 피해는 절반, 그늘은 계속 탄다.',
  },
  chaos: {
    q: '무작위 정령의 Q가 나간다.',
    w: '가장 가까운 그늘과 자리를 바꾼다.',
    e: '동전 던지기. 앞면은 모든 쿨타임 초기화, 뒷면은 기력 0.',
    r: '5초 동안 무작위 스킬이 연발된다. 끝나면 3초 기절.',
  },
};
/** 합동 궁극기: 짝이 되는 두 정령이 함께 있고, 둘 다 중급 이상에 R이 준비됐을 때 쓴다 */
export interface ComboSpec { name: string; pair: readonly [Element, Element]; cost: number; damage: number; text: string }
export const COMBOS: readonly ComboSpec[] = [
  { name: '증기 나선', pair: ['fire', 'water'], cost: 40, damage: 220, text: '메르와 쿠이가 불과 물을 꼬아 쏜다. 앞의 그늘을 세 번 꿰뚫고 불태운다.' },
  { name: '일식 베기', pair: ['light', 'dark'], cost: 40, damage: 240, text: '루나와 카이가 일식을 만들어 벤다. 주변 그늘을 기절시키고 눈을 멀게 하며, 화면의 탄을 모두 지운다.' },
];
export type ItemId = 'meal' | 'thermos' | 'shoes' | 'crystal' | 'heart';
export interface ItemSpec { name: string; effect: string; /** 있으면 상점 품목 */ cost?: number; /** 한 판에 가질 수 있는 수 */ limit?: number }
export const ITEMS: Readonly<Record<ItemId, ItemSpec>> = {
  meal: { name: '선식 한 컵', effect: 'HP +25 · 공격력 +15%', cost: 8 },
  thermos: { name: '식지 않는 보온병', effect: '기력 회복 속도 +25%', cost: 12, limit: 5 },
  shoes: { name: '끈 묶은 운동화', effect: '공격력 +12% · 최대 기력 +3' },
  crystal: { name: '기력의 결정', effect: '최대 기력 +10' },
  heart: { name: '심장 조각', effect: '최대 체력 +20' },
};
/** 일반 그늘 이름: 챕터 스프라이트 → 이름. 스프라이트가 없으면 종류 이름으로 돌아간다. */
export const ENEMY_NAMES: Record<string, string> = {
  bother: '귀찮음', heavy: '힘듦', gloom: '우울감',
  enemy_ch01_normal_annoyance: '귀찮음', enemy_ch01_normal_exhaustion: '힘듦', enemy_ch01_normal_depressed_mood: '우울감',
  enemy_ch02_normal_mirror_shards: '거울 조각', enemy_ch02_normal_whispers: '속삭임', enemy_ch02_normal_stares: '시선',
  enemy_ch03_normal_laughter_echo: '웃음소리', enemy_ch03_normal_group_chat_alert: '단체방 알림', enemy_ch03_normal_turned_back_shadow: '돌아선 등',
  enemy_ch04_normal_comparing_voices: '비교하는 목소리', enemy_ch04_normal_closed_bedroom_door: '닫힌 방문',
};
/** 좌클릭 정보창 설명 (실제 움직임 기준) */
export const ENEMY_DESC: Record<string, string> = {
  bother: '달려들다 멈추기를 반복한다. 멈춘 틈에 친다.',
  heavy: '느리게 따라오다 웅크린 뒤 덮친다. 웅크리면 옆으로 비킨다.',
  gloom: '거리를 두고 떠다니며 느린 물방울을 떨군다. 다가가면 물러난다.',
};
export const STATUS_LABELS: Record<StatusId, string> = { stun: '기절', slow: '둔화', root: '속박', burn: '화상', mark: '표식', blind: '실명', silence: '침묵' };
export const SPIRIT_ROLES: Record<Element, string> = { fire: '폭발·화상', water: '밀어내기·회복', wood: '지형·속박', dark: '표식·처형', light: '관통·정화', chaos: '무작위' };
export const SPIRIT_ASSETS: Record<Element, string> = { fire: 'spirit_fire_mer', water: 'spirit_water_kui', wood: 'spirit_wood_maemae', dark: 'spirit_dark_kai', light: 'spirit_light_luna', chaos: 'spirit_chaos_hidden_unnamed' };
export const PATTERN_LABELS: Record<string,string> = {
  slash_ring:'원형 베기 · 탄 사이의 틈으로',dark_orb:'어둠덩이 · 터지기 전에 멀리',
  roll:'굴러오기 · 붉은 선 옆으로',split:'분열 · 작은 그늘부터',crush:'짓누르기 · 원 밖으로',weight:'무게 장판 · 느려지는 바닥 주의',cover:'덮기 · 그림자 밖으로',damp:'눅눅한 장판 · 기력 회복 정지',pull:'끌어당기기 · 반대 방향으로 이동',triple_cover:'연속 덮기 · 계속 이동',gap_ring:'알람 음파 · 탄 사이의 틈으로',hands:'늘어진 손 · 붉은 원을 피해',yawn:'하품 파동 · 부채꼴 밖으로',air:'무거운 공기 · 이동 둔화',prison:'이불 감옥 · 원이 닫히기 전에 탈출',wave:'눕기 · 소환된 그늘부터',fan:'파편 산탄 · 틈을 찾아',mirror_rain:'파편 비 · 바닥의 예고 확인',silence_pool:'속삭임 · 침묵 장판 주의',surround:'따돌림 원 · 열린 쪽으로 탈출',door_laser:'문틈 빛살 · 붉은 선을 피해',knock:'노크 · 세 번의 충격파',luggage:'쌓인 짐 낙하 · 원 밖으로',lock:'잠금 · 잠시 스킬 봉인',gaze:'시선 · 레이저 옆으로',compare:'비교 · 깜박이지 않는 본체를 찾아',invert:'뒤집힌 나 · 좌우 반전',shatter:'금 가기 · 세 번의 탄막',echo_ring:'웃음 메아리 · 반대편도 주의',spiral:'알림 폭탄 · 나선 틈으로',read_ignore:'읽씹 · 쿨타임이 잠시 멈춤',call:'호출 · 그늘을 줄여',point:'손가락질 · 세 발의 조준탄',triple_charge:'몰아붙이기 · 세 번 돌진',laugh_storm:'웃음 폭풍 · 탄막의 틈으로',back_wall:'등 돌리기 · 보스 바깥에서 공격',push:'밀어내기 · 정면을 피해',photo:'단체 사진 · 초록색 그림자로',words:'비교하는 말 · 조준선 옆으로',echo_clone:'더 잘하는 애 · 따라오는 그림자',plates:'접시 회전 · 바깥으로 퍼지는 탄',table_flip:'식탁 뒤집기 · 정면에서 벗어나',empty_seat:'빈자리 · 초록색 영역만 안전',silent_meal:'침묵의 식사 · 단검으로 버텨',alone:'혼자 있어 · 정령이 잠시 봉인됨',mimic:'세나 흉내 · 네 무기를 따라 한다',copy_spirit:'정령 복사 · 속성색을 확인',tantrum:'떼쓰기 · 세 번의 파동',emotion:'감정의 파도 · 세 번의 탄막',notice_me:'나도 봐줘 · 끌려가도 계속 이동',
};
export const CHAPTERS = [
  { name: '무기력', floor: '#22252c', line: '#1c1f25', wall: '#14161b', enemies: ['enemy_ch01_normal_annoyance','enemy_ch01_normal_exhaustion','enemy_ch01_normal_depressed_mood'], bosses: ['giant_bother','great_heavy','blanket','great_heavy','apathy'], after: '열까지 센 뒤, 이번에는 일어났다. 커튼을 반쯤 걷었다.' },
  { name: '자존감', floor: '#282332', line: '#1c1926', wall: '#211b2e', enemies: ['enemy_ch02_normal_mirror_shards','enemy_ch02_normal_whispers','enemy_ch02_normal_stares'], bosses: ['great_shard','whisper_pack','door','great_shard','mirror'], after: '거울 앞에 잠깐 섰다. 오래된 친구의 메시지에 답장을 보냈다.' },
  { name: '소외', floor: '#272032', line: '#1c1626', wall: '#21152b', enemies: ['enemy_ch03_normal_laughter_echo','enemy_ch03_normal_group_chat_alert','enemy_ch03_normal_turned_back_shadow'], bosses: ['great_laugh','chat','group','chat','merged'], after: '편의점에서 고개를 들었다. 작은 목소리로, 안녕하세요.' },
  { name: '어린 시절', floor: '#302628', line: '#21191e', wall: '#251a24', enemies: ['enemy_ch04_normal_comparing_voices','enemy_ch04_normal_closed_bedroom_door','enemy_ch04_normal_comparing_voices'], bosses: ['voices','bedroom','table','voices','young'], after: '그때의 나를 두고 오지 않았다. 오늘은 함께 밖으로 나간다.' },
] as const;
export const LEVELS = CHAPTERS.flatMap((chapter, ci) => chapter.bosses.map((boss, si) => ({
  number: ci * 5 + si + 1, chapter: ci + 1, within: si + 1, title: chapter.name, boss: boss as BossId,
})));

export interface SpiritSlot { element: Element; xp: number; tier: number; uses: Record<string, number>; cooldowns: Record<SkillKey, number> }
export function newSpirit(element: Element): SpiritSlot {
  return { element, xp: 0, tier: 1, uses: {}, cooldowns: { q: 0, w: 0, e: 0, r: 0 } };
}
