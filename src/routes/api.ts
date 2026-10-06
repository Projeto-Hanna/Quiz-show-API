import { Router, type Request, type Response } from 'express';
import cors from 'cors';
import { rooms } from '../state.js';

export const apiRouter = Router();

apiRouter.get('/health', cors(), (_req: Request, res: Response) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
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
