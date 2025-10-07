const crypto = require('crypto');
const { encryptToken, decryptToken, generateNewKey } = require('./token-encryption');

/**
 * Утилита для ротации ключей шифрования токенов
 * Используется для смены ключа шифрования без потери данных
 */

/**
 * Перешифровывает все токены с новым ключом
 * @param {string} oldKey - Старый ключ шифрования (hex)
 * @param {string} newKey - Новый ключ шифрования (hex)
 * @param {object} db - Экземпляр базы данных
 * @returns {object} Результат операции
 */
function rotateEncryptionKey(oldKey, newKey, db) {
  const results = {
    users: { processed: 0, errors: 0 },
    streamers: { processed: 0, errors: 0 },
    errors: []
  };

  try {
    // Сохраняем текущий ключ
    const originalKey = process.env.TOKEN_ENCRYPTION_KEY;
    
    // Временно устанавливаем старый ключ для расшифровки
    process.env.TOKEN_ENCRYPTION_KEY = oldKey;
    
    // Перешифровываем токены пользователей
    const users = db.prepare('SELECT twitch_user_id, access_token, refresh_token FROM users WHERE access_token IS NOT NULL').all();
    
    for (const user of users) {
      try {
        // Расшифровываем старым ключом
        const decryptedAccessToken = decryptToken(user.access_token);
        const decryptedRefreshToken = decryptToken(user.refresh_token);
        
        if (decryptedAccessToken || decryptedRefreshToken) {
          // Устанавливаем новый ключ для шифрования
          process.env.TOKEN_ENCRYPTION_KEY = newKey;
          
          // Перешифровываем новым ключом
          const newEncryptedAccessToken = encryptToken(decryptedAccessToken);
          const newEncryptedRefreshToken = encryptToken(decryptedRefreshToken);
          
          // Сохраняем в БД
          db.prepare(`
            UPDATE users 
            SET access_token = ?, refresh_token = ?, updated_at = ?
            WHERE twitch_user_id = ?
          `).run(
            newEncryptedAccessToken,
            newEncryptedRefreshToken,
            Math.floor(Date.now() / 1000),
            user.twitch_user_id
          );
          
          results.users.processed++;
        }
      } catch (error) {
        results.users.errors++;
        results.errors.push(`User ${user.twitch_user_id}: ${error.message}`);
      }
    }
    
    // Перешифровываем токены стримеров
    const streamers = db.prepare('SELECT streamer_twitch_id, da_access_token, da_refresh_token FROM streamers WHERE da_access_token IS NOT NULL').all();
    
    for (const streamer of streamers) {
      try {
        // Расшифровываем старым ключом
        const decryptedAccessToken = decryptToken(streamer.da_access_token);
        const decryptedRefreshToken = decryptToken(streamer.da_refresh_token);
        
        if (decryptedAccessToken || decryptedRefreshToken) {
          // Устанавливаем новый ключ для шифрования
          process.env.TOKEN_ENCRYPTION_KEY = newKey;
          
          // Перешифровываем новым ключом
          const newEncryptedAccessToken = encryptToken(decryptedAccessToken);
          const newEncryptedRefreshToken = encryptToken(decryptedRefreshToken);
          
          // Сохраняем в БД
          db.prepare(`
            UPDATE streamers 
            SET da_access_token = ?, da_refresh_token = ?, updated_at = ?
            WHERE streamer_twitch_id = ?
          `).run(
            newEncryptedAccessToken,
            newEncryptedRefreshToken,
            Math.floor(Date.now() / 1000),
            streamer.streamer_twitch_id
          );
          
          results.streamers.processed++;
        }
      } catch (error) {
        results.streamers.errors++;
        results.errors.push(`Streamer ${streamer.streamer_twitch_id}: ${error.message}`);
      }
    }
    
    // Восстанавливаем оригинальный ключ или устанавливаем новый
    process.env.TOKEN_ENCRYPTION_KEY = originalKey || newKey;
    
  } catch (error) {
    results.errors.push(`General error: ${error.message}`);
  }
  
  return results;
}

/**
 * Проверяет целостность зашифрованных токенов
 * @param {object} db - Экземпляр базы данных
 * @returns {object} Результат проверки
 */
function verifyTokenIntegrity(db) {
  const results = {
    users: { total: 0, valid: 0, invalid: 0, errors: [] },
    streamers: { total: 0, valid: 0, invalid: 0, errors: [] }
  };

  try {
    // Проверяем токены пользователей
    const users = db.prepare('SELECT twitch_user_id, access_token, refresh_token FROM users WHERE access_token IS NOT NULL').all();
    
    for (const user of users) {
      results.users.total++;
      
      try {
        const decryptedAccessToken = decryptToken(user.access_token);
        const decryptedRefreshToken = decryptToken(user.refresh_token);
        
        if (decryptedAccessToken || decryptedRefreshToken) {
          results.users.valid++;
        } else {
          results.users.invalid++;
          results.users.errors.push(`User ${user.twitch_user_id}: Failed to decrypt tokens`);
        }
      } catch (error) {
        results.users.invalid++;
        results.users.errors.push(`User ${user.twitch_user_id}: ${error.message}`);
      }
    }
    
    // Проверяем токены стримеров
    const streamers = db.prepare('SELECT streamer_twitch_id, da_access_token, da_refresh_token FROM streamers WHERE da_access_token IS NOT NULL').all();
    
    for (const streamer of streamers) {
      results.streamers.total++;
      
      try {
        const decryptedAccessToken = decryptToken(streamer.da_access_token);
        const decryptedRefreshToken = decryptToken(streamer.da_refresh_token);
        
        if (decryptedAccessToken || decryptedRefreshToken) {
          results.streamers.valid++;
        } else {
          results.streamers.invalid++;
          results.streamers.errors.push(`Streamer ${streamer.streamer_twitch_id}: Failed to decrypt tokens`);
        }
      } catch (error) {
        results.streamers.invalid++;
        results.streamers.errors.push(`Streamer ${streamer.streamer_twitch_id}: ${error.message}`);
      }
    }
    
  } catch (error) {
    results.generalError = error.message;
  }
  
  return results;
}

/**
 * Генерирует новый ключ и сохраняет его в файл .env
 * @param {string} envPath - Путь к файлу .env
 * @returns {string} Новый ключ
 */
function generateAndSaveNewKey(envPath = '.env') {
  const newKey = generateNewKey();
  
  try {
    const fs = require('fs');
    const path = require('path');
    
    const envFile = path.join(process.cwd(), envPath);
    let envContent = '';
    
    // Читаем существующий .env файл
    if (fs.existsSync(envFile)) {
      envContent = fs.readFileSync(envFile, 'utf8');
    }
    
    // Обновляем или добавляем ключ
    const keyRegex = /^TOKEN_ENCRYPTION_KEY=.*$/m;
    if (keyRegex.test(envContent)) {
      envContent = envContent.replace(keyRegex, `TOKEN_ENCRYPTION_KEY=${newKey}`);
    } else {
      envContent += `\nTOKEN_ENCRYPTION_KEY=${newKey}\n`;
    }
    
    // Сохраняем обновленный файл
    fs.writeFileSync(envFile, envContent);
    
    return newKey;
  } catch (error) {
    throw new Error(`Failed to save new key to ${envPath}: ${error.message}`);
  }
}

module.exports = {
  rotateEncryptionKey,
  verifyTokenIntegrity,
  generateAndSaveNewKey
};
