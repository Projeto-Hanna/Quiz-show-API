import type { Server } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '../types/game.js';
import {
  rooms,
  socketToRoom,
  disconnectTimers,
  hostDisconnectTimers,
} from '../state.js';
import { clearRoomDisconnectTimers } from '../utils/roomUtils.js';
import { registerHostEvents } from './hostEvents.js';
import { registerPlayerEvents } from './playerEvents.js';

export function registerSocketHandlers(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
): void {
  io.on('connection', (socket) => {
    let eventCount = 0;
    let lastReset = Date.now();
    socket.use((_event, next) => {
      const now = Date.now();
      if (now - lastReset > 1000) {
        eventCount = 0;
        lastReset = now;
      }
      eventCount++;
      if (eventCount > 30) {
        return next(new Error('Rate limit exceeded'));
      }
      next();
    });

    registerHostEvents(io, socket);
    registerPlayerEvents(io, socket);

    socket.on('disconnect', () => {
      const roomIds = socketToRoom.get(socket.id);
      if (!roomIds) return;

      socketToRoom.delete(socket.id);

      for (const roomId of roomIds) {
        const room = rooms.get(roomId);
        if (!room) continue;

        if (socket.id === room.hostSocketId) {
          const existingHostTimer = hostDisconnectTimers.get(roomId);
          if (existingHostTimer) {
            clearTimeout(existingHostTimer);
          }

          const hostTimer = setTimeout(() => {
            hostDisconnectTimers.delete(roomId);
            if (!rooms.has(roomId)) return;

            if (room.hostSocketId === socket.id) {
              clearRoomDisconnectTimers(room);
              if (room.status !== 'FINISHED') {
                io.to(`room_${roomId}`).emit('room:closed', {
                  reason: 'O Host encerrou ou perdeu a conexão com a sala.',
                });
              }
              rooms.delete(roomId);
            }
          }, 25000);

          hostDisconnectTimers.set(roomId, hostTimer);
          continue;
        }

        const player = room.players.get(socket.id);
        if (!player) continue;

        const playerId = player.id;
        const disconnectedSocketId = socket.id;

        const existingTimer = disconnectTimers.get(playerId);
        if (existingTimer) {
          clearTimeout(existingTimer);
        }

        const timer = setTimeout(() => {
          disconnectTimers.delete(playerId);

          if (!rooms.has(roomId)) return;

          const currentSocketId = room.getSocketIdByPlayerId(playerId);
          if (currentSocketId === disconnectedSocketId) {
            const { removedPlayer } = room.removeUser(disconnectedSocketId);
            if (removedPlayer) {
              io.to(`room_${roomId}`).emit('room:player_left', {
                player: {
                  ...removedPlayer,
                  playerToken: undefined,
                },
                summary: room.getLobbySummary(),
              });
            }
          }
        }, 25000);

        disconnectTimers.set(playerId, timer);
      }
    });
  });
}
