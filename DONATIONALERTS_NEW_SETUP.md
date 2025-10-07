# Новая система DonationAlerts

## Описание
Обновленная логика работы:
1. **Основной вход через Twitch** (как было)
2. **Подключение DonationAlerts** через форму на странице бота
3. **Отслеживание донатов** по никам подключенных пользователей
4. **Автоматический показ аватаров** при донатах

## Как это работает

### Для стримера:
1. **Вход через Twitch** - основной аккаунт
2. **Подключение DonationAlerts** - нажимает кнопку "Подключить DonationAlerts"
3. **Ввод логина** - вводит свой логин DonationAlerts
4. **Запуск отслеживания** - нажимает "Запустить DonationAlerts"
5. **Получение донатов** - система отслеживает донаты всех подключенных пользователей

### Для зрителей:
1. **Вход через Twitch** - создают аватар
2. **Подключение DonationAlerts** - подключают свой аккаунт DonationAlerts
3. **Донаты** - донатят через DonationAlerts
4. **Показ аватара** - аватар появляется на экране

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
DA_CLIENT_SECRET=ваш_client_secret
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

## Использование

### Шаг 1: Вход стримера
1. Откройте `http://localhost:3000`
2. Нажмите "Вход через Twitch"
3. Авторизуйтесь в Twitch

### Шаг 2: Подключение DonationAlerts
1. На странице бота нажмите "Подключить DonationAlerts"
2. Введите ваш логин DonationAlerts
3. Нажмите "Подключить"

### Шаг 3: Запуск отслеживания
1. Нажмите "Запустить DonationAlerts"
2. Система начнет отслеживать донаты

### Шаг 4: Для зрителей
1. Зрители входят через Twitch
2. Создают аватар
3. Подключают DonationAlerts (если хотят донатить)
4. Донатят через DonationAlerts
5. Аватар появляется на экране

## API эндпоинты

### Подключение DonationAlerts:
- `POST /api/donationalerts/connect` - Подключить аккаунт
- `POST /api/donationalerts/disconnect` - Отключить аккаунт
- `GET /api/donationalerts/status` - Статус подключения

### Управление:
- `GET /api/donationalerts/test` - Тест API
- `POST /api/donationalerts/start` - Запустить отслеживание
- `POST /api/donationalerts/stop` - Остановить отслеживание

## Преимущества новой системы

1. **Простота для стримера**: Один аккаунт Twitch + подключение DonationAlerts
2. **Гибкость для зрителей**: Могут подключать DonationAlerts по желанию
3. **Безопасность**: Каждый пользователь использует свой аккаунт
4. **Масштабируемость**: Неограниченное количество пользователей

## Устранение неполадок

1. **Не подключается DonationAlerts**: Проверьте Client Secret
2. **Нет донатов**: Убедитесь, что пользователи подключили DonationAlerts
3. **Аватар не появляется**: Проверьте, что пользователь создал аватар

## Миграция

Старая система с OAuth полностью заменена. Теперь:
- Стример подключает DonationAlerts через форму
- Зрители подключают DonationAlerts по желанию
- Система отслеживает донаты по никам
