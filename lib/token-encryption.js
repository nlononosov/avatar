const crypto = require('crypto');

// Секретный ключ для шифрования токенов (должен быть в .env)
const ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || '4c35f0f5a02a0899457b51d9d93b97603c6cd659124b2a439c56651d5cfc9e94';
const ALGORITHM = 'aes-256-gcm';
const ENCRYPTED_PREFIX = 'enc:'; // маркер зашифрованного значения

/**
 * Шифрует токен с использованием AES-256-GCM
 * @param {string} token - Токен для шифрования
 * @returns {string} Зашифрованный токен в формате base64
 */
function encryptToken(token) {
  if (!token) return null;
  
  try {
    // Генерируем случайный IV для каждого шифрования
    const iv = crypto.randomBytes(16);
    
    // Создаем cipher с правильными параметрами для AES-256-GCM
    const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
    
    // Шифруем токен
    let encrypted = cipher.update(token, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Получаем auth tag для проверки целостности
    const authTag = cipher.getAuthTag();
    
    // Объединяем IV, auth tag и зашифрованные данные
    const combined = Buffer.concat([
      iv,
      authTag,
      Buffer.from(encrypted, 'hex')
    ]);
    
    return ENCRYPTED_PREFIX + combined.toString('base64');
  } catch (error) {
    console.error('Error encrypting token:', error);
    return null;
  }
}

/**
 * Расшифровывает токен
 * @param {string} encryptedToken - Зашифрованный токен в формате base64
 * @returns {string|null} Расшифрованный токен или null при ошибке
 */
function decryptToken(encryptedToken) {
  if (!encryptedToken) return null;
  
  try {
    // Удаляем префикс при наличии (новый формат)
    const payload = encryptedToken.startsWith(ENCRYPTED_PREFIX)
      ? encryptedToken.slice(ENCRYPTED_PREFIX.length)
      : encryptedToken;
    
    // Проверяем, что payload достаточно длинный для извлечения IV и auth tag
    if (payload.length < 64) { // минимум для IV (16) + auth tag (16) + данные (32)
      return null;
    }
    
    // Декодируем base64
    const combined = Buffer.from(payload, 'base64');
    
    // Проверяем размер буфера
    if (combined.length < 32) {
      return null;
    }
    
    // Извлекаем компоненты
    const iv = combined.slice(0, 16);
    const authTag = combined.slice(16, 32);
    const encrypted = combined.slice(32);
    
    // Создаем decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
    decipher.setAuthTag(authTag);
    
    // Расшифровываем
    let decrypted = decipher.update(encrypted, null, 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    // Не логируем ошибки дешифровки, просто возвращаем null
    return null;
  }
}

/**
 * Проверяет, является ли строка зашифрованным токеном
 * @param {string} token - Строка для проверки
 * @returns {boolean} true если это зашифрованный токен
 */
function isEncryptedToken(token) {
  if (!token) return false;
  
  return String(token).startsWith(ENCRYPTED_PREFIX);
}

/**
 * Безопасно сохраняет токен (автоматически определяет, нужно ли шифровать)
 * @param {string} token - Токен для сохранения
 * @returns {string} Токен, готовый для сохранения в БД
 */
function secureToken(token) {
  if (!token) return ''; // Возвращаем пустую строку вместо null для NOT NULL полей
  
  // Если токен уже зашифрован, возвращаем как есть
  if (isEncryptedToken(token)) {
    return token;
  }
  
  // Если токен выглядит как зашифрованный (base64, длинный), но без префикса
  // и корректно расшифровывается текущим ключом — просто добавим префикс
  if (token.length > 50 && /^[A-Za-z0-9+/=]+$/.test(token)) {
    const maybePlain = decryptToken(token);
    if (maybePlain) {
      return ENCRYPTED_PREFIX + token; // уже зашифрован старым форматом
    }
  }
  
  // Шифруем незашифрованный токен
  return encryptToken(token);
}

/**
 * Безопасно извлекает токен (автоматически расшифровывает если нужно)
 * @param {string} storedToken - Токен из БД
 * @returns {string|null} Расшифрованный токен или null
 */
function extractToken(storedToken) {
  if (!storedToken || storedToken.trim() === '') return null;
  
  // Если токен зашифрован, расшифровываем
  if (isEncryptedToken(storedToken)) {
    try { 
      const decrypted = decryptToken(storedToken);
      if (decrypted) return decrypted;
    } catch (error) {
      console.warn('Failed to decrypt token with prefix, trying without prefix:', error.message);
    }
  }
  
  // Back-compat: возможно старый зашифр. формат без префикса
  try {
    const plain = decryptToken(storedToken);
    if (plain) return plain;
  } catch (error) {
    console.warn('Failed to decrypt token without prefix:', error.message);
  }
  
  // Если токен выглядит как base64 (зашифрованный), но не расшифровывается
  // возвращаем null вместо исходного токена
  if (storedToken.length > 50 && /^[A-Za-z0-9+/=]+$/.test(storedToken)) {
    console.warn('Token appears encrypted but cannot be decrypted, returning null');
    return null;
  }
  
  // Иначе считаем токен незашифрованным
  return storedToken;
}

/**
 * Генерирует новый ключ шифрования
 * @returns {string} Новый ключ в hex формате
 */
function generateNewKey() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Проверяет, что ключ шифрования настроен правильно
 * @returns {boolean} true если ключ настроен
 */
function isEncryptionKeyConfigured() {
  return ENCRYPTION_KEY && ENCRYPTION_KEY.length === 64; // 32 bytes = 64 hex chars
}

module.exports = {
  encryptToken,
  decryptToken,
  isEncryptedToken,
  secureToken,
  extractToken,
  generateNewKey,
  isEncryptionKeyConfigured
};
