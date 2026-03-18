const express = require('express');
const Redis = require('ioredis');
const { createBullBoard } = require('@bull-board/api');
const { BullMQAdapter } = require('@bull-board/api/bullMQAdapter');
const { ExpressAdapter } = require('@bull-board/express');
const { Queue } = require('bullmq');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const PORT = parseInt(process.env.PORT || '3000', 10);
const SCAN_INTERVAL_MS = 60_000;

function parseRedisUrl(url) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    password: parsed.password || undefined,
  };
}

async function discoverQueues(redis) {
  const names = new Set();
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'bull:*:meta', 'COUNT', 200);
    cursor = next;
    for (const key of keys) {
      const name = key.replace(/^bull:/, '').replace(/:meta$/, '');
      names.add(name);
    }
  } while (cursor !== '0');
  return [...names].sort();
}

async function main() {
  const connOpts = parseRedisUrl(REDIS_URL);
  const redis = new Redis({ ...connOpts, maxRetriesPerRequest: null, enableReadyCheck: false, lazyConnect: true });
  await redis.connect();
  console.log(`Connected to Redis at ${connOpts.host}:${connOpts.port}`);

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/');

  const { addQueue, removeQueue, setQueues } = createBullBoard({
    queues: [],
    serverAdapter,
    options: {
      uiConfig: {
        boardTitle: 'Gaqno Queues',
      },
    },
  });

  const tracked = new Map();

  async function refreshQueues() {
    try {
      const names = await discoverQueues(redis);
      const current = new Set(tracked.keys());

      for (const name of names) {
        if (!tracked.has(name)) {
          const queue = new Queue(name, { connection: { ...connOpts, maxRetriesPerRequest: null, enableReadyCheck: false } });
          const adapter = new BullMQAdapter(queue);
          addQueue(adapter);
          tracked.set(name, { queue, adapter });
        }
      }

      for (const name of current) {
        if (!names.includes(name)) {
          const entry = tracked.get(name);
          removeQueue(entry.adapter);
          await entry.queue.close();
          tracked.delete(name);
        }
      }

      console.log(`Tracking ${tracked.size} queues`);
    } catch (err) {
      console.error('Queue refresh error:', err.message);
    }
  }

  await refreshQueues();
  setInterval(refreshQueues, SCAN_INTERVAL_MS);

  const app = express();

  app.get('/health', (_req, res) => res.json({ status: 'ok', queues: tracked.size }));
  app.use('/', serverAdapter.getRouter());

  app.listen(PORT, () => console.log(`Bull Board running on :${PORT}`));
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
