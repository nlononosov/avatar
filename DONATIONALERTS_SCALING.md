# DonationAlerts Масштабирование

## Проблема

Старая система polling DonationAlerts имела следующие ограничения:

- **Глобальный polling** - все стримеры опрашивались одновременно каждые 5 секунд
- **Нет rate limiting** - риск превышения лимитов API
- **Нет backoff** - при ошибках polling продолжался с той же частотой
- **Нет курсора** - могли пропускаться или дублироваться донаты
- **Нет webhooks** - только polling, что неэффективно при большом количестве стримеров

## Решение

Реализована новая система с:

### 1. Планировщик с Rate Limiting

```javascript
// lib/donationalerts-scheduler.js
class DonationAlertsScheduler {
  // Rate limiting: 10 запросов в минуту на стримера
  // Backoff: экспоненциальное увеличение интервала при ошибках
  // Батчинг: максимум 3 стримера одновременно
}
```

**Настройки:**
- Базовый интервал: 5 секунд
- Максимальный интервал: 60 секунд
- Rate limit: 10 запросов в минуту на стримера
- Backoff multiplier: 2x при ошибках
- Батч размер: 3 стримера одновременно

### 2. Webhooks

```javascript
// lib/donationalerts-webhooks.js
class DonationAlertsWebhooks {
  // Регистрация webhook в DonationAlerts
  // Проверка подписи входящих webhooks
  // Автоматическая обработка донатов
}
```

**Преимущества webhooks:**
- Мгновенная доставка донатов
- Снижение нагрузки на API
- Более надежная доставка

### 3. Курсор для точного отслеживания

```javascript
// Отслеживание последней обработанной донаты
const result = await fetchDonations(creds, lastCursor);
// Сохранение курсора для следующего запроса
updateStreamerCursor(streamerId, nextCursor);
```

**Преимущества курсора:**
- Нет пропущенных донатов
- Нет дублирования
- Эффективная пагинация

## Использование

### Запуск системы

```bash
# Система автоматически запускается при старте сервера
npm start
```

### Тестирование

```bash
# Тест всей системы
npm run test:da

# Тест планировщика
npm run test:da:scheduler

# Тест webhooks
npm run test:da:webhooks

# Тест rate limiting
npm run test:da:rate-limit

# Тест backoff
npm run test:da:backoff
```

### API для управления

#### Планировщик

```bash
# Статистика планировщика
GET /api/donationalerts/scheduler/stats

# Принудительный polling
POST /api/donationalerts/scheduler/force-poll/:streamerId

# Сброс backoff
POST /api/donationalerts/scheduler/reset-backoff/:streamerId
```

#### Webhooks

```bash
# Регистрация webhook
POST /api/donationalerts/webhook/register
{
  "streamerId": "12345",
  "webhookUrl": "https://yourdomain.com/api/donationalerts/webhook"
}

# Удаление webhook
DELETE /api/donationalerts/webhook/:streamerId

# Проверка статуса
GET /api/donationalerts/webhook/:streamerId/status

# Статистика webhooks
GET /api/donationalerts/webhooks/stats

# Очистка неактивных
POST /api/donationalerts/webhooks/cleanup
```

## Конфигурация

### Переменные окружения

```env
# Секрет для webhooks (автогенерируется если не указан)
DA_WEBHOOK_SECRET=your_webhook_secret

# Настройки планировщика (в коде)
BASE_INTERVAL=5000          # 5 секунд
MAX_INTERVAL=60000          # 1 минута
RATE_LIMIT_WINDOW=60000     # 1 минута
MAX_REQUESTS_PER_WINDOW=10  # 10 запросов
```

### Настройка webhook URL

```javascript
// В DonationAlerts настройте webhook URL:
// https://yourdomain.com/api/donationalerts/webhook
```

## Мониторинг

### Логи

```bash
# Планировщик
[DA Scheduler] Added streamer 12345 to scheduler
[DA Scheduler] Polling 3 streamers
[DA Scheduler] Streamer 12345 backoff: 2, next poll in 20000ms

# Webhooks
[DA Webhooks] Registered webhook for streamer 12345: https://...
[DA Webhooks] Received webhook: donation
[DA Webhooks] Processed 1 donations from webhook for streamer 12345
```

### Метрики

```javascript
// Статистика планировщика
{
  "isRunning": true,
  "totalStreamers": 5,
  "readyStreamers": 2,
  "streamers": {
    "12345": {
      "lastPoll": 1640995200000,
      "nextPoll": 1640995205000,
      "backoff": 0,
      "errors": 0,
      "webhookEnabled": true
    }
  }
}
```

## Масштабирование

### Для малых проектов (до 10 стримеров)

- Используйте только polling
- Webhooks не обязательны
- Базовые настройки подходят

### Для средних проектов (10-50 стримеров)

- Рекомендуется использовать webhooks
- Настройте rate limiting
- Мониторьте backoff

### Для больших проектов (50+ стримеров)

- Обязательно используйте webhooks
- Настройте мониторинг
- Рассмотрите горизонтальное масштабирование

## Troubleshooting

### Проблема: Высокий backoff

```bash
# Проверьте статус
GET /api/donationalerts/scheduler/stats

# Сбросьте backoff
POST /api/donationalerts/scheduler/reset-backoff/:streamerId
```

### Проблема: Webhook не работает

```bash
# Проверьте статус webhook
GET /api/donationalerts/webhook/:streamerId/status

# Перерегистрируйте webhook
POST /api/donationalerts/webhook/register
```

### Проблема: Rate limit exceeded

```bash
# Проверьте статистику
GET /api/donationalerts/scheduler/stats

# Увеличьте интервал в коде или уменьшите количество стримеров
```

## Миграция

### Автоматическая миграция

```bash
# Запустите миграции
npm run migrate

# Проверьте статус
npm run migrate:check
```

### Ручная настройка

1. Остановите старый сервер
2. Запустите миграции
3. Запустите новый сервер
4. Проверьте работу системы

## Безопасность

### Webhook подписи

```javascript
// Проверка подписи входящих webhooks
const signature = req.headers['x-da-signature'];
const isValid = webhooks.verifySignature(body, signature);
```

### Rate limiting

```javascript
// Защита от злоупотреблений
const allowed = scheduler.checkRateLimit(streamerId);
if (!allowed) {
  // Запрос заблокирован
}
```

## Производительность

### Оптимизации

- **Батчинг**: Обработка до 3 стримеров одновременно
- **Курсор**: Эффективная пагинация без дублирования
- **Webhooks**: Мгновенная доставка без polling
- **Rate limiting**: Защита от превышения лимитов

### Мониторинг производительности

```bash
# Статистика планировщика
npm run test:da:scheduler

# Статистика webhooks
npm run test:da:webhooks
```

## Заключение

Новая система DonationAlerts обеспечивает:

- ✅ **Масштабируемость** - поддержка сотен стримеров
- ✅ **Надежность** - backoff и retry механизмы
- ✅ **Эффективность** - webhooks и курсор
- ✅ **Безопасность** - rate limiting и подписи
- ✅ **Мониторинг** - детальная статистика

Система готова к продакшену и может обрабатывать высокие нагрузки.
