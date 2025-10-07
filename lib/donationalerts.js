const { getAllUsers } = require('../db');
const { getRedisClient, createRedisSubscriber, redisInstanceId } = require('./redis');

// Cache for user lookups by username (case-insensitive)
const usernameCache = new Map();
const redis = getRedisClient();
const subscriber = createRedisSubscriber('da-cache');

const USERNAME_HASH_KEY = 'da:usernames';
const USERNAME_CHANNEL = 'da:usernames:updates';

subscriber.subscribe(USERNAME_CHANNEL, err => {
  if (err) {
    console.error('[DA] Failed to subscribe to username updates:', err);
  }
});

subscriber.on('message', (channel, message) => {
  if (channel !== USERNAME_CHANNEL) return;
  try {
    const payload = JSON.parse(message);
    if (!payload || payload.source === redisInstanceId) return;
    const user = payload.user;
    if (user && user.login) {
      const normalized = user.login.toLowerCase();
      usernameCache.set(normalized, user);
      console.log(`[DA] Synced username cache for ${user.login}`);
    }
  } catch (error) {
    console.error('[DA] Failed to process username cache update:', error);
  }
});

function normalize(username) {
  return username.toLowerCase().trim();
}

async function publishUserUpdate(user) {
  if (!user || !user.login) {
    return;
  }

  const normalized = normalize(user.login);
  const payload = JSON.stringify({ source: redisInstanceId, user });
  try {
    await redis.hset(USERNAME_HASH_KEY, normalized, JSON.stringify(user));
    await redis.publish(USERNAME_CHANNEL, payload);
  } catch (error) {
    console.error(`[DA] Failed to publish username cache update for ${user.login}:`, error);
  }
}

function initializeUsernameCache() {
  try {
    const users = getAllUsers();

    users.forEach(user => {
      if (user.login) {
        usernameCache.set(user.login.toLowerCase(), user);
      }
    });

    console.log(`[DA] Initialized username cache with ${usernameCache.size} users`);

    // Prime Redis asynchronously
    (async () => {
      const pipeline = redis.pipeline();
      for (const [key, user] of usernameCache.entries()) {
        pipeline.hset(USERNAME_HASH_KEY, key, JSON.stringify(user));
      }
      try {
        await pipeline.exec();
      } catch (error) {
        console.error('[DA] Failed to prime Redis username cache:', error);
      }
    })();
  } catch (error) {
    console.error('[DA] Error initializing username cache:', error);
  }
}

// Find user by username (case-insensitive)
function findUserByUsername(username) {
  const normalizedUsername = normalize(username);
  return usernameCache.get(normalizedUsername) || null;
}

// Add user to cache
function addUserToCache(user) {
  if (!user || !user.login) return;
  const normalized = normalize(user.login);
  usernameCache.set(normalized, user);
  publishUserUpdate(user).catch(error => {
    console.error('[DA] Failed to replicate username cache add:', error);
  });
}

// Update user in cache
function updateUserInCache(user) {
  if (!user || !user.login) return;
  const normalized = normalize(user.login);
  usernameCache.set(normalized, user);
  publishUserUpdate(user).catch(error => {
    console.error('[DA] Failed to replicate username cache update:', error);
  });
}

module.exports = {
  initializeUsernameCache,
  addUserToCache,
  updateUserInCache,
  findUserByUsername
};
