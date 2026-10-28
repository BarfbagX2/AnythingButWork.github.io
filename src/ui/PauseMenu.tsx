import { useState } from 'react';
import type { Settings } from '../game/settings';
import { SettingsPanel } from './SettingsPanel';

interface Props {
  settings: Settings;
  onSettings: (s: Settings) => void;
  onResume: () => void;
  onQuit: () => void;
  onSurrender: () => void;
}

export function PauseMenu({ settings, onSettings, onResume, onQuit, onSurrender }: Props) {
  const [view, setView] = useState<'main' | 'settings'>('main');
  if (view === 'settings') return <SettingsPanel settings={settings} onChange={onSettings} onClose={() => setView('main')} />;
  return (
    <div className="overlay" data-testid="pause">
      <div className="panel pause-panel">
        <h2>PAUSED</h2>
        <button className="btn primary" onClick={onResume} data-testid="resume">
          Resume
        </button>
        <button className="btn" onClick={() => setView('settings')}>
          Settings
        </button>
        <button className="btn" onClick={onSurrender}>
          End match &amp; see results
        </button>
        <button className="btn" onClick={onQuit} data-testid="quit">
          Quit to main menu
        </button>
        <div style={{ fontSize: 11, color: 'var(--text-faint)', textAlign: 'center', marginTop: 6 }}>The simulation is paused while this menu is open.</div>
      </div>
    </div>
  );
}
