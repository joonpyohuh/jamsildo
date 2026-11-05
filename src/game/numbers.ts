/** 피해 숫자. 객체를 재사용하고, 40개를 넘으면 가장 오래된 것부터 지운다. */
export type NumberKind = 'hit' | 'crit' | 'burn' | 'execute' | 'player' | 'heal' | 'curse';

const STYLE: Readonly<Record<NumberKind, { color: string; size: number; label?: string }>> = {
  hit: { color: '#ffffff', size: 10 },
  crit: { color: '#ffd84a', size: 15, label: '치명타!' },
  burn: { color: '#ff9a3c', size: 8 },
  execute: { color: '#b88aff', size: 15, label: '처형' },
  player: { color: '#ff5a5a', size: 10 },
  heal: { color: '#6fe08a', size: 10 },
  curse: { color: '#6a6870', size: 8 },
};
const LIMIT = 40, LIFE = 0.6, RISE = 24, SPREAD = 8, POP = 0.1;

interface Slot { x: number; y: number; t: number; text: string; kind: NumberKind }

export class DamageNumbers {
  private readonly slots: Slot[] = Array.from({ length: LIMIT }, () => ({ x: 0, y: 0, t: LIFE, text: '', kind: 'hit' }));
  private next = 0;

  spawn(x: number, y: number, value: number, kind: NumberKind): void {
    const slot = this.slots[this.next]!;
    this.next = (this.next + 1) % LIMIT;
    slot.x = x + (Math.random() * 2 - 1) * SPREAD; slot.y = y; slot.t = 0; slot.kind = kind;
    slot.text = kind === 'heal' ? `+${value}` : String(value);
  }

  update(dt: number): void { for (const slot of this.slots) if (slot.t < LIFE) slot.t += dt; }

  clear(): void { for (const slot of this.slots) slot.t = LIFE; }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.textAlign = 'center';
    for (const slot of this.slots) {
      if (slot.t >= LIFE) continue;
      const style = STYLE[slot.kind], k = slot.t / LIFE, pop = style.label && slot.t < POP ? 1.3 : 1;
      const x = Math.round(slot.x), y = Math.round(slot.y - k * RISE);
      ctx.globalAlpha = 1 - k * k;
      if (style.label) this.text(ctx, style.label, x, y - style.size, 9, style.color);
      this.text(ctx, slot.text, x, y, Math.round(style.size * pop), style.color);
    }
    ctx.restore();
  }

  private text(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string): void {
    ctx.font = `${size}px Galmuri9, monospace`;
    ctx.fillStyle = '#08090b';
    ctx.fillText(text, x + 1, y + 1);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }
}
