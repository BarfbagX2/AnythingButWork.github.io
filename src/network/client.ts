import type { InputCommand, PlayerAction } from '../core/input';
import type { TeamId } from '../world/mapTypes';
import { PROTOCOL_VERSION, decodeMessage, encodeMessage, type ClientMessage, type ServerMessage } from './protocol';
import type { Snapshot } from './snapshot';

export type Welcome = Extract<ServerMessage, { t: 'welcome' }>;

export interface JoinOptions {
  name: string;
  team?: TeamId;
  heroId?: string;
  spectate?: boolean;
}

/**
 * Client side of the match protocol over a standard WebSocket (browser, or
 * Node 22+ which ships one). Owns no game state: `GameSession` applies the
 * snapshots it receives to a mirror simulation.
 */
export class NetClient {
  onWelcome: (w: Welcome) => void = () => {};
  onSnapshot: (s: Snapshot, matchId: number, ack: number) => void = () => {};
  onClose: (reason: string) => void = () => {};
  welcome: Welcome | null = null;
  /** Smoothed round-trip time in milliseconds. */
  rtt = 0;
  bytesIn = 0;
  snapshotsIn = 0;
  private ws: WebSocket | null = null;
  private seq = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  /** Connects and joins; resolves with the first welcome. */
  connect(url: string, join: JoinOptions, timeoutMs = 8000): Promise<Welcome> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (reason: string) => {
        if (settled) return;
        settled = true;
        reject(new Error(reason));
      };
      const timer = setTimeout(() => {
        fail(`Timed out connecting to ${url}`);
        this.close();
      }, timeoutMs);
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        clearTimeout(timer);
        fail(e instanceof Error ? e.message : String(e));
        return;
      }
      this.ws = ws;
      ws.onopen = () => {
        this.send({ t: 'hello', version: PROTOCOL_VERSION, name: join.name, team: join.team, heroId: join.heroId, spectate: join.spectate });
        this.pingTimer = setInterval(() => this.send({ t: 'ping', clientTime: performance.now() }), 1000);
      };
      ws.onerror = () => {
        clearTimeout(timer);
        fail(`Could not connect to ${url}`);
      };
      ws.onclose = (e) => {
        clearTimeout(timer);
        if (this.pingTimer) clearInterval(this.pingTimer);
        fail(`Connection closed${e.reason ? `: ${e.reason}` : ''}`);
        if (!this.closed) this.onClose(e.reason || 'Disconnected from server');
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') this.bytesIn += ev.data.length;
        const m = decodeMessage<ServerMessage>(ev.data);
        if (!m) return;
        switch (m.t) {
          case 'welcome':
            this.welcome = m;
            this.seq = 0;
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              resolve(m);
            }
            this.onWelcome(m);
            break;
          case 'snapshot':
            this.snapshotsIn++;
            this.onSnapshot(m.s, m.matchId, m.ack);
            break;
          case 'pong': {
            const sample = performance.now() - m.clientTime;
            this.rtt = this.rtt ? this.rtt * 0.8 + sample * 0.2 : sample;
            break;
          }
          case 'error':
            fail(m.reason);
            this.onClose(m.reason);
            break;
        }
      };
    });
  }

  sendInput(cmd: InputCommand): void {
    this.send({ t: 'input', seq: ++this.seq, cmd });
  }

  sendAction(action: PlayerAction): void {
    this.send({ t: 'action', action });
  }

  get connected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  close(): void {
    this.closed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
  }

  private send(m: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(encodeMessage(m));
  }
}
