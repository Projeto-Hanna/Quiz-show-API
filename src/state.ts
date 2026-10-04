import type { GameRoom } from './GameRoom.js';

export const rooms = new Map<string, GameRoom>();
export const socketToRoom = new Map<string, Set<string>>();
export const disconnectTimers = new Map<string, NodeJS.Timeout>();
export const hostDisconnectTimers = new Map<string, NodeJS.Timeout>();

export function addSocketRoom(socketId: string, roomId: string): void {
  const userRooms = socketToRoom.get(socketId) || new Set<string>();
  userRooms.add(roomId);
  socketToRoom.set(socketId, userRooms);
}

export function removeSocketRoom(socketId: string, roomId: string): void {
  const userRooms = socketToRoom.get(socketId);
  if (userRooms) {
    userRooms.delete(roomId);
    if (userRooms.size === 0) {
      socketToRoom.delete(socketId);
    }
  }
}
