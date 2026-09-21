import { server, io } from './server.js';
import { rooms, socketToRoom } from './state.js';
import { clearRoomDisconnectTimers } from './utils/roomUtils.js';

const PORT = process.env.PORT || 3001;
const ROOM_MAX_INACTIVE_MS = 60 * 60 * 1000;

// Periodic cleanup of abandoned/finished rooms (every 1 minute)
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms.entries()) {
    const isFinished = room.status === 'FINISHED';
    const isAbandoned =
      room.questionStartedAt > 0 &&
      now - room.questionStartedAt > ROOM_MAX_INACTIVE_MS;

    if (isFinished || isAbandoned) {
      clearRoomDisconnectTimers(room);
      for (const playerSocketId of room.players.keys()) {
        socketToRoom.delete(playerSocketId);
      }
      socketToRoom.delete(room.hostSocketId);
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
