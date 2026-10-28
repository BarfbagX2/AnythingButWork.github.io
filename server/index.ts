// HEXLINE authoritative match server.
//
//   npm run server -- [--port 8787] [--host 0.0.0.0] [--seed 42] [--team-size 6]
//                     [--difficulty easy|normal|hard|expert] [--static dist]
//                     [--wait-for <players>]   hold the match until N players join
//
// Players join from the game's main menu ("Online") with ws://<host>:<port>.
// Empty hero slots are played by bots; joining players take them over.
import fs from 'node:fs';
import type { Difficulty } from '../src/core/simulation';
import { DEFAULT_PORT } from '../src/network/protocol';
import { MatchServer } from './matchServer';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const difficulty = (arg('difficulty') ?? 'normal') as Difficulty;
if (!['easy', 'normal', 'hard', 'expert'].includes(difficulty)) {
  console.error(`Unknown difficulty ${difficulty}`);
  process.exit(2);
}
const staticDir = arg('static') ?? (fs.existsSync('dist/index.html') ? 'dist' : undefined);
const server = new MatchServer({
  port: Number(arg('port') ?? process.env.PORT ?? DEFAULT_PORT),
  host: arg('host'),
  seed: arg('seed') !== undefined ? Number(arg('seed')) : undefined,
  teamSize: Number(arg('team-size') ?? 6),
  difficulty,
  staticDir,
  waitForPlayers: Number(arg('wait-for') ?? 0),
});
await server.start();
if (staticDir) console.log(`Serving the game client from ./${staticDir} at http://localhost:${server.port}/`);

const shutdown = () => {
  server.stop().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
