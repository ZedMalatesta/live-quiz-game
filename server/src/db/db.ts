import { createHash, randomBytes } from 'crypto';
import type { User, Game, Question } from '../types/types.js';

export class GameDatabase {
  private users: User[] = [];
  private games: Game[] = [];
  private userIndex: number = 1;


  getUserByName(name: string): User | undefined {
    return this.users.find((u) => u.name === name);
  }

  getUserByIndex(index: string): User | undefined {
    return this.users.find((u) => u.index === index);
  }

  getAllUsers(): User[] {
    return this.users;
  }

  createUser(name: string, password: string): User {
    const user: User = {
      name,
      password: this.hashPassword(password),
      index: String(this.userIndex++),
    };
    this.users.push(user);
    return user;
  }

  private generateCode(): string {
    return randomBytes(3).toString('hex').toUpperCase();
  }

  createGame(hostId: string, questions: Question[]): Game {
    const game: Game = {
      id: randomBytes(8).toString('hex'),
      code: this.generateCode(),
      hostId,
      questions,
      players: [],
      currentQuestion: -1,
      status: 'waiting',
      playerAnswers: new Map(),
    };
    this.games.push(game);
    return game;
  }

  getGameByCode(code: string): Game | undefined {
    return this.games.find((g) => g.code === code.toUpperCase());
  }

  getGameById(id: string): Game | undefined {
    return this.games.find((g) => g.id === id);
  }

  getGameByHostId(hostId: string): Game | undefined {
    return this.games.find((g) => g.hostId === hostId);
  }

  getAllGames(): Game[] {
    return this.games;
  }

  removeGame(id: string): void {
    const idx = this.games.findIndex((g) => g.id === id);
    if (idx > -1) this.games.splice(idx, 1);
  }

  private hashPassword(password: string): string {
    return createHash('sha256').update(password).digest('hex');
  }

  verifyPassword(hashedPassword: string, plainPassword: string): boolean {
    return hashedPassword === this.hashPassword(plainPassword);
  }
}
