import http from 'node:http';
import { Server } from 'socket.io';
import { app, allowedOrigins } from './app.js';
import { registerSocketHandlers } from './sockets/index.js';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from './types/game.js';

export const server = http.createServer(app);

export const io = new Server<ClientToServerEvents, ServerToClientEvents>(
  server,
  {
    cors: {
      origin: allowedOrigins,
      methods: ['GET', 'POST'],
    },
  },
);

registerSocketHandlers(io);
