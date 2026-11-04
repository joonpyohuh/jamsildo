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
