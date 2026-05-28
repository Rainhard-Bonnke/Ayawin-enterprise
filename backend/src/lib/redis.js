let client = null;

function isRedisEnabled() {
  return Boolean(process.env.REDIS_URL || process.env.REDIS_HOST);
}

async function getRedis() {
  if (!isRedisEnabled()) return null;
  if (client) return client;

  const Redis = require('ioredis');
  client = process.env.REDIS_URL
    ? new Redis(process.env.REDIS_URL)
    : new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT) || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
      });

  client.on('error', (err) => {
    console.error('[redis]', err.message);
  });

  return client;
}

async function cacheGet(key) {
  const redis = await getRedis();
  if (!redis) return null;
  const value = await redis.get(key);
  return value ? JSON.parse(value) : null;
}

async function cacheSet(key, value, ttlSeconds = 300) {
  const redis = await getRedis();
  if (!redis) return;
  await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
}

async function cacheDel(key) {
  const redis = await getRedis();
  if (!redis) return;
  await redis.del(key);
}

module.exports = { getRedis, cacheGet, cacheSet, cacheDel, isRedisEnabled };
