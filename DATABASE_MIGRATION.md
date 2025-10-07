# 🗄️ Миграция базы данных

## Проблема с SQLite

SQLite имеет ограничения для продакшена:
- **Блокировки на запись** - только один процесс может писать одновременно
- **Нет горизонтального масштабирования** - нельзя распределить нагрузку
- **Ограниченная производительность** при высокой нагрузке
- **Нет репликации** для отказоустойчивости

## Решение

Создана абстракция для работы с БД, поддерживающая:
- **SQLite** (для разработки и малых нагрузок)
- **PostgreSQL** (для продакшена и высоких нагрузок)
- **Автоматические миграции**
- **Оптимизация производительности**

## Быстрый старт

### 1. SQLite (по умолчанию)

```bash
# Оптимизация SQLite
npm run db:optimize

# Статистика БД
npm run db:stats

# Создание бэкапа
npm run db:backup

# Запуск миграций
npm run migrate
```

### 2. PostgreSQL

```bash
# Установка зависимостей
npm install

# Настройка PostgreSQL
DB_PASSWORD=yourpassword npm run postgres:setup

# Тестирование соединения
DB_PASSWORD=yourpassword npm run postgres:test

# Запуск миграций
npm run migrate
```

## Конфигурация

### Переменные окружения

#### SQLite (по умолчанию)
```env
# Не требуется дополнительных настроек
# Используется data.sqlite в корне проекта
```

#### PostgreSQL
```env
DB_TYPE=postgresql
DB_HOST=localhost
DB_PORT=5432
DB_NAME=avatar_db
DB_USER=postgres
DB_PASSWORD=yourpassword
DB_MAX_CONNECTIONS=20
DB_IDLE_TIMEOUT=30000
DB_CONNECTION_TIMEOUT=2000
```

## Миграции

### Структура миграций

```javascript
{
  name: '001_create_users_table',
  up: {
    sqlite: 'CREATE TABLE users (...)',
    postgresql: 'CREATE TABLE users (...)'
  }
}
```

### Команды миграций

```bash
# Проверка статуса миграций
npm run migrate:check

# Запуск всех миграций
npm run migrate

# Ручной запуск
node migrations/index.js migrate
node migrations/index.js check
```

### Создание новой миграции

1. Добавьте новую миграцию в `migrations/index.js`
2. Укажите SQL для SQLite и PostgreSQL
3. Запустите миграцию: `npm run migrate`

## Оптимизация

### SQLite оптимизация

```bash
# Автоматическая оптимизация
npm run db:optimize

# Что оптимизируется:
# - WAL режим для лучшей производительности
# - Увеличение размера кеша
# - Memory-mapped I/O
# - Автоматическая очистка
# - Анализ и VACUUM
```

### PostgreSQL оптимизация

```bash
# Настройка производительности
npm run postgres:setup

# Что настраивается:
# - Connection pooling
# - Shared buffers
# - Work memory
# - Extensions (uuid-ossp, pgcrypto)
```

## Бэкапы

### SQLite бэкапы

```bash
# Создание бэкапа
npm run db:backup

# Восстановление из бэкапа
node scripts/optimize-sqlite.js restore data.sqlite data.sqlite.backup.2024-01-01
```

### PostgreSQL бэкапы

```bash
# Создание бэкапа
pg_dump -h localhost -U postgres avatar_db > backup.sql

# Восстановление
psql -h localhost -U postgres avatar_db < backup.sql
```

## Мониторинг

### SQLite мониторинг

```bash
# Статистика БД
npm run db:stats

# Проверка целостности
node scripts/optimize-sqlite.js optimize
```

### PostgreSQL мониторинг

```bash
# Тестирование соединения
npm run postgres:test

# Проверка производительности
psql -c "SELECT * FROM pg_stat_activity;"
```

## Миграция с SQLite на PostgreSQL

### 1. Подготовка

```bash
# Создайте бэкап SQLite
npm run db:backup

# Настройте PostgreSQL
DB_PASSWORD=yourpassword npm run postgres:setup
```

### 2. Экспорт данных

```bash
# Экспорт из SQLite (если нужно)
sqlite3 data.sqlite .dump > sqlite_dump.sql
```

### 3. Переключение

```env
# В .env файле
DB_TYPE=postgresql
DB_HOST=localhost
DB_PORT=5432
DB_NAME=avatar_db
DB_USER=postgres
DB_PASSWORD=yourpassword
```

### 4. Запуск миграций

```bash
# Запуск миграций на PostgreSQL
npm run migrate
```

## Производительность

### SQLite ограничения

- **Максимум**: ~1000 запросов/сек
- **Одновременные записи**: 1 процесс
- **Размер БД**: до 281 TB
- **Подключения**: до 1000

### PostgreSQL возможности

- **Максимум**: 10,000+ запросов/сек
- **Одновременные записи**: неограниченно
- **Размер БД**: неограниченно
- **Подключения**: до 100,000+
- **Репликация**: Master-Slave, Master-Master
- **Шардинг**: горизонтальное масштабирование

## Рекомендации

### Для разработки
- Используйте SQLite
- Регулярно оптимизируйте: `npm run db:optimize`
- Создавайте бэкапы: `npm run db:backup`

### Для продакшена
- Используйте PostgreSQL
- Настройте connection pooling
- Включите репликацию
- Мониторьте производительность
- Регулярно создавайте бэкапы

### Для высоких нагрузок
- PostgreSQL с репликацией
- Redis для кеширования
- Load balancer для распределения нагрузки
- Мониторинг и алерты

## Устранение неполадок

### SQLite проблемы

```bash
# Проверка целостности
node scripts/optimize-sqlite.js optimize

# Восстановление из бэкапа
node scripts/optimize-sqlite.js restore data.sqlite backup.sqlite
```

### PostgreSQL проблемы

```bash
# Тестирование соединения
npm run postgres:test

# Проверка логов
tail -f /var/log/postgresql/postgresql-*.log
```

### Миграции

```bash
# Проверка статуса
npm run migrate:check

# Принудительный запуск
node migrations/index.js migrate
```

## Безопасность

### SQLite
- Ограничьте права доступа к файлу БД (600)
- Регулярно создавайте бэкапы
- Шифруйте токены (уже реализовано)

### PostgreSQL
- Используйте SSL соединения
- Ограничьте доступ по IP
- Регулярно обновляйте пароли
- Мониторьте подключения

## Готово! 🎉

Теперь ваше приложение поддерживает как SQLite, так и PostgreSQL с автоматическими миграциями и оптимизацией производительности!
