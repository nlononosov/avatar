# 🔧 Настройка переменных окружения

## Проблема
Переменные окружения для ЮKassa не загружаются, поэтому платежи не создаются.

## Решение

### 1. Создайте файл `.env` в корне проекта
Создайте файл `.env` рядом с `server.js` и `package.json`:

```bash
# YooKassa Configuration
YK_SHOP_ID=ваш_shop_id_из_кабинета_юкасса
YK_SECRET_KEY=test_ваш_секретный_ключ_из_кабинета

# Server Configuration  
BASE_URL=http://localhost:3000

# Twitch Configuration (если нужно)
TWITCH_CLIENT_ID=ваш_twitch_client_id
TWITCH_CLIENT_SECRET=ваш_twitch_client_secret
```

### 2. Получите данные из кабинета ЮKassa
1. Зайдите в [личный кабинет ЮKassa](https://yookassa.ru/my)
2. Скопируйте **Shop ID** (это не ключ, а ID магазина)
3. Скопируйте **Секретный ключ** (начинается с `test_` для тестового режима)

### 3. Замените значения в .env
```bash
YK_SHOP_ID=123456
YK_SECRET_KEY=test_qtwttzXkPYl3duCCyPJwjUZmOIj0Aa1gAQay_2jvf_o
```

### 4. Перезапустите сервер
```bash
# Остановите сервер (Ctrl+C)
# Затем запустите снова
npm start
```

### 5. Проверьте логи
При запуске вы должны увидеть:
```
[config] YK_SHOP_ID = Set
[config] YK_SECRET_KEY = Set
YooKassa config: { shopId: 'Set', secretKey: 'Set', baseUrl: 'http://localhost:3000' }
```

Если видите `Missing` - проверьте файл `.env` и перезапустите сервер.

## Тестирование
После настройки попробуйте создать платеж на 100+ монет через интерфейс.
