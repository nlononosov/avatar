/**
 * Маршруты для DonationAlerts webhooks
 */

const { webhooks } = require('../lib/donationalerts-webhooks');
const { scheduler } = require('../lib/donationalerts-scheduler');

function registerDonationAlertsWebhookRoutes(app) {
  // Webhook endpoint для DonationAlerts
  app.post('/api/donationalerts/webhook', (req, res) => {
    webhooks.handleWebhook(req, res);
  });

  // Регистрация webhook для стримера
  app.post('/api/donationalerts/webhook/register', async (req, res) => {
    try {
      const { streamerId, webhookUrl } = req.body;
      
      if (!streamerId || !webhookUrl) {
        return res.status(400).json({ 
          error: 'streamerId and webhookUrl are required' 
        });
      }

      const result = await webhooks.registerWebhook(streamerId, webhookUrl);
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('Error registering webhook:', error);
      res.status(500).json({ 
        error: error.message || 'Failed to register webhook' 
      });
    }
  });

  // Удаление webhook для стримера
  app.delete('/api/donationalerts/webhook/:streamerId', async (req, res) => {
    try {
      const { streamerId } = req.params;
      
      await webhooks.unregisterWebhook(streamerId);
      
      res.json({
        success: true,
        message: 'Webhook unregistered successfully'
      });
    } catch (error) {
      console.error('Error unregistering webhook:', error);
      res.status(500).json({ 
        error: error.message || 'Failed to unregister webhook' 
      });
    }
  });

  // Проверка статуса webhook
  app.get('/api/donationalerts/webhook/:streamerId/status', async (req, res) => {
    try {
      const { streamerId } = req.params;
      
      const status = await webhooks.checkWebhookStatus(streamerId);
      
      res.json({
        success: true,
        data: status
      });
    } catch (error) {
      console.error('Error checking webhook status:', error);
      res.status(500).json({ 
        error: error.message || 'Failed to check webhook status' 
      });
    }
  });

  // Получение списка webhooks для стримера
  app.get('/api/donationalerts/webhook/:streamerId', async (req, res) => {
    try {
      const { streamerId } = req.params;
      
      const webhooksList = await webhooks.getWebhooks(streamerId);
      
      res.json({
        success: true,
        data: webhooksList
      });
    } catch (error) {
      console.error('Error getting webhooks:', error);
      res.status(500).json({ 
        error: error.message || 'Failed to get webhooks' 
      });
    }
  });

  // Статистика планировщика
  app.get('/api/donationalerts/scheduler/stats', (req, res) => {
    try {
      const stats = scheduler.getStats();
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('Error getting scheduler stats:', error);
      res.status(500).json({ 
        error: error.message || 'Failed to get scheduler stats' 
      });
    }
  });

  // Принудительный polling для стримера
  app.post('/api/donationalerts/scheduler/force-poll/:streamerId', (req, res) => {
    try {
      const { streamerId } = req.params;
      
      scheduler.forcePoll(streamerId);
      
      res.json({
        success: true,
        message: 'Force poll triggered'
      });
    } catch (error) {
      console.error('Error forcing poll:', error);
      res.status(500).json({ 
        error: error.message || 'Failed to force poll' 
      });
    }
  });

  // Сброс backoff для стримера
  app.post('/api/donationalerts/scheduler/reset-backoff/:streamerId', (req, res) => {
    try {
      const { streamerId } = req.params;
      
      scheduler.resetBackoff(streamerId);
      
      res.json({
        success: true,
        message: 'Backoff reset'
      });
    } catch (error) {
      console.error('Error resetting backoff:', error);
      res.status(500).json({ 
        error: error.message || 'Failed to reset backoff' 
      });
    }
  });

  // Статистика webhooks
  app.get('/api/donationalerts/webhooks/stats', (req, res) => {
    try {
      const stats = webhooks.getStats();
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('Error getting webhooks stats:', error);
      res.status(500).json({ 
        error: error.message || 'Failed to get webhooks stats' 
      });
    }
  });

  // Очистка неактивных webhooks
  app.post('/api/donationalerts/webhooks/cleanup', async (req, res) => {
    try {
      await webhooks.cleanupInactiveWebhooks();
      
      res.json({
        success: true,
        message: 'Webhook cleanup completed'
      });
    } catch (error) {
      console.error('Error cleaning up webhooks:', error);
      res.status(500).json({ 
        error: error.message || 'Failed to cleanup webhooks' 
      });
    }
  });
}

module.exports = { registerDonationAlertsWebhookRoutes };
