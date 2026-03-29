import type { WebSocket } from 'ws';
import type { WSMessage, RegData, CreateGameData, JoinGameData } from '../types/types.js';
import { GameController, type ControllerResponse } from '../controller/controller.js';

export class MessageRouter {
  private controller: GameController;

  constructor(controller: GameController) {
    this.controller = controller;
  }

  async handleMessage(ws: WebSocket, message: WSMessage): Promise<ControllerResponse | ControllerResponse[] | null> {
    const { type, data } = message;
    console.log(`→ [${type}]`, data);

    switch (type) {
      case 'reg':
        return this.controller.handleReg(ws, data as RegData);

      case 'create_game':
        return this.controller.handleCreateGame(ws, data as CreateGameData);

      case 'join_game':
        return this.controller.handleJoinGame(ws, data as JoinGameData);

      default:
        console.log(`Unhandled message type: ${type}`);
        return null;
    }
  }

  getController(): GameController {
    return this.controller;
  }
}
