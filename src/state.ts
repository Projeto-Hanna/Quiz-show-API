import type { GameRoom } from './GameRoom.js';

export const rooms = new Map<string, GameRoom>();
export const socketToRoom = new Map<string, string>();
export const disconnectTimers = new Map<string, NodeJS.Timeout>();
export const hostDisconnectTimers = new Map<string, NodeJS.Timeout>();
