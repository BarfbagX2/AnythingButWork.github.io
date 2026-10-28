import { BTN } from '../core/input';
import type { BindAction, Settings } from './settings';

const BUTTON_ACTIONS: [BindAction, number][] = [
  ['jump', BTN.JUMP],
  ['dash', BTN.DASH],
  ['crouch', BTN.CROUCH],
  ['reload', BTN.RELOAD],
  ['melee', BTN.MELEE],
  ['parry', BTN.PARRY],
  ['interact', BTN.INTERACT],
  ['ability1', BTN.A1],
  ['ability2', BTN.A2],
  ['ability3', BTN.A3],
  ['ability4', BTN.A4],
  ['item1', BTN.I1],
  ['item2', BTN.I2],
  ['item3', BTN.I3],
  ['item4', BTN.I4],
];

export type UiKeyAction = 'shop' | 'scoreboardDown' | 'scoreboardUp' | 'pause' | 'ping' | 'commands' | 'debug' | 'upgrade1' | 'upgrade2' | 'upgrade3' | 'upgrade4' | 'freecam';

/**
 * Keyboard/mouse input with pointer lock. Held keys are tracked, and presses
 * are latched until the next simulation sample so a tap shorter than one tick
 * is never lost.
 */
export class InputManager {
  private held = new Set<string>();
  private latched = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  locked = false;
  enabled = true;
  onUi: (a: UiKeyAction) => void = () => {};
  private codeToAction = new Map<string, BindAction>();

  constructor(
    private readonly target: HTMLElement,
    private settings: Settings,
  ) {
    this.rebuild();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('pointerlockchange', this.onLockChange);
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setSettings(s: Settings): void {
    this.settings = s;
    this.rebuild();
  }

  private rebuild(): void {
    this.codeToAction.clear();
    for (const [a, code] of Object.entries(this.settings.bindings)) this.codeToAction.set(code, a as BindAction);
  }

  requestLock(): void {
    if (document.pointerLockElement === this.target) return;
    try {
      const r = this.target.requestPointerLock() as unknown as Promise<void> | undefined;
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch {
      // Pointer lock unsupported (e.g. automation): mouse deltas still work while dragging.
    }
  }

  releaseLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private onLockChange = () => {
    this.locked = document.pointerLockElement === this.target;
  };

  private onBlur = () => {
    this.held.clear();
  };

  private isGameKey(code: string): boolean {
    return this.codeToAction.has(code) || code === 'Escape';
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (this.isGameKey(e.code) || e.code === 'Tab' || e.code.startsWith('Alt')) e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'Escape') {
      this.onUi('pause');
      return;
    }
    if (e.code === 'F8') {
      this.onUi('freecam');
      return;
    }
    const action = this.codeToAction.get(e.code);
    // Upgrade abilities: hold the modifier and press 1-4.
    const mod = this.held.has(this.settings.bindings.upgradeModifier);
    if (mod && action && action.startsWith('ability')) {
      this.onUi(`upgrade${action.slice(7)}` as UiKeyAction);
      return;
    }
    this.held.add(e.code);
    this.latched.add(e.code);
    if (action === 'shop') this.onUi('shop');
    else if (action === 'scoreboard') this.onUi('scoreboardDown');
    else if (action === 'ping') this.onUi('ping');
    else if (action === 'commands') this.onUi('commands');
    else if (action === 'debug') this.onUi('debug');
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.held.delete(e.code);
    if (this.codeToAction.get(e.code) === 'scoreboard') this.onUi('scoreboardUp');
  };

  private onMouseDown = (e: MouseEvent) => {
    if (!this.enabled || !this.locked) return;
    const code = `Mouse${e.button}`;
    this.held.add(code);
    this.latched.add(code);
  };

  private onMouseUp = (e: MouseEvent) => {
    this.held.delete(`Mouse${e.button}`);
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.enabled || !this.locked) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };

  private down(code: string): boolean {
    return this.held.has(code) || this.latched.has(code);
  }

  actionDown(a: BindAction): boolean {
    return this.down(this.settings.bindings[a]);
  }

  /** Consumes accumulated mouse movement. */
  takeMouse(): { dx: number; dy: number } {
    const r = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return r;
  }

  /** Samples movement axes (camera-relative) and button bits, then clears latches. */
  sample(): { forward: number; right: number; buttons: number; zoom: boolean } {
    let forward = 0;
    let right = 0;
    if (this.actionDown('forward')) forward += 1;
    if (this.actionDown('back')) forward -= 1;
    if (this.actionDown('right')) right += 1;
    if (this.actionDown('left')) right -= 1;
    let buttons = 0;
    for (const [a, bit] of BUTTON_ACTIONS) if (this.actionDown(a)) buttons |= bit;
    if (this.down('Mouse0')) buttons |= BTN.FIRE;
    const zoom = this.down('Mouse2');
    if (zoom) buttons |= BTN.ZOOM;
    if (this.down('Mouse3')) buttons |= BTN.DASH;
    this.latched.clear();
    return { forward, right, buttons, zoom };
  }

  isHeld(a: BindAction): boolean {
    return this.held.has(this.settings.bindings[a]);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    this.releaseLock();
  }
}
