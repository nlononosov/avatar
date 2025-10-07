const { ensureBotFor, stopBot, status } = require('../services/bot');
const { logLine } = require('../lib/logger');

function registerBotRoutes(app) {
  app.post('/bot/start', async (req, res) => {
    try {
      const uid = req.session.userId;
      if (!uid) return res.status(401).send('Неизвестен пользователь (нет cookie uid)');
      
      // Check if bot is already running
      const botStatus = status();
      if (botStatus.running) {
        return res.status(400).send('Бот уже подключен! Сначала остановите текущего бота.');
      }
      
      const { profile } = await ensureBotFor(String(uid));
      res.status(200).send(`✅ Бот успешно запущен и подключён к #${profile.login}. Напиши в чате "!ping" — ответит "pong".`);
    } catch (e) {
      logLine(`[bot] start error: ${e?.message || e}`);
      res.status(500).send('Ошибка запуска бота: ' + (e?.message || e));
    }
  });

  app.post('/bot/stop', async (_req, res) => {
    try {
      const changed = await stopBot();
      if (!changed) return res.status(200).send('Бот уже остановлен.');
      res.status(200).send('Бот остановлен.');
    } catch (e) {
      logLine(`[bot] stop error: ${e?.message || e}`);
      res.status(500).send('Ошибка остановки бота: ' + (e?.message || e));
    }
  });

  app.get('/bot/status', (_req, res) => {
    res.json(status());
  });
}

module.exports = { registerBotRoutes };


