const { stopBot, status } = require('../services/bot');

function registerLogoutRoute(app) {
  app.post('/auth/logout', async (req, res) => {
    const uid = req.cookies.uid;
    res.clearCookie('uid');
    res.cookie('force_login', '1', { httpOnly: true, sameSite: 'lax' });
    try {
      const st = status();
      if (st.running && st.for_user && uid && String(uid) === String(st.for_user)) {
        try { await stopBot(); } catch(_) {}
      }
    } catch(_) {}
    res.status(200).send('ok');
  });
}

module.exports = { registerLogoutRoute };


