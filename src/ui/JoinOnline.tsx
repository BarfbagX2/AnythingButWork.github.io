import { useState } from 'react';
import { HERO_LIST } from '../../data/heroes';
import { NetClient, type Welcome } from '../network/client';
import { DEFAULT_PORT } from '../network/protocol';
import type { TeamId } from '../world/mapTypes';
import { Seg } from './MatchSetup';

interface Props {
  error?: string;
  onBack: () => void;
  onJoined: (net: NetClient, welcome: Welcome) => void;
}

const KEY = 'hexline.online.v1';

function defaultUrl(): string {
  // When the page is served by the match server itself, connect back to it.
  if (typeof location !== 'undefined' && location.port === String(DEFAULT_PORT)) {
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
  }
  const host = typeof location !== 'undefined' && location.hostname ? location.hostname : 'localhost';
  return `ws://${host}:${DEFAULT_PORT}`;
}

function load(): { url: string; name: string } {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { url: typeof s.url === 'string' ? s.url : defaultUrl(), name: typeof s.name === 'string' ? s.name : 'Player' };
  } catch {
    return { url: defaultUrl(), name: 'Player' };
  }
}

/** Connects to a HEXLINE match server (`npm run server`) and joins its match. */
export function JoinOnline({ error, onBack, onJoined }: Props) {
  const saved = load();
  const [url, setUrl] = useState(saved.url);
  const [name, setName] = useState(saved.name);
  const [team, setTeam] = useState<TeamId | -1>(-1);
  const [heroId, setHeroId] = useState<string>('any');
  const [spectate, setSpectate] = useState(false);
  const [status, setStatus] = useState<string | null>(error ?? null);
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    setBusy(true);
    setStatus('Connecting…');
    try {
      localStorage.setItem(KEY, JSON.stringify({ url, name }));
    } catch {
      // Storage may be unavailable (private mode); not needed to play.
    }
    const net = new NetClient();
    try {
      const welcome = await net.connect(url.trim(), { name, team: team === -1 ? undefined : team, heroId: heroId === 'any' ? undefined : heroId, spectate });
      onJoined(net, welcome);
    } catch (e) {
      net.close();
      setStatus(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="screen setup" data-testid="online">
      <div className="setup-head">
        <h2>Online Match</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn" onClick={onBack}>
            Back
          </button>
          <button className="btn primary" data-testid="connect" disabled={busy || !url.trim()} onClick={connect}>
            {busy ? 'Connecting…' : spectate ? 'Watch' : 'Join match'}
          </button>
        </div>
      </div>
      <div className="panel opt-grid" style={{ maxWidth: 760 }}>
        <div className="opt">
          <label>Server address</label>
          <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} data-testid="server-url" spellCheck={false} />
        </div>
        <div className="opt">
          <label>Your name</label>
          <input type="text" value={name} maxLength={16} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="opt">
          <label>Team</label>
          <Seg value={team} options={[-1, 0, 1] as (TeamId | -1)[]} onChange={setTeam} labels={{ '-1': 'Auto-balance', 0: 'Amber Covenant', 1: 'Azure Lodge' }} />
        </div>
        <div className="opt">
          <label>Join as</label>
          <Seg value={spectate ? 'spectator' : 'player'} options={['player', 'spectator']} onChange={(v) => setSpectate(v === 'spectator')} labels={{ player: 'Player', spectator: 'Spectator' }} />
        </div>
        {!spectate && (
          <div className="opt" style={{ gridColumn: '1 / -1' }}>
            <label>Preferred hero (if a bot on your team is playing it)</label>
            <Seg value={heroId} options={['any', ...HERO_LIST.map((h) => h.id)]} onChange={setHeroId} labels={Object.fromEntries([['any', 'Any'], ...HERO_LIST.map((h) => [h.id, h.name.split(' ')[0]])])} />
          </div>
        )}
      </div>
      {status && (
        <div className="panel" style={{ maxWidth: 760, padding: '10px 14px', color: busy ? 'var(--text-dim)' : '#ffb0a0' }} data-testid="online-status">
          {status}
        </div>
      )}
      <div style={{ color: 'var(--text-dim)', fontSize: 12, lineHeight: 1.6, maxWidth: 760 }}>
        Host a match with <span className="kbd">npm run server</span> (port {DEFAULT_PORT}); after <span className="kbd">npm run build</span> the server also serves the game
        itself, so other players on your network can open <span className="kbd">http://&lt;host&gt;:{DEFAULT_PORT}/</span>. Every empty slot is played by a bot: you take over a
        bot&apos;s hero when you join and the bot takes it back when you leave. The server runs the simulation; your client sends inputs and renders its snapshots.
      </div>
    </div>
  );
}
