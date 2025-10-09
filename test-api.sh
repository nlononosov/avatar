#!/bin/bash

echo "🔍 Проверка API endpoints..."
echo ""

# Проверка главной страницы
echo "1️⃣ Проверка главной страницы (GET /)..."
curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" http://localhost:3000/
echo ""

# Проверка статуса авторизации
echo "2️⃣ Проверка статуса авторизации (GET /auth/status)..."
curl -s http://localhost:3000/auth/status
echo ""
echo ""

# Проверка инициализации OAuth
echo "3️⃣ Проверка инициализации OAuth (GET /auth/twitch/init)..."
curl -s http://localhost:3000/auth/twitch/init
echo ""
echo ""

echo "✅ Проверка завершена!"
echo ""
echo "Если все эндпоинты отвечают, значит сервер работает нормально."
echo "Проблема может быть на стороне браузера."

