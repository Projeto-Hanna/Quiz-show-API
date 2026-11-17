import type { Server, Socket } from 'socket.io';
import { GameRoom } from '../GameRoom.js';
import {
  CreateRoomSchema,
  HostRoomAuthSchema,
  HostKickPlayerSchema,
} from '../types/schemas.js';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '../types/game.js';
import {
  rooms,
  hostDisconnectTimers,
  countdownTimers,
  addSocketRoom,
  removeSocketRoom,
} from '../state.js';
import {
  generateRoomCode,
  clearRoomDisconnectTimers,
  clearRoomGameTimers,
  emitRoundResultToRoom,
  emitScoreboardToRoom,
  scheduleRoundTimer,
} from '../utils/roomUtils.js';

export function registerHostEvents(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  socket: Socket<ClientToServerEvents, ServerToClientEvents>,
): void {
  socket.on('host:create_room', (rawPayload, callback) => {
    try {
      const validation = CreateRoomSchema.safeParse(rawPayload ?? {});
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

  socket.on('host:rejoin_room', (rawPayload, callback) => {
    try {
      const validation = HostRoomAuthSchema.safeParse(rawPayload ?? {});
      if (!validation.success) {
        return callback?.({
          success: false,
          error:
            validation.error.issues[0]?.message ||
            'Dados de reconexão inválidos.',
        });
      }

      const roomId = validation.data.roomId.toUpperCase();
      const { hostToken } = validation.data;

      const room = rooms.get(roomId);
      const previousHostSocketId = room?.hostSocketId;
      if (!room || !room.reconnectHost(socket.id, hostToken)) {
        return callback?.({
          success: false,
          error: 'Sala não encontrada ou token de host inválido.',
        });
      }

      if (previousHostSocketId && previousHostSocketId !== socket.id) {
        removeSocketRoom(previousHostSocketId, roomId);
        io.sockets.sockets.get(previousHostSocketId)?.leave(`room_${roomId}`);
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
        sync: room.getSyncState(true),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      callback?.({ success: false, error: message });
    }
  });

  socket.on('host:start_game', (rawPayload, callback) => {
    try {
      const validation = HostRoomAuthSchema.safeParse(rawPayload ?? {});
      if (!validation.success) {
        return callback?.({
          success: false,
          error:
            validation.error.issues[0]?.message || 'Dados da sala inválidos.',
        });
      }

      const roomId = validation.data.roomId.toUpperCase();
      const { hostToken } = validation.data;

      const room = rooms.get(roomId);
      if (!room || room.hostToken !== hostToken) {
        return callback?.({
          success: false,
          error: 'Apenas o Host pode iniciar a partida.',
        });
      }

      room.startGame();
      clearRoomGameTimers(roomId);

      io.to(`room_${roomId}`).emit('game:countdown', {
        countdownSeconds: 3,
        seconds: 3,
      });

      callback?.({ success: true });

      const timer = setTimeout(() => {
        countdownTimers.delete(roomId);
        if (!rooms.has(roomId) || room.status !== 'COUNTDOWN') return;

        const pubQ = room.startQuestion(0);
        const hostQ = room.getCurrentQuestionHost();

        io.to(room.hostSocketId).emit('game:question_started', {
          question: hostQ,
          isHost: true,
        });

        io.to(`room_${roomId}`)
          .except(room.hostSocketId)
          .emit('game:question_started', {
            question: pubQ,
            isHost: false,
          });

        scheduleRoundTimer(io, room);
      }, 3500);

      countdownTimers.set(roomId, timer);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      callback?.({ success: false, error: message });
    }
  });

  socket.on('host:end_round', (rawPayload, callback) => {
    try {
      const validation = HostRoomAuthSchema.safeParse(rawPayload ?? {});
      if (!validation.success) {
        return callback?.({
          success: false,
          error:
            validation.error.issues[0]?.message || 'Dados da sala inválidos.',
        });
      }

      const roomId = validation.data.roomId.toUpperCase();
      const { hostToken } = validation.data;

      const room = rooms.get(roomId);
      if (!room || room.hostToken !== hostToken) {
        return callback?.({
          success: false,
          error: 'Apenas o Host pode encerrar a rodada.',
        });
      }

      if (room.status === 'ROUND_RESULT' && room.lastRoundResult) {
        return callback?.({
          success: true,
          roundData: room.lastRoundResult,
        });
      }

      if (room.status !== 'QUESTION') {
        return callback?.({
          success: false,
          error: 'Nenhuma pergunta ativa no momento.',
        });
      }

      clearRoomGameTimers(roomId);
      const roundData = room.endRound();
      emitRoundResultToRoom(io, room, roundData);
      callback?.({ success: true, roundData });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      callback?.({ success: false, error: message });
    }
  });

  socket.on('host:show_scoreboard', (rawPayload, callback) => {
    try {
      const validation = HostRoomAuthSchema.safeParse(rawPayload ?? {});
      if (!validation.success) {
        return callback?.({
          success: false,
          error:
            validation.error.issues[0]?.message || 'Dados da sala inválidos.',
        });
      }

      const roomId = validation.data.roomId.toUpperCase();
      const { hostToken } = validation.data;

      const room = rooms.get(roomId);
      if (!room || room.hostToken !== hostToken) {
        return callback?.({
          success: false,
          error: 'Apenas o Host pode acionar o placar.',
        });
      }

      if (
        room.status !== 'ROUND_RESULT' &&
        room.status !== 'SCOREBOARD'
      ) {
        return callback?.({
          success: false,
          error: 'Não é possível exibir o placar nesta fase.',
        });
      }

      clearRoomGameTimers(roomId);
      const scoreboard = room.showScoreboard();
      emitScoreboardToRoom(io, room, scoreboard, 'game:scoreboard');
      callback?.({ success: true, scoreboard });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      callback?.({ success: false, error: message });
    }
  });

  socket.on('host:next_question', (rawPayload, callback) => {
    try {
      const validation = HostRoomAuthSchema.safeParse(rawPayload ?? {});
      if (!validation.success) {
        return callback?.({
          success: false,
          error:
            validation.error.issues[0]?.message || 'Dados da sala inválidos.',
        });
      }

      const roomId = validation.data.roomId.toUpperCase();
      const { hostToken } = validation.data;

      const room = rooms.get(roomId);
      if (!room || room.hostToken !== hostToken) {
        return callback?.({
          success: false,
          error: 'Apenas o Host pode avançar a pergunta.',
        });
      }

      if (room.status !== 'ROUND_RESULT' && room.status !== 'SCOREBOARD') {
        return callback?.({
          success: false,
          error: 'Encerre a rodada atual antes de avançar.',
        });
      }

      clearRoomGameTimers(roomId);
      const nextIndex = room.currentQuestionIndex + 1;
      const pubQ = room.startQuestion(nextIndex);

      if (!pubQ) {
        const finalScoreboard = room.finishGame();
        emitScoreboardToRoom(io, room, finalScoreboard, 'game:finished');
        return callback?.({ success: true, finished: true });
      }

      const hostQ = room.getCurrentQuestionHost();
      io.to(room.hostSocketId).emit('game:question_started', {
        question: hostQ,
        isHost: true,
      });
      io.to(`room_${roomId}`)
        .except(room.hostSocketId)
        .emit('game:question_started', {
          question: pubQ,
          isHost: false,
        });

      scheduleRoundTimer(io, room);
      callback?.({ success: true, finished: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      callback?.({ success: false, error: message });
    }
  });

  socket.on('host:end_game', (rawPayload, callback) => {
    try {
      const validation = HostRoomAuthSchema.safeParse(rawPayload ?? {});
      if (!validation.success) {
        return callback?.({
          success: false,
          error:
            validation.error.issues[0]?.message || 'Dados da sala inválidos.',
        });
      }

      const roomId = validation.data.roomId.toUpperCase();
      const { hostToken } = validation.data;

      const room = rooms.get(roomId);
      if (!room || room.hostToken !== hostToken) {
        return callback?.({
          success: false,
          error: 'Apenas o Host pode encerrar o jogo.',
        });
      }

      clearRoomGameTimers(roomId);
      const finalScoreboard = room.finishGame();
      emitScoreboardToRoom(io, room, finalScoreboard, 'game:finished');
      callback?.({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      callback?.({ success: false, error: message });
    }
  });

  socket.on('host:restart_game', (rawPayload, callback) => {
    try {
      const validation = HostRoomAuthSchema.safeParse(rawPayload ?? {});
      if (!validation.success) {
        return callback?.({
          success: false,
          error:
            validation.error.issues[0]?.message || 'Dados da sala inválidos.',
        });
      }

      const roomId = validation.data.roomId.toUpperCase();
      const { hostToken } = validation.data;

      const room = rooms.get(roomId);
      if (!room || room.hostToken !== hostToken) {
        return callback?.({
          success: false,
          error: 'Apenas o Host pode reiniciar a partida.',
        });
      }

      clearRoomGameTimers(roomId);
      const summary = room.resetToLobby();
      io.to(`room_${roomId}`).emit('game:reset_to_lobby', { summary });
      callback?.({ success: true, summary });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      callback?.({ success: false, error: message });
    }
  });

  socket.on('host:cancel_room', (rawPayload, callback) => {
    try {
      const validation = HostRoomAuthSchema.safeParse(rawPayload ?? {});
      if (!validation.success) {
        return callback?.({
          success: false,
          error:
            validation.error.issues[0]?.message || 'Dados da sala inválidos.',
        });
      }

      const roomId = validation.data.roomId.toUpperCase();
      const { hostToken } = validation.data;

      const room = rooms.get(roomId);
      if (!room || room.hostToken !== hostToken) {
        return callback?.({
          success: false,
          error: 'Apenas o Host pode cancelar a sala.',
        });
      }

      clearRoomDisconnectTimers(room);
      io.to(`room_${roomId}`).emit('room:closed', {
        reason:
          room.status === 'FINISHED'
            ? 'A partida terminou e o Host encerrou a sala. Obrigado por jogar!'
            : 'A sala foi cancelada pelo Host.',
      });
      for (const playerSocketId of room.players.keys()) {
        removeSocketRoom(playerSocketId, roomId);
      }
      rooms.delete(roomId);
      removeSocketRoom(socket.id, roomId);
      socket.leave(`room_${roomId}`);

      callback?.({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      callback?.({ success: false, error: message });
    }
  });

  socket.on('host:kick_player', (rawPayload, callback) => {
    try {
      const validation = HostKickPlayerSchema.safeParse(rawPayload ?? {});
      if (!validation.success) {
        return callback?.({
          success: false,
          error:
            validation.error.issues[0]?.message ||
            'Dados inválidos para expulsar jogador.',
        });
      }

      const roomId = validation.data.roomId.toUpperCase();
      const { hostToken, playerId } = validation.data;

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
      room.kickPlayer(socketId);
      removeSocketRoom(socketId, roomId);

      io.to(socketId).emit('room:kicked', {
        reason: 'Você foi removido da sala pelo Host.',
      });

      const targetSocket = io.sockets.sockets.get(socketId);
      if (targetSocket) {
        targetSocket.leave(`room_${roomId}`);
      }

      io.to(`room_${roomId}`).emit('room:player_left', {
        player: room.toLobbyPlayer(player),
        summary: room.getLobbyCounts(),
      });

      callback?.({
        success: true,
        summary: room.getLobbySummary(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      callback?.({ success: false, error: message });
    }
  });
}
