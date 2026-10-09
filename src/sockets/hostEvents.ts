import type { Server, Socket } from 'socket.io';
import { GameRoom } from '../GameRoom.js';
import { CreateRoomSchema } from '../types/schemas.js';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '../types/game.js';
import { rooms, hostDisconnectTimers, addSocketRoom, removeSocketRoom } from '../state.js';
import {
  generateRoomCode,
  clearRoomDisconnectTimers,
} from '../utils/roomUtils.js';

export function registerHostEvents(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  socket: Socket<ClientToServerEvents, ServerToClientEvents>,
): void {
  socket.on(
    'host:create_room',
    ({ questions, timePerQuestion, maxPlayers }, callback) => {
      try {
        const validation = CreateRoomSchema.safeParse({
          questions,
          timePerQuestion,
          maxPlayers,
        });
        if (!validation.success) {
          return callback?.({
            success: false,
            error:
              validation.error.issues[0]?.message ||
              'Lista de perguntas inválida.',
          });
        }

        const roomId = generateRoomCode();
        const room = new GameRoom(
          roomId,
          socket.id,
          validation.data.questions,
          validation.data.timePerQuestion,
          validation.data.maxPlayers,
        );
      rooms.set(roomId, room);
      addSocketRoom(socket.id, roomId);

      socket.join(`room_${roomId}`);

      callback?.({
        success: true,
        roomId,
        hostToken: room.hostToken,
        summary: room.getLobbySummary(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      callback?.({ success: false, error: message });
    }
  });

  socket.on('host:rejoin_room', ({ roomId, hostToken }, callback) => {
    try {
      const room = rooms.get(roomId);
      if (!room || !room.reconnectHost(socket.id, hostToken)) {
        return callback?.({
          success: false,
          error: 'Sala não encontrada ou token de host inválido.',
        });
      }

      const timer = hostDisconnectTimers.get(roomId);
      if (timer) {
        clearTimeout(timer);
        hostDisconnectTimers.delete(roomId);
      }

      addSocketRoom(socket.id, roomId);
      socket.join(`room_${roomId}`);

      callback?.({
        success: true,
        summary: room.getLobbySummary(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      callback?.({ success: false, error: message });
    }
  });

  socket.on('host:start_game', ({ roomId, hostToken }, callback) => {
    const room = rooms.get(roomId);
    if (!room || room.hostToken !== hostToken) {
      return callback?.({
        success: false,
        error: 'Apenas o Host pode iniciar a partida.',
      });
    }

    try {
      room.startGame();

      io.to(`room_${roomId}`).emit('game:countdown', {
        countdownSeconds: 3,
      });

      callback?.({ success: true });

      setTimeout(() => {
        if (!rooms.has(roomId)) return;
        const pubQ = room.startQuestion(0);
        const hostQ = room.getCurrentQuestionHost();

        socket.emit('game:question_started', {
          question: hostQ,
          isHost: true,
        });

        socket.to(`room_${roomId}`).emit('game:question_started', {
          question: pubQ,
          isHost: false,
        });
      }, 3500);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      callback?.({ success: false, error: message });
    }
  });

  socket.on('host:end_round', ({ roomId, hostToken }, callback) => {
    const room = rooms.get(roomId);
    if (!room || room.hostToken !== hostToken) {
      return callback?.({
        success: false,
        error: 'Apenas o Host pode encerrar a rodada.',
      });
    }

    const roundData = room.endRound();
    io.to(`room_${roomId}`).emit('game:round_result', roundData);
    callback?.({ success: true, roundData });
  });

  socket.on('host:show_scoreboard', ({ roomId, hostToken }, callback) => {
    const room = rooms.get(roomId);
    if (!room || room.hostToken !== hostToken) {
      return callback?.({
        success: false,
        error: 'Apenas o Host pode acionar o placar.',
      });
    }

    const scoreboard = room.showScoreboard();
    io.to(`room_${roomId}`).emit('game:scoreboard', {
      scoreboard,
      currentIndex: room.currentQuestionIndex,
      totalQuestions: room.questions.length,
      hasMoreQuestions: room.currentQuestionIndex + 1 < room.questions.length,
    });
    callback?.({ success: true, scoreboard });
  });

  socket.on('host:next_question', ({ roomId, hostToken }, callback) => {
    const room = rooms.get(roomId);
    if (!room || room.hostToken !== hostToken) {
      return callback?.({
        success: false,
        error: 'Apenas o Host pode avançar a pergunta.',
      });
    }

    const nextIndex = room.currentQuestionIndex + 1;
    const pubQ = room.startQuestion(nextIndex);

    if (!pubQ) {
      const finalScoreboard = room.finishGame();
      io.to(`room_${roomId}`).emit('game:finished', {
        scoreboard: finalScoreboard,
      });
      return callback?.({ success: true, finished: true });
    }

    const hostQ = room.getCurrentQuestionHost();
    socket.emit('game:question_started', {
      question: hostQ,
      isHost: true,
    });
    socket.to(`room_${roomId}`).emit('game:question_started', {
      question: pubQ,
      isHost: false,
    });

    callback?.({ success: true, finished: false });
  });

  socket.on('host:end_game', ({ roomId, hostToken }, callback) => {
    const room = rooms.get(roomId);
    if (!room || room.hostToken !== hostToken) {
      return callback?.({
        success: false,
        error: 'Apenas o Host pode encerrar o jogo.',
      });
    }

    const finalScoreboard = room.finishGame();
    io.to(`room_${roomId}`).emit('game:finished', {
      scoreboard: finalScoreboard,
    });
    callback?.({ success: true });
  });

  socket.on('host:restart_game', ({ roomId, hostToken }, callback) => {
    const room = rooms.get(roomId);
    if (!room || room.hostToken !== hostToken) {
      return callback?.({
        success: false,
        error: 'Apenas o Host pode reiniciar a partida.',
      });
    }

    try {
      const summary = room.resetToLobby();
      io.to(`room_${roomId}`).emit('game:reset_to_lobby', { summary });
      callback?.({ success: true, summary });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      callback?.({ success: false, error: message });
    }
  });

  socket.on('host:cancel_room', ({ roomId, hostToken }, callback) => {
    const room = rooms.get(roomId);
    if (!room || room.hostToken !== hostToken) {
      return callback?.({
        success: false,
        error: 'Apenas o Host pode cancelar a sala.',
      });
    }

    clearRoomDisconnectTimers(room);
    io.to(`room_${roomId}`).emit('room:closed', {
      reason: 'A sala foi cancelada pelo Host.',
    });
    for (const playerSocketId of room.players.keys()) {
      removeSocketRoom(playerSocketId, roomId);
    }
    rooms.delete(roomId);
    removeSocketRoom(socket.id, roomId);
    socket.leave(`room_${roomId}`);

    callback?.({ success: true });
  });

  socket.on(
    'host:kick_player',
    ({ roomId, hostToken, playerId }, callback) => {
      const room = rooms.get(roomId);
      if (!room || room.hostToken !== hostToken) {
        return callback?.({
          success: false,
          error: 'Apenas o Host pode expulsar jogadores.',
        });
      }

      if (room.status !== 'LOBBY') {
        return callback?.({
          success: false,
          error:
            'Jogadores só podem ser removidos durante a fase de espera (Lobby).',
        });
      }

      const found = room.getPlayerByUuid(playerId);
      if (!found) {
        return callback?.({
          success: false,
          error: 'Jogador não encontrado na sala.',
        });
      }

      const { player, socketId } = found;
      room.removeUser(socketId);
      removeSocketRoom(socketId, roomId);

      io.to(socketId).emit('room:kicked', {
        reason: 'Você foi removido da sala pelo Host.',
      });

      const targetSocket = io.sockets.sockets.get(socketId);
      if (targetSocket) {
        targetSocket.leave(`room_${roomId}`);
      }

      io.to(`room_${roomId}`).emit('room:player_left', {
        player,
        summary: room.getLobbySummary(),
      });

      callback?.({
        success: true,
        summary: room.getLobbySummary(),
      });
    },
  );
}
