/**
 * Адаптер для работы с базой данных
 * Использует новую абстракцию DatabaseManager
 */

const { dbManager } = require('./database');
const { secureToken, extractToken, isEncryptionKeyConfigured } = require('./token-encryption');

// Gift types and IDs
const GIFT_TYPES = {
  COMMON: 'common',
  UNCOMMON: 'uncommon', 
  RARE: 'rare'
};

const GIFT_IDS = {
  [GIFT_TYPES.COMMON]: ['1'],
  [GIFT_TYPES.UNCOMMON]: ['1'],
  [GIFT_TYPES.RARE]: ['1']
};

// Функции для работы с пользователями
async function saveOrUpdateUser(user) {
  const now = Math.floor(Date.now() / 1000);
  
  // Шифруем токены перед сохранением
  const encryptedAccessToken = secureToken(user.access_token);
  const encryptedRefreshToken = secureToken(user.refresh_token);
  
  // Проверяем, что ключ шифрования настроен
  if (!isEncryptionKeyConfigured()) {
    console.warn('WARNING: Token encryption key not configured. Tokens will be stored in plaintext!');
  }
  
  const sql = dbManager.isPostgreSQL() 
    ? `
      INSERT INTO users (
        twitch_user_id, display_name, login, profile_image_url, access_token, 
        refresh_token, scope, expires_at, updated_at, coins
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (twitch_user_id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        login = EXCLUDED.login,
        profile_image_url = EXCLUDED.profile_image_url,
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        scope = EXCLUDED.scope,
        expires_at = EXCLUDED.expires_at,
        updated_at = EXCLUDED.updated_at,
        coins = EXCLUDED.coins
    `
    : `
      INSERT INTO users (
        twitch_user_id, display_name, login, profile_image_url, access_token, 
        refresh_token, scope, expires_at, updated_at, coins
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (twitch_user_id) DO UPDATE SET
        display_name = excluded.display_name,
        login = excluded.login,
        profile_image_url = excluded.profile_image_url,
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        scope = excluded.scope,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at,
        coins = excluded.coins
    `;
  
  const params = [
    user.twitch_user_id,
    user.display_name || null,
    user.login || null,
    user.profile_image_url || null,
    encryptedAccessToken,
    encryptedRefreshToken,
    Array.isArray(user.scope) ? user.scope.join(' ') : (user.scope || null),
    user.expires_at || null,
    now,
    user.coins || 0
  ];
  
  await dbManager.query(sql, params);
  
  // Update DonationAlerts cache if available
  try {
    const { updateUserInCache } = require('./donationalerts');
    updateUserInCache(user);
  } catch (error) {
    // Ignore if DonationAlerts module is not available
  }
}

async function getUserByTwitchId(twitchUserId) {
  const user = await dbManager.get(
    'SELECT * FROM users WHERE twitch_user_id = ?',
    [twitchUserId]
  );
  
  if (user) {
    // Расшифровываем токены при получении
    user.access_token = extractToken(user.access_token);
    user.refresh_token = extractToken(user.refresh_token);
  }
  
  return user;
}

async function getUserByLogin(login) {
  const user = await dbManager.get(
    'SELECT * FROM users WHERE login = ?',
    [login]
  );
  
  if (user) {
    // Расшифровываем токены при получении
    user.access_token = extractToken(user.access_token);
    user.refresh_token = extractToken(user.refresh_token);
  }
  
  return user;
}

async function getAllUsers() {
  const users = await dbManager.all('SELECT * FROM users');
  
  // Расшифровываем токены для всех пользователей
  return users.map(user => {
    user.access_token = extractToken(user.access_token);
    user.refresh_token = extractToken(user.refresh_token);
    return user;
  });
}

// Функции для работы с DonationAlerts
async function updateUserDAConnection(twitchUserId, daUsername) {
  const now = Math.floor(Date.now() / 1000);
  await dbManager.query(
    'UPDATE users SET da_username = ?, updated_at = ? WHERE twitch_user_id = ?',
    [daUsername, now, twitchUserId]
  );
}

async function getUserDAConnection(twitchUserId) {
  const user = await dbManager.get(
    'SELECT da_username FROM users WHERE twitch_user_id = ?',
    [twitchUserId]
  );
  return user ? user.da_username : null;
}

async function getUsersWithDAConnection() {
  return await dbManager.all('SELECT * FROM users WHERE da_username IS NOT NULL');
}

// Функции для работы с токенами DonationAlerts стримеров
async function upsertStreamerDA(creds) {
  const now = Math.floor(Date.now() / 1000);
  
  // Шифруем DonationAlerts токены
  const encryptedAccessToken = secureToken(creds.da_access_token);
  const encryptedRefreshToken = secureToken(creds.da_refresh_token);
  
  const sql = dbManager.isPostgreSQL()
    ? `
      INSERT INTO streamers (
        streamer_twitch_id, twitch_login, da_user_id, da_access_token, 
        da_refresh_token, da_expires_at, status, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (streamer_twitch_id) DO UPDATE SET
        twitch_login = EXCLUDED.twitch_login,
        da_user_id = EXCLUDED.da_user_id,
        da_access_token = EXCLUDED.da_access_token,
        da_refresh_token = EXCLUDED.da_refresh_token,
        da_expires_at = EXCLUDED.da_expires_at,
        status = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at
    `
    : `
      INSERT INTO streamers (
        streamer_twitch_id, twitch_login, da_user_id, da_access_token, 
        da_refresh_token, da_expires_at, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (streamer_twitch_id) DO UPDATE SET
        twitch_login = excluded.twitch_login,
        da_user_id = excluded.da_user_id,
        da_access_token = excluded.da_access_token,
        da_refresh_token = excluded.da_refresh_token,
        da_expires_at = excluded.da_expires_at,
        status = excluded.status,
        updated_at = excluded.updated_at
    `;
  
  const params = [
    creds.streamer_twitch_id,
    creds.twitch_login || null,
    creds.da_user_id,
    encryptedAccessToken,
    encryptedRefreshToken,
    creds.da_expires_at,
    creds.status || 'active',
    now
  ];
  
  return await dbManager.query(sql, params);
}

async function getStreamerDA(streamerTwitchId) {
  const streamer = await dbManager.get(
    'SELECT * FROM streamers WHERE streamer_twitch_id = ?',
    [streamerTwitchId]
  );
  
  if (streamer) {
    // Расшифровываем DonationAlerts токены
    streamer.da_access_token = extractToken(streamer.da_access_token);
    streamer.da_refresh_token = extractToken(streamer.da_refresh_token);
  }
  
  return streamer;
}

async function getAllStreamers() {
  const streamers = await dbManager.all(
    'SELECT * FROM streamers WHERE status = ?',
    ['active']
  );
  
  // Расшифровываем токены для всех стримеров
  return streamers.map(streamer => {
    streamer.da_access_token = extractToken(streamer.da_access_token);
    streamer.da_refresh_token = extractToken(streamer.da_refresh_token);
    return streamer;
  });
}

// Функции для работы с подарками
async function addGiftToUser(twitchUserId, streamerTwitchId, giftType, giftId, count = 1) {
  const now = Math.floor(Date.now() / 1000);
  
  const sql = dbManager.isPostgreSQL()
    ? `
      INSERT INTO user_gifts (twitch_user_id, streamer_twitch_id, gift_type, gift_id, count, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (twitch_user_id, streamer_twitch_id, gift_type, gift_id) 
      DO UPDATE SET count = user_gifts.count + $5, updated_at = $6
    `
    : `
      INSERT INTO user_gifts (twitch_user_id, streamer_twitch_id, gift_type, gift_id, count, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (twitch_user_id, streamer_twitch_id, gift_type, gift_id) 
      DO UPDATE SET count = user_gifts.count + ?, updated_at = ?
    `;
  
  const params = [twitchUserId, streamerTwitchId, giftType, giftId, count, now, count, now];
  return await dbManager.query(sql, params);
}

async function getUserGifts(twitchUserId, streamerTwitchId = null) {
  let sql = 'SELECT * FROM user_gifts WHERE twitch_user_id = ?';
  const params = [twitchUserId];
  
  if (streamerTwitchId) {
    sql += ' AND streamer_twitch_id = ?';
    params.push(streamerTwitchId);
  }
  
  return await dbManager.all(sql, params);
}

async function getUserGiftStats(twitchUserId, streamerTwitchId = null) {
  let sql = `
    SELECT gift_type, SUM(count) as total_gifts 
    FROM user_gifts 
    WHERE twitch_user_id = ?
  `;
  const params = [twitchUserId];
  
  if (streamerTwitchId) {
    sql += ' AND streamer_twitch_id = ?';
    params.push(streamerTwitchId);
  }
  
  sql += ' GROUP BY gift_type';
  
  return await dbManager.all(sql, params);
}

async function getRandomGift() {
  const giftTypes = Object.keys(GIFT_TYPES);
  const randomType = giftTypes[Math.floor(Math.random() * giftTypes.length)];
  const giftIds = GIFT_IDS[randomType];
  const randomGiftId = giftIds[Math.floor(Math.random() * giftIds.length)];
  
  return {
    type: randomType,
    id: `gift_${randomType}_${randomGiftId}`
  };
}

async function getAvailableGifts() {
  return await dbManager.all('SELECT * FROM gifts ORDER BY gift_type, gift_id');
}

async function getGiftInfo(giftType, giftId) {
  const gift = await dbManager.get(
    'SELECT * FROM gifts WHERE gift_type = ? AND gift_id = ?',
    [giftType, giftId]
  );
  
  if (gift) {
    return {
      name: gift.name,
      description: gift.description
    };
  }
  
  return {
    name: `Подарок ${giftType} #${giftId}`,
    description: `Описание подарка ${giftType} #${giftId}`
  };
}

// Функции для работы с аватарами
async function saveOrUpdateAvatar(avatar) {
  const now = Math.floor(Date.now() / 1000);
  
  const sql = dbManager.isPostgreSQL()
    ? `
      INSERT INTO avatars (twitch_user_id, body_skin, face_skin, clothes_type, others_type, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (twitch_user_id) DO UPDATE SET
        body_skin = EXCLUDED.body_skin,
        face_skin = EXCLUDED.face_skin,
        clothes_type = EXCLUDED.clothes_type,
        others_type = EXCLUDED.others_type,
        updated_at = EXCLUDED.updated_at
    `
    : `
      INSERT INTO avatars (twitch_user_id, body_skin, face_skin, clothes_type, others_type, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (twitch_user_id) DO UPDATE SET
        body_skin = excluded.body_skin,
        face_skin = excluded.face_skin,
        clothes_type = excluded.clothes_type,
        others_type = excluded.others_type,
        updated_at = excluded.updated_at
    `;
  
  const params = [
    avatar.twitch_user_id,
    avatar.body_skin || 1,
    avatar.face_skin || 1,
    avatar.clothes_type || 1,
    avatar.others_type || 1,
    now
  ];
  
  return await dbManager.query(sql, params);
}

async function getAvatarByTwitchId(twitchUserId) {
  return await dbManager.get(
    'SELECT * FROM avatars WHERE twitch_user_id = ?',
    [twitchUserId]
  );
}

// Функции для идемпотентности донатов
async function markDonationProcessed(streamerTwitchId, donationId) {
  const now = Math.floor(Date.now() / 1000);
  
  const sql = dbManager.isPostgreSQL()
    ? `
      INSERT INTO donations_processed (streamer_twitch_id, donation_id, processed_at)
      VALUES ($1, $2, $3)
      ON CONFLICT (streamer_twitch_id, donation_id) DO NOTHING
    `
    : `
      INSERT OR IGNORE INTO donations_processed (streamer_twitch_id, donation_id, processed_at)
      VALUES (?, ?, ?)
    `;
  
  return await dbManager.query(sql, [streamerTwitchId, donationId, now]);
}

async function isDonationProcessed(streamerTwitchId, donationId) {
  const result = await dbManager.get(
    'SELECT id FROM donations_processed WHERE streamer_twitch_id = ? AND donation_id = ?',
    [streamerTwitchId, donationId]
  );
  
  return !!result;
}

// Функции для настроек игр
async function saveOrUpdateGameSettings(settings) {
  const now = Math.floor(Date.now() / 1000);
  
  const sql = dbManager.isPostgreSQL()
    ? `
      INSERT INTO streamer_game_settings (streamer_id, min_participants, max_participants, registration_time, updated_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (streamer_id) DO UPDATE SET
        min_participants = EXCLUDED.min_participants,
        max_participants = EXCLUDED.max_participants,
        registration_time = EXCLUDED.registration_time,
        updated_at = EXCLUDED.updated_at
    `
    : `
      INSERT INTO streamer_game_settings (streamer_id, min_participants, max_participants, registration_time, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (streamer_id) DO UPDATE SET
        min_participants = excluded.min_participants,
        max_participants = excluded.max_participants,
        registration_time = excluded.registration_time,
        updated_at = excluded.updated_at
    `;
  
  const params = [
    settings.streamer_id,
    settings.min_participants || 1,
    settings.max_participants || 10,
    settings.registration_time || 10,
    now
  ];
  
  return await dbManager.query(sql, params);
}

async function getGameSettings(streamerId) {
  return await dbManager.get(
    'SELECT * FROM streamer_game_settings WHERE streamer_id = ?',
    [streamerId]
  );
}

// Экспорт всех функций
module.exports = {
  // Пользователи
  saveOrUpdateUser,
  getUserByTwitchId,
  getUserByLogin,
  getAllUsers,
  
  // DonationAlerts
  updateUserDAConnection,
  getUserDAConnection,
  getUsersWithDAConnection,
  upsertStreamerDA,
  getStreamerDA,
  getAllStreamers,
  
  // Подарки
  addGiftToUser,
  getUserGifts,
  getUserGiftStats,
  getRandomGift,
  getAvailableGifts,
  getGiftInfo,
  
  // Аватары
  saveOrUpdateAvatar,
  getAvatarByTwitchId,
  
  // Донаты
  markDonationProcessed,
  isDonationProcessed,
  
  // Настройки игр
  saveOrUpdateGameSettings,
  getGameSettings,
  
  // Константы
  GIFT_TYPES,
  GIFT_IDS
};
