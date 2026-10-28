/**
 * Input contract shared by the local player, bots, and network clients.
 * Every hero is driven exclusively through this structure, which is what
 * guarantees that bots obey the same rules as human players and lets a
 * server validate client input instead of trusting client state.
 */

export const BTN = {
  FIRE: 1 << 0,
  ZOOM: 1 << 1,
  JUMP: 1 << 2,
  DASH: 1 << 3,
  CROUCH: 1 << 4,
  RELOAD: 1 << 5,
  MELEE: 1 << 6,
  PARRY: 1 << 7,
  A1: 1 << 8,
  A2: 1 << 9,
  A3: 1 << 10,
  A4: 1 << 11,
  I1: 1 << 12,
  I2: 1 << 13,
  I3: 1 << 14,
  I4: 1 << 15,
  INTERACT: 1 << 16,
} as const;

export const ABILITY_BTNS = [BTN.A1, BTN.A2, BTN.A3, BTN.A4] as const;
export const ITEM_BTNS = [BTN.I1, BTN.I2, BTN.I3, BTN.I4] as const;

export interface InputCommand {
  /** Desired movement in world space (x, z), magnitude <= 1. */
  moveX: number;
  moveZ: number;
  /** Aim direction from the hero's eye. */
  yaw: number;
  pitch: number;
  buttons: number;
}

export type PingKind = 'attack' | 'defend' | 'group' | 'retreat' | 'focus' | 'push' | 'danger';

export type PlayerAction =
  | { type: 'buy'; itemId: string }
  | { type: 'sell'; itemId: string }
  | { type: 'upgradeAbility'; slot: 1 | 2 | 3 | 4 }
  | { type: 'ping'; kind: PingKind; x: number; z: number; targetId?: number; lane?: number };

export function emptyInput(): InputCommand {
  return { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0 };
}

export function sanitizeInput(cmd: InputCommand): InputCommand {
  const finite = (v: number) => (Number.isFinite(v) ? v : 0);
  let mx = finite(cmd.moveX);
  let mz = finite(cmd.moveZ);
  const l = Math.hypot(mx, mz);
  if (l > 1) {
    mx /= l;
    mz /= l;
  }
  return {
    moveX: mx,
    moveZ: mz,
    yaw: finite(cmd.yaw),
    pitch: Math.max(-1.5, Math.min(1.5, finite(cmd.pitch))),
    buttons: (cmd.buttons | 0) & 0x1ffff,
  };
}
