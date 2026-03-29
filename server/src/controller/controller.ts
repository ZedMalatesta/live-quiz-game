import type { WebSocket } from 'ws';
import type {
  RegData,
  CreateGameData,
  JoinGameData,
  StartGameData,
  User,
  Player,
} from '../types/types.js';
import { GameDatabase } from '../db/db.js';

export interface ControllerResponse {
  type: 'user' | 'game' | 'broadcast' | 'error';
  recipient: 'ws' | 'all_in_game' | 'host';
  targetWs?: WebSocket;
  gameId?: string;
  targetUser?: User;
  messageType: string;
  data: unknown;
}

export class GameController {
  private db: GameDatabase;
  private wsToUser: WeakMap<WebSocket, User>;
  private userToGame: Map<string, string> = new Map();

  constructor(database: GameDatabase) {
    this.db = database;
    this.wsToUser = new WeakMap<WebSocket, User>();
  }
  handleReg(ws: WebSocket, data: RegData): ControllerResponse {
    const { name, password } = data;
    const existing = this.db.getUserByName(name);

    if (existing) {
      if (!this.db.verifyPassword(existing.password, password)) {
        return {
          type: 'user',
          recipient: 'ws',
          targetWs: ws,
          messageType: 'reg',
          data: { name: '', index: '', error: true, errorText: 'Wrong password' },
        };
      }
      existing.ws = ws;
      this.wsToUser.set(ws, existing);
      console.log(`Re-login: ${existing.name}`);
      return {
        type: 'user',
        recipient: 'ws',
        targetWs: ws,
        messageType: 'reg',
        data: { name: existing.name, index: existing.index, error: false, errorText: '' },
      };
    } else {
      const user = this.db.createUser(name, password);
      user.ws = ws;
      this.wsToUser.set(ws, user);
      console.log(`Registered: ${user.name} (index: ${user.index})`);
      return {
        type: 'user',
        recipient: 'ws',
        targetWs: ws,
        messageType: 'reg',
        data: { name: user.name, index: user.index, error: false, errorText: '' },
      };
    }
  }

  getUserByWs(ws: WebSocket): User | undefined {
    return this.wsToUser.get(ws);
  }
  handleDisconnect(ws: WebSocket): void {
    const user = this.wsToUser.get(ws);
    if (user) {
      console.log(`Disconnected: ${user.name}`);
      user.ws = undefined;
      this.wsToUser.delete(ws);

      const gameId = this.userToGame.get(user.index);
      if (gameId) {
        const game = this.db.getGameById(gameId);
        if (game) {
          const playerIndex = game.players.findIndex((p) => p.index === user.index);
          if (playerIndex > -1) {
            game.players.splice(playerIndex, 1);
            console.log(`Player removed from game: ${user.name}`);
          }
        }
        this.userToGame.delete(user.index);
      }
    }
  }

  handleCreateGame(ws: WebSocket, data: CreateGameData): ControllerResponse | null {
    const user = this.getUserByWs(ws);
    if (!user) {
      return {
        type: 'error',
        recipient: 'ws',
        targetWs: ws,
        messageType: 'error',
        data: { message: 'Not authenticated. Please register first.' },
      };
    }

    const { questions } = data;
    if (!Array.isArray(questions) || questions.length === 0) {
      return {
        type: 'error',
        recipient: 'ws',
        targetWs: ws,
        messageType: 'error',
        data: { message: 'At least one question is required.' },
      };
    }

    for (const q of questions) {
      if (
        typeof q.text !== 'string' ||
        !Array.isArray(q.options) ||
        q.options.length !== 4 ||
        typeof q.correctIndex !== 'number' ||
        typeof q.timeLimitSec !== 'number'
      ) {
        return {
          type: 'error',
          recipient: 'ws',
          targetWs: ws,
          messageType: 'error',
          data: { message: 'Invalid question format.' },
        };
      }
    }

    const game = this.db.createGame(user.index, questions);
    console.log(`Game created — code: ${game.code}, host: ${user.name}, questions: ${questions.length}`);
    return {
      type: 'game',
      recipient: 'ws',
      targetWs: ws,
      messageType: 'game_created',
      data: { gameId: game.id, code: game.code },
    };
  }

  handleJoinGame(ws: WebSocket, data: JoinGameData): ControllerResponse[] {
    const user = this.getUserByWs(ws);
    if (!user) {
      return [
        {
          type: 'error',
          recipient: 'ws',
          targetWs: ws,
          messageType: 'error',
          data: { message: 'Not authenticated. Please register first.' },
        },
      ];
    }

    const { code } = data;
    if (!code || typeof code !== 'string') {
      return [
        {
          type: 'error',
          recipient: 'ws',
          targetWs: ws,
          messageType: 'error',
          data: { message: 'Invalid game code.' },
        },
      ];
    }

    const game = this.db.getGameByCode(code);
    if (!game) {
      return [
        {
          type: 'error',
          recipient: 'ws',
          targetWs: ws,
          messageType: 'error',
          data: { message: 'Game not found.' },
        },
      ];
    }

    const player: Player = {
      name: user.name,
      index: user.index,
      score: 0,
      ws: user.ws,
    };

    game.players.push(player);
    this.userToGame.set(user.index, game.id);
    console.log(`Player joined — name: ${user.name}, game: ${game.code}, total players: ${game.players.length}`);

    const responses: ControllerResponse[] = [
      {
        type: 'game',
        recipient: 'ws',
        targetWs: ws,
        messageType: 'game_joined',
        data: { gameId: game.id },
      },
      {
        type: 'broadcast',
        recipient: 'all_in_game',
        gameId: game.id,
        messageType: 'player_joined',
        data: { playerName: player.name, playerCount: game.players.length },
      },
      {
        type: 'broadcast',
        recipient: 'all_in_game',
        gameId: game.id,
        messageType: 'update_players',
        data: game.players.map((p) => ({
          name: p.name,
          index: p.index,
          score: p.score,
        })),
      },
    ];

    return responses;
  }

  handleStartGame(ws: WebSocket, data: StartGameData): ControllerResponse {
    const user = this.getUserByWs(ws);
    if (!user) {
      return {
        type: 'error',
        recipient: 'ws',
        targetWs: ws,
        messageType: 'error',
        data: { message: 'Not authenticated.' },
      };
    }

    const { gameId } = data;
    const game = this.db.getGameById(gameId);

    if (!game) {
      return {
        type: 'error',
        recipient: 'ws',
        targetWs: ws,
        messageType: 'error',
        data: { message: 'Game not found.' },
      };
    }

    if (game.hostId !== user.index) {
      return {
        type: 'error',
        recipient: 'ws',
        targetWs: ws,
        messageType: 'error',
        data: { message: 'Only host can start the game.' },
      };
    }

    if (game.status !== 'waiting') {
      return {
        type: 'error',
        recipient: 'ws',
        targetWs: ws,
        messageType: 'error',
        data: { message: 'Game has already started.' },
      };
    }

    game.status = 'in_progress';
    game.currentQuestion = 0;
    game.questionStartTime = Date.now();

    const question = game.questions[0];
    console.log(`Game started — id: ${game.id}, total players: ${game.players.length}`);

    return {
      type: 'broadcast',
      recipient: 'all_in_game',
      gameId: game.id,
      messageType: 'question',
      data: {
        questionNumber: 1,
        totalQuestions: game.questions.length,
        text: question.text,
        options: question.options,
        timeLimitSec: question.timeLimitSec,
      },
    };
  }

  getDatabase(): GameDatabase {
    return this.db;
  }
}
