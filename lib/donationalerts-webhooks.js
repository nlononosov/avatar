/**
 * Webhooks для DonationAlerts
 */

const crypto = require('crypto');
const { getStreamerDA, upsertStreamerDA } = require('../db');
const { scheduler } = require('./donationalerts-scheduler');

class DonationAlertsWebhooks {
  constructor() {
    this.webhookSecret = process.env.DA_WEBHOOK_SECRET || crypto.randomBytes(32).toString('hex');
    this.registeredWebhooks = new Map(); // streamerId -> webhookData
  }

  /**
   * Регистрирует webhook для стримера
   */
  async registerWebhook(streamerId, webhookUrl) {
    try {
      const creds = getStreamerDA(streamerId);
      if (!creds || creds.status !== 'active') {
        throw new Error('Streamer not found or inactive');
      }

      // Регистрируем webhook в DonationAlerts
      const response = await this.callDonationAlertsAPI(creds, 'POST', '/api/v1/webhooks', {
        url: webhookUrl,
        events: ['donation'],
        secret: this.webhookSecret
      });

      if (response.data && response.data.id) {
        this.registeredWebhooks.set(streamerId, {
          id: response.data.id,
          url: webhookUrl,
          secret: this.webhookSecret,
          registeredAt: Date.now()
        });

        // Обновляем статус стримера
        upsertStreamerDA({
          ...creds,
          webhook_enabled: true,
          webhook_url: webhookUrl,
          webhook_id: response.data.id
        });

        // Добавляем в планировщик с webhook режимом
        scheduler.addStreamer(streamerId);
        const streamer = scheduler.streamers.get(streamerId);
        if (streamer) {
          streamer.webhookEnabled = true;
        }

        console.log(`[DA Webhooks] Registered webhook for streamer ${streamerId}: ${webhookUrl}`);
        return response.data;
      }

      throw new Error('Failed to register webhook');
    } catch (error) {
      console.error(`[DA Webhooks] Error registering webhook for streamer ${streamerId}:`, error);
      throw error;
    }
  }

  /**
   * Удаляет webhook для стримера
   */
  async unregisterWebhook(streamerId) {
    try {
      const webhookData = this.registeredWebhooks.get(streamerId);
      if (!webhookData) {
        console.log(`[DA Webhooks] No webhook registered for streamer ${streamerId}`);
        return;
      }

      const creds = getStreamerDA(streamerId);
      if (creds) {
        // Удаляем webhook в DonationAlerts
        await this.callDonationAlertsAPI(creds, 'DELETE', `/api/v1/webhooks/${webhookData.id}`);

        // Обновляем статус стримера
        upsertStreamerDA({
          ...creds,
          webhook_enabled: false,
          webhook_url: null,
          webhook_id: null
        });
      }

      this.registeredWebhooks.delete(streamerId);

      // Обновляем планировщик
      const streamer = scheduler.streamers.get(streamerId);
      if (streamer) {
        streamer.webhookEnabled = false;
      }

      console.log(`[DA Webhooks] Unregistered webhook for streamer ${streamerId}`);
    } catch (error) {
      console.error(`[DA Webhooks] Error unregistering webhook for streamer ${streamerId}:`, error);
      throw error;
    }
  }

  /**
   * Обрабатывает входящий webhook
   */
  async handleWebhook(req, res) {
    try {
      const signature = req.headers['x-da-signature'];
      const body = JSON.stringify(req.body);

      // Проверяем подпись
      if (!this.verifySignature(body, signature)) {
        console.error('[DA Webhooks] Invalid webhook signature');
        return res.status(401).json({ error: 'Invalid signature' });
      }

      const webhookData = req.body;
      console.log(`[DA Webhooks] Received webhook: ${webhookData.type}`, webhookData);

      // Обрабатываем разные типы событий
      switch (webhookData.type) {
        case 'donation':
          await this.handleDonationWebhook(webhookData);
          break;
        case 'test':
          console.log('[DA Webhooks] Test webhook received');
          break;
        default:
          console.log(`[DA Webhooks] Unknown webhook type: ${webhookData.type}`);
      }

      res.status(200).json({ success: true });
    } catch (error) {
      console.error('[DA Webhooks] Error handling webhook:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Обрабатывает webhook с донатом
   */
  async handleDonationWebhook(webhookData) {
    try {
      const donation = webhookData.data;
      const streamerId = webhookData.streamer_id || webhookData.user_id;

      if (!streamerId) {
        console.error('[DA Webhooks] No streamer ID in webhook data');
        return;
      }

      // Передаем в планировщик для обработки
      await scheduler.handleWebhook(streamerId, {
        donations: [donation],
        cursor: webhookData.cursor,
        timestamp: webhookData.timestamp
      });

      console.log(`[DA Webhooks] Processed donation webhook for streamer ${streamerId}`);
    } catch (error) {
      console.error('[DA Webhooks] Error processing donation webhook:', error);
    }
  }

  /**
   * Проверяет подпись webhook
   */
  verifySignature(body, signature) {
    if (!signature) return false;

    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(body)
      .digest('hex');

    const receivedSignature = signature.replace('sha256=', '');
    
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(receivedSignature, 'hex')
    );
  }

  /**
   * Вызывает API DonationAlerts
   */
  async callDonationAlertsAPI(creds, method, endpoint, data = null) {
    const axios = require('axios');
    
    const config = {
      method,
      url: `https://www.donationalerts.com${endpoint}`,
      headers: {
        'Authorization': `Bearer ${creds.da_access_token}`,
        'Content-Type': 'application/json'
      }
    };

    if (data) {
      config.data = data;
    }

    return await axios(config);
  }

  /**
   * Получает список зарегистрированных webhooks
   */
  async getWebhooks(streamerId) {
    try {
      const creds = getStreamerDA(streamerId);
      if (!creds || creds.status !== 'active') {
        throw new Error('Streamer not found or inactive');
      }

      const response = await this.callDonationAlertsAPI(creds, 'GET', '/api/v1/webhooks');
      return response.data;
    } catch (error) {
      console.error(`[DA Webhooks] Error getting webhooks for streamer ${streamerId}:`, error);
      throw error;
    }
  }

  /**
   * Проверяет статус webhook
   */
  async checkWebhookStatus(streamerId) {
    try {
      const webhooks = await this.getWebhooks(streamerId);
      const webhookData = this.registeredWebhooks.get(streamerId);
      
      if (!webhookData) {
        return { registered: false };
      }

      const webhook = webhooks.data?.find(w => w.id === webhookData.id);
      
      return {
        registered: !!webhook,
        active: webhook?.status === 'active',
        url: webhook?.url,
        lastDelivery: webhook?.last_delivery_at,
        failures: webhook?.failure_count || 0
      };
    } catch (error) {
      console.error(`[DA Webhooks] Error checking webhook status for streamer ${streamerId}:`, error);
      return { registered: false, error: error.message };
    }
  }

  /**
   * Получает статистику webhooks
   */
  getStats() {
    return {
      totalRegistered: this.registeredWebhooks.size,
      webhooks: Array.from(this.registeredWebhooks.entries()).map(([streamerId, data]) => ({
        streamerId,
        url: data.url,
        registeredAt: data.registeredAt
      }))
    };
  }

  /**
   * Очищает неактивные webhooks
   */
  async cleanupInactiveWebhooks() {
    console.log('[DA Webhooks] Cleaning up inactive webhooks...');
    
    for (const [streamerId, webhookData] of this.registeredWebhooks) {
      try {
        const status = await this.checkWebhookStatus(streamerId);
        
        if (!status.registered || !status.active) {
          console.log(`[DA Webhooks] Removing inactive webhook for streamer ${streamerId}`);
          await this.unregisterWebhook(streamerId);
        }
      } catch (error) {
        console.error(`[DA Webhooks] Error checking webhook for streamer ${streamerId}:`, error);
      }
    }
  }
}

// Создаем глобальный экземпляр
const webhooks = new DonationAlertsWebhooks();

module.exports = {
  DonationAlertsWebhooks,
  webhooks
};
