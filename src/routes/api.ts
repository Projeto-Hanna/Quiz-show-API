import { Router, type Request, type Response } from 'express';
import { rooms } from '../state.js';

export const apiRouter = Router();

// Health check endpoint
apiRouter.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
  });
});

// List active rooms lobby summary
apiRouter.get('/rooms', (_req: Request, res: Response) => {
  const list = Array.from(rooms.values()).map((r) => r.getLobbySummary());
  res.json({ rooms: list });
});
