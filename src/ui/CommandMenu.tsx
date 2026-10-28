import { useEffect } from 'react';
import type { PingKind } from '../core/input';

const OPTIONS: { kind: PingKind; label: string; hint: string }[] = [
  { kind: 'group', label: 'Group up', hint: 'Nearby bots gather at your crosshair' },
  { kind: 'attack', label: 'Attack here', hint: 'Bots push toward the target location' },
  { kind: 'defend', label: 'Defend here', hint: 'Bots hold and protect this location' },
  { kind: 'focus', label: 'Focus target', hint: 'Team focuses the enemy under your crosshair' },
  { kind: 'push', label: 'Push this lane', hint: 'Bots escort troopers into enemy structures' },
  { kind: 'retreat', label: 'Fall back', hint: 'Everyone retreats toward base' },
];

/** Team command menu (T). Commands become pings bots can accept or decline. */
export function CommandMenu({ onPick, onClose }: { onPick: (k: PingKind) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= OPTIONS.length) {
        e.preventDefault();
        e.stopPropagation();
        onPick(OPTIONS[n - 1].kind);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onPick]);
  return (
    <div className="overlay" style={{ background: 'transparent' }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel commands" data-testid="commands">
        <div className="display" style={{ color: 'var(--brass-2)', textAlign: 'center' }}>
          TEAM COMMANDS
        </div>
        {OPTIONS.map((o, i) => (
          <button key={o.kind} className="btn" onClick={() => onPick(o.kind)} title={o.hint} style={{ textAlign: 'left' }}>
            <span className="kbd">{i + 1}</span> {o.label}
          </button>
        ))}
        <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>Commands target the point under your crosshair. G sends a contextual ping.</div>
      </div>
    </div>
  );
}
