import { audio } from '../audio/audio';
import type { SimEvent } from '../core/events';
import { sanitizeInput, type PlayerAction } from '../core/input';
import { yawPitchTo } from '../core/math';
import { Simulation, type MatchConfig } from '../core/simulation';
import type { Hero } from '../gameplay/entities';
import { GameRenderer } from '../rendering/renderer';
import { BotManager } from '../ai/botManager';
import { InputManager, type UiKeyAction } from './input';
import type { Settings } from './settings';

export interface SessionCallbacks {
  onEvent?: (e: SimEvent) => void;
  onUiKey?: (a: UiKeyAction) => void;
  onMatchEnd?: (winner: number) => void;
}

export interface FrameStats {
  fps: number;
  frameMs: number;
  simMs: number;
  ticksPerFrame: number;
}

/**
 * Owns one match on the client: simulation, renderer, input, bots and the
 * real-time loop. The simulation advances in fixed 60 Hz steps; rendering
 * interpolates between the last two steps.
 */
export class GameSession {
  readonly sim: Simulation;
  readonly renderer: GameRenderer;
  readonly input: InputManager;
  readonly bots: BotManager;
  local: Hero | null;
  /** Hero followed by the camera when spectating (or after death). */
  spectate: Hero | null = null;
  paused = false;
  uiBlocking = false;
  timeScale = 1;
  readonly frameStats: FrameStats = { fps: 0, frameMs: 0, simMs: 0, ticksPerFrame: 0 };
  private raf = 0;
  private last = 0;
  private acc = 0;
  private running = false;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private lastRender = 0;
  private actions: PlayerAction[] = [];
  private zoom = false;
  private ended = false;
  private listeners = new Set<(e: SimEvent) => void>();

  constructor(
    readonly canvas: HTMLCanvasElement,
    config: Partial<MatchConfig>,
    localSlot: number,
    private settings: Settings,
    private readonly cb: SessionCallbacks = {},
  ) {
    this.sim = new Simulation(config);
    this.local = localSlot >= 0 ? (this.sim.heroes[localSlot] ?? null) : null;
    this.bots = new BotManager(this.sim);
    this.sim.controllers.push((s) => this.bots.update(s));
    this.renderer = new GameRenderer(canvas, this.sim, settings.quality);
    this.renderer.cam.baseFov = settings.fov;
    this.input = new InputManager(canvas, settings);
    this.input.onUi = (a) => this.cb.onUiKey?.(a);
    const focus = this.local ?? this.sim.heroes[0] ?? null;
    if (focus) {
      this.renderer.cam.yaw = focus.yaw;
      this.renderer.cam.pitch = -0.05;
    }
    if (!this.local) this.spectate = this.sim.heroes[0] ?? null;
    this.resize();
    window.addEventListener('resize', this.resize);
  }

  applySettings(s: Settings): void {
    this.settings = s;
    this.input.setSettings(s);
    this.renderer.setQuality(s.quality);
    this.renderer.cam.baseFov = s.fov;
    audio.setVolumes(s.volume);
  }

  private resize = () => {
    const r = this.canvas.getBoundingClientRect();
    this.renderer.resize(r.width || window.innerWidth, r.height || window.innerHeight);
  };

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    audio.resume();
    audio.setVolumes(this.settings.volume);
    audio.startMusic();
    const loop = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Subscribe to simulation events (HUD feeds). Returns an unsubscribe function. */
  subscribe(fn: (e: SimEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  queueAction(a: PlayerAction): void {
    this.actions.push(a);
  }

  /** The hero the camera is attached to. */
  viewHero(): Hero | null {
    if (this.local && (this.local.alive || !this.spectate)) return this.local;
    return this.spectate ?? this.local;
  }

  cycleSpectate(dir: 1 | -1): void {
    const pool = this.local ? this.sim.heroes.filter((h) => h.team === this.local!.team) : this.sim.heroes;
    if (!pool.length) return;
    const i = this.spectate ? pool.indexOf(this.spectate) : -1;
    this.spectate = pool[(i + dir + pool.length) % pool.length];
  }

  private applyMouse(): void {
    const { dx, dy } = this.input.takeMouse();
    const cam = this.renderer.cam;
    const zoomMul = 1 - cam.zoom * 0.45;
    const sens = 0.0022 * this.settings.sensitivity * zoomMul;
    cam.yaw -= dx * sens;
    cam.pitch -= dy * sens * (this.settings.invertY ? -1 : 1);
    cam.pitch = Math.max(-1.35, Math.min(1.35, cam.pitch));
  }

  /** Converts input + crosshair into the local hero's InputCommand. */
  private sampleLocalInput(): void {
    const h = this.local;
    const s = this.input.sample();
    this.zoom = s.zoom;
    if (!h) return;
    const cam = this.renderer.cam;
    // Discrete actions (purchases, ability points, pings) are delivered even
    // while a menu such as the shop blocks movement and firing.
    if (this.actions.length) {
      h.actions.push(...this.actions);
      this.actions = [];
    }
    if (this.paused || this.uiBlocking) {
      h.input = sanitizeInput({ moveX: 0, moveZ: 0, yaw: h.input.yaw, pitch: h.input.pitch, buttons: 0 });
      return;
    }
    // Movement is camera-relative.
    const fx = Math.sin(cam.yaw);
    const fz = Math.cos(cam.yaw);
    const rx = -fz;
    const rz = fx;
    const mx = fx * s.forward + rx * s.right;
    const mz = fz * s.forward + rz * s.right;
    // Aim from the hero's eye toward the world point under the crosshair.
    const eye = { x: h.pos.x, y: h.pos.y + (h.crouching ? h.eyeHeight * 0.72 : h.eyeHeight), z: h.pos.z };
    const target = cam.crosshairTarget(this.sim.world, 220, this.sim.heroes, h.id);
    let { yaw, pitch } = yawPitchTo(eye, target);
    const d = Math.hypot(target.x - eye.x, target.z - eye.z);
    if (d < 1.2) {
      yaw = cam.yaw;
      pitch = cam.pitch;
    }
    h.input = sanitizeInput({ moveX: mx, moveZ: mz, yaw, pitch, buttons: s.buttons });
  }

  private handleEvents(events: SimEvent[]): void {
    const local = this.local;
    const view = this.viewHero();
    for (const e of events) {
      this.cb.onEvent?.(e);
      for (const l of this.listeners) l(e);
      switch (e.t) {
        case 'shot': {
          const isLocal = !!view && e.unit === view.id;
          const u = this.sim.units.get(e.unit);
          if (u && u.kind === 'hero') audio.gunshot(e.style, e.from, isLocal);
          break;
        }
        case 'damage':
          if (local && e.src === local.id && e.target !== local.id) {
            const t = this.sim.units.get(e.target);
            audio.hitmarker(e.crit, !!t && !t.alive);
          }
          if (local && e.target === local.id && e.amount > 5) audio.hurt();
          break;
        case 'vfx':
          if (['blast', 'nova', 'shockwave', 'lightning', 'beam', 'healBeam', 'warn'].includes(e.kind)) {
            if (e.kind === 'beam' && e.unit !== undefined && this.sim.units.get(e.unit)?.kind === 'structure') {
              audio.ability('beam', e.pos, false);
            } else audio.ability(e.kind, e.pos, false);
          }
          break;
        case 'cast':
          if (e.ability !== 'upgrade') audio.ability('cast', e.pos, !!view && e.unit === view.id);
          else if (local && e.unit === local.id) audio.ui('level');
          break;
        case 'move':
          if (view && e.unit === view.id) audio.movement(e.kind, view.pos, true);
          break;
        case 'reload':
          if (view && e.unit === view.id && !e.done) audio.reload(true);
          break;
        case 'death':
          if (e.kind === 'structure' || e.kind === 'boss') audio.explosion(e.pos, true);
          if (local && e.unit === local.id) audio.ui('death');
          break;
        case 'heroKill':
          if (local && (e.killer === local.id || e.assists.includes(local.id))) audio.ui('kill');
          break;
        case 'souls':
          if (local && e.hero === local.id && (e.source === 'orb' || e.source === 'trooper') && Math.random() < 0.5) audio.souls();
          break;
        case 'level':
          if (local && e.unit === local.id) audio.ui('level');
          break;
        case 'buy':
          if (local && e.unit === local.id) audio.ui('buy');
          break;
        case 'announce':
          if (e.kind === 'objective' || e.kind === 'boss') audio.ui('announce');
          break;
        case 'ping':
          if (local && e.team === local.team) audio.ui('ping');
          break;
        case 'match':
          if (e.state === 'ended' && !this.ended) {
            this.ended = true;
            this.cb.onMatchEnd?.(e.winner ?? -1);
          }
          break;
        default:
          break;
      }
    }
    this.renderer.queueEvents(events);
  }

  private frame(now: number): void {
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.25) dt = 0.25;
    // Frame-rate cap.
    const cap = this.settings.quality.fpsCap;
    if (cap > 0 && cap < 240 && now - this.lastRender < 1000 / cap - 1) {
      this.acc += this.paused ? 0 : dt * this.timeScale;
      return;
    }
    this.lastRender = now;
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.frameStats.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    this.frameStats.frameMs = dt * 1000;
    if (!this.paused && !this.uiBlocking) this.applyMouse();
    else this.input.takeMouse();

    const simDt = this.sim.dt;
    let ticks = 0;
    const t0 = performance.now();
    if (!this.paused) {
      this.acc += dt * this.timeScale;
      while (this.acc >= simDt && ticks < 6) {
        this.sampleLocalInput();
        this.sim.step();
        this.handleEvents(this.sim.events.drain());
        this.acc -= simDt;
        ticks++;
      }
      if (ticks === 6) this.acc = 0;
    }
    this.frameStats.simMs = performance.now() - t0;
    this.frameStats.ticksPerFrame = ticks;
    const alpha = this.paused ? 1 : Math.min(1, this.acc / simDt);
    const view = this.viewHero();
    if (view && view !== this.local && !this.renderer.cam.freeCam) {
      // Spectating: follow the hero's aim.
      this.renderer.cam.yaw = view.yaw;
      this.renderer.cam.pitch = view.pitch * 0.6;
    }
    const viewerTeam = this.local ? this.local.team : view ? view.team : 0;
    this.renderer.render(this.sim, alpha, dt, view, viewerTeam, this.zoom && view === this.local);
    if (view) audio.setListener(this.renderer.cam.camera.position, this.renderer.cam.yaw);
  }

  dispose(): void {
    this.stop();
    window.removeEventListener('resize', this.resize);
    this.input.dispose();
    this.renderer.dispose();
    audio.stopMusic();
  }
}
