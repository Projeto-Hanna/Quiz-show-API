import type { Server, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '../types/game.js';
import { rooms, disconnectTimers, addSocketRoom, removeSocketRoom } from '../state.js';

export function registerPlayerEvents(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  socket: Socket<ClientToServerEvents, ServerToClientEvents>,
): void {
  socket.on(
    'player:join_room',
    ({ roomId, playerName, playerToken }, callback) => {
      try {
        const normalizedRoomId = (roomId || '').trim().toUpperCase();
        const room = rooms.get(normalizedRoomId);

        if (!room) {
          return callback?.({
            success: false,
            error: 'Sala não encontrada. Verifique o código.',
          });
        }

        if (playerToken) {
          const existing = room.getPlayerByToken(playerToken);
          if (existing) {
            const playerId = existing.player.id;
            const pendingTimer = disconnectTimers.get(playerId);
            if (pendingTimer) {
              clearTimeout(pendingTimer);
              disconnectTimers.delete(playerId);
            }

            if (existing.socketId) {
              removeSocketRoom(existing.socketId, normalizedRoomId);
            }

            const reconnectedPlayer = room.reconnectPlayer(
              socket.id,
              playerToken,
            );
            if (reconnectedPlayer) {
              addSocketRoom(socket.id, normalizedRoomId);
              socket.join(`room_${normalizedRoomId}`);

              callback?.({
                success: true,
                player: reconnectedPlayer,
                summary: room.getLobbySummary(),
              });

              if (room.status === 'QUESTION') {
                const currentQ = room.getCurrentQuestionPublic();
                if (currentQ) {
                  socket.emit('game:question_started', {
                    question: currentQ,
                    isHost: false,
                  });
                }
              }

              return;
            }
          }
        }

        const player = room.addPlayer(socket.id, playerName);
        addSocketRoom(socket.id, normalizedRoomId);
        socket.join(`room_${normalizedRoomId}`);

        const publicPlayer = { ...player };
        delete publicPlayer.playerToken;

        io.to(`room_${normalizedRoomId}`).emit('room:player_joined', {
          player: publicPlayer,
          summary: room.getLobbySummary(),
        });

        callback?.({
          success: true,
          player,
          summary: room.getLobbySummary(),
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Erro desconhecido';
        callback?.({ success: false, error: message });
      }
    },
  );

  socket.on(
    'player:submit_answer',
    ({ roomId, playerToken, optionIndex }, callback) => {
      const room = rooms.get(roomId);
      if (!room) {
        return callback?.({ success: false, error: 'Sala não encontrada.' });
      }

      const player = room.players.get(socket.id);
      if (!player) {
        return callback?.({
          success: false,
          error: 'Jogador não encontrado na sala.',
        });
      }

      if (player.playerToken !== playerToken) {
        return callback?.({
          success: false,
          error: 'Token de jogador inválido.',
        });
      }

      const result = room.submitAnswer(socket.id, optionIndex);
      if (!result.success) {
        return callback?.({ success: false, error: result.reason });
      }

      callback?.({
        success: true,
        pointsEarned: result.player.lastAnswerPoints,
        isCorrect: result.player.lastAnswerCorrect,
      });

      io.to(`room_${roomId}`).emit('game:answer_progress', {
        totalAnswered: result.totalAnswered,
        totalPlayers: result.totalPlayers,
        allAnswered: result.allAnswered,
      });
    },
  );
}
