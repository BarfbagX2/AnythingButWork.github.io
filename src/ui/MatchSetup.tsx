import { useMemo, useState } from 'react';
import { HERO_LIST } from '../../data/heroes';
import type { Difficulty } from '../core/simulation';
import type { GameMode, SetupChoices } from '../game/matchSetup';
import type { Settings } from '../game/settings';
import type { LaneId, TeamId } from '../world/mapTypes';
import { describeAbility } from './text';

interface Props {
  mode: GameMode;
  settings: Settings;
  onBack: () => void;
  onStart: (c: SetupChoices) => void;
}

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard', 'expert'];

function Seg<T extends string | number>({ value, options, onChange, labels }: { value: T; options: T[]; onChange: (v: T) => void; labels?: Record<string, string> }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={String(o)} className={o === value ? 'on' : ''} onClick={() => onChange(o)}>
          {labels?.[String(o)] ?? String(o)}
        </button>
      ))}
    </div>
  );
}

export function MatchSetup({ mode, settings, onBack, onStart }: Props) {
  const [heroId, setHeroId] = useState(HERO_LIST.some((h) => h.id === settings.lastHero) ? settings.lastHero : HERO_LIST[0].id);
  const [team, setTeam] = useState<TeamId>(0);
  const [teamSize, setTeamSize] = useState(mode === 'practice' ? 2 : settings.teamSize || 6);
  const [allyDiff, setAllyDiff] = useState<Difficulty>(settings.difficulty);
  const [enemyDiff, setEnemyDiff] = useState<Difficulty>(mode === 'practice' ? 'easy' : settings.difficulty);
  const [lane, setLane] = useState<LaneId | -1>(-1);
  const [name, setName] = useState('You');
  const hero = useMemo(() => HERO_LIST.find((h) => h.id === heroId)!, [heroId]);
  const spectate = mode === 'spectate';
  const title = mode === 'practice' ? 'Practice Range' : spectate ? 'Spectate a Bot Match' : 'Bot Match';

  return (
    <div className="screen setup">
      <div className="setup-head">
        <h2>{title}</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn" onClick={onBack}>
            Back
          </button>
          <button
            className="btn primary"
            data-testid="start-match"
            onClick={() => onStart({ mode, heroId, playerName: name, team, teamSize, allyDifficulty: allyDiff, enemyDifficulty: enemyDiff, lane, seed: Math.floor(Math.random() * 100000) })}
          >
            {spectate ? 'Start spectating' : 'Enter the city'}
          </button>
        </div>
      </div>
      <div className="setup-body">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {!spectate && (
            <div className="hero-grid">
              {HERO_LIST.map((h) => (
                <div key={h.id} className={`hero-card ${h.id === heroId ? 'selected' : ''}`} onClick={() => setHeroId(h.id)} data-testid={`hero-${h.id}`}>
                  <div className="swatch" style={{ background: `linear-gradient(120deg, ${h.model.primary}, ${h.model.secondary} 60%, ${h.model.accent})` }}>
                    <div style={{ position: 'absolute', right: 8, bottom: 4, fontSize: 24, color: h.model.glow, textShadow: '0 0 8px ' + h.model.glow }}>{h.abilities[3].icon}</div>
                  </div>
                  <div className="name">{h.name}</div>
                  <div className="role">
                    {h.role} · {'★'.repeat(h.difficulty)}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="panel opt-grid">
            {!spectate && (
              <>
                <div className="opt">
                  <label>Your name</label>
                  <input type="text" value={name} maxLength={16} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="opt">
                  <label>Team</label>
                  <Seg value={team} options={[0, 1] as TeamId[]} onChange={setTeam} labels={{ 0: 'Amber Covenant', 1: 'Azure Lodge' }} />
                </div>
              </>
            )}
            <div className="opt">
              <label>Team size</label>
              <Seg value={teamSize} options={[1, 2, 3, 4, 5, 6]} onChange={setTeamSize} />
            </div>
            {!spectate && (
              <div className="opt">
                <label>Preferred lane</label>
                <Seg value={lane} options={[-1, 0, 1, 2] as (LaneId | -1)[]} onChange={setLane} labels={{ '-1': 'Auto', 0: 'West', 1: 'Mid', 2: 'East' }} />
              </div>
            )}
            <div className="opt">
              <label>{spectate ? 'Amber difficulty' : 'Ally bot difficulty'}</label>
              <Seg value={allyDiff} options={DIFFS} onChange={setAllyDiff} />
            </div>
            <div className="opt">
              <label>{spectate ? 'Azure difficulty' : 'Enemy bot difficulty'}</label>
              <Seg value={enemyDiff} options={DIFFS} onChange={setEnemyDiff} />
            </div>
          </div>
          <div style={{ color: 'var(--text-dim)', fontSize: 12, lineHeight: 1.5 }}>
            {mode === 'practice'
              ? 'Practice: start with 20,000 souls, short pregame, easy bots and no mid-boss. Experiment with builds and abilities.'
              : spectate
                ? 'Spectate: every hero is a bot. Use 1/2 or [ ] to switch the followed hero, F8 for a free camera, F3 for the AI inspector.'
                : 'Destroy the enemy Patron. Push lanes with your troopers: Guardian → Walker → Base Guardian → Shrines → Patron. Last-hit troopers and shoot the soul orbs they drop.'}
          </div>
        </div>
        {!spectate && (
          <div className="panel hero-detail">
            <div>
              <h3>{hero.name}</h3>
              <div className="title">{hero.title}</div>
            </div>
            <div style={{ color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.5 }}>{hero.description}</div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              <b style={{ color: 'var(--text)' }}>{hero.weapon.name}</b> · {hero.weapon.pellets > 1 ? `${hero.weapon.pellets}×` : ''}
              {hero.weapon.damage} dmg · {(1 / hero.weapon.fireInterval).toFixed(1)}/s · {hero.weapon.magazine} rounds · {hero.base.maxHp} HP
            </div>
            {hero.abilities.map((a) => (
              <div className="ability-row" key={a.id}>
                <div className="ability-icon" style={{ color: a.color, borderColor: a.ultimate ? 'var(--brass)' : undefined }}>
                  {a.icon}
                </div>
                <div>
                  <div className="an">
                    {a.slot}. {a.name} {a.ultimate && <span style={{ color: 'var(--brass)', fontSize: 11 }}>ULTIMATE</span>}
                    <span style={{ color: 'var(--text-faint)', fontWeight: 400, marginLeft: 6 }}>{a.params.cooldown}s</span>
                  </div>
                  <div className="ad">{describeAbility(a, 1)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
