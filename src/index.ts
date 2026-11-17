import { server, io } from './server.js';
import { rooms, removeSocketRoom } from './state.js';
import { clearRoomDisconnectTimers } from './utils/roomUtils.js';

const PORT = process.env.PORT || 3001;
const ROOM_MAX_INACTIVE_MS = 3 * 60 * 60 * 1000;
const ROOM_FINISHED_MAX_INACTIVE_MS = 60 * 60 * 1000;

process.on('uncaughtException', (err) => {
  console.error('[Quiz Show Server] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Quiz Show Server] Unhandled Rejection:', reason);
});

// Periodic cleanup of abandoned/finished rooms (every 1 minute)
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms.entries()) {
    const isFinishedAndExpired =
      room.status === 'FINISHED' &&
      room.finishedAt > 0 &&
      now - room.lastActivityAt > ROOM_FINISHED_MAX_INACTIVE_MS;

    const isInactive =
      room.status !== 'FINISHED' &&
      room.lastActivityAt > 0 &&
      now - room.lastActivityAt > ROOM_MAX_INACTIVE_MS;

    if (isFinishedAndExpired || isInactive) {
      clearRoomDisconnectTimers(room);
      for (const playerSocketId of room.players.keys()) {
        removeSocketRoom(playerSocketId, roomId);
      }
      removeSocketRoom(room.hostSocketId, roomId);
      io.to(`room_${roomId}`).emit('room:closed', {
        reason: 'A sala foi encerrada por inatividade.',
      });
      rooms.delete(roomId);
    }
  }
}, 60 * 1000);

server.listen(PORT, () => {
  console.log(`[Quiz Show Server] Rodando na porta ${PORT}`);
});
