const { PORT, BASE_URL, SCOPES, CLIENT_ID, CLIENT_SECRET } = require('../lib/config');
const { status } = require('../services/bot');

function registerHealthRoute(app) {
  app.get('/health', (_req, res) => {
    const bot = status();
    res.json({
      ok: true,
      baseUrl: BASE_URL,
      port: PORT,
      scopes: SCOPES,
      hasClientId: Boolean(CLIENT_ID),
      hasClientSecret: Boolean(CLIENT_SECRET),
      botRunning: bot.running
    });
  });
}

module.exports = { registerHealthRoute };


