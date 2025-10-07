// server.js
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');

const { PORT, BASE_URL, assertConfig } = require('./lib/config');
const { sseHandler } = require('./lib/logger');
const { registerAuthRoutes } = require('./routes/auth');
const { registerSuccessRoute } = require('./routes/success');
const { registerMyAvatarRoute } = require('./routes/my-avatar');
const { registerAvatarCustomizeRoutes } = require('./routes/avatar-customize');
const { registerBotRoutes } = require('./routes/bot');
const { registerHealthRoute } = require('./routes/health');
const { registerLogoutRoute } = require('./routes/logout');
const { registerGiftRoutes } = require('./routes/gifts');
const { registerMyChatRoute } = require('./routes/my-chat');
const { registerPaymentSuccessRoute } = require('./routes/payment-success');
const { registerDonationAlertsRoute } = require('./routes/donationalerts');
const { registerDonationAlertsAuthRoutes } = require('./routes/donationalerts-auth');
const { registerDonationAlertsConnectRoutes } = require('./routes/donationalerts-connect');
const { registerDebugRoutes } = require('./routes/debug');
const { overlayEventsHandler } = require('./lib/bus');
const { finishRace, finishFoodGame } = require('./services/bot');
const { handleWebhook, validateWebhook } = require('./lib/yookassa');
const { initializeUsernameCache } = require('./lib/donationalerts');
const { validateStreamerAccess, validateUserStreamerAccess } = require('./lib/streamer-auth');

const app = express();

// Генерируем секретный ключ для сессий
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// Безопасная настройка CORS
const { 
  getBaseAllowedOrigins, 
  createStaticCors, 
  createApiCors, 
  createAuthCors, 
  createDefaultCors,
  logCorsSecurity 
} = require('./lib/cors-security');

const allowedOrigins = getBaseAllowedOrigins();

// Логируем конфигурацию CORS
logCorsSecurity();

// CORS для статических файлов (без credentials)
app.use('/public', createStaticCors(allowedOrigins));

// CORS для API маршрутов (с credentials)
app.use('/api', createApiCors(allowedOrigins));

// CORS для аутентификации (с credentials)
app.use('/auth', createAuthCors(allowedOrigins));

// CORS для остальных маршрутов (без credentials)
app.use(createDefaultCors(allowedOrigins));

app.use(cookieParser());
app.use(express.json());

// Настройка безопасных сессий
app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // HTTPS в продакшене
    httpOnly: true, // Защита от XSS
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 дней
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax' // CSRF защита
  },
  name: 'avatar.sid' // Изменяем имя cookie для безопасности
}));
// Безопасная раздача статических файлов только из папки public
app.use(express.static(path.join(__dirname, 'public')));

// Защита от утечки конфиденциальных файлов
app.use((req, res, next) => {
  const url = req.url.toLowerCase();
  
  // Блокируем доступ к конфиденциальным файлам
  const blockedExtensions = ['.env', '.sqlite', '.sqlite-shm', '.sqlite-wal'];
  const blockedPaths = ['/data.sqlite', '/.env', '/server.js', '/db.js'];
  
  // Проверяем расширения файлов
  for (const ext of blockedExtensions) {
    if (url.includes(ext)) {
      return res.status(403).send('Access denied');
    }
  }
  
  // Проверяем конкретные пути
  for (const blockedPath of blockedPaths) {
    if (url === blockedPath || url.startsWith(blockedPath + '/')) {
      return res.status(403).send('Access denied');
    }
  }
  
  // Блокируем доступ к JS файлам вне public (кроме API routes)
  if (url.endsWith('.js') && !url.startsWith('/api/') && !url.startsWith('/public/')) {
    return res.status(403).send('Access denied');
  }
  
  next();
});

// Middleware для проверки аутентификации
app.use((req, res, next) => {
  // Проверяем аутентификацию для защищенных маршрутов
  const protectedRoutes = ['/api/', '/auth/logout', '/my-avatar', '/my-chat', '/avatar-customize'];
  const isProtectedRoute = protectedRoutes.some(route => req.path.startsWith(route));
  
  if (isProtectedRoute && !req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  next();
});

// Middleware для CSRF защиты (только для POST/PUT/DELETE)
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    // Исключаем webhook'и от внешних сервисов и OAuth маршруты
    const excludedPaths = ['/api/payment/webhook', '/api/donationalerts/webhook', '/auth/twitch/init', '/debug/'];
    const isExcluded = excludedPaths.some(path => req.path.startsWith(path));
    
    if (!isExcluded) {
      const csrfToken = req.headers['x-csrf-token'] || req.body._csrf;
      const sessionToken = req.session.csrfToken;
      
      if (!csrfToken || !sessionToken || csrfToken !== sessionToken) {
        return res.status(403).json({ error: 'Invalid CSRF token' });
      }
    }
  }
  next();
});

// Генерируем CSRF токен для каждой сессии
app.use((req, res, next) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
});

assertConfig(console);

// Logs SSE
app.get('/events', sseHandler);

// Overlay SSE - защищенный эндпоинт с проверкой streamer_id
app.get('/overlay/events', validateStreamerAccess, (req, res) => {
  // Parse query parameters manually if needed
  req.query = req.query || {};
  overlayEventsHandler(req, res);
});

// Race finish API
app.post('/api/race/finish', (req, res) => {
  try {
    const { winnerId } = req.body;
    if (!winnerId) {
      return res.status(400).json({ error: 'Missing winnerId' });
    }
    
    // Get bot client and channel from bot service
    const { getBotClient, getBotChannel } = require('./services/bot');
    const client = getBotClient();
    const channel = getBotChannel();
    
    if (client && channel) {
      finishRace(winnerId, client, channel);
      res.json({ success: true, message: 'Race finished' });
    } else {
      res.status(500).json({ error: 'Bot not connected' });
    }
  } catch (error) {
    console.error('Error finishing race:', error);
    res.status(500).json({ error: 'Failed to finish race' });
  }
});

// Food game finish API
app.post('/api/food-game/finish', (req, res) => {
  try {
    const { winnerId, winnerName } = req.body;

    if (!winnerId || !winnerName) {
      return res.status(400).json({ error: 'Missing winnerId or winnerName' });
    }

    // Get bot client and channel from bot service
    const { getBotClient, getBotChannel } = require('./services/bot');
    const client = getBotClient();
    const channel = getBotChannel();

    if (client && channel) {
      // Вызываем finishFoodGame из services/bot.js
      // Предполагается, что функция finishFoodGame существует и отправляет сообщение в чат
      const { finishFoodGame } = require('./services/bot');
      finishFoodGame(winnerName, client, channel); // Передаем имя победителя

      res.json({ success: true, message: 'Food game finished' });
    } else {
      res.status(500).json({ error: 'Bot not connected' });
    }
  } catch (error) {
    console.error('Error finishing food game:', error);
    res.status(500).json({ error: 'Failed to finish food game' });
  }
});

// YooKassa webhook
app.post('/api/payment/webhook', validateWebhook, handleWebhook);

// Routes
registerAuthRoutes(app);
registerSuccessRoute(app);
registerMyAvatarRoute(app);
registerAvatarCustomizeRoutes(app);
registerBotRoutes(app);
registerHealthRoute(app);
registerLogoutRoute(app);
registerGiftRoutes(app);
registerMyChatRoute(app);
registerPaymentSuccessRoute(app);
registerDonationAlertsRoute(app);
registerDonationAlertsAuthRoutes(app);
registerDonationAlertsConnectRoutes(app);
registerDebugRoutes(app);

// DonationAlerts webhooks
const { registerDonationAlertsWebhookRoutes } = require('./routes/donationalerts-webhooks');
registerDonationAlertsWebhookRoutes(app);

// API для метрик хитбокса аватаров
app.post('/api/plane-race/avatar-metrics', express.json(), (req, res) => {
  const { userId, halfW, halfH } = req.body || {};
  // Получаем Game из bot.js
  const { Game } = require('./services/bot');
  const p = Game.players.get(String(userId));
  if (p && Number.isFinite(halfW)) { p.halfW = halfW; }
  if (p && Number.isFinite(halfH)) { p.halfH = halfH; }
  res.json({ ok: true });
});

// Initialize DonationAlerts username cache
initializeUsernameCache();

// Start DonationAlerts scheduler (replaces old polling)
const { scheduler } = require('./lib/donationalerts-scheduler');
scheduler.start();

app.listen(PORT, () => {
  console.log(`Server listening on ${BASE_URL}`);
});
