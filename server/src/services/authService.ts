import type { WebSocket } from 'ws';
import type { RegData, User } from '../types/types.js';
import { GameDatabase } from '../db/db.js';

export interface RegResponse {
  name: string;
  index: string;
  error: boolean;
  errorText: string;
}

export class AuthService {
  constructor(private db: GameDatabase, private wsToUser: WeakMap<WebSocket, User>) {}

  handleReg(ws: WebSocket, data: RegData): RegResponse {
    const { name, password } = data;
    const existing = this.db.getUserByName(name);

    if (existing) {
      if (!this.db.verifyPassword(existing.password, password)) {
        return { name: '', index: '', error: true, errorText: 'Wrong password' };
      }
      existing.ws = ws;
      this.wsToUser.set(ws, existing);
      return { name: existing.name, index: existing.index, error: false, errorText: '' };
    } else {
      const user = this.db.createUser(name, password);
      user.ws = ws;
      this.wsToUser.set(ws, user);
      console.log(`User registered: ${user.name}`);
      return { name: user.name, index: user.index, error: false, errorText: '' };
    }
  }

  getUserByWs(ws: WebSocket): User | undefined {
    return this.wsToUser.get(ws);
  }

  handleDisconnect(ws: WebSocket, userToGame: Map<string, string>): void {
    const user = this.wsToUser.get(ws);
    if (user) {
      user.ws = undefined;
      this.wsToUser.delete(ws);

      const gameId = userToGame.get(user.index);
      if (gameId) {
        const game = this.db.getGameById(gameId);
        if (game) {
          const playerIndex = game.players.findIndex((p) => p.index === user.index);
          if (playerIndex > -1) {
            game.players.splice(playerIndex, 1);

          }
        }
        userToGame.delete(user.index);
      }
    }
  }
}
