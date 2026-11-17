import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { apiRouter } from './routes/api.js';

export const allowedOrigins: string | string[] = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim())
  : '*';

export const app = express();

/**
 * Number of reverse proxies between the client and this server.
 * - unset (default): 1 — e.g. Render, Railway, Heroku, Fly.io, Nginx on a VPS
 * - "2": CDN in front of the host (e.g. Cloudflare + Render)
 * - "false" or "0": server exposed directly (no proxy), so X-Forwarded-For is ignored
 */
const parseTrustProxy = (value: string | undefined): number | false => {
  if (value === undefined || value.trim() === '') return 1;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'false' || normalized === '0') return false;
  const hops = Number(normalized);
  return Number.isInteger(hops) && hops > 0 ? hops : 1;
};

app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));

app.use(helmet());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1500,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health',
});
app.use(limiter);

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

app.use(apiRouter);
