const { stopBot, status } = require('../services/bot');

function registerLogoutRoute(app) {
  app.post('/auth/logout', async (req, res) => {
    const uid = req.session.userId;
    
    // Останавливаем бота если он запущен для этого пользователя
    try {
      const st = status();
      if (st.running && st.for_user && uid && String(uid) === String(st.for_user)) {
        try { 
          await stopBot(); 
        } catch(_) {}
      }
    } catch(_) {}
    
    // Уничтожаем сессию
    req.session.destroy((err) => {
      if (err) {
        console.error('Session destruction error:', err);
        return res.status(500).json({ error: 'Logout failed' });
      }
      
      // Очищаем cookie сессии
      res.clearCookie('avatar.sid');
      res.cookie('force_login', '1', { 
        httpOnly: true, 
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production'
      });
      
      res.status(200).json({ success: true });
    });
  });
}

module.exports = { registerLogoutRoute };


