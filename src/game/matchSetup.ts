import { PERSONALITY_IDS } from '../../data/ai';
import { HERO_LIST } from '../../data/heroes';
import type { Difficulty, HeroSlot, MatchConfig } from '../core/simulation';
import { Rng } from '../core/rng';
import type { LaneId, TeamId } from '../world/mapTypes';

export type GameMode = 'standard' | 'practice' | 'spectate';

export interface SetupChoices {
  mode: GameMode;
  heroId: string;
  playerName: string;
  team: TeamId;
  teamSize: number;
  allyDifficulty: Difficulty;
  enemyDifficulty: Difficulty;
  lane: LaneId | -1;
  seed: number;
}

const BOT_NAMES = ['Ash', 'Bishop', 'Crow', 'Dusk', 'Ember', 'Fable', 'Grim', 'Hollis', 'Iris', 'Jinx', 'Kade', 'Lark', 'Moth', 'Nox', 'Onyx', 'Pike', 'Quill', 'Rue', 'Sable', 'Thorn', 'Vale', 'Wren'];

/**
 * Builds a match configuration from menu choices: the player's hero plus bot
 * teammates and opponents with distinct heroes per team and varied personalities.
 */
export function buildMatchConfig(c: SetupChoices): { config: Partial<MatchConfig>; localSlot: number } {
  const rng = new Rng(c.seed);
  const slots: HeroSlot[] = [];
  const names = rng.shuffle([...BOT_NAMES]);
  let localSlot = -1;
  for (const team of [0, 1] as TeamId[]) {
    const pool = rng.shuffle(HERO_LIST.map((h) => h.id));
    const isPlayerTeam = c.mode !== 'spectate' && team === c.team;
    if (isPlayerTeam) {
      pool.splice(pool.indexOf(c.heroId), 1);
      pool.unshift(c.heroId);
    }
    for (let i = 0; i < c.teamSize; i++) {
      const heroId = pool[i % pool.length];
      const human = isPlayerTeam && i === 0;
      const diff = team === c.team ? c.allyDifficulty : c.enemyDifficulty;
      if (human) localSlot = slots.length;
      slots.push({
        team,
        heroId,
        name: human ? c.playerName || 'You' : `${names.pop() ?? 'Bot'}`,
        isBot: !human,
        difficulty: c.mode === 'spectate' ? (team === 0 ? c.allyDifficulty : c.enemyDifficulty) : diff,
        personality: rng.chance(0.5) ? undefined : rng.pick(PERSONALITY_IDS),
        lane: human && c.lane >= 0 ? (c.lane as LaneId) : undefined,
      });
    }
  }
  const practice = c.mode === 'practice';
  return {
    config: {
      seed: c.seed,
      slots,
      waves: true,
      neutrals: true,
      boss: !practice,
      structures: true,
      pregame: practice ? 3 : 12,
      startingSouls: practice ? 20000 : undefined,
      mode: practice ? 'practice' : 'standard',
      difficulty: c.enemyDifficulty,
    },
    localSlot,
  };
}
