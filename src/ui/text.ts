import type { AbilityDef } from '../gameplay/types';

/** Ability description with {param} placeholders filled for an upgrade level. */
export function describeAbility(a: AbilityDef, level: number, spiritPower = 0): string {
  const val = (name: string): number => {
    let v = a.params[name] ?? 0;
    for (let i = 0; i < level - 1 && i < 3; i++) v += a.upgrades[i].mods[name] ?? 0;
    const scale = a.params[`${name}Scale`];
    if (scale) {
      let s = scale;
      for (let i = 0; i < level - 1 && i < 3; i++) s += a.upgrades[i].mods[`${name}Scale`] ?? 0;
      v += s * spiritPower;
    }
    return v;
  };
  return a.description.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = val(k);
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  });
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatSouls(n: number): string {
  return n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n));
}
