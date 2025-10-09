const Redis = require('ioredis');
const { randomUUID } = require('crypto');
const {
  REDIS_URL,
  REDIS_HOST,
  REDIS_PORT,
  REDIS_USERNAME,
  REDIS_PASSWORD,
  REDIS_DB
} = require('./config');

const instanceId = randomUUID();

let commandClient = null;
const subscribers = new Set();
let redisAvailable = true;
let connectionAttempts = 0;
const MAX_RETRY_ATTEMPTS = 3; // Уменьшили с 5 до 3 для более быстрой остановки

console.log('[redis] Initializing Redis clients...');
if (!REDIS_HOST && !REDIS_URL) {
  console.warn('[redis] No REDIS_HOST or REDIS_URL configured, Redis will be disabled');
  redisAvailable = false;
}

function buildOptions(role) {
  const base = {
    enableReadyCheck: true,
    lazyConnect: false,
    maxRetriesPerRequest: null,
    retryStrategy(times) {
      connectionAttempts++;
      
      // После 5 попыток отключаем автоповтор
      if (connectionAttempts >= MAX_RETRY_ATTEMPTS) {
        console.error(`[redis:${role}] Max retry attempts reached. Redis will be disabled.`);
        console.error(`[redis:${role}] Install Redis: brew install redis && brew services start redis`);
        redisAvailable = false;
        return null; // Останавливаем повторные попытки
      }
      
      const delay = Math.min(1000 * Math.pow(2, times), 30000);
      console.error(`[redis:${role}] reconnecting in ${delay}ms (attempt ${times}/${MAX_RETRY_ATTEMPTS})`);
      return delay;
    },
    connectionName: `avatar-${role}`
  };

  if (REDIS_URL) {
    return base;
  }

  return {
    ...base,
    host: REDIS_HOST,
    port: REDIS_PORT,
    username: REDIS_USERNAME || undefined,
    password: REDIS_PASSWORD || undefined,
    db: Number.isFinite(REDIS_DB) ? REDIS_DB : undefined
  };
}

function createClient(role) {
  const options = buildOptions(role);
  const client = REDIS_URL ? new Redis(REDIS_URL, options) : new Redis(options);
  client.on('error', err => {
    console.error(`[redis:${role}]`, err);
  });
  client.on('end', () => {
    console.warn(`[redis:${role}] connection closed`);
  });
  return client;
}

function getRedisClient() {
  if (!redisAvailable) {
    return null;
  }
  if (!commandClient) {
    commandClient = createClient('command');
  }
  return commandClient;
}

function createRedisSubscriber(role = 'subscriber') {
  if (!redisAvailable) {
    console.warn(`[redis:${role}] Redis is not available, returning mock subscriber`);
    return null;
  }
  const client = createClient(role);
  subscribers.add(client);
  client.once('end', () => subscribers.delete(client));
  return client;
}

async function disconnectAllRedisClients() {
  const promises = [];
  if (commandClient) {
    promises.push(commandClient.quit().catch(() => commandClient.disconnect()));
    commandClient = null;
  }
  for (const sub of subscribers) {
    promises.push(sub.quit().catch(() => sub.disconnect()));
    subscribers.delete(sub);
  }
  await Promise.allSettled(promises);
}

module.exports = {
  getRedisClient,
  createRedisSubscriber,
  disconnectAllRedisClients,
  redisInstanceId: instanceId
};
