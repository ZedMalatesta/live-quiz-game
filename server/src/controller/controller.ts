import type { WebSocket } from 'ws';
import type {
  RegData,
  CreateGameData,
  User,
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

  getDatabase(): GameDatabase {
    return this.db;
  }
}
