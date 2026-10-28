/**
 * Ally / enemy colours for health bars and nameplates. The default green vs.
 * red pair is the classic colour-vision problem, so the colour-blind setting
 * swaps it for blue vs. orange (distinguishable with protanopia,
 * deuteranopia and tritanopia).
 */
const NORMAL = { ally: '#7fe08a', enemy: '#ff5a5a', allyBar: '#5cff7a', enemyBar: '#ff4a4a' };
const COLORBLIND = { ally: '#5cc8ff', enemy: '#ffa63d', allyBar: '#4ab8ff', enemyBar: '#ff9a2e' };

let current = NORMAL;

export function setColorblind(on: boolean): void {
  current = on ? COLORBLIND : NORMAL;
}

/** Nameplate colour for a unit seen by `viewerTeam`. */
export function relationColor(team: number, viewerTeam: number): string {
  return team === viewerTeam ? current.ally : current.enemy;
}

/** Health-bar fill colour (slightly more saturated than nameplates). */
export function relationBarColor(team: number, viewerTeam: number): string {
  return team === viewerTeam ? current.allyBar : current.enemyBar;
}
