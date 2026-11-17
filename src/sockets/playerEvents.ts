import type { Server, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '../types/game.js';
import {
  PlayerJoinSchema,
  PlayerLeaveSchema,
  PlayerSubmitAnswerSchema,
} from '../types/schemas.js';
import {
  rooms,
  disconnectTimers,
  addSocketRoom,
  removeSocketRoom,
} from '../state.js';

export function registerPlayerEvents(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  socket: Socket<ClientToServerEvents, ServerToClientEvents>,
): void {
  socket.on('player:join_room', (rawPayload, callback) => {
    try {
      const validation = PlayerJoinSchema.safeParse(rawPayload ?? {});
      if (!validation.success) {
        return callback?.({
          success: false,
          error:
            validation.error.issues[0]?.message ||
            'Dados inválidos para entrar na sala.',
        });
      }

      const normalizedRoomId = validation.data.roomId.toUpperCase();
      const { playerName, playerToken } = validation.data;
      const room = rooms.get(normalizedRoomId);

      if (!room) {
        return callback?.({
          success: false,
          error: 'Sala não encontrada. Verifique o código.',
        });
      }

      if (playerToken && room.isTokenKicked(playerToken)) {
        return callback?.({
          success: false,
          error: 'Você foi removido da sala pelo Host.',
          code: 'KICKED',
        });
      }

      if (playerToken) {
        const existing = room.getPlayerByToken(playerToken);
        const isActiveOtherSocketWithDifferentName =
          existing &&
          room.status === 'LOBBY' &&
          existing.player.connected !== false &&
          existing.socketId !== socket.id &&
          io.sockets.sockets.has(existing.socketId) &&
          playerName.trim().toLowerCase() !== existing.player.name.toLowerCase();

        if (existing && !isActiveOtherSocketWithDifferentName) {
          const playerId = existing.player.id;
          const pendingTimer = disconnectTimers.get(playerId);
          if (pendingTimer) {
            clearTimeout(pendingTimer);
            disconnectTimers.delete(playerId);
          }

          if (existing.socketId && existing.socketId !== socket.id) {
            removeSocketRoom(existing.socketId, normalizedRoomId);
            io.sockets.sockets
              .get(existing.socketId)
              ?.leave(`room_${normalizedRoomId}`);
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
              sync: room.getSyncState(false, socket.id),
            });

            const connectionTarget =
              room.status === 'LOBBY'
                ? `room_${normalizedRoomId}`
                : room.hostSocketId;
            io.to(connectionTarget).emit('room:player_connection', {
              playerId: reconnectedPlayer.id,
              connected: true,
              summary: room.getLobbyCounts(),
            });

            if (room.status === 'QUESTION') {
              io.to(room.hostSocketId).emit('game:answer_progress', {
                totalAnswered: room.answeredCount,
                totalPlayers: room.getConnectedPlayerCount(),
                allAnswered: room.areAllActivePlayersAnswered(),
              });
            }

            return;
          }
        }
      }

      const player = room.addPlayer(socket.id, playerName);
      addSocketRoom(socket.id, normalizedRoomId);
      socket.join(`room_${normalizedRoomId}`);

      io.to(`room_${normalizedRoomId}`).emit('room:player_joined', {
        player: room.toLobbyPlayer(player),
        summary: room.getLobbyCounts(),
      });

      callback?.({
        success: true,
        player,
        summary: room.getLobbySummary(),
        sync: room.getSyncState(false, socket.id),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      callback?.({ success: false, error: message });
    }
  });

  socket.on('player:leave_room', (rawPayload, callback) => {
    try {
      const validation = PlayerLeaveSchema.safeParse(rawPayload ?? {});
      if (!validation.success) {
        return callback?.({ success: false });
      }

      const normalizedRoomId = validation.data.roomId.toUpperCase();
      const { playerToken } = validation.data;
      const room = rooms.get(normalizedRoomId);
      if (!room) {
        return callback?.({ success: true });
      }

      const player = room.players.get(socket.id);
      if (player && (!playerToken || player.playerToken === playerToken)) {
        const pendingTimer = disconnectTimers.get(player.id);
        if (pendingTimer) {
          clearTimeout(pendingTimer);
          disconnectTimers.delete(player.id);
        }

        const { removedPlayer } = room.removeUser(socket.id);
        removeSocketRoom(socket.id, normalizedRoomId);
        socket.leave(`room_${normalizedRoomId}`);

        if (removedPlayer) {
          io.to(`room_${normalizedRoomId}`).emit('room:player_left', {
            player: room.toLobbyPlayer(removedPlayer),
            summary: room.getLobbyCounts(),
          });

          if (room.status === 'QUESTION') {
            io.to(room.hostSocketId).emit('game:answer_progress', {
              totalAnswered: room.answeredCount,
              totalPlayers: room.getConnectedPlayerCount(),
              allAnswered: room.areAllActivePlayersAnswered(),
            });
          }
        }
      }

      callback?.({ success: true });
    } catch {
      callback?.({ success: false });
    }
  });

  socket.on('player:submit_answer', (rawPayload, callback) => {
    try {
      const validation = PlayerSubmitAnswerSchema.safeParse(rawPayload ?? {});
      if (!validation.success) {
        return callback?.({
          success: false,
          error:
            validation.error.issues[0]?.message ||
            'Dados de resposta inválidos.',
        });
      }

      const normalizedRoomId = validation.data.roomId.toUpperCase();
      const { playerToken, optionIndex, questionIndex } = validation.data;

      const room = rooms.get(normalizedRoomId);
      if (!room) {
        return callback?.({ success: false, error: 'Sala não encontrada.' });
      }

      let player = room.players.get(socket.id);
      if (!player) {
        const foundByToken = room.getPlayerByToken(playerToken);
        if (foundByToken) {
          const pendingTimer = disconnectTimers.get(foundByToken.player.id);
          if (pendingTimer) {
            clearTimeout(pendingTimer);
            disconnectTimers.delete(foundByToken.player.id);
          }

          if (foundByToken.socketId && foundByToken.socketId !== socket.id) {
            removeSocketRoom(foundByToken.socketId, normalizedRoomId);
            io.sockets.sockets
              .get(foundByToken.socketId)
              ?.leave(`room_${normalizedRoomId}`);
          }

          player = room.reconnectPlayer(socket.id, playerToken) ?? undefined;
          if (player) {
            addSocketRoom(socket.id, normalizedRoomId);
            socket.join(`room_${normalizedRoomId}`);
            io.to(room.hostSocketId).emit('room:player_connection', {
              playerId: player.id,
              connected: true,
              summary: room.getLobbyCounts(),
            });
          }
        }
      }

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

      const result = room.submitAnswer(socket.id, optionIndex, questionIndex);
      if (!result.success) {
        return callback?.({ success: false, error: result.reason });
      }

      callback?.({
        success: true,
        pointsEarned: result.player.lastAnswerPoints,
        isCorrect: result.player.lastAnswerCorrect,
      });

      io.to(room.hostSocketId).emit('game:answer_progress', {
        totalAnswered: result.totalAnswered,
        totalPlayers: result.totalPlayers,
        allAnswered: result.allAnswered,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      callback?.({ success: false, error: message });
    }
  });
}
