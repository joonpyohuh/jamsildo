/**
 * 효과음은 전부 WebAudio로 합성한다 (에셋 없음).
 * 베는 소리 = 노이즈 스윕, 맞는 소리 = 저음 낙하 + 짧은 클릭. 타격감의 절반은 소리다.
 */
export type SfxName =
  | 'swing' | 'swingBig' | 'hit' | 'hitBig' | 'punch' | 'bow' | 'arrowHit'
  | 'face' | 'hurt' | 'lock' | 'open' | 'pickup' | 'morph'
  | 'alarm' | 'beep' | 'tear' | 'spawn' | 'thud' | 'quiet'
  | 'blip' | 'fireball' | 'fireHit' | 'flame' | 'spirit' | 'ult';

export class Sfx {
  private ac: AudioContext | null = null;
  private out: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  unlock(): void {
    if (this.ac) {
      if (this.ac.state === 'suspended') void this.ac.resume();
      return;
    }
    const ac = new AudioContext();
    const out = ac.createGain();
    out.gain.value = 0.5;
    const comp = ac.createDynamicsCompressor();
    out.connect(comp);
    comp.connect(ac.destination);
    const buf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    this.ac = ac;
    this.out = out;
    this.noiseBuf = buf;
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, at = 0): void {
    const { ac, out } = this;
    if (!ac || !out) return;
    const t = ac.currentTime + at;
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  private noise(dur: number, vol: number, f0: number, f1: number, q: number, at = 0, type: BiquadFilterType = 'bandpass'): void {
    const { ac, out, noiseBuf } = this;
    if (!ac || !out || !noiseBuf) return;
    const t = ac.currentTime + at;
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const f = ac.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.03);
  }

  play(name: SfxName): void {
    if (!this.ac) return;
    switch (name) {
      case 'swing':
        this.noise(0.07, 0.18, 2600, 900, 1.2);
        break;
      case 'swingBig':
        this.noise(0.15, 0.26, 1800, 380, 0.9);
        this.tone('sine', 150, 70, 0.1, 0.08);
        break;
      case 'hit':
        this.tone('square', 900, 300, 0.035, 0.07);
        this.noise(0.05, 0.3, 1300, 500, 1.5);
        this.tone('sine', 170, 50, 0.09, 0.35);
        break;
      case 'hitBig':
        this.tone('square', 650, 200, 0.05, 0.08);
        this.noise(0.09, 0.36, 900, 280, 1.1);
        this.tone('sine', 125, 38, 0.15, 0.45);
        break;
      case 'punch':
        this.noise(0.06, 0.34, 700, 200, 0.8, 0, 'lowpass');
        this.tone('sine', 115, 34, 0.17, 0.55);
        break;
      case 'bow':
        this.tone('triangle', 520, 980, 0.05, 0.12);
        this.noise(0.05, 0.08, 4200, 2000, 1.4);
        break;
      case 'arrowHit':
        this.tone('square', 700, 250, 0.03, 0.06);
        this.noise(0.04, 0.22, 1500, 600, 1.4);
        break;
      case 'face':
        // 터지는 소리가 아니라 가라앉는 소리. "없앴다"가 아니라 "마주했다".
        this.tone('sine', 660, 660, 0.55, 0.07);
        this.tone('sine', 990, 990, 0.7, 0.04, 0.06);
        break;
      case 'hurt':
        this.tone('square', 300, 90, 0.18, 0.1);
        this.noise(0.12, 0.2, 800, 200, 0.8);
        break;
      case 'lock':
        this.tone('sine', 90, 55, 0.2, 0.32);
        this.noise(0.06, 0.16, 400, 180, 0.7, 0, 'lowpass');
        break;
      case 'open':
        this.tone('sine', 220, 220, 0.14, 0.07);
        this.tone('sine', 330, 330, 0.18, 0.06, 0.09);
        break;
      case 'pickup':
        this.tone('sine', 1320, 1760, 0.05, 0.05);
        break;
      case 'morph':
        this.tone('triangle', 1500, 2200, 0.05, 0.035);
        this.noise(0.05, 0.05, 6000, 3000, 1.2);
        break;
      case 'alarm':
        for (let i = 0; i < 4; i += 1) this.tone('square', 1880, 1880, 0.045, 0.045, i * 0.09);
        break;
      case 'beep':
        this.tone('square', 1880, 1880, 0.04, 0.035);
        break;
      case 'tear':
        this.tone('sine', 320, 170, 0.14, 0.08);
        break;
      case 'spawn':
        this.noise(0.28, 0.08, 320, 110, 0.6, 0, 'lowpass');
        break;
      case 'thud':
        this.tone('sine', 80, 40, 0.22, 0.45);
        this.noise(0.08, 0.2, 500, 150, 0.6, 0, 'lowpass');
        break;
      case 'blip':
        // 대사 한 글자
        this.tone('square', 520 + Math.random() * 60, 520, 0.025, 0.018);
        break;
      case 'fireball':
        this.noise(0.18, 0.22, 900, 300, 0.7, 0, 'lowpass');
        this.tone('sawtooth', 220, 110, 0.12, 0.05);
        break;
      case 'fireHit':
        this.noise(0.22, 0.34, 1200, 200, 0.6, 0, 'lowpass');
        this.tone('sine', 140, 45, 0.18, 0.4);
        break;
      case 'flame':
        this.noise(0.45, 0.2, 400, 1400, 0.5, 0, 'bandpass');
        this.tone('sine', 110, 220, 0.3, 0.12);
        break;
      case 'spirit':
        for (let i = 0; i < 4; i += 1) this.tone('triangle', 660 * Math.pow(1.26, i), 660 * Math.pow(1.26, i), 0.18, 0.05, i * 0.07);
        break;
      case 'ult':
        this.noise(0.6, 0.3, 300, 2400, 0.6, 0, 'bandpass');
        this.tone('sawtooth', 90, 180, 0.5, 0.1);
        break;
      case 'quiet':
        this.tone('sine', 440, 440, 2.2, 0.06);
        this.tone('sine', 660, 660, 2.0, 0.04, 0.18);
        this.tone('sine', 880, 880, 1.8, 0.025, 0.36);
        break;
    }
  }
}
