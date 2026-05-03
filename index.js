import express from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter.js';
import { ExpressAdapter } from '@bull-board/express';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import basicAuth from 'express-basic-auth';

const PORT = Number(process.env.PORT || 3000);
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const parsed = (process.env.QUEUE_NAMES || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const queueNames = parsed.length > 0 ? parsed : ['default'];
const BULL_PREFIX = process.env.BULL_PREFIX || 'bull';

const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/');

const queues = queueNames.map(
  (name) =>
    new BullMQAdapter(
      new Queue(name, {
        connection,
        prefix: BULL_PREFIX,
      }),
    ),
);

createBullBoard({
  queues,
  serverAdapter,
});

const app = express();

app.get('/health', (_req, res) => {
  res.status(200).send('ok');
});

const user = process.env.BASIC_AUTH_USER;
const pass = process.env.BASIC_AUTH_PASS;
if (user && pass) {
  app.use(
    basicAuth({
      users: { [user]: pass },
      challenge: true,
    }),
  );
}

app.use('/', serverAdapter.getRouter());

app.listen(PORT, '0.0.0.0', () => {
  console.log(`bull-board listening on 0.0.0.0:${PORT} queues=${queueNames.join('|')}`);
});
