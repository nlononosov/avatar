const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

const {
  DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/avatar',
  PGPOOL_MAX,
  PGPOOL_IDLE_TIMEOUT,
  PGPOOL_CONNECTION_TIMEOUT
} = process.env;

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: PGPOOL_MAX ? Number(PGPOOL_MAX) : 20,
  idleTimeoutMillis: PGPOOL_IDLE_TIMEOUT ? Number(PGPOOL_IDLE_TIMEOUT) : 30000,
  connectionTimeoutMillis: PGPOOL_CONNECTION_TIMEOUT ? Number(PGPOOL_CONNECTION_TIMEOUT) : 2000
});

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

const initPromise = initialize().catch(error => {
  console.error('[db] Initialization failed:', error);
  throw error;
});

async function initialize() {
  await withClient(async client => {
    await client.query('BEGIN');
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          twitch_user_id TEXT UNIQUE NOT NULL,
          display_name TEXT,
          login TEXT,
          profile_image_url TEXT,
          access_token TEXT NOT NULL,
          refresh_token TEXT,
          scope TEXT,
          expires_at BIGINT,
          updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())),
          coins INTEGER NOT NULL DEFAULT 0,
          da_username TEXT,
          da_user_id TEXT,
          avatar_timeout_seconds INTEGER NOT NULL DEFAULT 300
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS streamer_game_settings (
          streamer_id TEXT PRIMARY KEY,
          min_participants INTEGER NOT NULL DEFAULT 1,
          max_participants INTEGER NOT NULL DEFAULT 10,
          registration_time INTEGER NOT NULL DEFAULT 10,
          created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())),
          updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()))
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS gifts (
          id TEXT PRIMARY KEY,
          gift_type TEXT NOT NULL,
          gift_id TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000),
          updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS user_avatars (
          twitch_user_id TEXT PRIMARY KEY,
          body_skin TEXT NOT NULL DEFAULT 'body_skin_1',
          face_skin TEXT NOT NULL DEFAULT 'face_skin_1',
          clothes_type TEXT NOT NULL DEFAULT 'clothes_type_1',
          others_type TEXT NOT NULL DEFAULT 'others_1',
          created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000),
          updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000),
          CONSTRAINT fk_user_avatars_user
            FOREIGN KEY (twitch_user_id) REFERENCES users(twitch_user_id)
            ON DELETE CASCADE
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS locked_skins (
          id SERIAL PRIMARY KEY,
          skin_type TEXT NOT NULL,
          skin_id TEXT NOT NULL,
          price INTEGER NOT NULL DEFAULT 100,
          is_locked BOOLEAN NOT NULL DEFAULT TRUE,
          created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000),
          UNIQUE (skin_type, skin_id)
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS user_purchased_skins (
          id SERIAL PRIMARY KEY,
          twitch_user_id TEXT NOT NULL,
          skin_type TEXT NOT NULL,
          skin_id TEXT NOT NULL,
          purchased_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000),
          UNIQUE (twitch_user_id, skin_type, skin_id),
          CONSTRAINT fk_user_purchased_skins_user
            FOREIGN KEY (twitch_user_id) REFERENCES users(twitch_user_id)
            ON DELETE CASCADE
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS user_gifts (
          id SERIAL PRIMARY KEY,
          twitch_user_id TEXT NOT NULL,
          gift_type TEXT NOT NULL,
          gift_id TEXT NOT NULL,
          count INTEGER NOT NULL DEFAULT 1,
          created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000),
          updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000),
          UNIQUE (twitch_user_id, gift_type, gift_id),
          CONSTRAINT fk_user_gifts_user
            FOREIGN KEY (twitch_user_id) REFERENCES users(twitch_user_id)
            ON DELETE CASCADE
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS user_streamers (
          id SERIAL PRIMARY KEY,
          user_twitch_id TEXT NOT NULL,
          streamer_twitch_id TEXT NOT NULL,
          created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000),
          UNIQUE (user_twitch_id, streamer_twitch_id),
          CONSTRAINT fk_user_streamers_user
            FOREIGN KEY (user_twitch_id) REFERENCES users(twitch_user_id)
            ON DELETE CASCADE,
          CONSTRAINT fk_user_streamers_streamer
            FOREIGN KEY (streamer_twitch_id) REFERENCES users(twitch_user_id)
            ON DELETE CASCADE
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS streamers (
          streamer_twitch_id TEXT PRIMARY KEY,
          twitch_login TEXT,
          da_user_id TEXT,
          da_access_token TEXT,
          da_refresh_token TEXT,
          da_expires_at BIGINT,
          status TEXT DEFAULT 'active',
          created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000),
          updated_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS da_poll_locks (
          streamer_twitch_id TEXT PRIMARY KEY,
          locked_by TEXT,
          locked_until BIGINT NOT NULL DEFAULT 0
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS streamer_overlay_state (
          streamer_id TEXT PRIMARY KEY,
          state_json TEXT NOT NULL,
          updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000),
          CONSTRAINT fk_streamer_overlay_state_user
            FOREIGN KEY (streamer_id) REFERENCES users(twitch_user_id)
            ON DELETE CASCADE
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS donations_processed (
          id SERIAL PRIMARY KEY,
          streamer_twitch_id TEXT NOT NULL,
          donation_id TEXT NOT NULL,
          created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000),
          UNIQUE (streamer_twitch_id, donation_id)
        );
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_streamers_da_user_id
        ON streamers(da_user_id);
      `);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });

  await initializeGifts();
  await initializeLockedSkins();
  await clearOldGifts();
}

async function withClient(fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

async function query(sql, params = []) {
  await initPromise;
  const { rows } = await pool.query(sql, params);
  return rows;
}

async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

async function run(sql, params = []) {
  await initPromise;
  return pool.query(sql, params);
}

async function initializeGifts() {
  const now = Date.now();
  const gifts = [
    { id: 'gift_common_1', gift_type: 'common', gift_id: '1', name: 'Печенька', description: 'Вкусное печенье для поднятия настроения' },
    { id: 'gift_uncommon_1', gift_type: 'uncommon', gift_id: '1', name: 'Коробочка', description: 'Загадчная коробочка с сюрпризом' },
    { id: 'gift_rare_1', gift_type: 'rare', gift_id: '1', name: 'Тортик', description: 'Праздничный тортик для особого случая' }
  ];

  for (const gift of gifts) {
    const existing = await queryOne('SELECT id FROM gifts WHERE id = $1', [gift.id]);
    if (!existing) {
      await run(
        `INSERT INTO gifts (id, gift_type, gift_id, name, description, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [gift.id, gift.gift_type, gift.gift_id, gift.name, gift.description, now, now]
      );
    }
  }
}

async function initializeLockedSkins() {
  try {
    const existing = await queryOne('SELECT COUNT(*)::int AS count FROM locked_skins');
    if (existing && existing.count === 0) {
      const lockedSkins = [
        { skin_type: 'clothes', skin_id: 'clothes_type_2', price: 150 },
        { skin_type: 'body', skin_id: 'body_skin_2', price: 200 },
        { skin_type: 'face', skin_id: 'face_skin_2', price: 100 },
        { skin_type: 'others', skin_id: 'others_2', price: 120 }
      ];

      for (const skin of lockedSkins) {
        await run(
          'INSERT INTO locked_skins (skin_type, skin_id, price) VALUES ($1, $2, $3)
           ON CONFLICT (skin_type, skin_id) DO NOTHING',
          [skin.skin_type, skin.skin_id, skin.price]
        );
      }
      console.log('[db] Initialized locked skins');
    }
  } catch (error) {
    console.error('[db] Error initializing locked skins:', error);
  }
}

async function clearOldGifts() {
  try {
    const result = await run(
      `DELETE FROM user_gifts WHERE gift_type IN ('gift_common', 'gift_uncommon', 'gift_rare')`
    );
    if (result.rowCount && result.rowCount > 0) {
      console.log(`[db] Cleared ${result.rowCount} old gift records with incorrect types`);
    }
  } catch (error) {
    console.error('[db] Error clearing old gifts:', error);
  }
}

async function saveOrUpdateUser(user) {
  const now = Math.floor(Date.now() / 1000);
  await run(
    `INSERT INTO users (
      twitch_user_id, display_name, login, profile_image_url,
      access_token, refresh_token, scope, expires_at, updated_at, coins, da_username, da_user_id, avatar_timeout_seconds
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, 0), $11, $12, COALESCE($13, 300))
    ON CONFLICT (twitch_user_id) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      login = EXCLUDED.login,
      profile_image_url = EXCLUDED.profile_image_url,
      access_token = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      scope = EXCLUDED.scope,
      expires_at = EXCLUDED.expires_at,
      updated_at = EXCLUDED.updated_at,
      coins = EXCLUDED.coins,
      da_username = EXCLUDED.da_username,
      da_user_id = EXCLUDED.da_user_id,
      avatar_timeout_seconds = EXCLUDED.avatar_timeout_seconds`,
    [
      user.twitch_user_id,
      user.display_name || null,
      user.login || null,
      user.profile_image_url || null,
      user.access_token,
      user.refresh_token || null,
      Array.isArray(user.scope) ? user.scope.join(' ') : (user.scope || null),
      user.expires_at || null,
      now,
      user.coins || 0,
      user.da_username || null,
      user.da_user_id || null,
      user.avatar_timeout_seconds || null
    ]
  );

  try {
    const existingAvatar = await queryOne(
      'SELECT twitch_user_id FROM user_avatars WHERE twitch_user_id = $1',
      [user.twitch_user_id]
    );
    if (!existingAvatar) {
      await run(
        `INSERT INTO user_avatars (twitch_user_id, body_skin, face_skin, clothes_type, others_type, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (twitch_user_id) DO NOTHING`,
        [
          user.twitch_user_id,
          'body_skin_1',
          'face_skin_1',
          'clothes_type_1',
          'others_1',
          Date.now()
        ]
      );
      console.log(`[db] Created default avatar for user ${user.twitch_user_id}`);
    }
  } catch (avatarError) {
    console.error(`[db] Error creating avatar for user ${user.twitch_user_id}:`, avatarError.message);
  }

  try {
    const { updateUserInCache } = require('./lib/donationalerts');
    if (typeof updateUserInCache === 'function') {
      updateUserInCache(user);
    }
  } catch (error) {
    // ignore cache errors
  }
}

async function getUserByTwitchId(twitchUserId) {
  const row = await queryOne('SELECT * FROM users WHERE twitch_user_id = $1', [twitchUserId]);
  return normalizeUser(row);
}

async function getUserByLogin(login) {
  const row = await queryOne('SELECT * FROM users WHERE login = $1', [login]);
  return normalizeUser(row);
}

async function getAllUsers() {
  const rows = await query('SELECT * FROM users');
  return rows.map(normalizeUser);
}

function normalizeUser(row) {
  if (!row) return null;
  return {
    ...row,
    coins: typeof row.coins === 'number' ? row.coins : Number(row.coins || 0),
    avatar_timeout_seconds: typeof row.avatar_timeout_seconds === 'number'
      ? row.avatar_timeout_seconds
      : Number(row.avatar_timeout_seconds || 300)
  };
}

async function saveOrUpdateAvatar(twitchUserId, avatarData) {
  const now = Date.now();
  await run(
    `INSERT INTO user_avatars (twitch_user_id, body_skin, face_skin, clothes_type, others_type, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (twitch_user_id) DO UPDATE SET
       body_skin = EXCLUDED.body_skin,
       face_skin = EXCLUDED.face_skin,
       clothes_type = EXCLUDED.clothes_type,
       others_type = EXCLUDED.others_type,
       updated_at = EXCLUDED.updated_at`,
    [
      twitchUserId,
      avatarData.body_skin || 'body_skin_1',
      avatarData.face_skin || 'face_skin_1',
      avatarData.clothes_type || 'clothes_type_1',
      avatarData.others_type || 'others_1',
      now
    ]
  );
}

async function getAvatarByTwitchId(twitchUserId) {
  return queryOne('SELECT * FROM user_avatars WHERE twitch_user_id = $1', [twitchUserId]);
}

async function addGiftToUser(twitchUserId, giftType, giftId, count = 1) {
  const now = Date.now();
  await run(
    `INSERT INTO user_gifts (twitch_user_id, gift_type, gift_id, count, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (twitch_user_id, gift_type, gift_id) DO UPDATE SET
       count = user_gifts.count + EXCLUDED.count,
       updated_at = EXCLUDED.updated_at`,
    [twitchUserId, giftType, giftId, count, now]
  );
}

async function getUserGifts(twitchUserId) {
  const rows = await query(
    `SELECT twitch_user_id, gift_type, gift_id, count, created_at, updated_at
     FROM user_gifts WHERE twitch_user_id = $1`,
    [twitchUserId]
  );
  return rows.map(row => ({
    ...row,
    count: Number(row.count)
  }));
}

async function getUserGiftStats(twitchUserId) {
  const rows = await query(
    `SELECT gift_type, COUNT(*) AS unique_gifts, SUM(count) AS total_gifts
     FROM user_gifts
     WHERE twitch_user_id = $1
     GROUP BY gift_type`,
    [twitchUserId]
  );
  return rows.map(row => ({
    gift_type: row.gift_type,
    unique_gifts: Number(row.unique_gifts),
    total_gifts: Number(row.total_gifts)
  }));
}

function getRandomGift() {
  const giftTypes = Object.values(GIFT_TYPES);
  const randomType = giftTypes[Math.floor(Math.random() * giftTypes.length)];
  const availableIds = GIFT_IDS[randomType];
  const randomId = availableIds[Math.floor(Math.random() * availableIds.length)];

  return {
    type: randomType,
    id: randomId,
    path: `/parts/gift_${randomType}/gift_${randomType}_${randomId}.png`
  };
}

function getAvailableAvatarParts() {
  const partsDir = path.join(__dirname, 'parts');
  const layers = ['body', 'face', 'clothes', 'others'];
  const availableParts = {};

  layers.forEach(layer => {
    const layerDir = path.join(partsDir, layer);
    if (fs.existsSync(layerDir)) {
      const files = fs.readdirSync(layerDir)
        .filter(file => file.endsWith('.png'))
        .map(file => {
          const name = file.replace('.png', '');
          return {
            id: name,
            name: name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
            path: `/parts/${layer}/${file}`
          };
        });
      availableParts[layer] = files;
    } else {
      availableParts[layer] = [];
    }
  });

  return availableParts;
}

function getAvailableGifts() {
  const partsDir = path.join(__dirname, 'parts');
  const giftTypes = ['gift_common', 'gift_uncommon', 'gift_rare'];
  const availableGifts = {};

  giftTypes.forEach(giftType => {
    const giftDir = path.join(partsDir, giftType);
    if (fs.existsSync(giftDir)) {
      const files = fs.readdirSync(giftDir)
        .filter(file => file.endsWith('.png'))
        .map(file => {
          const name = file.replace('.png', '');
          const rarity = giftType.replace('gift_', '');
          return {
            id: name,
            name: name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
            path: `/parts/${giftType}/${file}`,
            rarity
          };
        });
      availableGifts[giftType] = files;
    } else {
      availableGifts[giftType] = [];
    }
  });

  return availableGifts;
}

async function updateAvatarPart(twitchUserId, partType, partId) {
  const now = Math.floor(Date.now() / 1000);
  const existingAvatar = await getAvatarByTwitchId(twitchUserId);
  if (!existingAvatar) {
    return false;
  }

  const fieldMap = {
    body: 'body_skin',
    face: 'face_skin',
    clothes: 'clothes_type',
    others: 'others_type'
  };

  const updateField = fieldMap[partType];
  if (!updateField) {
    return false;
  }

  await run(
    `UPDATE user_avatars
     SET ${updateField} = $1, updated_at = $2
     WHERE twitch_user_id = $3`,
    [partId, now, twitchUserId]
  );
  return true;
}

async function addUserToStreamer(userTwitchId, streamerTwitchId) {
  try {
    await run(
      `INSERT INTO user_streamers (user_twitch_id, streamer_twitch_id)
       VALUES ($1, $2)
       ON CONFLICT (user_twitch_id, streamer_twitch_id) DO NOTHING`,
      [userTwitchId, streamerTwitchId]
    );
    return true;
  } catch (error) {
    console.error('Error adding user to streamer:', error);
    return false;
  }
}

async function getStreamerUsers(streamerTwitchId, searchQuery = '') {
  const params = [streamerTwitchId];
  let sql = `
    SELECT DISTINCT
      u.twitch_user_id,
      u.display_name,
      u.login,
      u.profile_image_url,
      ua.body_skin,
      ua.face_skin,
      ua.clothes_type,
      ua.others_type,
      us.created_at
    FROM user_streamers us
    JOIN users u ON us.user_twitch_id = u.twitch_user_id
    LEFT JOIN user_avatars ua ON u.twitch_user_id = ua.twitch_user_id
    WHERE us.streamer_twitch_id = $1`;

  if (searchQuery.trim()) {
    sql += ' AND (u.display_name ILIKE $2 OR u.login ILIKE $3)';
    const searchPattern = `%${searchQuery.trim()}%`;
    params.push(searchPattern, searchPattern);
  }

  sql += ' ORDER BY us.created_at DESC';

  return query(sql, params);
}

async function getUserAvatarPreview(twitchUserId) {
  return queryOne(
    `SELECT ua.*, u.display_name, u.profile_image_url
     FROM user_avatars ua
     JOIN users u ON ua.twitch_user_id = u.twitch_user_id
     WHERE ua.twitch_user_id = $1`,
    [twitchUserId]
  );
}

async function giveGiftToUser(twitchUserId, giftType, giftId, count = 1) {
  const normalizedType = giftType.startsWith('gift_') ? giftType.replace('gift_', '') : giftType;
  await addGiftToUser(twitchUserId, normalizedType, giftId, count);
  return true;
}

async function getUserCoins(twitchUserId) {
  const row = await queryOne('SELECT coins FROM users WHERE twitch_user_id = $1', [twitchUserId]);
  return row ? Number(row.coins) : 0;
}

async function updateUserCoins(twitchUserId, coins) {
  await run('UPDATE users SET coins = $1, updated_at = $2 WHERE twitch_user_id = $3', [coins, Math.floor(Date.now() / 1000), twitchUserId]);
}

async function addUserCoins(twitchUserId, amount) {
  const currentCoins = await getUserCoins(twitchUserId);
  const newCoins = Math.max(0, currentCoins + amount);
  await updateUserCoins(twitchUserId, newCoins);
  return newCoins;
}

async function getLockedSkins() {
  return query('SELECT * FROM locked_skins WHERE is_locked = TRUE');
}

async function getUserPurchasedSkins(twitchUserId) {
  return query('SELECT skin_type, skin_id FROM user_purchased_skins WHERE twitch_user_id = $1', [twitchUserId]);
}

async function isSkinPurchased(twitchUserId, skinType, skinId) {
  const row = await queryOne(
    'SELECT 1 FROM user_purchased_skins WHERE twitch_user_id = $1 AND skin_type = $2 AND skin_id = $3',
    [twitchUserId, skinType, skinId]
  );
  return !!row;
}

async function purchaseSkin(twitchUserId, skinType, skinId, price) {
  const currentCoins = await getUserCoins(twitchUserId);
  if (currentCoins < price) {
    return { success: false, error: 'Недостаточно монет' };
  }

  try {
    await withClient(async client => {
      await client.query('BEGIN');
      try {
        const newCoins = currentCoins - price;
        await client.query('UPDATE users SET coins = $1 WHERE twitch_user_id = $2', [newCoins, twitchUserId]);
        await client.query(
          `INSERT INTO user_purchased_skins (twitch_user_id, skin_type, skin_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (twitch_user_id, skin_type, skin_id) DO NOTHING`,
          [twitchUserId, skinType, skinId]
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
    return { success: true, newCoins: currentCoins - price };
  } catch (error) {
    console.error('Error purchasing skin:', error);
    return { success: false, error: 'Ошибка при покупке скина' };
  }
}

async function getSkinPrice(skinType, skinId) {
  const row = await queryOne('SELECT price FROM locked_skins WHERE skin_type = $1 AND skin_id = $2', [skinType, skinId]);
  return row ? Number(row.price) : 0;
}

async function getAllSkinsWithPrices() {
  const allParts = getAvailableAvatarParts();
  const lockedSkins = await getLockedSkins();
  const lockedMap = new Map();
  lockedSkins.forEach(skin => {
    lockedMap.set(`${skin.skin_type}_${skin.skin_id}`, skin);
  });

  const result = [];
  Object.keys(allParts).forEach(skinType => {
    allParts[skinType].forEach(part => {
      const key = `${skinType}_${part.id}`;
      const lockedInfo = lockedMap.get(key);
      result.push({
        skinType,
        skinId: part.id,
        name: part.name,
        path: part.path,
        price: lockedInfo ? Number(lockedInfo.price) : 0,
        isLocked: !!lockedInfo,
        isLockedValue: lockedInfo ? lockedInfo.is_locked : false
      });
    });
  });

  return result;
}

async function updateSkinPrice(skinType, skinId, price, isLocked = true) {
  try {
    await run(
      `INSERT INTO locked_skins (skin_type, skin_id, price, is_locked)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (skin_type, skin_id) DO UPDATE SET
         price = EXCLUDED.price,
         is_locked = EXCLUDED.is_locked`,
      [skinType, skinId, price, isLocked]
    );
    return { success: true };
  } catch (error) {
    console.error('Error updating skin price:', error);
    return { success: false, error: 'Failed to update skin price' };
  }
}

async function bulkUpdateSkinPrices(skins) {
  let updated = 0;
  const errors = [];

  try {
    await withClient(async client => {
      await client.query('BEGIN');
      try {
        for (const skin of skins) {
          try {
            await client.query(
              `INSERT INTO locked_skins (skin_type, skin_id, price, is_locked)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (skin_type, skin_id) DO UPDATE SET
                 price = EXCLUDED.price,
                 is_locked = EXCLUDED.is_locked`,
              [skin.skinType, skin.skinId, skin.price, skin.isLocked]
            );
            updated++;
          } catch (error) {
            errors.push({ skin, error: error.message });
          }
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  } catch (transactionError) {
    errors.push({ error: transactionError.message });
  }

  return { updated, errors };
}

async function updateUserDAConnection(twitchUserId, daUsername) {
  const now = Math.floor(Date.now() / 1000);
  return run('UPDATE users SET da_username = $1, updated_at = $2 WHERE twitch_user_id = $3', [daUsername, now, twitchUserId]);
}

async function getUserDAConnection(twitchUserId) {
  const row = await queryOne('SELECT da_username FROM users WHERE twitch_user_id = $1', [twitchUserId]);
  return row ? row.da_username : null;
}

async function getUsersWithDAConnection() {
  const rows = await query('SELECT * FROM users WHERE da_username IS NOT NULL');
  return rows.map(normalizeUser);
}

async function upsertStreamerDA(creds) {
  const now = Math.floor(Date.now() / 1000);
  await run(
    `INSERT INTO streamers (
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
      updated_at = EXCLUDED.updated_at`,
    [
      creds.streamer_twitch_id,
      creds.twitch_login || null,
      creds.da_user_id,
      creds.da_access_token,
      creds.da_refresh_token,
      creds.da_expires_at,
      creds.status || 'active',
      now
    ]
  );
}

async function getStreamerDA(streamerTwitchId) {
  return queryOne('SELECT * FROM streamers WHERE streamer_twitch_id = $1', [streamerTwitchId]);
}

async function getAllStreamers() {
  return query('SELECT * FROM streamers WHERE status = $1', ['active']);
}

async function acquirePollLock(streamerTwitchId, lockedBy, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const newExpiry = now + ttlSeconds;
  const result = await run(
    `INSERT INTO da_poll_locks (streamer_twitch_id, locked_by, locked_until)
     VALUES ($1, $2, $3)
     ON CONFLICT (streamer_twitch_id) DO UPDATE SET
       locked_by = EXCLUDED.locked_by,
       locked_until = EXCLUDED.locked_until
     WHERE da_poll_locks.locked_until <= $4 OR da_poll_locks.locked_by = $5`,
    [streamerTwitchId, lockedBy, newExpiry, now, lockedBy]
  );
  return result.rowCount > 0;
}

async function releasePollLock(streamerTwitchId, lockedBy) {
  const result = await run(
    `UPDATE da_poll_locks
     SET locked_until = 0, locked_by = NULL
     WHERE streamer_twitch_id = $1 AND locked_by = $2`,
    [streamerTwitchId, lockedBy]
  );
  return result.rowCount > 0;
}

async function markDonationProcessed(streamerTwitchId, donationId) {
  await run(
    `INSERT INTO donations_processed (streamer_twitch_id, donation_id)
     VALUES ($1, $2)
     ON CONFLICT (streamer_twitch_id, donation_id) DO NOTHING`,
    [streamerTwitchId, donationId]
  );
}

async function isDonationProcessed(streamerTwitchId, donationId) {
  const row = await queryOne(
    'SELECT 1 FROM donations_processed WHERE streamer_twitch_id = $1 AND donation_id = $2',
    [streamerTwitchId, donationId]
  );
  return !!row;
}

async function setUserDA(twitchUserId, daUserId) {
  await run('UPDATE users SET da_user_id = $1 WHERE twitch_user_id = $2', [daUserId, twitchUserId]);
}

async function findUserByDAUserId(daUserId) {
  return queryOne('SELECT * FROM users WHERE da_user_id = $1', [daUserId]);
}

async function findUserByNormalizedLogin(login) {
  const normalizedLogin = login.trim().toLowerCase();
  return queryOne('SELECT * FROM users WHERE LOWER(login) = $1', [normalizedLogin]);
}

async function setAvatarTimeoutSeconds(twitchUserId, seconds) {
  await run('UPDATE users SET avatar_timeout_seconds = $1 WHERE twitch_user_id = $2', [seconds, twitchUserId]);
}

async function getAvatarTimeoutSeconds(twitchUserId) {
  const row = await queryOne('SELECT avatar_timeout_seconds FROM users WHERE twitch_user_id = $1', [twitchUserId]);
  return row ? Number(row.avatar_timeout_seconds) : 300;
}

async function setGameSettings(streamerId, settings) {
  const now = Math.floor(Date.now() / 1000);
  await run(
    `INSERT INTO streamer_game_settings (
      streamer_id, min_participants, max_participants, registration_time, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (streamer_id) DO UPDATE SET
       min_participants = EXCLUDED.min_participants,
       max_participants = EXCLUDED.max_participants,
       registration_time = EXCLUDED.registration_time,
       updated_at = EXCLUDED.updated_at`,
    [
      streamerId,
      settings.min_participants,
      settings.max_participants,
      settings.registration_time,
      now
    ]
  );
}

async function getGameSettings(streamerId) {
  return queryOne('SELECT * FROM streamer_game_settings WHERE streamer_id = $1', [streamerId]);
}

async function getGiftInfo(giftType, giftId) {
  return queryOne('SELECT * FROM gifts WHERE gift_type = $1 AND gift_id = $2', [giftType, giftId]);
}

async function getAllGifts() {
  return query('SELECT * FROM gifts');
}

async function updateGiftInfo(giftId, data) {
  try {
    await run(
      `UPDATE gifts SET
         name = COALESCE($2, name),
         description = COALESCE($3, description),
         updated_at = $4
       WHERE id = $1`,
      [giftId, data.name || null, data.description || null, Date.now()]
    );
    return true;
  } catch (error) {
    console.error('Error updating gift info:', error);
    return false;
  }
}

async function getStreamerOverlayState(streamerId) {
  if (!streamerId) {
    return null;
  }
  try {
    const row = await queryOne(
      'SELECT state_json FROM streamer_overlay_state WHERE streamer_id = $1',
      [streamerId]
    );
    if (!row || !row.state_json) {
      return null;
    }
    return JSON.parse(row.state_json);
  } catch (error) {
    console.error('Error loading overlay state:', error);
    return null;
  }
}

async function setStreamerOverlayState(streamerId, state) {
  if (!streamerId) {
    throw new Error('streamerId is required to save overlay state');
  }
  try {
    const payload = JSON.stringify(state || {});
    const now = Date.now();
    await run(
      `INSERT INTO streamer_overlay_state (streamer_id, state_json, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (streamer_id) DO UPDATE SET
         state_json = EXCLUDED.state_json,
         updated_at = EXCLUDED.updated_at`,
      [streamerId, payload, now]
    );
    return true;
  } catch (error) {
    console.error('Error saving overlay state:', error);
    return false;
  }
}

module.exports = {
  saveOrUpdateUser,
  getUserByTwitchId,
  getUserByLogin,
  getAllUsers,
  saveOrUpdateAvatar,
  getAvatarByTwitchId,
  addGiftToUser,
  getUserGifts,
  getUserGiftStats,
  getRandomGift,
  getAvailableAvatarParts,
  getAvailableGifts,
  updateAvatarPart,
  addUserToStreamer,
  getStreamerUsers,
  getUserAvatarPreview,
  giveGiftToUser,
  getUserCoins,
  updateUserCoins,
  addUserCoins,
  getLockedSkins,
  getUserPurchasedSkins,
  isSkinPurchased,
  purchaseSkin,
  getSkinPrice,
  getAllSkinsWithPrices,
  updateSkinPrice,
  bulkUpdateSkinPrices,
  updateUserDAConnection,
  getUserDAConnection,
  getUsersWithDAConnection,
  upsertStreamerDA,
  getStreamerDA,
  getAllStreamers,
  acquirePollLock,
  releasePollLock,
  markDonationProcessed,
  isDonationProcessed,
  setUserDA,
  findUserByDAUserId,
  findUserByNormalizedLogin,
  setAvatarTimeoutSeconds,
  getAvatarTimeoutSeconds,
  setGameSettings,
  getGameSettings,
  getGiftInfo,
  getAllGifts,
  updateGiftInfo,
  getStreamerOverlayState,
  setStreamerOverlayState,
  GIFT_TYPES,
  GIFT_IDS,
  pool
};
