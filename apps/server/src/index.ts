import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { createSession } from './session-store.js';
import { handleSignaling } from './routes/signal.js';
import { quickMatch } from './matchmaking.js';

// trustProxy: Railway fronts the server with a proxy; without this every
// visitor shares the proxy's IP and the per-IP rate limits lock everyone out
const server = Fastify({ logger: true, trustProxy: true });

await server.register(cors, { origin: true });
await server.register(rateLimit, { max: 300, timeWindow: '1 minute' });
await server.register(websocket, { options: { maxPayload: 2048 } });

const createLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

server.get('/health', async () => {
  return { status: 'ok' };
});

server.post('/session', createLimit, async (_request, reply) => {
  const session = createSession();
  if (!session) return reply.status(503).send({ error: 'Server busy' });
  return { sessionId: session.id };
});

server.post('/quick-match', createLimit, async (_request, reply) => {
  const result = quickMatch();
  if (!result) return reply.status(503).send({ error: 'Server busy' });
  return result;
});

server.get('/signal', { websocket: true }, (socket) => {
  handleSignaling(socket);
});

try {
  await server.listen({ port: Number(process.env.PORT) || 3001, host: '0.0.0.0' });
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
