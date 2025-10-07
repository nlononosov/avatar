# 🚀 Быстрый старт по безопасности

## Что было исправлено

✅ **Шифрование OAuth токенов** - все токены теперь шифруются AES-GCM  
✅ **Безопасные сессии** - серверные сессии с HttpOnly cookies  
✅ **CSRF защита** - защита от межсайтовых атак  
✅ **Ограничение доступа к файлам** - защита от утечки конфиденциальных данных  
✅ **Автоматическая миграция** - существующие токены шифруются автоматически  

## Быстрая настройка

### 1. Инициализация безопасности

```bash
# Автоматическая настройка всех аспектов безопасности
node scripts/init-security.js init
```

### 2. Проверка безопасности

```bash
# Проверка текущего состояния безопасности
node scripts/init-security.js check
```

### 3. Генерация ключа шифрования

```bash
# Генерация и сохранение ключа
node scripts/generate-encryption-key.js generate --save
```

### 4. Безопасность базы данных

```bash
# Установка безопасных прав доступа
node scripts/secure-database.js secure

# Проверка прав доступа
node scripts/secure-database.js check

# Создание бэкапа
node scripts/secure-database.js backup
```

### 5. Безопасность CORS

```bash
# Проверка конфигурации CORS
node scripts/test-cors.js check

# Тестирование безопасности CORS
node scripts/test-cors.js test
```

### 6. База данных

```bash
# SQLite (по умолчанию)
npm run db:optimize
npm run db:stats
npm run db:backup

# PostgreSQL (для продакшена)
DB_PASSWORD=yourpassword npm run postgres:setup
DB_PASSWORD=yourpassword npm run postgres:test

# Миграции
npm run migrate
npm run migrate:check
```

## Переменные окружения

Добавьте в ваш `.env` файл:

```env
# Обязательно для продакшена
TOKEN_ENCRYPTION_KEY=your_64_character_hex_key
SESSION_SECRET=your_session_secret

# Основные настройки
NODE_ENV=production
BASE_URL=https://yourdomain.com

# CORS настройки
ALLOWED_ORIGINS=https://yourdomain.com,https://panel.yourdomain.com,https://overlay.yourdomain.com

# База данных (SQLite по умолчанию)
# DB_TYPE=sqlite

# PostgreSQL (для продакшена)
# DB_TYPE=postgresql
# DB_HOST=localhost
# DB_PORT=5432
# DB_NAME=avatar_db
# DB_USER=postgres
# DB_PASSWORD=yourpassword
```

## Что происходит автоматически

1. **При запуске приложения**:
   - Автоматически шифруются существующие незашифрованные токены
   - Проверяется конфигурация ключа шифрования
   - Настраиваются безопасные сессии

2. **При сохранении токенов**:
   - Все новые токены автоматически шифруются
   - Проверяется целостность данных

3. **При получении токенов**:
   - Токены автоматически расшифровываются
   - Обратная совместимость со старыми данными

## Проверка работы

### 1. Проверка шифрования

```javascript
// В консоли Node.js
const { isEncryptionKeyConfigured } = require('./lib/token-encryption');
console.log('Encryption configured:', isEncryptionKeyConfigured());
```

### 2. Проверка целостности токенов

```javascript
// В коде приложения
const { verifyTokenIntegrity } = require('./lib/key-rotation');
const results = verifyTokenIntegrity(db);
console.log('Token integrity:', results);
```

### 3. Проверка безопасности БД

```bash
node scripts/secure-database.js check
```

## Важные моменты

⚠️ **Ключ шифрования**:
- Должен быть 64 символа (32 байта в hex)
- Храните отдельно от базы данных
- Меняйте каждые 6 месяцев

⚠️ **Права доступа к БД**:
- Файлы БД должны иметь права 600 (только владелец)
- Регулярно проверяйте права доступа

⚠️ **Бэкапы**:
- Создавайте зашифрованные бэкапы
- Храните ключи шифрования отдельно

## Поддержка

При проблемах:

1. Запустите проверку: `node scripts/init-security.js check`
2. Посмотрите логи приложения
3. Обратитесь к `SECURITY.md` для детальной информации
4. Свяжитесь с командой разработки

## Готово! 🎉

Ваше приложение теперь защищено от основных угроз безопасности!
