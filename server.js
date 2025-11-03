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
const { registerGameRoutes } = require('./routes/games');
const { overlayEventsHandler } = require('./lib/bus');
const { registerMetrics } = require('./lib/metrics');
const { handleWebhook, validateWebhook } = require('./lib/yookassa');
const { initializeUsernameCache } = require('./lib/donationalerts');

const app = express();
app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.static(__dirname));

assertConfig(console);

registerMetrics(app);

// Logs SSE
app.get('/events', sseHandler);

// Overlay SSE
app.get('/overlay/events', (req, res) => {
  // Parse query parameters manually if needed
  req.query = req.query || {};
  overlayEventsHandler(req, res);
});

// Race finish API - DEPRECATED: these endpoints are no longer used with multi-bot architecture
// app.post('/api/race/finish', ...)
// app.post('/api/food-game/finish', ...)

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
registerGameRoutes(app);

// API для метрик хитбокса аватаров - DEPRECATED: requires streamerId for multi-bot
// app.post('/api/plane-race/avatar-metrics', ...)

// Initialize DonationAlerts username cache
initializeUsernameCache();

// Start DonationAlerts polling
const { startPolling, stopPolling } = require('./lib/donationalerts-poll');
startPolling();

// Восстанавливаем ботов из Redis при старте (если Redis доступен)
const { restoreBotsFromRedis } = require('./services/bot');
const { getClient } = require('./lib/redis');
const { stopHealthCheck } = require('./lib/redis');
const dbAsync = require('./lib/db/async');

// Проверяем Redis и восстанавливаем ботов асинхронно
getClient()
  .then((redis) => {
    if (redis && redis.status === 'ready') {
      console.log('[server] Redis is available, restoring bots from Redis state...');
      restoreBotsFromRedis().catch((err) => {
        console.error('[server] Failed to restore bots from Redis:', err.message);
      });
    } else {
      console.warn('[server] Redis not available, skipping bot restoration');
    }
  })
  .catch((err) => {
    console.warn('[server] Redis check failed, skipping bot restoration:', err.message);
  });

const server = app.listen(PORT, () => {
  console.log(`Server listening on ${BASE_URL}`);
  // PM2 ready signal
  if (process.send) {
    process.send('ready');
  }
});

// Graceful shutdown
async function gracefulShutdown(signal) {
  console.log(`\n[server] ${signal} received, starting graceful shutdown...`);
  
  // Stop accepting new requests
  server.close(() => {
    console.log('[server] HTTP server closed');
  });
  
  try {
    // Stop DonationAlerts polling
    stopPolling();
    console.log('[server] DonationAlerts polling stopped');
    
    // Stop Redis health checks
    stopHealthCheck();
    console.log('[server] Redis health checks stopped');
    
    // Close DB worker
    if (dbAsync && typeof dbAsync.terminate === 'function') {
      await dbAsync.terminate();
      console.log('[server] Database worker terminated');
    }
    
    // Give time for cleanup (max 5 seconds)
    setTimeout(() => {
      console.log('[server] Graceful shutdown completed');
      process.exit(0);
    }, 5000);
  } catch (error) {
    console.error('[server] Error during graceful shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('[server] Unhandled Rejection at:', promise, 'reason:', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('[server] Uncaught Exception:', error);
  gracefulShutdown('uncaughtException').finally(() => {
    process.exit(1);
  });
});
