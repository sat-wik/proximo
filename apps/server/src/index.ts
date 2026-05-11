import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { createSession } from './session-store.js';
import { handleSignaling } from './routes/signal.js';
import { getRank } from './services/embedding-service.js';

const server = Fastify({ logger: true });

await server.register(cors, { origin: true });
await server.register(websocket);

server.get('/health', async () => {
  return { status: 'ok' };
});

server.post('/session', async () => {
  const session = createSession();
  return { sessionId: session.id };
});

server.get('/rank', async (request, reply) => {
  const { target, word } = request.query as { target?: string; word?: string };
  if (!target || !word) return reply.status(400).send({ error: 'target and word required' });
  const rank = await getRank(target, word.toLowerCase());
  if (rank === null) return reply.status(404).send({ error: 'Word not in dictionary' });
  return { rank };
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
