/**
 * Планировщик для DonationAlerts с rate limiting и backoff
 */

const { getAllStreamers } = require('../db');

class DonationAlertsScheduler {
  constructor() {
    this.streamers = new Map(); // streamerId -> { lastPoll, nextPoll, backoff, errors }
    this.isRunning = false;
    this.pollingInterval = null;
    this.rateLimiter = new Map(); // streamerId -> { requests, windowStart }
    
    // Настройки
    this.config = {
      baseInterval: 5000, // 5 секунд базовый интервал
      maxInterval: 60000, // 1 минута максимальный интервал
      backoffMultiplier: 2, // Увеличиваем интервал в 2 раза при ошибках
      maxBackoff: 5, // Максимум 5 попыток backoff
      rateLimitWindow: 60000, // 1 минута окно для rate limiting
      maxRequestsPerWindow: 10, // Максимум 10 запросов в минуту на стримера
      webhookTimeout: 30000 // 30 секунд таймаут для webhook
    };
  }

  /**
   * Добавляет стримера в планировщик
   */
  addStreamer(streamerId) {
    if (!this.streamers.has(streamerId)) {
      this.streamers.set(streamerId, {
        lastPoll: 0,
        nextPoll: Date.now(),
        backoff: 0,
        errors: 0,
        webhookEnabled: false,
        lastCursor: null
      });
      console.log(`[DA Scheduler] Added streamer ${streamerId} to scheduler`);
    }
  }

  /**
   * Удаляет стримера из планировщика
   */
  removeStreamer(streamerId) {
    this.streamers.delete(streamerId);
    this.rateLimiter.delete(streamerId);
    console.log(`[DA Scheduler] Removed streamer ${streamerId} from scheduler`);
  }

  /**
   * Проверяет rate limit для стримера
   */
  checkRateLimit(streamerId) {
    const now = Date.now();
    const rateLimit = this.rateLimiter.get(streamerId) || { requests: 0, windowStart: now };
    
    // Сбрасываем окно если прошла минута
    if (now - rateLimit.windowStart > this.config.rateLimitWindow) {
      rateLimit.requests = 0;
      rateLimit.windowStart = now;
    }
    
    // Проверяем лимит
    if (rateLimit.requests >= this.config.maxRequestsPerWindow) {
      return false;
    }
    
    // Увеличиваем счетчик
    rateLimit.requests++;
    this.rateLimiter.set(streamerId, rateLimit);
    
    return true;
  }

  /**
   * Вычисляет следующий интервал polling с учетом backoff
   */
  calculateNextInterval(streamerId, success = true) {
    const streamer = this.streamers.get(streamerId);
    if (!streamer) return this.config.baseInterval;
    
    if (success) {
      // Сбрасываем backoff при успехе
      streamer.backoff = 0;
      streamer.errors = 0;
      return this.config.baseInterval;
    } else {
      // Увеличиваем backoff при ошибке
      streamer.errors++;
      streamer.backoff = Math.min(streamer.backoff + 1, this.config.maxBackoff);
      
      const interval = this.config.baseInterval * Math.pow(this.config.backoffMultiplier, streamer.backoff);
      return Math.min(interval, this.config.maxInterval);
    }
  }

  /**
   * Обновляет время следующего polling для стримера
   */
  updateNextPoll(streamerId, success = true) {
    const streamer = this.streamers.get(streamerId);
    if (!streamer) return;
    
    const interval = this.calculateNextInterval(streamerId, success);
    streamer.nextPoll = Date.now() + interval;
    streamer.lastPoll = Date.now();
    
    if (!success) {
      console.log(`[DA Scheduler] Streamer ${streamerId} backoff: ${streamer.backoff}, next poll in ${interval}ms`);
    }
  }

  /**
   * Получает стримеров готовых к polling
   */
  getReadyStreamers() {
    const now = Date.now();
    const ready = [];
    
    for (const [streamerId, streamer] of this.streamers) {
      if (now >= streamer.nextPoll && this.checkRateLimit(streamerId)) {
        ready.push(streamerId);
      }
    }
    
    return ready;
  }

  /**
   * Запускает планировщик
   */
  start() {
    if (this.isRunning) {
      console.log('[DA Scheduler] Already running');
      return;
    }
    
    this.isRunning = true;
    console.log('[DA Scheduler] Starting scheduler...');
    
    // Загружаем активных стримеров
    this.loadActiveStreamers();
    
    // Запускаем основной цикл
    this.pollingInterval = setInterval(() => {
      this.pollCycle();
    }, 1000); // Проверяем каждую секунду
    
    console.log('[DA Scheduler] Scheduler started');
  }

  /**
   * Останавливает планировщик
   */
  stop() {
    if (!this.isRunning) {
      return;
    }
    
    this.isRunning = false;
    
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    
    console.log('[DA Scheduler] Scheduler stopped');
  }

  /**
   * Загружает активных стримеров из БД
   */
  loadActiveStreamers() {
    try {
      const streamers = getAllStreamers();
      streamers.forEach(streamer => {
        this.addStreamer(streamer.streamer_twitch_id);
      });
      console.log(`[DA Scheduler] Loaded ${streamers.length} active streamers`);
    } catch (error) {
      console.error('[DA Scheduler] Error loading streamers:', error);
    }
  }

  /**
   * Основной цикл polling
   */
  async pollCycle() {
    if (!this.isRunning) return;
    
    const readyStreamers = this.getReadyStreamers();
    
    if (readyStreamers.length === 0) {
      return;
    }
    
    console.log(`[DA Scheduler] Polling ${readyStreamers.length} streamers`);
    
    // Обрабатываем стримеров параллельно, но с ограничением
    const batchSize = 3; // Максимум 3 стримера одновременно
    const batches = [];
    
    for (let i = 0; i < readyStreamers.length; i += batchSize) {
      batches.push(readyStreamers.slice(i, i + batchSize));
    }
    
    for (const batch of batches) {
      await Promise.allSettled(
        batch.map(streamerId => this.pollStreamer(streamerId))
      );
      
      // Небольшая задержка между батчами
      if (batches.indexOf(batch) < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }

  /**
   * Polling для конкретного стримера
   */
  async pollStreamer(streamerId) {
    try {
      const { pollStreamer } = require('./donationalerts-poll');
      await pollStreamer(streamerId);
      this.updateNextPoll(streamerId, true);
    } catch (error) {
      console.error(`[DA Scheduler] Error polling streamer ${streamerId}:`, error.message);
      this.updateNextPoll(streamerId, false);
    }
  }

  /**
   * Обрабатывает webhook для стримера
   */
  async handleWebhook(streamerId, webhookData) {
    try {
      const streamer = this.streamers.get(streamerId);
      if (!streamer) {
        console.log(`[DA Scheduler] Webhook for unknown streamer ${streamerId}`);
        return false;
      }
      
      // Обновляем курсор
      if (webhookData.cursor) {
        streamer.lastCursor = webhookData.cursor;
      }
      
      // Обрабатываем донаты из webhook
      if (webhookData.donations && webhookData.donations.length > 0) {
        const { processDonation } = require('./donationalerts-poll');
        
        for (const donation of webhookData.donations) {
          await processDonation(streamerId, donation);
        }
        
        console.log(`[DA Scheduler] Processed ${webhookData.donations.length} donations from webhook for streamer ${streamerId}`);
      }
      
      // Сбрасываем backoff при успешном webhook
      this.updateNextPoll(streamerId, true);
      
      return true;
    } catch (error) {
      console.error(`[DA Scheduler] Error handling webhook for streamer ${streamerId}:`, error);
      return false;
    }
  }

  /**
   * Получает статистику планировщика
   */
  getStats() {
    const stats = {
      isRunning: this.isRunning,
      totalStreamers: this.streamers.size,
      readyStreamers: this.getReadyStreamers().length,
      streamers: {}
    };
    
    for (const [streamerId, streamer] of this.streamers) {
      stats.streamers[streamerId] = {
        lastPoll: streamer.lastPoll,
        nextPoll: streamer.nextPoll,
        backoff: streamer.backoff,
        errors: streamer.errors,
        webhookEnabled: streamer.webhookEnabled,
        rateLimit: this.rateLimiter.get(streamerId) || { requests: 0, windowStart: 0 }
      };
    }
    
    return stats;
  }

  /**
   * Принудительно обновляет polling для стримера
   */
  forcePoll(streamerId) {
    const streamer = this.streamers.get(streamerId);
    if (streamer) {
      streamer.nextPoll = Date.now();
      console.log(`[DA Scheduler] Forced poll for streamer ${streamerId}`);
    }
  }

  /**
   * Сбрасывает backoff для стримера
   */
  resetBackoff(streamerId) {
    const streamer = this.streamers.get(streamerId);
    if (streamer) {
      streamer.backoff = 0;
      streamer.errors = 0;
      streamer.nextPoll = Date.now();
      console.log(`[DA Scheduler] Reset backoff for streamer ${streamerId}`);
    }
  }
}

// Создаем глобальный экземпляр
const scheduler = new DonationAlertsScheduler();

module.exports = {
  DonationAlertsScheduler,
  scheduler
};
