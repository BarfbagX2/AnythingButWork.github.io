import type { GameSession } from '../game/session';
import { formatSouls } from './text';
import { useTicker } from './useTicker';

export function Scoreboard({ session }: { session: GameSession }) {
  useTicker(4);
  const sim = session.sim;
  const local = session.local;
  return (
    <div className="overlay" style={{ background: 'rgba(4,4,10,0.35)', pointerEvents: 'none' }}>
      <div className="panel scoreboard" data-testid="scoreboard">
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th>Hero</th>
              <th>Lvl</th>
              <th>K</th>
              <th>D</th>
              <th>A</th>
              <th>Souls</th>
              <th>LH</th>
              <th>Hero dmg</th>
              <th>Obj dmg</th>
              <th>Items</th>
            </tr>
          </thead>
          {[0, 1].map((team) => (
            <tbody key={team}>
              <tr>
                <td colSpan={11} className="teamhead" style={{ color: team === 0 ? 'var(--amber)' : 'var(--azure)' }}>
                  {team === 0 ? 'AMBER COVENANT' : 'AZURE LODGE'} · {sim.teams[team as 0 | 1].kills} kills · {sim.teams[team as 0 | 1].structuresDestroyed} objectives
                </td>
              </tr>
              {sim.heroes
                .filter((h) => h.team === team)
                .map((h) => (
                  <tr key={h.id} className={h === local ? 'me' : ''} style={{ opacity: h.alive ? 1 : 0.55 }}>
                    <td>
                      {h.playerName}
                      {h.isBot ? <span style={{ color: 'var(--text-faint)' }}> (bot)</span> : ''}
                      {!h.alive && <span style={{ color: 'var(--danger)' }}> {Math.ceil(Math.max(0, h.respawnAt - sim.time))}s</span>}
                    </td>
                    <td>{h.def.name}</td>
                    <td>{h.level}</td>
                    <td>{h.match.kills}</td>
                    <td>{h.match.deaths}</td>
                    <td>{h.match.assists}</td>
                    <td style={{ color: 'var(--souls)' }}>{formatSouls(h.netWorth)}</td>
                    <td>{h.match.lastHits}</td>
                    <td>{Math.round(h.match.heroDamage)}</td>
                    <td>{Math.round(h.match.objectiveDamage)}</td>
                    <td style={{ letterSpacing: 2 }}>{h.items.map((i) => i.def.icon).join('')}</td>
                  </tr>
                ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}
