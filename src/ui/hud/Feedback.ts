import type { SimEvent } from '../../core/events';
import type { GameSession } from '../../game/session';

interface FloatNum {
  el: HTMLDivElement;
  x: number;
  y: number;
  z: number;
  born: number;
  life: number;
  vy: number;
}

/**
 * High-frequency combat feedback drawn with plain DOM nodes outside React:
 * crosshair hitmarkers and floating numbers (damage dealt, crits, heals,
 * souls). Numbers are pooled and projected from world space every frame.
 */
export class Feedback {
  private nums: FloatNum[] = [];
  private pool: HTMLDivElement[] = [];
  private hit: HTMLDivElement;
  private hitUntil = 0;
  private raf = 0;
  private enabled = true;

  constructor(
    private readonly root: HTMLDivElement,
    private readonly session: GameSession,
  ) {
    this.hit = document.createElement('div');
    this.hit.className = 'hitmarker';
    root.appendChild(this.hit);
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.update();
    };
    this.raf = requestAnimationFrame(loop);
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
  }

  private spawn(text: string, cls: string, x: number, y: number, z: number, life = 0.9): void {
    if (!this.enabled) return;
    const el = this.pool.pop() ?? document.createElement('div');
    el.className = `dmg-num ${cls}`;
    el.textContent = text;
    el.style.opacity = '1';
    this.root.appendChild(el);
    this.nums.push({ el, x: x + (Math.random() - 0.5) * 0.6, y, z: z + (Math.random() - 0.5) * 0.6, born: performance.now(), life: life * 1000, vy: 1.2 + Math.random() * 0.6 });
    if (this.nums.length > 60) this.recycle(this.nums.shift()!);
  }

  private recycle(n: FloatNum): void {
    n.el.remove();
    this.pool.push(n.el);
  }

  onEvent(e: SimEvent): void {
    const local = this.session.local;
    if (!local) return;
    if (e.t === 'damage') {
      if (e.src === local.id && e.target !== local.id) {
        const target = this.session.sim.units.get(e.target);
        const killed = !!target && !target.alive;
        this.hit.className = `hitmarker${e.crit ? ' crit' : ''}${killed ? ' kill' : ''}`;
        this.hit.style.opacity = '1';
        this.hit.style.transform = `translate(-50%, -50%) rotate(45deg) scale(${e.crit ? 1.3 : 1})`;
        this.hitUntil = performance.now() + (killed ? 350 : 160);
        const cls = e.crit ? 'crit' : e.type === 'spirit' ? 'spirit' : '';
        if (e.amount >= 1) this.spawn(String(e.amount), cls, e.pos.x, e.pos.y + 0.4, e.pos.z);
      } else if (e.target === local.id && e.amount >= 1 && e.src >= 0) {
        // Damage taken: shown subtly near the player.
      }
    } else if (e.t === 'heal' && e.target === local.id && e.amount >= 10) {
      this.spawn(`+${e.amount}`, 'heal', local.pos.x, local.pos.y + 2.1, local.pos.z, 0.8);
    } else if (e.t === 'souls' && e.hero === local.id && e.amount >= 5 && e.source !== 'passive') {
      this.spawn(`+${e.amount}`, 'souls', e.pos.x, e.pos.y + 1.4, e.pos.z, 1.1);
    }
  }

  private update(): void {
    const now = performance.now();
    if (now > this.hitUntil && this.hit.style.opacity !== '0') this.hit.style.opacity = '0';
    const r = this.session.renderer;
    for (let i = this.nums.length - 1; i >= 0; i--) {
      const n = this.nums[i];
      const age = now - n.born;
      if (age > n.life) {
        this.recycle(n);
        this.nums.splice(i, 1);
        continue;
      }
      const t = age / 1000;
      const p = r.project({ x: n.x, y: n.y + n.vy * t, z: n.z });
      if (!p) {
        n.el.style.opacity = '0';
        continue;
      }
      n.el.style.left = `${p.x}px`;
      n.el.style.top = `${p.y}px`;
      n.el.style.opacity = String(Math.min(1, 2 - (age / n.life) * 2));
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    for (const n of this.nums) n.el.remove();
    this.hit.remove();
  }
}
