// server.js
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

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
const { finishRace, finishFoodGame, getBotClient, getBotChannel, getGame } = require('./services/bot');
const { handleWebhook, validateWebhook } = require('./lib/yookassa');
const { initializeUsernameCache } = require('./lib/donationalerts');

const app = express();
app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.static(__dirname));

// Проверяем конфигурацию
try {
  assertConfig(console);
} catch (error) {
  console.error('[server] Configuration error:', error.message);
  console.error('[server] Please check your .env file');
  process.exit(1);
}

// Проверяем подключение к БД
const { pool } = require('./db');
pool.query('SELECT NOW()')
  .then(() => {
    console.log('[server] Database connection successful');
  })
  .catch(error => {
    console.error('[server] Database connection failed:', error.message);
    console.error('[server] Please check if PostgreSQL is running');
    console.error('[server] Current DATABASE_URL:', process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/avatar');
  });

// Logs SSE
app.get('/events', sseHandler);

// Overlay SSE
app.get('/overlay/events', (req, res) => {
  // Parse query parameters manually if needed
  req.query = req.query || {};
  overlayEventsHandler(req, res);
});

// Race finish API
app.post('/api/race/finish', (req, res) => {
  try {
    const { winnerId, streamerId: bodyStreamerId } = req.body;
    const streamerId = bodyStreamerId || req.cookies?.uid;
    if (!winnerId) {
      return res.status(400).json({ error: 'Missing winnerId' });
    }

    if (!streamerId) {
      return res.status(400).json({ error: 'Missing streamerId' });
    }

    // Get bot client and channel from bot service
    const client = getBotClient(String(streamerId));
    const channel = getBotChannel(String(streamerId));

    if (client && channel) {
      finishRace(String(streamerId), winnerId, client, channel);
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
    const { winnerId, winnerName, streamerId: bodyStreamerId } = req.body;
    const streamerId = bodyStreamerId || req.cookies?.uid;

    if (!winnerId || !winnerName) {
      return res.status(400).json({ error: 'Missing winnerId or winnerName' });
    }

    if (!streamerId) {
      return res.status(400).json({ error: 'Missing streamerId' });
    }

    // Get bot client and channel from bot service
    const client = getBotClient(String(streamerId));
    const channel = getBotChannel(String(streamerId));

    if (client && channel) {
      // Вызываем finishFoodGame из services/bot.js
      // Предполагается, что функция finishFoodGame существует и отправляет сообщение в чат
      finishFoodGame(String(streamerId), winnerName, client, channel); // Передаем имя победителя

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

// API для метрик хитбокса аватаров
app.post('/api/plane-race/avatar-metrics', express.json(), (req, res) => {
  const { userId, halfW, halfH, streamerId: bodyStreamerId } = req.body || {};
  const streamerId = bodyStreamerId || req.cookies?.uid;
  const game = streamerId ? getGame(String(streamerId)) : null;
  const p = game?.players?.get(String(userId));
  if (p && Number.isFinite(halfW)) { p.halfW = halfW; }
  if (p && Number.isFinite(halfH)) { p.halfH = halfH; }
  res.json({ ok: true });
});

// Initialize DonationAlerts username cache
initializeUsernameCache().catch(error => {
  console.error('[server] Failed to initialize username cache:', error);
});

// Start DonationAlerts polling
const { startPolling } = require('./lib/donationalerts-poll');
try {
  startPolling();
} catch (error) {
  console.error('[server] Failed to start DonationAlerts polling:', error.message);
}

// Обработка необработанных ошибок
process.on('unhandledRejection', (reason, promise) => {
  console.error('[server] Unhandled Rejection at:', promise, 'reason:', reason);
  // Не останавливаем сервер, просто логируем ошибку
});

process.on('uncaughtException', (error) => {
  console.error('[server] Uncaught Exception:', error);
  // Для критических ошибок - завершаем процесс
  if (error.code === 'EADDRINUSE') {
    console.error('[server] Port already in use, exiting...');
    process.exit(1);
  }
});

app.listen(PORT, () => {
  console.log(`[server] Server listening on ${BASE_URL}`);
  console.log(`[server] Press Ctrl+C to stop`);
});
