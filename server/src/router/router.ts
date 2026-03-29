import type { WebSocket } from 'ws';
import type { WSMessage, RegData, CreateGameData } from '../types/types.js';
import { GameController, type ControllerResponse } from '../controller/controller.js';

/**
 * Message router - routes incoming WebSocket messages to appropriate controller methods
 */
export class MessageRouter {
  private controller: GameController;

  constructor(controller: GameController) {
    this.controller = controller;
  }

  /**
   * Route incoming message to appropriate handler
   */
  async handleMessage(ws: WebSocket, message: WSMessage): Promise<ControllerResponse | null> {
    const { type, data } = message;
    console.log(`→ [${type}]`, data);

    switch (type) {
      case 'reg':
        return this.controller.handleReg(ws, data as RegData);

      case 'create_game':
        return this.controller.handleCreateGame(ws, data as CreateGameData);

      default:
        console.log(`Unhandled message type: ${type}`);
        return null;
    }
  }

  /**
   * Get controller for direct access if needed
   */
  getController(): GameController {
    return this.controller;
  }
}
