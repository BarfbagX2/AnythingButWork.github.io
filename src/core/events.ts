import type { Vec3 } from './math';
import type { DamageType } from '../gameplay/types';

/**
 * Events emitted by the simulation each tick. Presentation layers (renderer,
 * audio, HUD, kill feed) and the network layer consume them; gameplay never
 * depends on whether anyone listens.
 */
export type SimEvent =
  | { t: 'shot'; unit: number; from: Vec3; dir: Vec3; style: string; pellets: number }
  | { t: 'damage'; src: number; target: number; amount: number; type: DamageType; crit: boolean; pos: Vec3; shielded: number }
  | { t: 'heal'; target: number; amount: number; src: number }
  | { t: 'impact'; pos: Vec3; normal: Vec3; kind: 'world' | 'unit' | 'shield'; color?: string }
  | { t: 'death'; unit: number; kind: string; killer: number; pos: Vec3 }
  | { t: 'heroKill'; killer: number; victim: number; assists: number[]; bounty: number }
  | { t: 'cast'; unit: number; ability: string; slot: number; pos: Vec3; dir: Vec3 }
  | { t: 'vfx'; kind: string; pos: Vec3; radius: number; color: string; duration: number; dir?: Vec3; to?: Vec3; unit?: number }
  | { t: 'souls'; hero: number; amount: number; pos: Vec3; source: 'trooper' | 'hero' | 'structure' | 'neutral' | 'orb' | 'passive' | 'boss' | 'urn' }
  | { t: 'orbSpawn'; orb: number; pos: Vec3 }
  | { t: 'orbTaken'; orb: number; hero: number; denied: boolean }
  | { t: 'structure'; id: number; key: string; state: 'vulnerable' | 'destroyed' | 'phase2' }
  | { t: 'announce'; text: string; team: number; kind: 'objective' | 'kill' | 'info' | 'boss' | 'warning'; unit?: number }
  | { t: 'respawn'; unit: number }
  | { t: 'level'; unit: number; level: number }
  | { t: 'buy'; unit: number; item: string; sold?: boolean }
  | { t: 'match'; state: string; winner?: number }
  | { t: 'move'; unit: number; kind: 'jump' | 'doubleJump' | 'dash' | 'land' | 'slide' | 'mantle' }
  | { t: 'reload'; unit: number; done: boolean }
  | { t: 'melee'; unit: number; heavy: boolean; hit: boolean }
  | { t: 'parry'; unit: number; success: boolean; attacker?: number }
  | { t: 'zip'; unit: number; on: boolean }
  | { t: 'ping'; team: number; kind: string; pos: Vec3; from: number; targetId?: number }
  | { t: 'botSay'; unit: number; text: string; team: number }
  | { t: 'status'; unit: number; id: string; on: boolean };

export class EventQueue {
  events: SimEvent[] = [];

  push(e: SimEvent): void {
    this.events.push(e);
  }

  drain(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }
}
