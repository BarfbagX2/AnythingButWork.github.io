import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { BotManager } from '../src/ai/botManager';
import type { SimEvent } from '../src/core/events';
import { emptyInput, sanitizeAction, sanitizeInput, type InputCommand, type PlayerAction } from '../src/core/input';
import { Simulation, type Difficulty, type MatchConfig } from '../src/core/simulation';
import { buildMatchConfig } from '../src/game/matchSetup';
import type { Hero } from '../src/gameplay/entities';
import { DEFAULT_PORT, PROTOCOL_VERSION, decodeMessage, encodeMessage, type ClientMessage, type ServerMessage } from '../src/network/protocol';
import { encodeSnapshot, filterEvents, type Snapshot } from '../src/network/snapshot';
import type { TeamId } from '../src/world/mapTypes';

export interface MatchServerOptions {
  port?: number;
  host?: string;
  seed?: number;
  teamSize?: number;
  difficulty?: Difficulty;
  /** Snapshots per second sent to each client. */
  snapshotRate?: number;
  /** Seconds after a match ends before the next one starts. */
  restartDelay?: number;
  /** Hold each match at its first tick until this many players have joined. */
  waitForPlayers?: number;
  /** Serve this directory over HTTP on the same port (e.g. the Vite build). */
  staticDir?: string;
  /** Override the generated match config (tests). */
  config?: Partial<MatchConfig>;
  log?: (msg: string) => void;
}

interface Client {
  ws: WebSocket;
  name: string;
  /** Requested team/hero, kept across match restarts. */
  wantTeam?: TeamId;
  wantHero?: string;
  spectate: boolean;
  hero: Hero | null;
  queue: { seq: number; cmd: InputCommand }[];
  last: InputCommand;
  ack: number;
  actions: PlayerAction[];
  joined: boolean;
}

const MAX_QUEUE = 8;
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/**
 * Authoritative match host: runs the same `Simulation` + `BotManager` as the
 * single-player client at 60 Hz. Every hero starts as a bot; a connecting
 * player takes over a bot hero and hands it back to the AI on disconnect.
 */
export class MatchServer {
  sim!: Simulation;
  bots!: BotManager;
  matchId = 0;
  readonly clients = new Set<Client>();
  private wss: WebSocketServer | null = null;
  private http: http.Server | null = null;
  private timer: NodeJS.Timeout | null = null;
  private last = 0;
  private acc = 0;
  private sinceSnapshot = 0;
  private pending: SimEvent[] = [];
  private endedAt = -1;
  private lastLobbySnapshot = 0;
  private seed: number;
  private readonly opts: Required<Omit<MatchServerOptions, 'staticDir' | 'config' | 'host'>> & Pick<MatchServerOptions, 'staticDir' | 'config' | 'host'>;

  constructor(opts: MatchServerOptions = {}) {
    // Explicitly-undefined options (e.g. an omitted CLI flag) keep their defaults.
    const given = Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)) as MatchServerOptions;
    this.opts = {
      port: DEFAULT_PORT,
      seed: Math.floor(Math.random() * 100000),
      teamSize: 6,
      difficulty: 'normal',
      snapshotRate: 20,
      restartDelay: 15,
      waitForPlayers: 0,
      log: (m) => console.log(m),
      ...given,
    };
    this.seed = this.opts.seed;
    this.newMatch();
  }

  get port(): number {
    const a = this.http?.address();
    return a && typeof a === 'object' ? a.port : this.opts.port;
  }

  /** Starts listening. Resolves with the bound port (use port 0 for any free port). */
  start(): Promise<number> {
    this.http = http.createServer((req, res) => this.serveStatic(req, res));
    this.wss = new WebSocketServer({ server: this.http, maxPayload: 64 * 1024, perMessageDeflate: { threshold: 1024 } });
    this.wss.on('connection', (ws) => this.onConnection(ws));
    return new Promise((resolve) => {
      this.http!.listen(this.opts.port, this.opts.host, () => {
        this.last = performance.now();
        this.timer = setInterval(() => this.loop(), 4);
        this.opts.log(`HEXLINE match server listening on port ${this.port} (match ${this.matchId}, seed ${this.seed})`);
        if (this.opts.waitForPlayers > 0) this.opts.log(`waiting for ${this.opts.waitForPlayers} player(s) before starting`);
        resolve(this.port);
      });
    });
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const c of this.clients) c.ws.terminate();
    this.clients.clear();
    await new Promise<void>((r) => (this.wss ? this.wss.close(() => r()) : r()));
    await new Promise<void>((r) => (this.http ? this.http.close(() => r()) : r()));
  }

  // --- Match lifecycle ----------------------------------------------------------

  private newMatch(): void {
    this.matchId++;
    const config: Partial<MatchConfig> = this.opts.config ?? buildMatchConfig({
      mode: 'spectate',
      heroId: 'rook',
      playerName: '',
      team: 0,
      teamSize: this.opts.teamSize,
      allyDifficulty: this.opts.difficulty,
      enemyDifficulty: this.opts.difficulty,
      lane: -1,
      seed: this.seed,
    }).config;
    this.sim = new Simulation(config);
    this.bots = new BotManager(this.sim);
    this.sim.controllers.push((s) => this.bots.update(s));
    this.pending = [];
    this.endedAt = -1;
    this.sinceSnapshot = 0;
    for (const c of this.clients) {
      c.hero = null;
      c.queue = [];
      c.actions = [];
      c.ack = 0;
      if (c.joined) this.join(c);
    }
  }

  /** True while the match is held before its first tick, waiting for players. */
  get waiting(): boolean {
    const humans = [...this.clients].filter((c) => c.hero).length;
    return this.sim.tick === 0 && humans < this.opts.waitForPlayers;
  }

  private loop(): void {
    const now = performance.now();
    if (this.waiting) {
      // Lobby: the world is frozen, but joined clients still get snapshots.
      this.last = now;
      this.acc = 0;
      if (now - this.lastLobbySnapshot > 200) {
        this.lastLobbySnapshot = now;
        this.broadcast();
      }
      return;
    }
    this.acc += Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    const dt = this.sim.dt;
    let ticks = 0;
    while (this.acc >= dt && ticks < 8) {
      this.tick();
      this.acc -= dt;
      ticks++;
    }
    if (ticks === 8) this.acc = 0;
  }

  /** Advances the match by one fixed step (public for deterministic tests). */
  tick(): void {
    for (const c of this.clients) this.applyClientInput(c);
    this.sim.step();
    for (const e of this.sim.events.drain()) this.pending.push(e);
    if (this.sim.phase === 'ended' && this.endedAt < 0) {
      this.endedAt = this.sim.time;
      this.opts.log(`match ${this.matchId} ended: winner team ${this.sim.winner}; next match in ${this.opts.restartDelay}s`);
    }
    this.sinceSnapshot++;
    if (this.sinceSnapshot >= Math.max(1, Math.round(this.sim.tickRate / this.opts.snapshotRate))) {
      this.sinceSnapshot = 0;
      this.broadcast();
    }
    if (this.endedAt >= 0 && this.sim.time - this.endedAt >= this.opts.restartDelay) {
      this.seed = (this.seed * 31 + 7) % 100000;
      this.newMatch();
    }
  }

  private applyClientInput(c: Client): void {
    const h = c.hero;
    if (!h) return;
    let next = c.queue.shift();
    if (c.queue.length > 3) {
      // Falling behind (burst after a network hiccup): skip ahead, keeping taps.
      let buttons = next ? next.cmd.buttons : 0;
      for (const q of c.queue) buttons |= q.cmd.buttons;
      next = c.queue[c.queue.length - 1];
      next = { seq: next.seq, cmd: { ...next.cmd, buttons } };
      c.queue = [];
    }
    if (next) {
      c.last = next.cmd;
      c.ack = next.seq;
    }
    h.input = c.last;
    if (c.actions.length) {
      h.actions.push(...c.actions);
      c.actions = [];
    }
  }

  private broadcast(): void {
    const events = this.pending;
    this.pending = [];
    const base = new Map<TeamId | -1, Snapshot>();
    for (const c of this.clients) {
      if (!c.joined || c.ws.readyState !== c.ws.OPEN) continue;
      const team: TeamId | -1 = c.hero ? (c.hero.team as TeamId) : -1;
      let snap = base.get(team);
      if (!snap) {
        snap = encodeSnapshot(this.sim, team, []);
        base.set(team, snap);
      }
      const s: Snapshot = { ...snap, events: filterEvents(this.sim, events, team, c.hero ? c.hero.id : -1) };
      this.send(c, { t: 'snapshot', matchId: this.matchId, s, ack: c.ack });
    }
  }

  // --- Clients ------------------------------------------------------------------

  private onConnection(ws: WebSocket): void {
    const c: Client = { ws, name: 'Player', spectate: false, hero: null, queue: [], last: emptyInput(), ack: 0, actions: [], joined: false };
    this.clients.add(c);
    ws.on('message', (data) => this.onMessage(c, data));
    ws.on('close', () => this.leave(c));
    ws.on('error', () => this.leave(c));
  }

  private onMessage(c: Client, data: unknown): void {
    const m = decodeMessage<ClientMessage>(Buffer.isBuffer(data) ? data.toString('utf8') : data);
    if (!m) return;
    switch (m.t) {
      case 'hello': {
        if (m.version !== PROTOCOL_VERSION) {
          this.send(c, { t: 'error', reason: `protocol version ${m.version} != server ${PROTOCOL_VERSION}` });
          c.ws.close();
          return;
        }
        if (c.joined) return;
        c.name = String(m.name ?? 'Player').replace(/[^\p{L}\p{N} _.-]/gu, '').slice(0, 20) || 'Player';
        c.wantTeam = m.team === 0 || m.team === 1 ? m.team : undefined;
        c.wantHero = typeof m.heroId === 'string' ? m.heroId : undefined;
        c.spectate = !!m.spectate;
        c.joined = true;
        this.join(c);
        break;
      }
      case 'input': {
        if (!c.hero || !m.cmd || typeof m.cmd !== 'object') return;
        const seq = typeof m.seq === 'number' && Number.isFinite(m.seq) ? m.seq : c.ack + 1;
        c.queue.push({ seq, cmd: sanitizeInput(m.cmd) });
        if (c.queue.length > MAX_QUEUE) c.queue.splice(0, c.queue.length - MAX_QUEUE);
        break;
      }
      case 'action': {
        const a = sanitizeAction(m.action);
        if (c.hero && a && c.actions.length < 16) c.actions.push(a);
        break;
      }
      case 'ping':
        if (typeof m.clientTime === 'number') this.send(c, { t: 'pong', clientTime: m.clientTime, serverTime: this.sim.time });
        break;
    }
  }

  /** Assigns the client a bot-controlled hero (or spectator) and sends the welcome. */
  private join(c: Client): void {
    if (!c.spectate) {
      const taken = new Set([...this.clients].map((x) => x.hero?.id).filter((id) => id !== undefined));
      const free = this.sim.heroes.filter((h) => h.isBot && !taken.has(h.id));
      const humans = (t: number) => [...this.clients].filter((x) => x.hero && x.hero.team === t).length;
      const balanced: TeamId = humans(0) <= humans(1) ? 0 : 1;
      const team = c.wantTeam ?? balanced;
      const onTeam = free.filter((h) => h.team === team);
      const pool = onTeam.length ? onTeam : free;
      const pick = pool.find((h) => h.def.id === c.wantHero) ?? pool[0] ?? null;
      if (pick) {
        this.bots.detach(pick.id);
        pick.isBot = false;
        pick.playerName = c.name;
        pick.input = emptyInput();
        c.hero = pick;
        c.last = emptyInput();
        this.opts.log(`${c.name} joined as ${pick.def.name} (team ${pick.team})`);
      } else this.opts.log(`${c.name} joined as a spectator (no free heroes)`);
    }
    this.send(c, {
      t: 'welcome',
      version: PROTOCOL_VERSION,
      matchId: this.matchId,
      config: this.sim.config,
      heroIds: this.sim.heroes.map((h) => h.id),
      heroUnitId: c.hero ? c.hero.id : -1,
      team: c.hero ? (c.hero.team as TeamId) : -1,
      tickRate: this.sim.tickRate,
      snapshotRate: this.opts.snapshotRate,
    });
  }

  private leave(c: Client): void {
    if (!this.clients.delete(c)) return;
    const h = c.hero;
    if (h) {
      const i = this.sim.heroes.indexOf(h);
      h.playerName = this.sim.config.slots[i]?.name ?? h.playerName;
      h.input = emptyInput();
      this.bots.attach(this.sim, h.id);
      this.opts.log(`${c.name} left; ${h.def.name} is back under AI control`);
    }
  }

  private send(c: Client, m: ServerMessage): void {
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(encodeMessage(m));
  }

  // --- Static files ---------------------------------------------------------------

  private serveStatic(req: http.IncomingMessage, res: http.ServerResponse): void {
    const root = this.opts.staticDir ? path.resolve(this.opts.staticDir) : null;
    if (!root || req.method !== 'GET' || !fs.existsSync(root)) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('HEXLINE match server. Connect with the game client.');
      return;
    }
    let rel = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(root, '.' + rel);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }
}
