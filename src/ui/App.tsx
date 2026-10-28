import { useCallback, useState } from 'react';
import { audio } from '../audio/audio';
import { buildMatchConfig, type SetupChoices } from '../game/matchSetup';
import { loadSettings, saveSettings, type Settings } from '../game/settings';
import type { MatchConfig } from '../core/simulation';
import { GameView, type MatchSummary } from './GameView';
import { MainMenu } from './MainMenu';
import { MatchSetup } from './MatchSetup';
import { Results } from './Results';
import { SettingsPanel } from './SettingsPanel';

type Screen =
  | { id: 'menu' }
  | { id: 'setup'; mode: SetupChoices['mode'] }
  | { id: 'game'; config: Partial<MatchConfig>; localSlot: number; choices: SetupChoices; key: number }
  | { id: 'results'; summary: MatchSummary; choices: SetupChoices }
  | { id: 'settings'; back: Screen };

export function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [screen, setScreen] = useState<Screen>({ id: 'menu' });

  const updateSettings = useCallback((s: Settings) => {
    setSettings(s);
    saveSettings(s);
    audio.setVolumes(s.volume);
  }, []);

  const start = (choices: SetupChoices) => {
    audio.resume();
    const { config, localSlot } = buildMatchConfig(choices);
    updateSettings({ ...settings, lastHero: choices.heroId, difficulty: choices.enemyDifficulty, teamSize: choices.teamSize });
    setScreen({ id: 'game', config, localSlot, choices, key: Date.now() });
  };

  switch (screen.id) {
    case 'menu':
      return (
        <MainMenu
          onPlay={(mode) => {
            audio.resume();
            audio.ui('click');
            setScreen({ id: 'setup', mode });
          }}
          onSettings={() => setScreen({ id: 'settings', back: screen })}
        />
      );
    case 'setup':
      return <MatchSetup mode={screen.mode} settings={settings} onBack={() => setScreen({ id: 'menu' })} onStart={start} />;
    case 'game':
      return (
        <GameView
          key={screen.key}
          config={screen.config}
          localSlot={screen.localSlot}
          settings={settings}
          onSettings={updateSettings}
          onQuit={() => setScreen({ id: 'menu' })}
          onEnd={(summary) => setScreen({ id: 'results', summary, choices: screen.choices })}
        />
      );
    case 'results':
      return (
        <Results
          summary={screen.summary}
          onRematch={() => start({ ...screen.choices, seed: (screen.choices.seed * 31 + 7) % 100000 })}
          onMenu={() => setScreen({ id: 'menu' })}
        />
      );
    case 'settings':
      return <SettingsPanel settings={settings} onChange={updateSettings} onClose={() => setScreen(screen.back)} standalone />;
  }
}
