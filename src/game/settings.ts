import type { Difficulty } from '../core/simulation';
import { QUALITY_PRESETS, type QualitySettings } from '../rendering/renderer';

export type BindAction =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'dash'
  | 'crouch'
  | 'reload'
  | 'melee'
  | 'parry'
  | 'interact'
  | 'ability1'
  | 'ability2'
  | 'ability3'
  | 'ability4'
  | 'item1'
  | 'item2'
  | 'item3'
  | 'item4'
  | 'shop'
  | 'scoreboard'
  | 'ping'
  | 'commands'
  | 'upgradeModifier'
  | 'debug';

export const BIND_LABELS: Record<BindAction, string> = {
  forward: 'Move forward',
  back: 'Move back',
  left: 'Strafe left',
  right: 'Strafe right',
  jump: 'Jump / double jump',
  dash: 'Dash',
  crouch: 'Crouch / slide',
  reload: 'Reload',
  melee: 'Melee (hold for heavy)',
  parry: 'Parry',
  interact: 'Zipline / interact',
  ability1: 'Ability 1',
  ability2: 'Ability 2',
  ability3: 'Ability 3',
  ability4: 'Ultimate',
  item1: 'Item active 1',
  item2: 'Item active 2',
  item3: 'Item active 3',
  item4: 'Item active 4',
  shop: 'Shop',
  scoreboard: 'Scoreboard (hold)',
  ping: 'Contextual ping',
  commands: 'Team commands',
  upgradeModifier: 'Upgrade ability (hold + 1-4)',
  debug: 'Developer overlay',
};

export const DEFAULT_BINDINGS: Record<BindAction, string> = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  dash: 'ShiftLeft',
  crouch: 'ControlLeft',
  reload: 'KeyR',
  melee: 'KeyQ',
  parry: 'KeyF',
  interact: 'KeyE',
  ability1: 'Digit1',
  ability2: 'Digit2',
  ability3: 'Digit3',
  ability4: 'Digit4',
  item1: 'KeyZ',
  item2: 'KeyX',
  item3: 'KeyC',
  item4: 'KeyV',
  shop: 'KeyB',
  scoreboard: 'Tab',
  ping: 'KeyG',
  commands: 'KeyT',
  upgradeModifier: 'AltLeft',
  debug: 'F3',
};

export interface Settings {
  sensitivity: number;
  invertY: boolean;
  fov: number;
  quality: QualitySettings;
  volume: { master: number; music: number; sfx: number; ui: number; voice: number };
  bindings: Record<BindAction, string>;
  hudScale: number;
  damageNumbers: boolean;
  showFps: boolean;
  colorblind: boolean;
  reduceShake: boolean;
  autoLevelAbilities: boolean;
  lastHero: string;
  difficulty: Difficulty;
  teamSize: number;
}

export function defaultSettings(): Settings {
  return {
    sensitivity: 1.0,
    invertY: false,
    fov: 80,
    quality: { ...QUALITY_PRESETS.medium },
    volume: { master: 0.8, music: 0.4, sfx: 0.8, ui: 0.7, voice: 0.7 },
    bindings: { ...DEFAULT_BINDINGS },
    hudScale: 1,
    damageNumbers: true,
    showFps: false,
    colorblind: false,
    reduceShake: false,
    autoLevelAbilities: false,
    lastHero: 'rook',
    difficulty: 'normal',
    teamSize: 6,
  };
}

const KEY = 'hexline.settings.v1';

export function loadSettings(): Settings {
  const d = defaultSettings();
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (!raw) return d;
    const s = JSON.parse(raw) as Partial<Settings>;
    return {
      ...d,
      ...s,
      quality: { ...d.quality, ...(s.quality ?? {}) },
      volume: { ...d.volume, ...(s.volume ?? {}) },
      bindings: { ...d.bindings, ...(s.bindings ?? {}) },
    };
  } catch {
    return d;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage unavailable (private mode): settings still apply for this session.
  }
}

export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    Space: 'Space',
    ShiftLeft: 'L-Shift',
    ShiftRight: 'R-Shift',
    ControlLeft: 'L-Ctrl',
    ControlRight: 'R-Ctrl',
    AltLeft: 'L-Alt',
    AltRight: 'R-Alt',
    Tab: 'Tab',
    Mouse0: 'LMB',
    Mouse1: 'MMB',
    Mouse2: 'RMB',
    Mouse3: 'Mouse4',
    Mouse4: 'Mouse5',
    Backquote: '`',
  };
  return map[code] ?? code;
}
