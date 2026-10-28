import { useCallback, useEffect, useRef, useState } from 'react';
import type { SimEvent } from '../core/events';
import type { PingKind } from '../core/input';
import type { MatchConfig } from '../core/simulation';
import { GameSession } from '../game/session';
import type { Settings } from '../game/settings';
import type { UiKeyAction } from '../game/input';
import { DebugOverlay } from './DebugOverlay';
import { Feedback } from './hud/Feedback';
import { Hud } from './hud/Hud';
import { PauseMenu } from './PauseMenu';
import { Scoreboard } from './Scoreboard';
import { Shop } from './Shop';
import { CommandMenu } from './CommandMenu';

export interface MatchSummary {
  winner: number;
  localTeam: number;
  duration: number;
  heroes: {
    id: number;
    name: string;
    hero: string;
    team: number;
    isBot: boolean;
    kills: number;
    deaths: number;
    assists: number;
    souls: number;
    heroDamage: number;
    objectiveDamage: number;
    lastHits: number;
    healing: number;
    level: number;
    items: string[];
  }[];
  structures: { team: number; destroyed: number }[];
}

interface Props {
  config: Partial<MatchConfig>;
  localSlot: number;
  settings: Settings;
  onSettings: (s: Settings) => void;
  onQuit: () => void;
  onEnd: (s: MatchSummary) => void;
}

export function summarize(session: GameSession): MatchSummary {
  const sim = session.sim;
  return {
    winner: sim.winner,
    localTeam: session.local ? session.local.team : -1,
    duration: Math.max(0, (sim.endTime > 0 ? sim.endTime : sim.time) - sim.matchStartTime),
    heroes: sim.heroes.map((h) => ({
      id: h.id,
      name: h.playerName,
      hero: h.def.name,
      team: h.team,
      isBot: h.isBot,
      kills: h.match.kills,
      deaths: h.match.deaths,
      assists: h.match.assists,
      souls: h.netWorth,
      heroDamage: Math.round(h.match.heroDamage),
      objectiveDamage: Math.round(h.match.objectiveDamage),
      lastHits: h.match.lastHits,
      healing: Math.round(h.match.healing),
      level: h.level,
      items: h.items.map((i) => i.def.name),
    })),
    structures: [0, 1].map((t) => ({ team: t, destroyed: sim.teams[t as 0 | 1].structuresDestroyed })),
  };
}

export function GameView({ config, localSlot, settings, onSettings, onQuit, onEnd }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fbRef = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<GameSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [shop, setShop] = useState(false);
  const [board, setBoard] = useState(false);
  const [debug, setDebug] = useState(false);
  const [commands, setCommands] = useState(false);
  const [locked, setLocked] = useState(false);
  const overlays = useRef({ paused: false, shop: false, commands: false });
  overlays.current = { paused, shop, commands };
  const eventSink = useRef<(e: SimEvent) => void>(() => {});
  const uiKeySink = useRef<(a: UiKeyAction) => void>(() => {});

  // Create the session once.
  useEffect(() => {
    const canvas = canvasRef.current!;
    let s: GameSession;
    try {
      s = new GameSession(canvas, config, localSlot, settings, {
        onEvent: (e) => eventSink.current(e),
        onUiKey: (a) => uiKeySink.current(a),
        onMatchEnd: () => {
          window.setTimeout(() => onEnd(summarize(s)), 6000);
        },
      });
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    s.start();
    setSession(s);
    const fb = new Feedback(fbRef.current!, s);
    eventSink.current = (e) => fb.onEvent(e);
    const onLock = () => {
      const isLocked = document.pointerLockElement === canvas;
      setLocked(isLocked);
      // Losing pointer lock during play (e.g. Esc consumed by the browser) pauses.
      const o = overlays.current;
      if (!isLocked && !o.shop && !o.commands && !o.paused && s.local && s.sim.phase !== 'ended') {
        setPaused(true);
      }
    };
    document.addEventListener('pointerlockchange', onLock);
    (window as unknown as { __hexline?: GameSession }).__hexline = s;
    return () => {
      document.removeEventListener('pointerlockchange', onLock);
      fb.dispose();
      s.dispose();
      delete (window as unknown as { __hexline?: GameSession }).__hexline;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    session?.applySettings(settings);
    document.documentElement.style.setProperty('--hud-scale', String(settings.hudScale));
  }, [session, settings]);

  // Pause state drives the session.
  useEffect(() => {
    if (!session) return;
    session.paused = paused && !!session.local;
    session.uiBlocking = shop || commands;
    if (paused || shop || commands) session.input.releaseLock();
  }, [session, paused, shop, commands]);

  const ping = useCallback(
    (kind?: PingKind) => {
      const s = session;
      if (!s || !s.local) return;
      const cam = s.renderer.cam;
      const pt = cam.crosshairTarget(s.sim.world, 200, s.sim.allUnits().filter((u) => u.alive && u.id !== s.local!.id), s.local.id);
      // Contextual: what's under the crosshair?
      let targetId = -1;
      let auto: PingKind = 'attack';
      let best = 4;
      for (const u of s.sim.allUnits()) {
        if (!u.alive || u.id === s.local.id) continue;
        const d = Math.hypot(u.pos.x - pt.x, u.pos.z - pt.z);
        if (d < best + u.radius) {
          best = d;
          targetId = u.id;
          if (u.kind === 'hero' && u.team !== s.local.team) auto = 'focus';
          else if (u.kind === 'structure') auto = u.team === s.local.team ? 'defend' : 'attack';
          else if (u.kind === 'hero') auto = 'group';
        }
      }
      s.queueAction({ type: 'ping', kind: kind ?? auto, x: pt.x, z: pt.z, targetId });
    },
    [session],
  );

  uiKeySink.current = (a: UiKeyAction) => {
    const s = session;
    if (!s) return;
    switch (a) {
      case 'pause':
        if (shop) setShop(false);
        else if (commands) setCommands(false);
        else setPaused((p) => !p);
        break;
      case 'shop':
        if (!s.local) break;
        setShop((v) => !v);
        break;
      case 'scoreboardDown':
        setBoard(true);
        break;
      case 'scoreboardUp':
        setBoard(false);
        break;
      case 'debug':
        setDebug((d) => !d);
        break;
      case 'ping':
        ping();
        break;
      case 'commands':
        if (s.local) setCommands((v) => !v);
        break;
      case 'freecam': {
        const cam = s.renderer.cam;
        cam.freeCam = !cam.freeCam;
        if (cam.freeCam) cam.freePos.copy(cam.camera.position);
        break;
      }
      case 'upgrade1':
      case 'upgrade2':
      case 'upgrade3':
      case 'upgrade4':
        s.queueAction({ type: 'upgradeAbility', slot: Number(a.slice(7)) as 1 | 2 | 3 | 4 });
        break;
    }
  };

  // Spectator controls and free-camera flight.
  useEffect(() => {
    if (!session) return;
    const keys = new Set<string>();
    const down = (e: KeyboardEvent) => {
      keys.add(e.code);
      if (!session.local) {
        if (e.code === 'BracketRight' || e.code === 'Digit2') session.cycleSpectate(1);
        if (e.code === 'BracketLeft' || e.code === 'Digit1') session.cycleSpectate(-1);
        if (e.code === 'Equal') session.timeScale = Math.min(8, session.timeScale * 2);
        if (e.code === 'Minus') session.timeScale = Math.max(0.25, session.timeScale / 2);
      }
    };
    const up = (e: KeyboardEvent) => keys.delete(e.code);
    let raf = 0;
    const fly = () => {
      raf = requestAnimationFrame(fly);
      const cam = session.renderer.cam;
      if (!cam.freeCam) return;
      const sp = keys.has('ShiftLeft') ? 1.6 : 0.5;
      const fx = Math.sin(cam.yaw);
      const fz = Math.cos(cam.yaw);
      const p = cam.freePos;
      const up = Math.sin(cam.pitch) * sp;
      if (keys.has('KeyW')) p.set(p.x + fx * sp, p.y + up, p.z + fz * sp);
      if (keys.has('KeyS')) p.set(p.x - fx * sp, p.y - up, p.z - fz * sp);
      // Right-hand side of the camera is (-fz, fx).
      if (keys.has('KeyD')) p.set(p.x - fz * sp, p.y, p.z + fx * sp);
      if (keys.has('KeyA')) p.set(p.x + fz * sp, p.y, p.z - fx * sp);
    };
    fly();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [session]);

  const requestLock = () => {
    if (!session || paused || shop || commands) return;
    session.input.requestLock();
  };

  if (error) {
    return (
      <div className="screen" style={{ alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        <h2 className="display">Could not start the match</h2>
        <div style={{ color: 'var(--text-dim)', maxWidth: 520, textAlign: 'center' }}>{error}</div>
        <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>HEXLINE needs WebGL. Try enabling hardware acceleration or another browser.</div>
        <button className="btn" onClick={onQuit}>
          Back to menu
        </button>
      </div>
    );
  }

  return (
    <div className="game-root">
      <canvas ref={canvasRef} className="game-canvas" onClick={requestLock} data-testid="game-canvas" />
      <div ref={fbRef} className="hud" style={{ zIndex: 2 }} />
      {session && <Hud session={session} settings={settings} />}
      {session && debug && <DebugOverlay session={session} />}
      {session && board && <Scoreboard session={session} />}
      {session && shop && session.local && <Shop session={session} onClose={() => setShop(false)} />}
      {session && commands && session.local && (
        <CommandMenu
          onPick={(k) => {
            ping(k);
            setCommands(false);
          }}
          onClose={() => setCommands(false)}
        />
      )}
      {session && paused && (
        <PauseMenu
          settings={settings}
          onSettings={onSettings}
          onResume={() => {
            setPaused(false);
            window.setTimeout(() => session.input.requestLock(), 30);
          }}
          onQuit={onQuit}
          onSurrender={() => {
            setPaused(false);
            onEnd(summarize(session));
          }}
        />
      )}
      {session && !locked && !paused && !shop && !commands && session.local && session.sim.phase !== 'ended' && (
        <div className="click-to-play">Click to capture the mouse</div>
      )}
    </div>
  );
}
