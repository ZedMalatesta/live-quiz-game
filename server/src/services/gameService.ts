import type { WebSocket } from 'ws';
import type { CreateGameData, JoinGameData, User, Player } from '../types/types.js';
import { GameDatabase } from '../db/db.js';

export interface CreateGameResponse {
  gameId: string;
  code: string;
}

export interface JoinGameResponse {
  gameId: string;
  playerName: string;
  playerCount: number;
  playersList: Array<{ name: string; index: string; score: number }>;
}

export class GameService {
  constructor(private db: GameDatabase) {}

  validateCreateGameData(data: CreateGameData): string | null {
    const { questions } = data;
    if (!Array.isArray(questions) || questions.length === 0) {
      return 'At least one question is required.';
    }

    for (const q of questions) {
      if (
        typeof q.text !== 'string' ||
        !Array.isArray(q.options) ||
        q.options.length !== 4 ||
        typeof q.correctIndex !== 'number' ||
        typeof q.timeLimitSec !== 'number'
      ) {
        return 'Invalid question format.';
      }
    }

    return null;
  }

  createGame(user: User, data: CreateGameData): CreateGameResponse {
    const game = this.db.createGame(user.index, data.questions);
    console.log(`Game created — code: ${game.code}, host: ${user.name}, questions: ${data.questions.length}`);
    return { gameId: game.id, code: game.code };
  }

  joinGame(user: User, code: string): { game: any; player: Player } {
    const game = this.db.getGameByCode(code);
    if (!game) {
      throw new Error('Game not found.');
    }

    const player: Player = {
      name: user.name,
      index: user.index,
      score: 0,
      ws: user.ws,
    };

    game.players.push(player);
    console.log(`Player joined — name: ${user.name}, game: ${game.code}, total players: ${game.players.length}`);

    return { game, player };
  }

  getPlayersList(gameId: string): Array<{ name: string; index: string; score: number }> {
    const game = this.db.getGameById(gameId);
    if (!game) return [];
    return game.players.map((p) => ({ name: p.name, index: p.index, score: p.score }));
  }
}
