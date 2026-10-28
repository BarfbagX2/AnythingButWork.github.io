import { useEffect, useState } from 'react';
import { QUALITY_PRESETS, type QualitySettings } from '../rendering/renderer';
import { BIND_LABELS, DEFAULT_BINDINGS, defaultSettings, keyLabel, type BindAction, type Settings } from '../game/settings';

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
  onClose: () => void;
  standalone?: boolean;
}

type Tab = 'gameplay' | 'graphics' | 'audio' | 'controls' | 'accessibility';

function Row({ label, children, value }: { label: string; children: React.ReactNode; value?: string }) {
  return (
    <div className="row">
      <span>{label}</span>
      <span>{children}</span>
      <span style={{ color: 'var(--text-dim)', textAlign: 'right' }}>{value}</span>
    </div>
  );
}

export function SettingsPanel({ settings, onChange, onClose, standalone }: Props) {
  const [tab, setTab] = useState<Tab>('gameplay');
  const [binding, setBinding] = useState<BindAction | null>(null);
  const s = settings;
  const set = (patch: Partial<Settings>) => onChange({ ...s, ...patch });
  const setQ = (patch: Partial<QualitySettings>) => onChange({ ...s, quality: { ...s.quality, ...patch, preset: 'custom' } });

  useEffect(() => {
    if (!binding) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== 'Escape') onChange({ ...s, bindings: { ...s.bindings, [binding]: e.code } });
      setBinding(null);
    };
    const onMouse = (e: MouseEvent) => {
      if (e.button < 3) return;
      onChange({ ...s, bindings: { ...s.bindings, [binding]: `Mouse${e.button}` } });
      setBinding(null);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
    };
  }, [binding, onChange, s]);

  const body = (
    <div className="panel settings" data-testid="settings">
      <h2>SETTINGS</h2>
      <div className="tabs">
        {(['gameplay', 'graphics', 'audio', 'controls', 'accessibility'] as Tab[]).map((t) => (
          <button key={t} className={`btn small ${tab === t ? 'primary' : ''}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
        <button className="btn small ghost" style={{ marginLeft: 'auto' }} onClick={() => onChange(defaultSettings())}>
          Reset all
        </button>
      </div>
      {tab === 'gameplay' && (
        <>
          <Row label="Mouse sensitivity" value={s.sensitivity.toFixed(2)}>
            <input type="range" min={0.1} max={4} step={0.05} value={s.sensitivity} onChange={(e) => set({ sensitivity: Number(e.target.value) })} />
          </Row>
          <Row label="Invert Y axis">
            <input type="checkbox" checked={s.invertY} onChange={(e) => set({ invertY: e.target.checked })} />
          </Row>
          <Row label="Field of view" value={`${s.fov}°`}>
            <input type="range" min={60} max={110} step={1} value={s.fov} onChange={(e) => set({ fov: Number(e.target.value) })} />
          </Row>
          <Row label="Damage numbers">
            <input type="checkbox" checked={s.damageNumbers} onChange={(e) => set({ damageNumbers: e.target.checked })} />
          </Row>
          <Row label="Show FPS counter">
            <input type="checkbox" checked={s.showFps} onChange={(e) => set({ showFps: e.target.checked })} />
          </Row>
          <Row label="HUD scale" value={`${Math.round(s.hudScale * 100)}%`}>
            <input type="range" min={0.75} max={1.4} step={0.05} value={s.hudScale} onChange={(e) => set({ hudScale: Number(e.target.value) })} />
          </Row>
        </>
      )}
      {tab === 'graphics' && (
        <>
          <Row label="Quality preset" value={s.quality.preset}>
            <div className="seg">
              {(['low', 'medium', 'high'] as const).map((p) => (
                <button key={p} className={s.quality.preset === p ? 'on' : ''} onClick={() => set({ quality: { ...QUALITY_PRESETS[p] } })}>
                  {p}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Resolution scale" value={`${Math.round(s.quality.resolutionScale * 100)}%`}>
            <input type="range" min={0.4} max={1} step={0.05} value={s.quality.resolutionScale} onChange={(e) => setQ({ resolutionScale: Number(e.target.value) })} />
          </Row>
          <Row label="Shadows" value={s.quality.shadows}>
            <div className="seg">
              {(['off', 'low', 'high'] as const).map((p) => (
                <button key={p} className={s.quality.shadows === p ? 'on' : ''} onClick={() => setQ({ shadows: p })}>
                  {p}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Effects density" value={`${Math.round(s.quality.effects * 100)}%`}>
            <input type="range" min={0.2} max={1} step={0.05} value={s.quality.effects} onChange={(e) => setQ({ effects: Number(e.target.value) })} />
          </Row>
          <Row label="View distance" value={`${s.quality.viewDistance} m`}>
            <input type="range" min={120} max={500} step={10} value={s.quality.viewDistance} onChange={(e) => setQ({ viewDistance: Number(e.target.value) })} />
          </Row>
          <Row label="Post-processing (bloom)">
            <input type="checkbox" checked={s.quality.postprocessing} onChange={(e) => setQ({ postprocessing: e.target.checked })} />
          </Row>
          <Row label="Frame-rate limit" value={s.quality.fpsCap >= 240 ? 'none' : `${s.quality.fpsCap}`}>
            <input type="range" min={30} max={240} step={10} value={s.quality.fpsCap} onChange={(e) => setQ({ fpsCap: Number(e.target.value) })} />
          </Row>
        </>
      )}
      {tab === 'audio' && (
        <>
          {(['master', 'music', 'sfx', 'ui', 'voice'] as const).map((k) => (
            <Row key={k} label={`${k === 'sfx' ? 'Effects' : k === 'ui' ? 'Interface' : k[0].toUpperCase() + k.slice(1)} volume`} value={`${Math.round(s.volume[k] * 100)}%`}>
              <input type="range" min={0} max={1} step={0.05} value={s.volume[k]} onChange={(e) => set({ volume: { ...s.volume, [k]: Number(e.target.value) } })} />
            </Row>
          ))}
        </>
      )}
      {tab === 'controls' && (
        <>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>Click a binding, then press a key (Esc cancels). Mouse side buttons are supported.</div>
          {(Object.keys(DEFAULT_BINDINGS) as BindAction[]).map((a) => (
            <div className="bind" key={a}>
              <span>{BIND_LABELS[a]}</span>
              <button className="btn small" onClick={() => setBinding(a)}>
                {binding === a ? 'press a key…' : keyLabel(s.bindings[a])}
              </button>
            </div>
          ))}
        </>
      )}
      {tab === 'accessibility' && (
        <>
          <Row label="Colour-blind friendly team colours">
            <input type="checkbox" checked={s.colorblind} onChange={(e) => set({ colorblind: e.target.checked })} />
          </Row>
          <Row label="Reduce camera shake">
            <input type="checkbox" checked={s.reduceShake} onChange={(e) => set({ reduceShake: e.target.checked })} />
          </Row>
          <Row label="Auto-spend ability points">
            <input type="checkbox" checked={s.autoLevelAbilities} onChange={(e) => set({ autoLevelAbilities: e.target.checked })} />
          </Row>
        </>
      )}
      <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn primary" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
  if (standalone) return <div className="screen" style={{ alignItems: 'center', justifyContent: 'center' }}>{body}</div>;
  return <div className="overlay">{body}</div>;
}
