const { ensureBotFor, stopBot, status } = require('../services/bot');
const { logLine } = require('../lib/logger');

function registerBotRoutes(app) {
  app.post('/bot/start', async (req, res) => {
    try {
      const uid = req.session.userId;
      if (!uid) return res.status(401).send('Неизвестен пользователь (нет cookie uid)');

      const streamerKey = String(uid);

      // Check if bot is already running for this streamer
      const botStatus = status(streamerKey);
      if (botStatus.running) {
        return res.status(400).send('Бот уже подключен! Сначала остановите текущего бота.');
      }

      const { profile } = await ensureBotFor(streamerKey);
      res.status(200).send(`✅ Бот успешно запущен и подключён к #${profile.login}. Напиши в чате "!ping" — ответит "pong".`);
    } catch (e) {
      logLine(`[bot] start error: ${e?.message || e}`);
      res.status(500).send('Ошибка запуска бота: ' + (e?.message || e));
    }
  });

  app.post('/bot/stop', async (req, res) => {
    try {
      const uid = req.session.userId;
      if (!uid) return res.status(401).send('Неизвестен пользователь (нет cookie uid)');

      const changed = await stopBot(String(uid));
      if (!changed) return res.status(200).send('Бот уже остановлен.');
      res.status(200).send('Бот остановлен.');
    } catch (e) {
      logLine(`[bot] stop error: ${e?.message || e}`);
      res.status(500).send('Ошибка остановки бота: ' + (e?.message || e));
    }
  });

  app.get('/bot/status', (req, res) => {
    const uid = req.session.userId;
    if (!uid) return res.status(401).json({ error: 'Неизвестен пользователь' });

    res.json(status(String(uid)));
  });
}

module.exports = { registerBotRoutes };


