# Настройка DonationAlerts OAuth

## Описание
Новая логика работы: пользователи авторизуются через DonationAlerts OAuth, а не через Twitch. Это позволяет каждому пользователю использовать свой собственный аккаунт DonationAlerts для получения донатов.

## Настройка

### 1. Создание приложения в DonationAlerts
1. Перейдите в [DonationAlerts](https://www.donationalerts.com/)
2. Войдите в свой аккаунт
3. Перейдите в **Настройки** → **API**
4. Создайте новое приложение:
   - **Название**: Avatar System
   - **Redirect URI**: `http://localhost:3000/auth/donationalerts/callback`
   - **Scopes**: `oauth-user-show`, `oauth-donation-index`
5. Скопируйте **Client Secret**

### 2. Настройка переменных окружения
Создайте файл `.env` в корне проекта:
```bash
# DonationAlerts OAuth
DA_CLIENT_ID=16136
DA_CLIENT_SECRET=ваш_client_secret_здесь
DA_REDIRECT_URI=http://localhost:3000/auth/donationalerts/callback

# Остальные настройки...
TWITCH_CLIENT_ID=your_twitch_client_id
TWITCH_CLIENT_SECRET=your_twitch_client_secret
YK_SHOP_ID=your_yookassa_shop_id
YK_SECRET_KEY=your_yookassa_secret_key
```

### 3. Запуск системы
```bash
npm start
```

## Как это работает

### Для пользователей:
1. **Вход**: Пользователь нажимает "Вход через DonationAlerts"
2. **Авторизация**: Перенаправляется на DonationAlerts для авторизации
3. **Создание аккаунта**: Система создает аккаунт пользователя с его DonationAlerts данными
4. **Аватар**: Пользователь может настроить свой аватар
5. **Донаты**: При донате через DonationAlerts аватар появляется на экране

### Для стримера:
1. **Запуск системы**: Нажимает "Запустить DonationAlerts"
2. **Опрос донатов**: Система опрашивает донаты всех авторизованных пользователей
3. **Показ аватаров**: При донате аватар донатера появляется на экране

## API эндпоинты

### OAuth:
- `GET /auth/donationalerts` - Начать OAuth авторизацию
- `GET /auth/donationalerts/callback` - Callback от DonationAlerts

### Управление:
- `GET /api/donationalerts/test` - Тест API (показать донаты всех пользователей)
- `POST /api/donationalerts/start` - Запустить опрос донатов
- `POST /api/donationalerts/stop` - Остановить опрос донатов
- `GET /api/donationalerts/my-donations` - Получить донаты текущего пользователя

## Преимущества новой системы

1. **Простота для пользователей**: Не нужно получать API ключи
2. **Безопасность**: Каждый пользователь использует свой аккаунт
3. **Масштабируемость**: Неограниченное количество пользователей
4. **Автоматизация**: Система сама получает донаты всех пользователей

## Устранение неполадок

1. **Ошибка OAuth**: Проверьте Client Secret и Redirect URI
2. **Нет донатов**: Убедитесь, что пользователи авторизованы через DonationAlerts
3. **Аватар не появляется**: Проверьте, что пользователь создал аватар в системе

## Миграция с старой системы

Старая система с API ключами больше не нужна. Пользователи должны:
1. Войти через DonationAlerts OAuth
2. Настроить свой аватар
3. Донатить через свой аккаунт DonationAlerts
