/**
 * 텍스트는 DOM으로 그린다. 픽셀 폰트(Galmuri)를 게임 픽셀 단위(--px)의 정수배로 놓아
 * 캔버스의 도트 격자와 글자의 도트 격자가 일치하도록 한다.
 */
export type ScreenId = 'title' | 'down' | 'clear';

const PORTRAIT: Readonly<Record<'yunseul' | 'sena', string>> = {
  yunseul: '/portraits/yunseul.png',
  sena: '/portraits/sena.png',
};

export class Ui {
  private readonly screens: Record<ScreenId, HTMLElement>;
  private readonly bossName: HTMLElement;
  private readonly formTag: HTMLElement;
  private readonly clearWarmth: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly hintText: HTMLElement;
  private readonly talk: HTMLElement;
  private readonly talkName: HTMLElement;
  private readonly talkText: HTMLElement;
  private readonly talkFace: HTMLImageElement;

  constructor(root: HTMLElement) {
    const q = <T extends HTMLElement = HTMLElement>(sel: string, scope: ParentNode = root): T => {
      const el = scope.querySelector<T>(sel);
      if (!el) throw new Error(`missing ui element: ${sel}`);
      return el;
    };
    this.screens = { title: q('#title'), down: q('#down'), clear: q('#clear') };
    this.bossName = q('#bossName');
    this.formTag = q('#formTag');
    this.clearWarmth = q('#clearWarmth');
    this.hint = q('#hint');
    this.hintText = q('#hintText');
    this.talk = q('#talk');
    this.talkName = q('#talkName');
    this.talkText = q('#talkText');
    this.talkFace = q<HTMLImageElement>('#talkFace');
  }

  setScale(s: number): void {
    document.documentElement.style.setProperty('--px', `${s}px`);
  }

  showScreen(id: ScreenId | null): void {
    for (const [key, el] of Object.entries(this.screens)) {
      el.classList.toggle('is-on', key === id);
    }
  }

  isScreenOn(): boolean {
    return Object.values(this.screens).some((el) => el.classList.contains('is-on'));
  }

  setClearWarmth(n: number): void {
    this.clearWarmth.textContent = String(n);
  }

  showBoss(name: string): void {
    this.bossName.textContent = name;
    this.bossName.classList.add('is-on');
  }

  hideBoss(): void {
    this.bossName.classList.remove('is-on');
  }

  /* ── 전투 중 세나 훈수: 왼쪽 아래, 작은 얼굴 + 한 줄 ── */

  say(text: string): void {
    this.hintText.textContent = text;
    this.hint.classList.remove('is-on');
    void this.hint.offsetWidth;
    this.hint.classList.add('is-on');
  }

  hideLine(): void {
    this.hint.classList.remove('is-on');
  }

  /* ── 대사창: 테두리 박스, 왼쪽 글, 오른쪽 얼굴 ── */

  showTalk(who: 'yunseul' | 'sena', name: string, text: string, complete: boolean): void {
    this.talk.classList.add('is-on');
    this.talk.classList.toggle('is-complete', complete);
    this.talk.dataset.who = who;
    this.talkName.textContent = name;
    this.talkText.textContent = text;
    const src = PORTRAIT[who];
    if (!this.talkFace.src.endsWith(src)) this.talkFace.src = src;
  }

  hideTalk(): void {
    this.talk.classList.remove('is-on', 'is-complete');
  }

  /* ── 오프닝·안내 ── */

  get cineText(): HTMLElement {
    const el = document.querySelector<HTMLElement>('#cineText');
    if (!el) throw new Error('missing #cineText');
    return el;
  }

  showCine(on: boolean): void {
    document.querySelector('#cine')?.classList.toggle('is-on', on);
  }

  center(text: string): void {
    const el = document.querySelector<HTMLElement>('#center');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('is-on');
    void el.offsetWidth;
    el.classList.add('is-on');
  }

  /* ── 형태 이름 ── */

  flashForm(label: string): void {
    this.formTag.textContent = label;
    this.formTag.classList.remove('is-on');
    void this.formTag.offsetWidth;
    this.formTag.classList.add('is-on');
  }

  hideForm(): void {
    this.formTag.classList.remove('is-on');
  }

  placeForm(x: number, y: number): void {
    this.formTag.style.left = `calc(var(--px) * ${Math.round(x)})`;
    this.formTag.style.top = `calc(var(--px) * ${Math.round(y)})`;
  }
}
