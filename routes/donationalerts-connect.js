function registerDonationAlertsConnectRoutes(app) {
  // Disconnect DonationAlerts account (OAuth-based)
  app.post('/api/donationalerts/disconnect', async (req, res) => {
    try {
      const uid = req.cookies.uid;
      if (!uid) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { upsertStreamerDA } = require('../db');
      // Устанавливаем статус need_reauth для стримера
      await upsertStreamerDA({
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
      const uid = req.cookies.uid;
      if (!uid) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { getStreamerDA } = require('../db');
      const streamerDA = await getStreamerDA(uid);
      
      res.json({
        connected: !!(streamerDA && streamerDA.da_access_token && streamerDA.status === 'active'),
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
