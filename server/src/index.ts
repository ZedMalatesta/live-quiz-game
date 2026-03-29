import 'dotenv/config';
import { WebSocketServer, WebSocket } from 'ws';
import type { WSMessage } from './types/types.js';
import { GameDatabase } from './db/db.js';
import { GameController } from './controller/controller.js';
import { MessageRouter } from './router/router.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

const database = new GameDatabase();
const controller = new GameController(database);
const router = new MessageRouter(controller);


function send(ws: WebSocket, type: string, data: unknown): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  const message: WSMessage = { type, data, id: 0 };
  ws.send(JSON.stringify(message));
}

function broadcastToGame(gameId: string, type: string, data: unknown): void {
  const game = database.getGameById(gameId);
  if (!game) return;

  const message: WSMessage = { type, data, id: 0 };
  const json = JSON.stringify(message);

  for (const player of game.players) {
    if (player.ws && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(json);
    }
  }

  const hostUser = database.getUserByIndex(game.hostId);
  if (hostUser?.ws && hostUser.ws.readyState === WebSocket.OPEN) {
    hostUser.ws.send(json);
  }
}

async function handleControllerResponse(response: Awaited<ReturnType<typeof router.handleMessage>>): Promise<void> {
  if (!response) return;

  const { recipient, messageType, data, targetWs, gameId } = response;

  switch (recipient) {
    case 'ws':
      if (targetWs) send(targetWs, messageType, data);
      break;

    case 'all_in_game':
      if (gameId) broadcastToGame(gameId, messageType, data);
      break;

    case 'host':
      if (gameId) {
        const game = database.getGameById(gameId);
        if (game) {
          const hostUser = database.getUserByIndex(game.hostId);
          if (hostUser?.ws) send(hostUser.ws, messageType, data);
        }
      }
      break;
  }


const wss = new WebSocketServer({ port: PORT });

console.log(`WebSocket server running on ws://localhost:${PORT}`);

wss.on('connection', (ws: WebSocket) => {
  console.log('Client connected');

  ws.on('message', async (raw) => {
    try {
      const message = JSON.parse(raw.toString()) as WSMessage;
      const response = await router.handleMessage(ws, message);
      await handleControllerResponse(response);
    } catch (e) {
      console.error('Failed to handle message:', e);
    }
  });

  ws.on('close', () => {
    controller.handleDisconnect(ws);
  });

  ws.on('error', console.error);
});