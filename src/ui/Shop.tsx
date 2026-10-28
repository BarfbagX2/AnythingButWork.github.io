import { useState } from 'react';
import { BALANCE } from '../../data/balance';
import { ITEMS, ITEM_MAP } from '../../data/items';
import { canUpgradeAbility } from '../gameplay/abilities';
import { STAT_LABELS, type ItemCategory, type ItemDef, type StatKey } from '../gameplay/types';
import type { GameSession } from '../game/session';
import { describeAbility, formatSouls } from './text';
import { useTicker } from './useTicker';

const CATS: { id: ItemCategory; name: string }[] = [
  { id: 'weapon', name: 'Weapon' },
  { id: 'vitality', name: 'Vitality' },
  { id: 'spirit', name: 'Spirit' },
];

function statLines(it: ItemDef): string[] {
  return Object.entries(it.mods).map(([k, v]) => `${(v as number) > 0 ? '+' : ''}${v} ${STAT_LABELS[k as StatKey] ?? k}`);
}

export function Shop({ session, onClose }: { session: GameSession; onClose: () => void }) {
  useTicker(8);
  const h = session.local!;
  const sim = session.sim;
  const [sel, setSel] = useState<ItemDef>(ITEMS[0]);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'items' | 'abilities'>('items');
  const owned = new Set(h.items.map((i) => i.def.id));
  const usage = sim.items.slotUsage(h);
  const filter = (it: ItemDef) => !q || it.name.toLowerCase().includes(q.toLowerCase()) || it.description.toLowerCase().includes(q.toLowerCase());
  const chk = sim.items.check(h, sel.id);
  const buy = (id: string) => {
    session.queueAction({ type: 'buy', itemId: id });
  };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel shop" data-testid="shop">
        <div className="shop-head">
          <span className="title">Curiosity Shop</span>
          <div className="seg" style={{ width: 220 }}>
            <button className={tab === 'items' ? 'on' : ''} onClick={() => setTab('items')}>
              Items
            </button>
            <button className={tab === 'abilities' ? 'on' : ''} onClick={() => setTab('abilities')}>
              Abilities {h.abilityPoints > 0 ? `(${h.abilityPoints})` : ''}
            </button>
          </div>
          <input type="text" placeholder="Search items…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} />
          <span style={{ marginLeft: 'auto', color: 'var(--souls)', fontWeight: 800, fontSize: 18 }}>◈ {formatSouls(h.souls)}</span>
          {!h.inShopRange && h.alive && <span style={{ color: 'var(--danger)', fontSize: 12 }}>Not at a shop — browse only</span>}
          <button className="btn small" onClick={onClose}>
            Close (B)
          </button>
        </div>
        {tab === 'items' ? (
          <div className="shop-body">
            <div className="shop-cols">
              {CATS.map((cat) => (
                <div key={cat.id} className={`shop-col ${cat.id}`}>
                  <h4>
                    {cat.name} <span style={{ color: 'var(--text-faint)' }}>({usage[cat.id]}/{BALANCE.items.slotsPerCategory})</span>
                  </h4>
                  {[1, 2, 3, 4].map((tier) => {
                    const list = ITEMS.filter((it) => it.category === cat.id && it.tier === tier && filter(it));
                    if (!list.length) return null;
                    return (
                      <div key={tier}>
                        <div className="tier-label">
                          TIER {tier} · {BALANCE.items.tierCost[tier - 1]}
                        </div>
                        {list.map((it) => {
                          const c = sim.items.check(h, it.id);
                          return (
                            <div
                              key={it.id}
                              data-testid={`item-${it.id}`}
                              className={`shop-item ${sel.id === it.id ? 'sel' : ''} ${owned.has(it.id) ? 'owned' : ''} ${!c.ok && !owned.has(it.id) ? 'cant' : ''}`}
                              onClick={() => setSel(it)}
                              onDoubleClick={() => buy(it.id)}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                buy(it.id);
                              }}
                            >
                              <span className="ic">{it.icon}</span>
                              <span>
                                {it.name}
                                {it.component && <span style={{ color: 'var(--text-faint)' }}> ⇐ {ITEM_MAP[it.component].name}</span>}
                              </span>
                              <span className="cost">{owned.has(it.id) ? '✓' : c.cost}</span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="shop-side">
              <div style={{ fontSize: 32 }}>{sel.icon}</div>
              <h3>{sel.name}</h3>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                {sel.category} · tier {sel.tier} {sel.active ? '· active' : ''}
              </div>
              <div className="desc">{sel.description}</div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                {statLines(sel).map((l) => (
                  <div key={l}>{l}</div>
                ))}
              </div>
              {sel.component && (
                <div style={{ fontSize: 12 }}>
                  Upgrades from <b>{ITEM_MAP[sel.component].name}</b> (its cost is credited)
                </div>
              )}
              <div style={{ color: 'var(--souls)', fontWeight: 800 }}>Cost: {chk.cost}</div>
              {!chk.ok && <div className="reason">{chk.reason}</div>}
              <button className="btn primary" disabled={!chk.ok} onClick={() => buy(sel.id)} data-testid="buy">
                Buy
              </button>
              {owned.has(sel.id) && (
                <button className="btn" onClick={() => session.queueAction({ type: 'sell', itemId: sel.id })}>
                  Sell for {Math.round(sel.cost * BALANCE.economy.sellRefund)}
                </button>
              )}
              <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>Tip: double-click or right-click an item to buy it.</div>
              <div style={{ marginTop: 8, fontSize: 12, letterSpacing: '0.1em', color: 'var(--text-dim)' }}>
                OWNED · flex slots {usage.flexUsed}/{usage.flexMax}
              </div>
              <div className="owned-list">
                {h.items.map((it) => (
                  <div key={it.def.id} className={`item-slot ${it.def.category}`} title={it.def.name} onClick={() => setSel(it.def)} style={{ cursor: 'pointer' }}>
                    {it.def.icon}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ padding: 16, display: 'grid', gap: 10, overflow: 'auto' }}>
            <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>
              Ability points: <b style={{ color: 'var(--souls)' }}>{h.abilityPoints}</b>. Unlock costs 1; upgrades cost {BALANCE.abilityUpgradeCost.join(' / ')}. Ultimate unlocks at level {BALANCE.ultimateMinLevel}.
            </div>
            {h.abilities.map((st, i) => {
              const c = canUpgradeAbility(h, i + 1);
              return (
                <div key={st.def.id} className="ab-upgrade">
                  <div className="ability-icon" style={{ color: st.def.color }}>
                    {st.def.icon}
                  </div>
                  <div>
                    <b>
                      {st.def.name} {st.level === 0 ? '(locked)' : st.level > 1 ? `· tier ${st.level - 1}` : ''}
                    </b>
                    <div style={{ color: 'var(--text-dim)' }}>{describeAbility(st.def, Math.max(1, st.level), h.stats.spiritPower)}</div>
                    <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                      {st.def.upgrades.map((u, k) => (
                        <span key={k} style={{ color: st.level - 1 > k ? 'var(--souls)' : 'var(--text-faint)', fontSize: 11 }}>
                          T{k + 1}: {u.text}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button className="btn small" disabled={!c.ok} title={c.reason} onClick={() => session.queueAction({ type: 'upgradeAbility', slot: (i + 1) as 1 | 2 | 3 | 4 })}>
                    {st.level === 0 ? 'Unlock' : st.level >= 4 ? 'Max' : `Upgrade (${c.cost})`}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
