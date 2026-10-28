import { useState } from 'react';
import { BIND_LABELS, DEFAULT_BINDINGS, keyLabel, type BindAction } from '../game/settings';
import type { GameMode } from '../game/matchSetup';

interface Props {
  onPlay: (mode: GameMode) => void;
  onSettings: () => void;
}

/** Decorative hexagonal emblem rendered as inline SVG. */
function Emblem() {
  return (
    <svg className="menu-art" viewBox="0 0 200 200" aria-hidden>
      <defs>
        <radialGradient id="g1" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffa63d" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#ffa63d" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="g2" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#4aa8ff" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#4aa8ff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="70" cy="120" r="70" fill="url(#g1)" />
      <circle cx="130" cy="80" r="70" fill="url(#g2)" />
      {[0, 1, 2].map((i) => (
        <polygon
          key={i}
          points="100,20 170,60 170,140 100,180 30,140 30,60"
          fill="none"
          stroke={i === 1 ? '#d8b46a' : 'rgba(216,180,106,0.35)'}
          strokeWidth={i === 1 ? 2 : 1}
          transform={`rotate(${i * 20 - 20} 100 100) scale(${1 - i * 0.12}) translate(${i * 12} ${i * 12})`}
        >
          <animateTransform attributeName="transform" type="rotate" from={`${i * 20} 100 100`} to={`${i * 20 + (i % 2 ? -360 : 360)} 100 100`} dur={`${60 + i * 30}s`} repeatCount="indefinite" />
        </polygon>
      ))}
      <path d="M40 100 H160" stroke="#ffa63d" strokeWidth="2" opacity="0.7" />
      <path d="M100 40 V160" stroke="#4aa8ff" strokeWidth="2" opacity="0.7" />
      <circle cx="100" cy="100" r="9" fill="#120f1c" stroke="#f0d28c" strokeWidth="2" />
    </svg>
  );
}

export function MainMenu({ onPlay, onSettings }: Props) {
  const [panel, setPanel] = useState<'none' | 'controls' | 'credits'>('none');
  return (
    <div className="screen menu">
      <Emblem />
      <h1 className="menu-title">HEXLINE</h1>
      <div className="menu-sub">Lane warfare in the occult city</div>
      <div className="menu-items">
        <button className="btn primary" data-testid="play" onClick={() => onPlay('standard')}>
          Play — 6v6 bot match
        </button>
        <button className="btn" data-testid="practice" onClick={() => onPlay('practice')}>
          Practice range
        </button>
        <button className="btn" data-testid="spectate" onClick={() => onPlay('spectate')}>
          Watch bots play
        </button>
        <button className="btn" onClick={onSettings}>
          Settings
        </button>
        <button className="btn" onClick={() => setPanel(panel === 'controls' ? 'none' : 'controls')}>
          Controls
        </button>
        <button className="btn" onClick={() => setPanel(panel === 'credits' ? 'none' : 'credits')}>
          Credits &amp; about
        </button>
      </div>
      {panel !== 'none' && (
        <div className="panel" style={{ position: 'fixed', right: '6vw', top: '12vh', width: 440, maxHeight: '76vh', overflow: 'auto', padding: 20 }}>
          {panel === 'controls' ? (
            <>
              <h3 className="display" style={{ marginTop: 0 }}>Controls</h3>
              <div className="bind">
                <span>Aim / shoot</span>
                <span>
                  <span className="kbd">Mouse</span> <span className="kbd">LMB</span>
                </span>
              </div>
              <div className="bind">
                <span>Zoom / aim down sights</span>
                <span className="kbd">RMB</span>
              </div>
              {(Object.keys(DEFAULT_BINDINGS) as BindAction[]).map((a) => (
                <div className="bind" key={a}>
                  <span>{BIND_LABELS[a]}</span>
                  <span className="kbd">{keyLabel(DEFAULT_BINDINGS[a])}</span>
                </div>
              ))}
              <div className="bind">
                <span>Pause / release mouse</span>
                <span className="kbd">Esc</span>
              </div>
              <p style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                Double-jump and dash cost stamina. Dash then jump for a long dash-jump; dash then crouch to slide (brief infinite ammo). Jump at a ledge to mantle onto it. Press E under a zipline to ride it. Hold Alt and press 1-4 to upgrade abilities. Keys are rebindable in Settings.
              </p>
            </>
          ) : (
            <>
              <h3 className="display" style={{ marginTop: 0 }}>About HEXLINE</h3>
              <p style={{ color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.5 }}>
                HEXLINE is an original browser game that recreates the structure of a lane-based hero shooter MOBA: three lanes, trooper waves, Guardians, Walkers, Base Guardians, Shrines and a two-phase Patron, a souls economy, stamina movement, ziplines, a mid-boss, and full 6v6 matches against autonomous bots.
              </p>
              <p style={{ color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.5 }}>
                All characters, art, audio and the map are original and generated procedurally in code. No proprietary assets are used. Inspired by the gameplay of Valve&apos;s Deadlock; not affiliated with or endorsed by Valve.
              </p>
              <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>Built with TypeScript, Three.js, React and Vite.</p>
            </>
          )}
        </div>
      )}
      <div className="menu-foot">
        <span>v0.1 · single-player vs. bots · multiplayer server: see README</span>
        <span>Press Esc in-game to pause</span>
      </div>
    </div>
  );
}
