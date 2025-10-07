const crypto = require('crypto');

// Секретный ключ для подписи токенов (в продакшене должен быть в .env)
const STREAMER_TOKEN_SECRET = process.env.STREAMER_TOKEN_SECRET || 'default-secret-key-change-in-production';

/**
 * Генерирует подписанный токен для overlay
 * @param {string} streamerTwitchId - ID стримера в Twitch
 * @param {number} expiresIn - Время жизни токена в секундах (по умолчанию 1 час)
 * @returns {string} Подписанный токен
 */
function generateStreamerToken(streamerTwitchId, expiresIn = 3600) {
  const payload = {
    streamer_twitch_id: streamerTwitchId,
    exp: Math.floor(Date.now() / 1000) + expiresIn,
    iat: Math.floor(Date.now() / 1000)
  };
  
  const payloadString = JSON.stringify(payload);
  const signature = crypto
    .createHmac('sha256', STREAMER_TOKEN_SECRET)
    .update(payloadString)
    .digest('hex');
  
  const token = Buffer.from(payloadString).toString('base64') + '.' + signature;
  return token;
}

/**
 * Проверяет и декодирует подписанный токен
 * @param {string} token - Подписанный токен
 * @returns {object|null} Декодированный payload или null если токен невалиден
 */
function verifyStreamerToken(token) {
  try {
    const [payloadBase64, signature] = token.split('.');
    if (!payloadBase64 || !signature) {
      return null;
    }
    
    const payloadString = Buffer.from(payloadBase64, 'base64').toString('utf8');
    const expectedSignature = crypto
      .createHmac('sha256', STREAMER_TOKEN_SECRET)
      .update(payloadString)
      .digest('hex');
    
    if (signature !== expectedSignature) {
      return null;
    }
    
    const payload = JSON.parse(payloadString);
    
    // Проверяем время истечения
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    
    return payload;
  } catch (error) {
    return null;
  }
}

/**
 * Middleware для проверки streamer_id в запросах
 * @param {object} req - Express request object
 * @param {object} res - Express response object  
 * @param {function} next - Express next function
 */
function validateStreamerAccess(req, res, next) {
  // Получаем streamer_id из разных источников
  let streamerId = null;
  
  // 1. Из подписанного токена в query параметре
  if (req.query.token) {
    const tokenPayload = verifyStreamerToken(req.query.token);
    if (tokenPayload) {
      streamerId = tokenPayload.streamer_twitch_id;
    }
  }
  
  // 2. Из query параметра streamer_id (для обратной совместимости)
  if (!streamerId && req.query.streamer_id) {
    streamerId = req.query.streamer_id;
  }
  
  // 3. Из сессии пользователя (для авторизованных запросов)
  if (!streamerId && req.session && req.session.userId) {
    // Для авторизованных пользователей используем их ID как streamer_id
    // В реальном приложении здесь должна быть проверка связи пользователь-стример
    streamerId = req.session.userId;
  }
  
  if (!streamerId) {
    return res.status(400).json({ 
      error: 'Missing streamer_id or invalid token',
      message: 'Streamer ID is required for this request'
    });
  }
  
  // Добавляем streamer_id в request для использования в маршрутах
  req.streamerId = streamerId;
  next();
}

/**
 * Middleware для проверки доступа пользователя к данным стримера
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {function} next - Express next function
 */
function validateUserStreamerAccess(req, res, next) {
  const userId = req.session.userId;
  const streamerId = req.streamerId || req.query.streamer_id;
  
  if (!userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  if (!streamerId) {
    return res.status(400).json({ error: 'Streamer ID required' });
  }
  
  // Проверяем, что пользователь имеет доступ к данным этого стримера
  // В реальном приложении здесь должна быть проверка в БД
  // Пока что разрешаем доступ если userId === streamerId (пользователь = стример)
  if (userId !== streamerId) {
    // TODO: Добавить проверку связи пользователь-стример в БД
    // const { isUserSubscribedToStreamer } = require('../db');
    // if (!isUserSubscribedToStreamer(userId, streamerId)) {
    //   return res.status(403).json({ error: 'Access denied to this streamer data' });
    // }
  }
  
  req.userId = userId;
  req.streamerId = streamerId;
  next();
}

module.exports = {
  generateStreamerToken,
  verifyStreamerToken,
  validateStreamerAccess,
  validateUserStreamerAccess
};
