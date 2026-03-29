import type { WebSocket } from 'ws';
import type { WSMessage, RegData, CreateGameData, JoinGameData, StartGameData, AnswerData } from '../types/types.js';
import { GameController, type ControllerResponse } from '../controller/controller.js';

export class MessageRouter {
  private controller: GameController;

  constructor(controller: GameController) {
    this.controller = controller;
  }

  async handleMessage(ws: WebSocket, message: WSMessage): Promise<ControllerResponse | ControllerResponse[] | null> {
    const { type, data } = message;

    switch (type) {
      case 'reg':
        return this.controller.handleReg(ws, data as RegData);

      case 'create_game':
        return this.controller.handleCreateGame(ws, data as CreateGameData);

      case 'join_game':
        return this.controller.handleJoinGame(ws, data as JoinGameData);

      case 'start_game':
        return this.controller.handleStartGame(ws, data as StartGameData);

      case 'answer':
        return this.controller.handleAnswer(ws, data as AnswerData);

      default:
        return null;
    }
  }

  getController(): GameController {
    return this.controller;
  }
}
