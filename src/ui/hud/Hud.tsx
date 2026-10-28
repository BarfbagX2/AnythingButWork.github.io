import { useEffect, useRef, useState } from 'react';
import { BALANCE } from '../../../data/balance';
import type { SimEvent } from '../../core/events';
import { abilityParam, canUpgradeAbility } from '../../gameplay/abilities';
import type { Hero } from '../../gameplay/entities';
import { zipClosest } from '../../gameplay/movement';
import { totalShield } from '../../gameplay/status';
import { SF } from '../../gameplay/types';
import type { GameSession } from '../../game/session';
import { keyLabel, type Settings } from '../../game/settings';
import { formatSouls, formatTime } from '../text';
import { useTicker } from '../useTicker';
import { Minimap } from './Minimap';

interface FeedEntry {
  id: number;
  html: { killer: string; killerTeam: number; victim: string; victimTeam: number; assists: number; mine: boolean };
  until: number;
}

let feedIds = 1;

function Crosshair({ hero }: { hero: Hero | null }) {
  let gap = 6;
  if (hero) {
    const w = hero.weapon;
    const moving = Math.hypot(hero.vel.x, hero.vel.z) > 1.5 || !hero.grounded;
    const cone = w.spread + (moving ? w.def.spreadMoving : 0);
    gap = 4 + Math.min(40, cone * 420);
  }
  const bar = (style: React.CSSProperties) => <div className="bar" style={style} />;
  return (
    <div className="crosshair">
      <div className="dot" />
      {bar({ left: '50%', top: `calc(50% - ${gap + 8}px)`, width: 2, height: 7, marginLeft: -1 })}
      {bar({ left: '50%', top: `calc(50% + ${gap + 1}px)`, width: 2, height: 7, marginLeft: -1 })}
      {bar({ top: '50%', left: `calc(50% - ${gap + 8}px)`, height: 2, width: 7, marginTop: -1 })}
      {bar({ top: '50%', left: `calc(50% + ${gap + 1}px)`, height: 2, width: 7, marginTop: -1 })}
    </div>
  );
}

const STRUCT_ORDER = ['guardian', 'walker', 'baseGuardian'] as const;

export function Hud({ session, settings }: { session: GameSession; settings: Settings }) {
  useTicker(15);
  const sim = session.sim;
  const local = session.local;
  const view = session.viewHero();
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [announce, setAnnounce] = useState<{ text: string; until: number } | null>(null);
  const [toast, setToast] = useState<{ text: string; until: number } | null>(null);
  const [chat, setChat] = useState<{ id: number; text: string; until: number }[]>([]);
  const latest = useRef({ feed, chat });
  latest.current = { feed, chat };

  useEffect(() => {
    return session.subscribe((e: SimEvent) => {
      const now = performance.now();
      if (e.t === 'heroKill') {
        const k = sim.units.get(e.killer);
        const v = sim.units.get(e.victim) as Hero | undefined;
        if (!v) return;
        const killerName = k && k.kind === 'hero' ? k.playerName : k ? (k.kind === 'structure' ? k.def.name : k.kind === 'trooper' ? 'Troopers' : 'The city') : 'The city';
        const entry: FeedEntry = {
          id: feedIds++,
          html: { killer: killerName, killerTeam: k ? (k.team as number) : 2, victim: v.playerName, victimTeam: v.team, assists: e.assists.length, mine: !!local && (e.killer === local.id || e.victim === local.id || e.assists.includes(local.id)) },
          until: now + 7000,
        };
        setFeed((f) => [...f.filter((x) => x.until > now).slice(-5), entry]);
      } else if (e.t === 'announce') {
        if (e.kind === 'warning') {
          if (e.team === -1 && (e.unit === undefined || e.unit === local?.id)) setToast({ text: e.text, until: now + 1400 });
        } else if (e.team === -1 || (local && e.team === local.team) || !local) setAnnounce({ text: e.text, until: now + 4000 });
      } else if (e.t === 'botSay') {
        if (local && e.team !== local.team) return;
        const u = sim.units.get(e.unit);
        const name = u && u.kind === 'hero' ? u.playerName : 'Bot';
        setChat((c) => [...c.filter((x) => x.until > now).slice(-4), { id: feedIds++, text: `${name}: ${e.text}`, until: now + 6000 }]);
      } else if (e.t === 'ping' && local && e.team === local.team) {
        const u = sim.units.get(e.from);
        const name = u && u.kind === 'hero' ? u.playerName : '';
        const labels: Record<string, string> = { attack: 'Attack here', defend: 'Defend here', group: 'Group up', retreat: 'Fall back!', focus: 'Focus this target', push: 'Push this lane', danger: 'Danger!' };
        setChat((c) => [...c.filter((x) => x.until > now).slice(-4), { id: feedIds++, text: `${name}: ${labels[e.kind] ?? e.kind}`, until: now + 5000 }]);
      }
    });
  }, [session, sim, local]);

  const now = performance.now();
  const h = view;
  const teamKills = [sim.teams[0].kills, sim.teams[1].kills];
  const pregame = sim.phase === 'pregame';
  const clock = pregame ? -sim.matchTime : sim.matchTime;

  // Contextual prompts.
  let prompt = '';
  if (h && h.alive && local === h) {
    if (!h.zip) {
      for (const z of session.sim.ziplines) {
        if (z.team !== h.team) continue;
        const c = zipClosest(z, h.pos.x, h.pos.z);
        if (c.dist < BALANCE.zipline.attachRange && h.pos.y < c.y) {
          prompt = `Press ${keyLabel(settings.bindings.interact)} to ride the zipline`;
          break;
        }
      }
    } else prompt = `Riding zipline — ${keyLabel(settings.bindings.jump)} to drop off, look back to reverse`;
    if (!prompt && h.inShopRange) prompt = `Press ${keyLabel(settings.bindings.shop)} to open the shop`;
  }

  return (
    <div className="hud" data-testid="hud">
      {h && h.alive && local === h && <Crosshair hero={h} />}
      <Minimap session={session} />

      <div className="topbar">
        <div className="team-score amber">
          <div className="k">{teamKills[0]}</div>
          <div>
            <div className="tn">Amber Covenant</div>
            <div className="heads">
              {sim.heroes
                .filter((x) => x.team === 0)
                .map((x) => (
                  <div key={x.id} className={`head ${x.alive ? '' : 'dead'}`} style={{ background: x.def.model.primary }} title={x.playerName}>
                    {x.alive ? '' : Math.ceil(Math.max(0, x.respawnAt - sim.time))}
                  </div>
                ))}
            </div>
          </div>
        </div>
        <div className="clock">
          <div className="t">{formatTime(clock)}</div>
          <div className="p">{pregame ? 'Troopers in' : sim.phase === 'ended' ? 'Match over' : 'Match'}</div>
        </div>
        <div className="team-score azure">
          <div className="k">{teamKills[1]}</div>
          <div style={{ textAlign: 'right' }}>
            <div className="tn">Azure Lodge</div>
            <div className="heads" style={{ justifyContent: 'flex-end' }}>
              {sim.heroes
                .filter((x) => x.team === 1)
                .map((x) => (
                  <div key={x.id} className={`head ${x.alive ? '' : 'dead'}`} style={{ background: x.def.model.primary }} title={x.playerName}>
                    {x.alive ? '' : Math.ceil(Math.max(0, x.respawnAt - sim.time))}
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>

      <div className="objectives" data-testid="objectives">
        {[0, 1].map((team) => (
          <div key={team} className="obj-lane" title={team === 0 ? 'Amber structures' : 'Azure structures'}>
            {[0, 1, 2].map((lane) => (
              <div key={lane} style={{ display: 'flex', gap: 2, marginRight: 6 }}>
                {STRUCT_ORDER.map((type) => {
                  const s = sim.structureByKeyGet(`${team === 0 ? 'a' : 'b'}-${type}-${lane}`);
                  return <div key={type} className={`obj-pip ${!s || !s.alive ? 'dead' : s.vulnerable ? 'vuln' : ''}`} style={{ background: team === 0 ? 'var(--amber)' : 'var(--azure)', borderColor: sim.map.lanes[lane].color }} />;
                })}
              </div>
            ))}
            {['shrine-0', 'shrine-1', 'patron'].map((k) => {
              const s = sim.structureByKeyGet(`${team === 0 ? 'a' : 'b'}-${k}`);
              return <div key={k} className={`obj-pip ${!s || !s.alive ? 'dead' : s.vulnerable ? 'vuln' : ''}`} style={{ background: team === 0 ? 'var(--amber)' : 'var(--azure)', width: k === 'patron' ? 13 : 10, height: k === 'patron' ? 13 : 10 }} />;
            })}
          </div>
        ))}
      </div>

      <div className="killfeed">
        {feed
          .filter((f) => f.until > now)
          .map((f) => (
            <div key={f.id} className={`feed-item ${f.html.mine ? 'mine' : ''}`}>
              <span className={f.html.killerTeam === 0 ? 'a' : f.html.killerTeam === 1 ? 'b' : ''}>{f.html.killer}</span>
              {f.html.assists > 0 && <span style={{ color: 'var(--text-faint)' }}> +{f.html.assists}</span>} <span style={{ color: 'var(--text-dim)' }}>✕</span>{' '}
              <span className={f.html.victimTeam === 0 ? 'a' : 'b'}>{f.html.victim}</span>
            </div>
          ))}
      </div>
      {announce && announce.until > now && <div className="announce">{announce.text}</div>}
      {toast && toast.until > now && <div className="toast">{toast.text}</div>}
      <div className="chat">
        {chat
          .filter((c) => c.until > now)
          .map((c) => (
            <div key={c.id}>{c.text}</div>
          ))}
      </div>
      {prompt && <div className="prompt">{prompt}</div>}

      {pregame && <div className="announce" style={{ top: '30%' }}>Troopers deploy in {Math.ceil(-sim.matchTime)}… {local ? `Visit the shop (${keyLabel(settings.bindings.shop)}) and spend your ability point (${keyLabel(settings.bindings.upgradeModifier)} + 1-4).` : ''}</div>}
      {sim.phase === 'ended' && (
        <div className="announce" style={{ top: '35%', fontSize: 64, color: local && sim.winner !== local.team ? '#ff8a7a' : 'var(--brass-2)' }}>
          {local ? (sim.winner === local.team ? 'VICTORY' : 'DEFEAT') : `${sim.winner === 0 ? 'AMBER' : 'AZURE'} WINS`}
        </div>
      )}

      {h && <Vitals hero={h} session={session} />}
      {h && <Abilities hero={h} session={session} settings={settings} />}
      {h && <WeaponPanel hero={h} session={session} settings={settings} />}
      {h && !h.alive && local === h && sim.phase !== 'ended' && (
        <div className="death">
          <div className="big">ELIMINATED</div>
          <div className="sub">Respawning in {Math.ceil(Math.max(0, h.respawnAt - sim.time))}s — you can shop while dead ({keyLabel(settings.bindings.shop)})</div>
        </div>
      )}
      {!local && h && (
        <div className="toast" style={{ bottom: 120 }}>
          Spectating {h.playerName} ({h.def.name}, {h.team === 0 ? 'Amber' : 'Azure'}) — [ / ] to switch · +/- speed ({session.timeScale}x) · F3 AI inspector
        </div>
      )}
      {settings.showFps && <div className="perf">{`${session.frameStats.fps.toFixed(0)} fps`}</div>}
    </div>
  );
}

function Vitals({ hero: h }: { hero: Hero; session: GameSession }) {
  const frac = h.hp / h.maxHp;
  const shield = totalShield(h);
  const max = h.stats.stamina;
  return (
    <div className="vitals" data-testid="vitals">
      <div className="lvl">
        <div className="badge">
          <span>{h.level}</span>
        </div>
        <div>
          <div className="heroname">{h.def.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            {h.playerName} · {h.def.role}
          </div>
        </div>
      </div>
      <div className="bar-wrap">
        <div className={`bar-fill ${frac < 0.3 ? 'low' : ''}`} style={{ width: `${frac * 100}%` }} />
        {shield > 0 && <div className="bar-shield" style={{ width: `${Math.min(100, (shield / h.maxHp) * 100)}%` }} />}
        <div className="bar-text">
          {Math.ceil(h.hp)} / {Math.round(h.maxHp)}
          {shield > 0 ? ` (+${Math.round(shield)})` : ''}
        </div>
      </div>
      <div className="stamina" title="Stamina">
        {Array.from({ length: max }, (_, i) => (
          <div key={i} className={`pip ${i < h.stamina ? 'full' : ''}`}>
            {i === h.stamina && <div className="fill" style={{ width: `${(h.staminaNext / h.stats.staminaCooldown) * 100}%` }} />}
          </div>
        ))}
      </div>
      <div className="statuses">
        {h.statuses.slice(0, 8).map((s, i) => (
          <div key={i} className={`status-chip ${s.spec.debuff ? 'debuff' : ''}`}>
            {s.spec.name}
          </div>
        ))}
        {h.flags & SF.STUN ? <div className="status-chip debuff">STUNNED</div> : null}
      </div>
    </div>
  );
}

function Abilities({ hero: h, session, settings }: { hero: Hero; session: GameSession; settings: Settings }) {
  const t = session.sim.time;
  const keys = [settings.bindings.ability1, settings.bindings.ability2, settings.bindings.ability3, settings.bindings.ability4];
  const anyUpgrade = h.abilities.some((_, i) => canUpgradeAbility(h, i + 1).ok);
  return (
    <>
      {h.abilityPoints > 0 && anyUpgrade && session.local === h && (
        <div className="ap-hint">
          {h.abilityPoints} ability point{h.abilityPoints > 1 ? 's' : ''} — hold {keyLabel(settings.bindings.upgradeModifier)} + 1-4
        </div>
      )}
      <div className="abilities" data-testid="abilities">
        {h.abilities.map((st, i) => {
          const def = st.def;
          const charges = abilityParam(st, 'charges');
          const cdTotal = Math.max(0.5, abilityParam(st, 'cooldown') * h.stats.cooldownMul);
          const remaining = Math.max(0, st.cooldownEnd - t);
          const onCd = charges > 1 ? st.charges <= 0 : remaining > 0;
          const casting = h.cast && h.cast.slot === i + 1;
          const can = canUpgradeAbility(h, i + 1).ok;
          return (
            <div key={def.id} className={`ab ${def.ultimate ? 'ult' : ''} ${st.level === 0 ? 'locked' : ''} ${casting ? 'casting' : ''}`} title={`${def.name}: ${def.description}`} style={{ color: def.color }}>
              <span className="key">{keyLabel(keys[i])}</span>
              {def.icon}
              {onCd && st.level > 0 && (
                <>
                  <div className="cd" style={{ transform: `scaleY(${Math.min(1, remaining / cdTotal)})` }} />
                  <div className="cdtext" style={{ color: '#fff' }}>
                    {Math.ceil(charges > 1 ? Math.max(0, st.nextCharge - t) : remaining)}
                  </div>
                </>
              )}
              {charges > 1 && st.level > 0 && <span className="charges">{st.charges}</span>}
              <div className="pips">
                {[1, 2, 3].map((k) => (
                  <i key={k} className={st.level - 1 >= k ? 'on' : ''} />
                ))}
              </div>
              {can && session.local === h && <div className="up" />}
            </div>
          );
        })}
      </div>
    </>
  );
}

function WeaponPanel({ hero: h, session, settings }: { hero: Hero; session: GameSession; settings: Settings }) {
  const w = h.weapon;
  const t = session.sim.time;
  const actives = session.sim.items.actives(h);
  const itemKeys = [settings.bindings.item1, settings.bindings.item2, settings.bindings.item3, settings.bindings.item4];
  const free = t < h.freeAmmoUntil;
  return (
    <div className="weapon-panel" data-testid="weapon">
      <div className="item-bar">
        {h.items.map((it) => {
          const ai = actives.indexOf(it);
          const cd = Math.max(0, it.cooldownEnd - t);
          return (
            <div key={it.def.id} className={`item-slot ${it.def.category}`} title={`${it.def.name}: ${it.def.description}`}>
              {ai >= 0 && ai < 4 && <span className="k">{keyLabel(itemKeys[ai])}</span>}
              {it.def.icon}
              {cd > 0 && <div className="icd">{Math.ceil(cd)}</div>}
            </div>
          );
        })}
      </div>
      <div className="souls" data-testid="souls">
        ◈ {formatSouls(h.souls)}
      </div>
      <div className="ammo">
        {free ? '∞' : w.ammo}
        <small> / {w.magazine}</small>
      </div>
      <div className="wname">{w.def.name.replace(/\s*\(.*\)$/, '')}</div>
      {w.reloading && <div className="reload">RELOADING {Math.max(0, w.reloadEnd - t).toFixed(1)}s</div>}
    </div>
  );
}
