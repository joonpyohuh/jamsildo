/** 관리자 콘솔의 플레이 분석 표와 CSV. 서버 값을 읽기 좋은 이름으로 바꾸기만 한다. */
import { ARTIFACTS, type ArtifactId } from './game/build';
import { SPIRIT_NAMES } from './game/campaign';
import type { Element } from './game/config';
import { FORMS, type FormId } from './game/forms';
import augmentData from './game/data/augments.json';

interface Stage { stage: number; reached: number; deaths: number; stopped: number }
interface Build { kind: 'artifact' | 'augment' | 'spirit' | 'weapon'; id: string; runs: number; avg_stage: number; avg_deaths: number }
interface Person { who: string; runs: number; deaths: number; seconds: number; best: number; last_stage: number; last_seen: string }
export interface RunRow { who: string; started_at: string; updated_at?: string; seconds: number; stage: number; max_stage: number; deaths: number; deaths_by_stage?: Record<string, number>; state: string; spirits: string[]; artifacts: string[]; augments: string[]; weapon: string }
export interface RunsOverview {
  summary: { runs: number; people: number; seconds: number; deaths: number; cleared: number; left: number };
  stages: Stage[]; builds: Build[]; people: Person[]; recent: RunRow[];
}

const STATES: Readonly<Record<string, string>> = { playing: '진행 중', down: '쓰러진 뒤 이탈', left: '이탈', cleared: '클리어' };
const AUGMENTS = new Map(Object.values(augmentData.cards).flat().map(card => [card.id, card.name]));
const KINDS: Readonly<Record<Build['kind'], string>> = { artifact: '아티팩트', augment: '증강', spirit: '정령', weapon: '무기' };

const artifact = (id: string): string => ARTIFACTS[id as ArtifactId]?.name ?? id;
const augment = (id: string): string => AUGMENTS.get(id) ?? id;
const spirit = (value: string): string => { const [element, tier] = value.split(':'); return `${SPIRIT_NAMES[element as Element] ?? element}${tier ? ` ${tier}단계` : ''}`; };
const weapon = (id: string): string => FORMS[id as FormId]?.label ?? id;
const buildName = (build: Build): string => build.kind === 'artifact' ? artifact(build.id) : build.kind === 'augment' ? augment(build.id) : build.kind === 'spirit' ? spirit(build.id) : weapon(build.id);
const minutes = (seconds: number): string => `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
const percent = (part: number, all: number): string => all ? `${Math.round(part / all * 100)}%` : '-';
const when = (value: string): string => new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

function table(root: HTMLElement, headers: readonly string[], rows: readonly (readonly (string | number)[])[]): void {
  const wrap = document.createElement('div'), element = document.createElement('table'), head = element.createTHead().insertRow(), body = element.createTBody();
  wrap.className = 'table-scroll';
  for (const label of headers) { const cell = document.createElement('th'); cell.textContent = label; head.append(cell); }
  for (const row of rows) { const line = body.insertRow(); for (const value of row) line.insertCell().textContent = String(value); }
  wrap.append(element); root.append(wrap);
}

function heading(root: HTMLElement, text: string): void {
  const title = document.createElement('h4'); title.textContent = text; root.append(title);
}

export function renderRuns(root: HTMLElement, data: RunsOverview): void {
  root.replaceChildren();
  const s = data.summary;
  heading(root, '요약');
  table(root, ['런', '플레이어', '총 플레이', '런당 평균', '총 사망', '클리어', '이탈'], [[s.runs, s.people, minutes(s.seconds), minutes(s.runs ? Math.round(s.seconds / s.runs) : 0), s.deaths, `${s.cleared} (${percent(s.cleared, s.runs)})`, `${s.left} (${percent(s.left, s.runs)})`]]);
  heading(root, '스테이지 퍼널');
  table(root, ['스테이지', '도달', '도달률', '사망', '여기서 멈춤', '멈춤률'], data.stages.filter(stage => stage.reached > 0).map(stage => [stage.stage, stage.reached, percent(stage.reached, s.runs), stage.deaths, stage.stopped, percent(stage.stopped, stage.reached)]));
  for (const kind of ['spirit', 'weapon', 'artifact', 'augment'] as const) {
    heading(root, `${KINDS[kind]} 선택`);
    table(root, ['이름', '런 수', '채택률', '평균 도달', '평균 사망'], data.builds.filter(build => build.kind === kind).map(build => [buildName(build), build.runs, percent(build.runs, s.runs), build.avg_stage, build.avg_deaths]));
  }
  heading(root, '플레이어별 (최근 접속 순)');
  table(root, ['플레이어', '시도', '사망', '플레이', '최고', '마지막', '최근'], data.people.map(person => [person.who, person.runs, person.deaths, minutes(person.seconds), person.best, person.last_stage, when(person.last_seen)]));
  heading(root, '최근 런');
  table(root, ['플레이어', '시작', '플레이', '멈춘 곳', '최고', '사망', '상태', '무기', '정령', '아티팩트', '증강'], data.recent.map(run => [run.who, when(run.started_at), minutes(run.seconds), run.stage, run.max_stage, run.deaths, STATES[run.state] ?? run.state, weapon(run.weapon), run.spirits.map(spirit).join(', '), run.artifacts.map(artifact).join(', '), run.augments.map(augment).join(', ')]));
}

/** 엑셀에서 한글이 깨지지 않게 BOM을 붙인다 */
export function downloadRunsCsv(rows: readonly RunRow[]): void {
  const headers = ['player', 'started_at', 'updated_at', 'seconds', 'stopped_stage', 'max_stage', 'deaths', 'deaths_by_stage', 'state', 'weapon', 'spirits', 'artifacts', 'augments'];
  const cell = (value: unknown): string => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const lines = rows.map(run => [run.who, run.started_at, run.updated_at, run.seconds, run.stage, run.max_stage, run.deaths, JSON.stringify(run.deaths_by_stage ?? {}), STATES[run.state] ?? run.state, weapon(run.weapon), run.spirits.map(spirit).join('|'), run.artifacts.map(artifact).join('|'), run.augments.map(augment).join('|')].map(cell).join(','));
  const url = URL.createObjectURL(new Blob([`﻿${[headers.join(','), ...lines].join('\n')}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = `jamsildo-runs-${new Date().toISOString().slice(0, 10)}.csv`; link.click();
  URL.revokeObjectURL(url);
}
