import { randomInt } from 'node:crypto';
import type { Server } from 'socket.io';
import { ANSWER_GRACE_MS, type GameRoom } from '../GameRoom.js';
import type {
  ClientToServerEvents,
  RoundResult,
  ScoreboardItem,
  ServerToClientEvents,
} from '../types/game.js';
import {
  rooms,
  disconnectTimers,
  hostDisconnectTimers,
  countdownTimers,
  roundTimers,
} from '../state.js';

/**
 * Clears any pending countdown or round timers for a room.
 */
export function clearRoomGameTimers(roomId: string): void {
  const countdownTimer = countdownTimers.get(roomId);
  if (countdownTimer) {
    clearTimeout(countdownTimer);
    countdownTimers.delete(roomId);
  }

  const roundTimer = roundTimers.get(roomId);
  if (roundTimer) {
    clearTimeout(roundTimer);
    roundTimers.delete(roomId);
  }
}

/**
 * Emits round results to the room: full results to the Host, and only each player's own result to players.
 */
export function emitRoundResultToRoom(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  room: GameRoom,
  roundData: RoundResult,
): void {
  io.to(room.hostSocketId).emit('game:round_result', roundData);

  for (const [playerSocketId, player] of room.players.entries()) {
    const ownResult = roundData.playerResults.filter(
      (pr) => pr.id === player.id,
    );
    io.to(playerSocketId).emit('game:round_result', {
      ...roundData,
      playerResults: ownResult,
    });
  }
}

/**
 * Emits the scoreboard to the room: the full list to the Host, and only the
 * top N plus their own row to each player (keeps traffic flat as rooms grow).
 */
export function emitScoreboardToRoom(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  room: GameRoom,
  fullScoreboard: ScoreboardItem[],
  event: 'game:scoreboard' | 'game:finished',
): void {
  const progress = {
    currentIndex: room.currentQuestionIndex,
    totalQuestions: room.questions.length,
    hasMoreQuestions: room.currentQuestionIndex + 1 < room.questions.length,
  };

  const send = (target: string, scoreboard: ScoreboardItem[]) => {
    if (event === 'game:scoreboard') {
      io.to(target).emit('game:scoreboard', { scoreboard, ...progress });
    } else {
      io.to(target).emit('game:finished', { scoreboard });
    }
  };

  send(room.hostSocketId, fullScoreboard);
  for (const [playerSocketId, player] of room.players.entries()) {
    send(playerSocketId, room.getPlayerScoreboard(fullScoreboard, player.id));
  }
}

/**
 * Schedules the authoritative server-side timer for the current question round.
 */
export function scheduleRoundTimer(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  room: GameRoom,
): void {
  const existingRoundTimer = roundTimers.get(room.id);
  if (existingRoundTimer) {
    clearTimeout(existingRoundTimer);
  }

  const delayMs = room.timePerQuestion * 1000 + ANSWER_GRACE_MS;
  const timer = setTimeout(() => {
    roundTimers.delete(room.id);
    if (!rooms.has(room.id) || room.status !== 'QUESTION') return;

    const roundData = room.endRound();
    emitRoundResultToRoom(io, room, roundData);
  }, delayMs);

  roundTimers.set(room.id, timer);
}

/**
 * Clears all pending disconnect grace period timers and game timers for a room.
 */
export function clearRoomDisconnectTimers(room: GameRoom): void {
  clearRoomGameTimers(room.id);

  for (const player of room.players.values()) {
    const timer = disconnectTimers.get(player.id);
    if (timer) {
      clearTimeout(timer);
      disconnectTimers.delete(player.id);
    }
  }

  const hostTimer = hostDisconnectTimers.get(room.id);
  if (hostTimer) {
    clearTimeout(hostTimer);
    hostDisconnectTimers.delete(room.id);
  }
}

/**
 * Helper to generate 4-character room codes (easily readable) using cryptographically secure random integers.
 */
export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(randomInt(chars.length));
    }
  } while (rooms.has(code));
  return code;
}
