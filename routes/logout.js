const { stopBot, status } = require('../services/bot');

function registerLogoutRoute(app) {
  app.post('/auth/logout', async (req, res) => {
    const uid = req.cookies.uid;
    res.clearCookie('uid');
    res.cookie('force_login', '1', { httpOnly: true, sameSite: 'lax' });
    try {
      if (uid) {
        const st = status(String(uid));
        if (st.running) {
          try { await stopBot(String(uid)); } catch (_) {}
        }
      }
    } catch (_) {}
    res.status(200).send('ok');
  });
}

module.exports = { registerLogoutRoute };


