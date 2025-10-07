function registerDonationAlertsConnectRoutes(app) {
  // Disconnect DonationAlerts account (OAuth-based)
  app.post('/api/donationalerts/disconnect', async (req, res) => {
    try {
      const uid = req.session.userId;
      if (!uid) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { upsertStreamerDA } = require('../db');
      // Устанавливаем статус need_reauth для стримера
      upsertStreamerDA({
        streamer_twitch_id: uid,
        status: 'need_reauth',
        da_access_token: null,
        da_refresh_token: null,
        da_expires_at: null
      });

      res.json({ 
        success: true, 
        message: 'DonationAlerts account disconnected'
      });

    } catch (error) {
      console.error('Error disconnecting DonationAlerts:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Get current DonationAlerts connection status
  app.get('/api/donationalerts/status', async (req, res) => {
    try {
      const uid = req.session.userId;
      if (!uid) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { db } = require('../db');
      
      // Получаем данные напрямую из БД без расшифровки для проверки статуса
      const streamerDA = db.prepare('SELECT * FROM streamers WHERE streamer_twitch_id = ?').get(uid);
      
      // Проверяем наличие токенов в БД (даже если они зашифрованы)
      const hasAccessToken = streamerDA && streamerDA.da_access_token && streamerDA.da_access_token.trim() !== '';
      const hasRefreshToken = streamerDA && streamerDA.da_refresh_token && streamerDA.da_refresh_token.trim() !== '';
      const isActive = streamerDA && streamerDA.status === 'active';
      
      res.json({
        connected: !!(hasAccessToken && hasRefreshToken && isActive),
        status: streamerDA?.status || 'not_connected',
        da_user_id: streamerDA?.da_user_id || null,
        needs_reauth: streamerDA?.status === 'need_reauth'
      });

    } catch (error) {
      console.error('Error getting DA status:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
}

module.exports = { registerDonationAlertsConnectRoutes };
