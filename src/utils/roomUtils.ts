import { randomInt } from 'node:crypto';
import type { GameRoom } from '../GameRoom.js';
import { rooms, disconnectTimers, hostDisconnectTimers } from '../state.js';

/**
 * Clears all pending disconnect grace period timers for a room (both players and host).
 */
export function clearRoomDisconnectTimers(room: GameRoom): void {
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
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(randomInt(chars.length));
    }
  } while (rooms.has(code));
  return code;
}
