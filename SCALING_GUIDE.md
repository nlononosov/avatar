# Руководство по масштабированию для 20-50 стримеров

## Обзор архитектуры

Проект спроектирован для поддержки 20-50+ одновременных стримеров с использованием:

1. **Redis** - распределённое состояние и event bus
2. **PM2 Cluster Mode** - горизонтальное масштабирование на одном сервере
3. **Асинхронная очередь БД** - неблокирующие SQLite операции
4. **Динамический поллинг** - автоматическое масштабирование параметров
5. **Мониторинг и метрики** - Prometheus метрики для отслеживания

## Ключевые компоненты масштабирования

### 1. Redis для распределённого состояния

Redis используется для:
- **Event Bus** - распространяет события между инстансами через pub/sub
- **Состояние ботов** - хранит активность ботов и аватаров
- **Состояние игр** - гонки и мини-игры синхронизируются через Redis
- **Блокировки** - Redlock предотвращает дублирование обработки донатов

**Конфигурация:**
```bash
REDIS_URL=redis://localhost:6379
REDIS_REQUIRED=true  # Обязательно для production
REDIS_TLS=false      # Включите для Redis Cloud
```

### 2. PM2 Cluster Mode

Конфигурация в `ecosystem.config.js`:
- `instances: 'max'` - использует все CPU ядра
- `exec_mode: 'cluster'` - запускает кластер инстансов
- `max_memory_restart: '2G'` - авторестарт при превышении памяти

**Запуск:**
```bash
pm2 start ecosystem.config.js
pm2 save        # Сохранить конфигурацию
pm2 startup     # Автозапуск после перезагрузки
```

### 3. Динамический поллинг DonationAlerts

Система автоматически адаптирует параметры:

**Формула параллелизма:**
- `concurrency = max(2, min(50, ceil(streamers / 10 * 4)))`
- Для 20 стримеров: 8 воркеров
- Для 50 стримеров: 20 воркеров

**Динамический интервал:**
- Минимум: 3 секунды
- Максимум: 30 секунд
- Рассчитывается как: `estimatedCycleTime * 2`

**Конфигурация:**
```bash
DA_POLL_INTERVAL_MS=5000
DA_POLL_CONCURRENCY=4
DA_POLL_LOCK_TTL_MS=4500
```

### 4. Асинхронная БД очередь

SQLite операции выполняются через Worker Thread, не блокируя event loop:
- Все операции через `lib/db/async.js`
- Автоматический рестарт при сбоях
- Параллельная обработка запросов

## Системные требования

### Минимальные (20 стримеров)
- CPU: 4 ядра
- RAM: 4GB
- Disk: 10GB SSD
- Redis: 1GB
- Network: 100 Mbps

### Рекомендуемые (50 стримеров)
- CPU: 8+ ядер
- RAM: 8GB
- Disk: 20GB SSD
- Redis: 2GB
- Network: 500 Mbps

## Мониторинг и метрики

### Prometheus метрики

Эндпоинт: `http://localhost:3000/metrics`

**Ключевые метрики:**
- `donationalerts_poll_duration_seconds` - время поллинга
- `overlay_sse_connections` - количество активных overlay подключений
- `redis_health_status` - статус Redis
- `donationalerts_queue_entries` - размер очереди

### Health Check

Эндпоинт: `http://localhost:3000/health`

Проверяет:
- Доступность Redis
- Размер очереди поллинга
- Состояние системы

### PM2 Мониторинг

```bash
pm2 monit              # Интерактивный мониторинг
pm2 logs               # Логи
pm2 status             # Статус инстансов
```

## Отказоустойчивость

### Graceful Shutdown

PM2 отправляет SIGTERM, приложение корректно завершает:
- Закрывает DB соединения
- Останавливает поллинг
- Завершает активные запросы

### Redis Fallback

При недоступности Redis система переходит в режим in-memory:
- Теряется координация между инстансами
- Event bus не работает
- Не подходит для production

**Всегда используйте `REDIS_REQUIRED=true` в production!**

## Горизонтальное масштабирование

### Балансировщик нагрузки

Если один сервер недостаточен, запустите несколько инстансов за nginx:

**nginx.conf:**
```nginx
upstream avatar_backend {
    least_conn;  # Балансировка по наименьшей нагрузке
    server localhost:3000;
    server localhost:3001;
    server localhost:3002;
}

server {
    listen 80;
    
    location / {
        proxy_pass http://avatar_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
    
    location /overlay/events {
        proxy_pass http://avatar_backend;
        proxy_set_header Connection '';
        proxy_http_version 1.1;
        chunked_transfer_encoding off;
        proxy_buffering off;
        proxy_cache off;
    }
}
```

### Координация через Redis

Все инстансы подключаются к одному Redis:
- Event bus синхронизирует события
- Redlock предотвращает дублирование
- Состояние игр разделяется

## Тюнинг производительности

### SQLite оптимизации

В `db.js` уже включено:
```javascript
db.pragma('journal_mode = WAL');  // Write-Ahead Logging
```

### Redis настройки

```redis
maxmemory 2gb
maxmemory-policy allkeys-lru
save ""  # Отключить RDB для лучшей производительности
```

### Node.js флаги

```bash
NODE_OPTIONS="--max-old-space-size=4096" pm2 start ecosystem.config.js
```

## Troubleshooting

### Высокая нагрузка на Redis

**Симптомы:** Задержки, таймауты

**Решения:**
- Увеличьте `maxmemory`
- Настройте Redis persistence
- Рассмотрите Redis Sentinel для высокой доступности

### Очередь донатов переполняется

**Симптомы:** `donationalerts_queue_entries` растёт

**Решения:**
- Увеличьте `DA_POLL_CONCURRENCY`
- Проверьте производительность API DonationAlerts
- Увеличьте интервал опроса

### SQLite блокировки

**Симптомы:** Задержки операций БД

**Решения:**
- Проверьте что используется `lib/db/async.js`
- Убедитесь что `journal_mode = WAL`
- Рассмотрите PostgreSQL для 50+ стримеров

### Memory leaks

**Симптомы:** RAM постоянно растёт

**Решения:**
- Проверьте что эндпоинты не держат открытыми соединения SSE
- Проверьте очистку таймеров в играх
- Используйте `pm2 --max-memory-restart 2G`

## Производственный чеклист

См. [SCALING_CHECKLIST.md](./SCALING_CHECKLIST.md) для полного списка проверок.

## Дополнительные ресурсы

- [PM2 Documentation](https://pm2.keymetrics.io/docs/usage/cluster-mode/)
- [Redis Best Practices](https://redis.io/docs/manual/patterns/)
- [Node.js Production Best Practices](https://github.com/goldbergyoni/nodebestpractices)

