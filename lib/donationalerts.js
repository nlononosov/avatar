const { getAllUsers } = require('../db');

// Cache for user lookups by username (case-insensitive)
const usernameCache = new Map();

// Initialize username cache on startup
function initializeUsernameCache() {
  try {
    const { getAllUsers } = require('../db');
    const users = getAllUsers();
    
    users.forEach(user => {
      if (user.login) {
        usernameCache.set(user.login.toLowerCase(), user);
      }
    });
    
    console.log(`[DA] Initialized username cache with ${usernameCache.size} users`);
  } catch (error) {
    console.error('[DA] Error initializing username cache:', error);
  }
}

// Find user by username (case-insensitive)
function findUserByUsername(username) {
  const normalizedUsername = username.toLowerCase().trim();
  return usernameCache.get(normalizedUsername);
}

// Add user to cache
function addUserToCache(user) {
  if (user.login) {
    usernameCache.set(user.login.toLowerCase(), user);
  }
}

// Update user in cache
function updateUserInCache(user) {
  if (user.login) {
    usernameCache.set(user.login.toLowerCase(), user);
  }
}

// Legacy functions removed - use lib/donationalerts-poll.js instead

// Legacy polling and processing functions removed - use lib/donationalerts-poll.js instead

module.exports = {
  initializeUsernameCache,
  addUserToCache,
  updateUserInCache,
  findUserByUsername
};
