# 🔒 Скрипты безопасности

Этот каталог содержит утилиты для обеспечения безопасности приложения.

## Доступные скрипты

### 1. Генерация ключа шифрования

**Файл**: `generate-encryption-key.js`

Генерирует 256-битный ключ для шифрования OAuth токенов.

```bash
# Генерировать новый ключ
node scripts/generate-encryption-key.js generate

# Генерировать и сохранить в .env
node scripts/generate-encryption-key.js generate --save

# Проверить существующий ключ
node scripts/generate-encryption-key.js validate abc123...

# Сохранить ключ в .env
node scripts/generate-encryption-key.js save abc123...
```

### 2. Безопасность базы данных

**Файл**: `secure-database.js`

Управляет правами доступа к файлам базы данных.

```bash
# Установить безопасные права доступа
node scripts/secure-database.js secure

# Проверить текущие права
node scripts/secure-database.js check

# Создать безопасный бэкап
node scripts/secure-database.js backup
```

## Быстрый старт

### 1. Настройка шифрования токенов

```bash
# Генерируем ключ шифрования
node scripts/generate-encryption-key.js generate --save

# Проверяем настройку
node -e "console.log(require('./lib/token-encryption').isEncryptionKeyConfigured())"
```

### 2. Обеспечение безопасности БД

```bash
# Устанавливаем безопасные права доступа
node scripts/secure-database.js secure

# Проверяем безопасность
node scripts/secure-database.js check
```

### 3. Создание бэкапа

```bash
# Создаем безопасный бэкап
node scripts/secure-database.js backup
```

## Безопасность в продакшене

### Обязательные шаги

1. **Генерация ключей**:
```bash
# Генерируем ключ для продакшена
node scripts/generate-encryption-key.js generate
# Сохраняем в переменные окружения сервера
```

2. **Настройка прав доступа**:
```bash
# Устанавливаем безопасные права
node scripts/secure-database.js secure
```

3. **Создание бэкапа**:
```bash
# Создаем начальный бэкап
node scripts/secure-database.js backup
```

### Переменные окружения

Добавьте в ваш `.env` файл:

```env
# Обязательно для продакшена
TOKEN_ENCRYPTION_KEY=your_64_character_hex_key
SESSION_SECRET=your_session_secret

# Дополнительно
DB_BACKUP_ENCRYPTION_KEY=your_backup_key
```

## Мониторинг

### Проверка целостности

```javascript
// В коде приложения
const { verifyTokenIntegrity } = require('./lib/key-rotation');
const results = verifyTokenIntegrity(db);
console.log('Token integrity:', results);
```

### Ротация ключей

```javascript
// При необходимости смены ключа
const { rotateEncryptionKey } = require('./lib/key-rotation');
const results = rotateEncryptionKey(oldKey, newKey, db);
console.log('Key rotation results:', results);
```

## Устранение неполадок

### Проблема: "Token encryption key not configured"

**Решение**:
```bash
node scripts/generate-encryption-key.js generate --save
```

### Проблема: "Failed to decrypt tokens"

**Решение**:
1. Проверьте правильность ключа
2. Запустите проверку целостности
3. При необходимости перешифруйте токены

### Проблема: "Database files have insecure permissions"

**Решение**:
```bash
node scripts/secure-database.js secure
```

## Лучшие практики

1. **Регулярные бэкапы**: Создавайте бэкапы перед обновлениями
2. **Ротация ключей**: Меняйте ключи шифрования каждые 6 месяцев
3. **Мониторинг**: Отслеживайте доступ к файлам БД
4. **Документирование**: Ведите журнал изменений безопасности
5. **Тестирование**: Регулярно проверяйте целостность токенов

## Поддержка

При возникновении проблем:

1. Проверьте логи приложения
2. Запустите диагностические скрипты
3. Обратитесь к документации в `SECURITY.md`
4. Свяжитесь с командой разработки
