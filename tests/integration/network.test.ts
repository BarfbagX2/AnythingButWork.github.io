import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MatchServer } from '../../server/matchServer';
import { Simulation } from '../../src/core/simulation';
import { buildMatchConfig } from '../../src/game/matchSetup';
import type { Hero } from '../../src/gameplay/entities';
import { NetClient, type Welcome } from '../../src/network/client';
import { PROTOCOL_VERSION } from '../../src/network/protocol';
import { applySnapshot, type Snapshot } from '../../src/network/snapshot';

// Real server, real sockets, real time: two clients join a 2v2 bot match.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 5000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await sleep(20);
  }
  return fn();
}

interface Player {
  net: NetClient;
  welcome: Welcome;
  mirror: Simulation;
  last: Snapshot | null;
}

let server: MatchServer;
let url = '';

async function join(name: string, team: 0 | 1): Promise<Player> {
  const net = new NetClient();
  const p = { net, last: null } as unknown as Player;
  net.onSnapshot = (s) => {
    p.last = s;
    applySnapshot(p.mirror, s, p.welcome?.heroUnitId ?? -1);
  };
  const welcome = await net.connect(url, { name, team });
  p.welcome = welcome;
  p.mirror = new Simulation(welcome.config);
  return p;
}

beforeAll(async () => {
  const { config } = buildMatchConfig({
    mode: 'spectate',
    heroId: 'rook',
    playerName: '',
    team: 0,
    teamSize: 2,
    allyDifficulty: 'normal',
    enemyDifficulty: 'normal',
    lane: -1,
    seed: 11,
  });
  server = new MatchServer({ port: 0, host: '127.0.0.1', config: { ...config, pregame: 1 }, log: () => {} });
  const port = await server.start();
  url = `ws://127.0.0.1:${port}`;
});

afterAll(async () => {
  await server.stop();
});

describe('match server options', () => {
  it('keeps defaults for options passed as undefined (omitted CLI flags)', () => {
    const s = new MatchServer({ port: 0, seed: undefined, teamSize: 1, log: () => {} });
    expect(Number.isFinite(s.sim.config.seed)).toBe(true);
    expect(s.sim.heroes.length).toBe(2);
  });
});

describe('network: authoritative server + snapshot client', () => {
  let alice: Player;
  let bob: Player;

  it('takes over a bot hero on join and mirrors the server ids', async () => {
    alice = await join('Alice', 0);
    bob = await join('Bob', 1);
    for (const p of [alice, bob]) {
      expect(p.welcome.version).toBe(PROTOCOL_VERSION);
      expect(p.welcome.heroUnitId).toBeGreaterThan(0);
      expect(p.mirror.heroes.map((h) => h.id)).toEqual(p.welcome.heroIds);
    }
    expect(alice.welcome.team).toBe(0);
    expect(bob.welcome.team).toBe(1);
    const a = server.sim.units.get(alice.welcome.heroUnitId) as Hero;
    expect(a.isBot).toBe(false);
    expect(a.playerName).toBe('Alice');
    expect(server.bots.brains.has(a.id)).toBe(false);
    expect(await until(() => !!alice.last && !!bob.last)).toBe(true);
    // The mirror learns the human's name from snapshots.
    expect((alice.mirror.units.get(a.id) as Hero).playerName).toBe('Alice');
  });

  it('applies client input on the server and replicates the result', async () => {
    const id = alice.welcome.heroUnitId;
    const hero = server.sim.units.get(id) as Hero;
    expect(await until(() => server.sim.phase === 'playing', 4000)).toBe(true);
    const start = { ...hero.pos };
    // Walk toward the map centre (team 0's base is at negative z).
    const timer = setInterval(() => alice.net.sendInput({ moveX: 0, moveZ: 1, yaw: 0, pitch: 0, buttons: 0 }), 1000 / 60);
    await sleep(1200);
    clearInterval(timer);
    for (let i = 0; i < 5; i++) alice.net.sendInput({ moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0 });
    const moved = Math.hypot(hero.pos.x - start.x, hero.pos.z - start.z);
    expect(moved).toBeGreaterThan(3);
    // Once the hero stops, the client's mirror converges on the server state.
    await sleep(700);
    const m = alice.mirror.units.get(id)!;
    expect(Math.hypot(m.pos.x - hero.pos.x, m.pos.z - hero.pos.z)).toBeLessThan(0.1);
    expect(alice.mirror.time).toBeGreaterThan(0);
  });

  it('withholds hidden enemy heroes but sends allies', async () => {
    const snap = alice.last!;
    const hidden = server.sim.heroes.filter((h) => h.team === 1 && h.alive && !h.visibleTo[0]);
    expect(hidden.length).toBeGreaterThan(0);
    for (const h of hidden) expect(snap.heroes.find((x) => x.id === h.id)?.live).toBeUndefined();
    for (const h of server.sim.heroes.filter((x) => x.team === 0)) expect(snap.heroes.find((x) => x.id === h.id)?.live).toBeDefined();
  });

  it('validates actions: applies legal ones, ignores malformed ones', async () => {
    const hero = server.sim.units.get(alice.welcome.heroUnitId) as Hero;
    expect(hero.abilities[0].level).toBe(0);
    alice.net.sendAction({ type: 'upgradeAbility', slot: 1 });
    alice.net.sendAction({ type: 'upgradeAbility', slot: 9 } as never);
    alice.net.sendAction({ type: 'teleport', x: 0 } as never);
    expect(await until(() => hero.abilities[0].level === 1)).toBe(true);
    expect(await until(() => (alice.mirror.units.get(hero.id) as Hero).abilities[0].level === 1)).toBe(true);
    expect(server.clients.size).toBe(2);
  });

  it('rejects a client speaking another protocol version', async () => {
    const ws = new WebSocket(url);
    const reply = await new Promise<string>((resolve) => {
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', version: PROTOCOL_VERSION + 99, name: 'Old' }));
      ws.onmessage = (e) => resolve(String(e.data));
    });
    expect(JSON.parse(reply).t).toBe('error');
  });

  it('hands the hero back to the AI when the player leaves', async () => {
    const id = bob.welcome.heroUnitId;
    bob.net.close();
    expect(await until(() => server.bots.brains.has(id))).toBe(true);
    const h = server.sim.units.get(id) as Hero;
    expect(h.isBot).toBe(true);
    expect(h.playerName).not.toBe('Bob');
    alice.net.close();
  });
});
