import type { Difficulty } from '../src/core/simulation';

/**
 * Difficulty changes how well bots perceive, aim and decide — never their
 * health or damage. Every bot obeys the same rules as the player.
 */
export interface DifficultyProfile {
  /** Seconds before reacting to a newly seen target. */
  reaction: number;
  /** Aim error expressed in metres at the target (scaled by target speed). */
  aimError: number;
  /** Maximum aim turn rate, rad/s. */
  turnRate: number;
  /** 0..1 how accurately target velocity is used for leading shots. */
  prediction: number;
  /** Seconds between strategic re-evaluations. */
  decisionInterval: number;
  /** Random noise added to utility scores (worse decisions). */
  decisionNoise: number;
  /** Probability of following team calls / focus targets. */
  coordination: number;
  /** Probability per check of using a ready ability when conditions are met. */
  abilityTiming: number;
  /** 0..1 skill at timing last hits and securing orbs. */
  lastHit: number;
  /** 0..1 dodge / strafe quality. */
  dodge: number;
  /** HP fraction offset applied to retreat thresholds (higher = retreats earlier, smarter). */
  retreatSense: number;
  /** Perception update interval (s). */
  perceptionInterval: number;
  /** Visual field of view for spotting enemies (degrees). */
  fov: number;
  /** How far ahead the bot thinks about structure danger (0..1). */
  towerSense: number;
  /** Fraction of optimal purchases (lower = sloppier builds). */
  shopping: number;
  /** Uses movement tech (dash-jumps, slides) in fights. */
  movementTech: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultyProfile> = {
  easy: { reaction: 0.6, aimError: 0.85, turnRate: 3.2, prediction: 0.25, decisionInterval: 1.5, decisionNoise: 0.28, coordination: 0.3, abilityTiming: 0.35, lastHit: 0.25, dodge: 0.15, retreatSense: -0.05, perceptionInterval: 0.3, fov: 110, towerSense: 0.35, shopping: 0.6, movementTech: 0.05 },
  normal: { reaction: 0.38, aimError: 0.55, turnRate: 6, prediction: 0.6, decisionInterval: 1.0, decisionNoise: 0.14, coordination: 0.6, abilityTiming: 0.6, lastHit: 0.55, dodge: 0.4, retreatSense: 0.05, perceptionInterval: 0.18, fov: 140, towerSense: 0.7, shopping: 0.85, movementTech: 0.3 },
  hard: { reaction: 0.26, aimError: 0.36, turnRate: 10, prediction: 0.85, decisionInterval: 0.75, decisionNoise: 0.07, coordination: 0.85, abilityTiming: 0.82, lastHit: 0.8, dodge: 0.65, retreatSense: 0.1, perceptionInterval: 0.12, fov: 160, towerSense: 0.9, shopping: 0.95, movementTech: 0.6 },
  expert: { reaction: 0.18, aimError: 0.24, turnRate: 16, prediction: 1.0, decisionInterval: 0.5, decisionNoise: 0.025, coordination: 1.0, abilityTiming: 0.95, lastHit: 0.95, dodge: 0.85, retreatSense: 0.14, perceptionInterval: 0.08, fov: 180, towerSense: 1.0, shopping: 1.0, movementTech: 0.85 },
};

/**
 * Personalities bias the utility weights of the shared decision system;
 * they do not replace it.
 */
export interface Personality {
  id: string;
  name: string;
  farm: number;
  push: number;
  defend: number;
  gank: number;
  fight: number;
  objective: number;
  support: number;
  jungle: number;
  /** Base HP fraction at which the bot wants to retreat. */
  retreatHp: number;
  /** 0..1 appetite for risky engagements. */
  risk: number;
  /** How long it stays committed to a goal (hysteresis bonus). */
  commitment: number;
}

export const PERSONALITIES: Record<string, Personality> = {
  aggressive: { id: 'aggressive', name: 'Aggressive', farm: 0.8, push: 1.0, defend: 0.8, gank: 1.35, fight: 1.35, objective: 0.9, support: 0.7, jungle: 0.6, retreatHp: 0.22, risk: 0.8, commitment: 0.18 },
  defensive: { id: 'defensive', name: 'Defensive', farm: 0.95, push: 0.75, defend: 1.45, gank: 0.6, fight: 0.9, objective: 1.0, support: 1.0, jungle: 0.8, retreatHp: 0.42, risk: 0.3, commitment: 0.2 },
  farmer: { id: 'farmer', name: 'Farmer', farm: 1.4, push: 0.85, defend: 0.9, gank: 0.6, fight: 0.75, objective: 0.8, support: 0.6, jungle: 1.4, retreatHp: 0.35, risk: 0.4, commitment: 0.25 },
  roamer: { id: 'roamer', name: 'Roamer', farm: 0.7, push: 0.9, defend: 0.9, gank: 1.5, fight: 1.2, objective: 0.9, support: 0.8, jungle: 1.0, retreatHp: 0.3, risk: 0.65, commitment: 0.12 },
  supportive: { id: 'supportive', name: 'Supportive', farm: 0.75, push: 0.9, defend: 1.1, gank: 0.8, fight: 1.15, objective: 1.0, support: 1.6, jungle: 0.5, retreatHp: 0.35, risk: 0.45, commitment: 0.2 },
  objective: { id: 'objective', name: 'Objective-focused', farm: 0.85, push: 1.4, defend: 1.15, gank: 0.8, fight: 1.0, objective: 1.5, support: 0.85, jungle: 0.7, retreatHp: 0.32, risk: 0.55, commitment: 0.25 },
};

export const PERSONALITY_IDS = Object.keys(PERSONALITIES);
