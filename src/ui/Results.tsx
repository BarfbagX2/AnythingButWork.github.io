import type { MatchSummary } from './GameView';
import { formatSouls, formatTime } from './text';

export function Results({ summary, onRematch, onMenu }: { summary: MatchSummary; onRematch: () => void; onMenu: () => void }) {
  const spect = summary.localTeam < 0;
  const won = summary.winner === summary.localTeam;
  const title = summary.winner < 0 ? 'MATCH ENDED' : spect ? `${summary.winner === 0 ? 'AMBER' : 'AZURE'} WINS` : won ? 'VICTORY' : 'DEFEAT';
  const best = (k: keyof MatchSummary['heroes'][number]) => [...summary.heroes].sort((a, b) => (b[k] as number) - (a[k] as number))[0];
  const mvp = [...summary.heroes].sort((a, b) => b.kills * 2 + b.assists + b.objectiveDamage / 1500 - (a.kills * 2 + a.assists + a.objectiveDamage / 1500))[0];
  return (
    <div className="screen results" data-testid="results">
      <h1 className={won || spect ? 'win' : 'loss'}>{title}</h1>
      <div style={{ color: 'var(--text-dim)', letterSpacing: '0.2em', marginBottom: 20 }}>
        {formatTime(summary.duration)} · objectives destroyed {summary.structures[0].destroyed} – {summary.structures[1].destroyed}
      </div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 18, flexWrap: 'wrap', justifyContent: 'center' }}>
        {[
          ['MVP', mvp, `${mvp?.kills}/${mvp?.deaths}/${mvp?.assists}`],
          ['Most hero damage', best('heroDamage'), `${best('heroDamage')?.heroDamage}`],
          ['Most objective damage', best('objectiveDamage'), `${best('objectiveDamage')?.objectiveDamage}`],
          ['Most souls', best('souls'), formatSouls(best('souls')?.souls ?? 0)],
        ].map(([label, h, v]) => (
          <div key={label as string} className="panel" style={{ padding: '10px 16px', minWidth: 180 }}>
            <div style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--text-dim)' }}>{String(label).toUpperCase()}</div>
            <div style={{ fontWeight: 800 }}>{(h as MatchSummary['heroes'][number])?.name}</div>
            <div style={{ color: 'var(--brass)' }}>{v as string}</div>
          </div>
        ))}
      </div>
      <div className="panel scoreboard">
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
              <th>Healing</th>
            </tr>
          </thead>
          {[0, 1].map((team) => (
            <tbody key={team}>
              <tr>
                <td colSpan={11} className="teamhead" style={{ color: team === 0 ? 'var(--amber)' : 'var(--azure)' }}>
                  {team === 0 ? 'AMBER COVENANT' : 'AZURE LODGE'} {summary.winner === team ? '· WINNER' : ''}
                </td>
              </tr>
              {summary.heroes
                .filter((h) => h.team === team)
                .map((h) => (
                  <tr key={h.id} className={!h.isBot ? 'me' : ''}>
                    <td>{h.name}</td>
                    <td>{h.hero}</td>
                    <td>{h.level}</td>
                    <td>{h.kills}</td>
                    <td>{h.deaths}</td>
                    <td>{h.assists}</td>
                    <td style={{ color: 'var(--souls)' }}>{formatSouls(h.souls)}</td>
                    <td>{h.lastHits}</td>
                    <td>{h.heroDamage}</td>
                    <td>{h.objectiveDamage}</td>
                    <td>{h.healing}</td>
                  </tr>
                ))}
            </tbody>
          ))}
        </table>
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
        <button className="btn primary" onClick={onRematch} data-testid="rematch">
          Rematch
        </button>
        <button className="btn" onClick={onMenu} data-testid="menu">
          Main menu
        </button>
      </div>
    </div>
  );
}
