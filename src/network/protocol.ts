import type { InputCommand, PlayerAction } from '../core/input';
import type { MatchConfig } from '../core/simulation';
import type { TeamId } from '../world/mapTypes';
import type { Snapshot } from './snapshot';

/**
 * Wire protocol between the authoritative match server (`server/`) and
 * clients. Messages are JSON text frames (the server enables per-message
 * deflate). The server owns the simulation; clients only ever send inputs and
 * discrete actions for the hero they control, exactly the same contract bots
 * use (`InputCommand` + `PlayerAction`).
 */
export const PROTOCOL_VERSION = 1;
export const DEFAULT_PORT = 8787;

export type ClientMessage =
  | { t: 'hello'; version: number; name: string; team?: TeamId; heroId?: string; spectate?: boolean }
  /** One command per client tick; `seq` increases by one per command. */
  | { t: 'input'; seq: number; cmd: InputCommand }
  | { t: 'action'; action: PlayerAction }
  | { t: 'ping'; clientTime: number };

export type ServerMessage =
  | {
      t: 'welcome';
      version: number;
      matchId: number;
      /** The client rebuilds an identical (non-stepping) simulation from this. */
      config: MatchConfig;
      /** Hero ids in slot order, so the client can verify its mirror. */
      heroIds: number[];
      /** Unit id of the hero this client controls, or -1 for spectators. */
      heroUnitId: number;
      team: TeamId | -1;
      tickRate: number;
      snapshotRate: number;
    }
  | { t: 'snapshot'; matchId: number; s: Snapshot; /** Last input seq applied for this client. */ ack: number }
  | { t: 'pong'; clientTime: number; serverTime: number }
  | { t: 'error'; reason: string };

export function encodeMessage(m: ClientMessage | ServerMessage): string {
  return JSON.stringify(m);
}

export function decodeMessage<T extends ClientMessage | ServerMessage>(data: unknown): T | null {
  try {
    const text = typeof data === 'string' ? data : new TextDecoder().decode(data as ArrayBuffer);
    const m = JSON.parse(text);
    return m && typeof m === 'object' && typeof m.t === 'string' ? (m as T) : null;
  } catch {
    return null;
  }
}
