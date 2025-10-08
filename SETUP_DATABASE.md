# Настройка базы данных PostgreSQL

## Проблема
При запуске сервера возникает ошибка: `role "postgres" does not exist`

## Решение

### Вариант 1: Создать пользователя postgres (рекомендуется)

```bash
# 1. Подключиться к PostgreSQL под вашим пользователем
psql postgres

# 2. Создать роль postgres с паролем
CREATE ROLE postgres WITH LOGIN PASSWORD 'postgres';

# 3. Дать права суперпользователя
ALTER ROLE postgres WITH SUPERUSER;

# 4. Создать базу данных
CREATE DATABASE avatar OWNER postgres;

# 5. Выйти
\q
```

### Вариант 2: Использовать текущего пользователя системы

```bash
# 1. Узнать имя текущего пользователя
whoami

# 2. Создать базу данных
createdb avatar

# 3. Обновить DATABASE_URL в .env
# Замените username на ваше имя пользователя из whoami
DATABASE_URL=postgres://username:@localhost:5432/avatar
```

### Проверка подключения

```bash
# Проверить, что можете подключиться
psql -U postgres -d avatar

# Или если используете текущего пользователя
psql -d avatar
```

## Настройка Redis

Redis используется для кеширования и событий в реальном времени.

```bash
# Установить Redis (если еще не установлен)
brew install redis

# Запустить Redis
brew services start redis

# Или запустить вручную
redis-server
```

### Проверка Redis

```bash
# Проверить, что Redis работает
redis-cli ping
# Должно вернуть: PONG
```

## Полная настройка

1. Создайте файл `.env` на основе `.env.example`:
   ```bash
   cp .env.example .env
   ```

2. Отредактируйте `.env` и укажите правильные значения

3. Настройте PostgreSQL (один из вариантов выше)

4. Запустите Redis:
   ```bash
   brew services start redis
   ```

5. Запустите сервер:
   ```bash
   npm start
   ```

## Быстрая настройка (скрипт)

Вы можете использовать скрипт для быстрой настройки:

```bash
npm run setup-db
```

