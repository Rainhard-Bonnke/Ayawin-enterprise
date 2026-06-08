let client = null;
let redisDisabled = false;

function isRedisEnabled() {
  if (redisDisabled) return false;
  if (process.env.REDIS_URL) return true;
  return process.env.REDIS_ENABLED === 'true';
}

function disableRedis(reason) {
  if (!redisDisabled) {
    redisDisabled = true;
    console.warn(`[redis] disabled: ${reason}`);
  }
  if (client) {
    try {
      client.disconnect();
    } catch {
      /* ignore */
    }
    client = null;
  }
}

async function getRedis() {
  if (!isRedisEnabled()) return null;
  if (client) return client;

  const Redis = require('ioredis');
  const options = process.env.REDIS_URL
    ? process.env.REDIS_URL
    : {
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT) || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
        lazyConnect: true,
      };

  client = new Redis(options);
  client.on('error', (err) => {
    console.error('[redis]', err.message);
    disableRedis(err.message);
  });

  try {
    await client.connect();
  } catch (err) {
    disableRedis(err.message);
    return null;
  }

  return client;
}

async function cacheGet(key) {
  try {
    const redis = await getRedis();
    if (!redis) return null;
    const value = await redis.get(key);
    return value ? JSON.parse(value) : null;
  } catch (err) {
    disableRedis(err.message);
    return null;
  }
}

async function cacheSet(key, value, ttlSeconds = 300) {
  try {
    const redis = await getRedis();
    if (!redis) return;
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (err) {
    disableRedis(err.message);
  }
}

async function cacheDel(key) {
  try {
    const redis = await getRedis();
    if (!redis) return;
    await redis.del(key);
  } catch (err) {
    disableRedis(err.message);
  }
}

module.exports = { getRedis, cacheGet, cacheSet, cacheDel, isRedisEnabled, disableRedis };
