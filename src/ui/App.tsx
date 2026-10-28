import { useCallback, useRef, useState } from 'react';
import { audio } from '../audio/audio';
import { buildMatchConfig, type SetupChoices } from '../game/matchSetup';
import { loadSettings, saveSettings, type Settings } from '../game/settings';
import type { MatchConfig } from '../core/simulation';
import type { RemoteLink } from '../game/session';
import type { NetClient, Welcome } from '../network/client';
import { GameView, type MatchSummary } from './GameView';
import { JoinOnline } from './JoinOnline';
import { MainMenu } from './MainMenu';
import { MatchSetup } from './MatchSetup';
import { Results } from './Results';
import { SettingsPanel } from './SettingsPanel';

type Screen =
  | { id: 'menu' }
  | { id: 'setup'; mode: SetupChoices['mode'] }
  | { id: 'game'; config: Partial<MatchConfig>; localSlot: number; choices: SetupChoices; key: number }
  | { id: 'results'; summary: MatchSummary; choices: SetupChoices }
  | { id: 'online'; error?: string }
  | { id: 'online-game'; link: RemoteLink; key: number }
  | { id: 'online-results'; summary: MatchSummary }
  | { id: 'settings'; back: Screen };

export function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [screen, setScreen] = useState<Screen>({ id: 'menu' });

  const updateSettings = useCallback((s: Settings) => {
    setSettings(s);
    saveSettings(s);
    audio.setVolumes(s.volume);
  }, []);

  // The live server connection survives screen changes (game -> results -> next match).
  const netRef = useRef<NetClient | null>(null);
  const leaveOnline = (next: Screen) => {
    const net = netRef.current;
    netRef.current = null;
    if (net) {
      net.onClose = () => {};
      net.onWelcome = () => {};
      net.close();
    }
    setScreen(next);
  };
  const enterOnline = (net: NetClient, welcome: Welcome) => {
    netRef.current = net;
    let matchId = welcome.matchId;
    // The server starts its next match on its own; follow it there.
    net.onWelcome = (w) => {
      if (w.matchId === matchId) return;
      matchId = w.matchId;
      setScreen({ id: 'online-game', link: { net, welcome: w }, key: Date.now() });
    };
    net.onClose = (reason) => leaveOnline({ id: 'online', error: reason });
    setScreen({ id: 'online-game', link: { net, welcome }, key: Date.now() });
  };

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
          onOnline={() => {
            audio.resume();
            audio.ui('click');
            setScreen({ id: 'online' });
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
    case 'online':
      return <JoinOnline error={screen.error} onBack={() => setScreen({ id: 'menu' })} onJoined={enterOnline} />;
    case 'online-game':
      return (
        <GameView
          key={screen.key}
          config={screen.link.welcome.config}
          localSlot={-1}
          remote={screen.link}
          settings={settings}
          onSettings={updateSettings}
          onQuit={() => leaveOnline({ id: 'menu' })}
          onEnd={(summary) => setScreen({ id: 'online-results', summary })}
        />
      );
    case 'online-results':
      return <Results summary={screen.summary} note="The server starts the next match automatically — you will rejoin it." onMenu={() => leaveOnline({ id: 'menu' })} />;
    case 'settings':
      return <SettingsPanel settings={settings} onChange={updateSettings} onClose={() => setScreen(screen.back)} standalone />;
  }
}
