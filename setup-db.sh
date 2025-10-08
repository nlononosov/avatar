#!/bin/bash

echo "🔧 Настройка базы данных для Avatar System"
echo ""

# Проверка PostgreSQL
echo "📊 Проверка PostgreSQL..."
if ! command -v psql &> /dev/null; then
    echo "❌ PostgreSQL не установлен"
    echo "Установите PostgreSQL: brew install postgresql@14"
    exit 1
fi

if ! pg_isready &> /dev/null; then
    echo "❌ PostgreSQL не запущен"
    echo "Запустите PostgreSQL: brew services start postgresql@14"
    exit 1
fi

echo "✅ PostgreSQL запущен"
echo ""

# Получить текущего пользователя
CURRENT_USER=$(whoami)
echo "👤 Текущий пользователь системы: $CURRENT_USER"
echo ""

# Предложить выбор
echo "Выберите способ настройки:"
echo "1) Создать пользователя 'postgres' (рекомендуется)"
echo "2) Использовать текущего пользователя ($CURRENT_USER)"
echo ""
read -p "Ваш выбор (1 или 2): " choice

if [ "$choice" = "1" ]; then
    echo ""
    echo "🔐 Создание пользователя postgres..."
    
    # Создать пользователя postgres
    psql postgres -c "CREATE ROLE postgres WITH LOGIN PASSWORD 'postgres';" 2>/dev/null || {
        echo "ℹ️  Пользователь postgres уже существует"
    }
    
    # Дать права суперпользователя
    psql postgres -c "ALTER ROLE postgres WITH SUPERUSER;" 2>/dev/null
    
    # Создать базу данных
    psql postgres -c "CREATE DATABASE avatar OWNER postgres;" 2>/dev/null || {
        echo "ℹ️  База данных avatar уже существует"
    }
    
    DATABASE_URL="postgres://postgres:postgres@localhost:5432/avatar"
    echo "✅ Пользователь postgres создан"
    
elif [ "$choice" = "2" ]; then
    echo ""
    echo "🔐 Использование текущего пользователя..."
    
    # Создать базу данных
    createdb avatar 2>/dev/null || {
        echo "ℹ️  База данных avatar уже существует"
    }
    
    DATABASE_URL="postgres://$CURRENT_USER:@localhost:5432/avatar"
    echo "✅ База данных создана для пользователя $CURRENT_USER"
else
    echo "❌ Неверный выбор"
    exit 1
fi

echo ""
echo "🗄️  Проверка подключения к базе данных..."
if psql "$DATABASE_URL" -c "SELECT 1;" &> /dev/null; then
    echo "✅ Подключение к базе данных успешно"
else
    echo "❌ Не удалось подключиться к базе данных"
    exit 1
fi

echo ""
echo "🔴 Проверка Redis..."
if ! command -v redis-cli &> /dev/null; then
    echo "⚠️  Redis не установлен"
    echo "Установите Redis: brew install redis"
else
    if redis-cli ping &> /dev/null; then
        echo "✅ Redis работает"
    else
        echo "⚠️  Redis не запущен"
        echo "Запустите Redis: brew services start redis"
    fi
fi

echo ""
echo "📝 Создание файла .env..."
if [ -f .env ]; then
    echo "⚠️  Файл .env уже существует"
    read -p "Перезаписать? (y/n): " overwrite
    if [ "$overwrite" != "y" ]; then
        echo "Пропуск создания .env"
        echo ""
        echo "✅ Настройка завершена!"
        echo "DATABASE_URL: $DATABASE_URL"
        exit 0
    fi
fi

cat > .env << EOF
# Server Configuration
PORT=3000
BASE_URL=http://localhost:3000

# Twitch OAuth (замените на ваши данные)
TWITCH_CLIENT_ID=your_twitch_client_id
TWITCH_CLIENT_SECRET=your_twitch_client_secret
TWITCH_SCOPES=chat:read chat:edit

# PostgreSQL Database
DATABASE_URL=$DATABASE_URL

# Redis
REDIS_HOST=127.0.0.1
REDIS_PORT=6379

# YooKassa Payment (замените на ваши данные)
YK_SHOP_ID=your_shop_id
YK_SECRET_KEY=your_secret_key

# DonationAlerts (замените на ваши данные)
DA_CLIENT_ID=your_da_client_id
DA_CLIENT_SECRET=your_da_client_secret
DA_REDIRECT_URI=http://localhost:3000/auth/donationalerts/callback
EOF

echo "✅ Файл .env создан"
echo ""
echo "✅ Настройка завершена!"
echo ""
echo "📌 DATABASE_URL: $DATABASE_URL"
echo ""
echo "⚠️  Не забудьте:"
echo "   1. Обновить TWITCH_CLIENT_ID и TWITCH_CLIENT_SECRET в .env"
echo "   2. Обновить YK_SHOP_ID и YK_SECRET_KEY в .env"
echo "   3. Обновить DA_CLIENT_ID и DA_CLIENT_SECRET в .env"
echo "   4. Запустить Redis: brew services start redis"
echo ""
echo "🚀 Запустите сервер: npm start"

