import type { WebSocket } from 'ws';
import type {
  RegData,
  CreateGameData,
  JoinGameData,
  StartGameData,
  AnswerData,
  User,
} from '../types/types.js';
import { GameDatabase } from '../db/db.js';
import { AuthService } from '../services/authService.js';
import { GameService } from '../services/gameService.js';
import { GameplayService, type BroadcastFn } from '../services/gameplayService.js';

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
  private authService: AuthService;
  private gameService: GameService;
  private gameplayService: GameplayService;

  constructor(database: GameDatabase) {
    this.db = database;
    this.wsToUser = new WeakMap<WebSocket, User>();
    this.authService = new AuthService(database, this.wsToUser);
    this.gameService = new GameService(database);
    this.gameplayService = new GameplayService(database);
  }

  setBroadcastFunction(fn: BroadcastFn): void {
    this.gameplayService.setBroadcastFunction(fn);
  }
  handleReg(ws: WebSocket, data: RegData): ControllerResponse {
    const regResponse = this.authService.handleReg(ws, data);

    return {
      type: 'user',
      recipient: 'ws',
      targetWs: ws,
      messageType: 'reg',
      data: regResponse,
    };
  }

  getUserByWs(ws: WebSocket): User | undefined {
    return this.authService.getUserByWs(ws);
  }

  handleDisconnect(ws: WebSocket): void {
    this.authService.handleDisconnect(ws, this.userToGame);
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

    const validationError = this.gameService.validateCreateGameData(data);
    if (validationError) {
      return {
        type: 'error',
        recipient: 'ws',
        targetWs: ws,
        messageType: 'error',
        data: { message: validationError },
      };
    }

    const gameResponse = this.gameService.createGame(user, data);
    return {
      type: 'game',
      recipient: 'ws',
      targetWs: ws,
      messageType: 'game_created',
      data: gameResponse,
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

    try {
      const { game, player } = this.gameService.joinGame(user, code);
      this.userToGame.set(user.index, game.id);

      const playersList = this.gameService.getPlayersList(game.id);

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
          data: playersList,
        },
      ];

      return responses;
    } catch (error) {
      return [
        {
          type: 'error',
          recipient: 'ws',
          targetWs: ws,
          messageType: 'error',
          data: { message: (error as Error).message },
        },
      ];
    }
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

    this.gameplayService.startQuestionTimer(gameId);

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

  handleAnswer(ws: WebSocket, data: AnswerData): ControllerResponse {
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

    const { gameId, questionIndex } = data;
    const validation = this.gameplayService.validateAnswer(data, gameId);

    if (!validation.valid) {
      return {
        type: 'error',
        recipient: 'ws',
        targetWs: ws,
        messageType: 'error',
        data: { message: validation.error },
      };
    }

    this.gameplayService.recordAnswer(user.index, data, gameId);
    console.log(`Answer received — player: ${user.name}, question: ${questionIndex}, answer: ${data.answerIndex}`);

    if (this.gameplayService.allPlayersAnswered(gameId)) {
      console.log(`All players answered — ending question early for game: ${gameId}`);
      this.gameplayService.endQuestion(gameId);
    }

    return {
      type: 'user',
      recipient: 'ws',
      targetWs: ws,
      messageType: 'answer_accepted',
      data: { questionIndex },
    };
  }

  broadcastQuestionResult(gameId: string): ControllerResponse {
    const result = this.gameplayService.broadcastQuestionResult(gameId);

    if (!result) {
      return {
        type: 'error',
        recipient: 'ws',
        messageType: 'error',
        data: { message: 'Game not found.' },
      };
    }

    return {
      type: 'broadcast',
      recipient: 'all_in_game',
      gameId,
      messageType: 'question_result',
      data: result,
    };
  }

  getDatabase(): GameDatabase {
    return this.db;
  }
}
