const cors = require('cors');

/**
 * Утилиты для безопасной настройки CORS
 */

/**
 * Создает функцию проверки разрешенных доменов
 * @param {Array} allowedOrigins - Массив разрешенных доменов
 * @param {boolean} allowLocalhost - Разрешить localhost в режиме разработки
 * @returns {Function} Функция проверки origin
 */
function createOriginChecker(allowedOrigins, allowLocalhost = true) {
  return function corsOriginChecker(origin, callback) {
    // Разрешаем запросы без origin (например, мобильные приложения, Postman)
    if (!origin) {
      return callback(null, true);
    }
    
    // Проверяем, есть ли origin в белом списке
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // В режиме разработки разрешаем localhost с любым портом
    if (allowLocalhost && process.env.NODE_ENV !== 'production' && origin.match(/^https?:\/\/localhost(:\d+)?$/)) {
      return callback(null, true);
    }
    
    // Отклоняем все остальные origin
    return callback(new Error('Not allowed by CORS'), false);
  };
}

/**
 * Базовые разрешенные домены
 * @returns {Array} Массив базовых разрешенных доменов
 */
function getBaseAllowedOrigins() {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  
  return [
    baseUrl,
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    // Добавляем домены из переменной окружения
    ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [])
  ];
}

/**
 * CORS конфигурация для статических файлов
 */
const staticCorsConfig = {
  credentials: false,
  methods: ['GET', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept'],
  maxAge: 86400 // 24 часа
};

/**
 * CORS конфигурация для API маршрутов
 */
const apiCorsConfig = {
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With', 
    'Content-Type', 
    'Accept', 
    'Authorization',
    'X-CSRF-Token'
  ],
  exposedHeaders: ['X-CSRF-Token'],
  maxAge: 86400
};

/**
 * CORS конфигурация для аутентификации
 */
const authCorsConfig = {
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With', 
    'Content-Type', 
    'Accept', 
    'Authorization',
    'X-CSRF-Token'
  ],
  exposedHeaders: ['X-CSRF-Token'],
  maxAge: 86400
};

/**
 * CORS конфигурация для остальных маршрутов
 */
const defaultCorsConfig = {
  credentials: false,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept'],
  maxAge: 86400
};

/**
 * Создает CORS middleware для статических файлов
 * @param {Array} allowedOrigins - Разрешенные домены
 * @returns {Function} CORS middleware
 */
function createStaticCors(allowedOrigins) {
  return cors({
    origin: createOriginChecker(allowedOrigins),
    ...staticCorsConfig
  });
}

/**
 * Создает CORS middleware для API маршрутов
 * @param {Array} allowedOrigins - Разрешенные домены
 * @returns {Function} CORS middleware
 */
function createApiCors(allowedOrigins) {
  return cors({
    origin: createOriginChecker(allowedOrigins),
    ...apiCorsConfig
  });
}

/**
 * Создает CORS middleware для аутентификации
 * @param {Array} allowedOrigins - Разрешенные домены
 * @returns {Function} CORS middleware
 */
function createAuthCors(allowedOrigins) {
  return cors({
    origin: createOriginChecker(allowedOrigins),
    ...authCorsConfig
  });
}

/**
 * Создает CORS middleware для остальных маршрутов
 * @param {Array} allowedOrigins - Разрешенные домены
 * @returns {Function} CORS middleware
 */
function createDefaultCors(allowedOrigins) {
  return cors({
    origin: createOriginChecker(allowedOrigins),
    ...defaultCorsConfig
  });
}

/**
 * Проверяет безопасность CORS конфигурации
 * @returns {Object} Результат проверки
 */
function validateCorsSecurity() {
  const results = {
    allowedOrigins: getBaseAllowedOrigins(),
    isProduction: process.env.NODE_ENV === 'production',
    hasCustomOrigins: Boolean(process.env.ALLOWED_ORIGINS),
    warnings: [],
    recommendations: []
  };

  // Проверяем, что в продакшене не используется localhost
  if (results.isProduction) {
    const hasLocalhost = results.allowedOrigins.some(origin => 
      origin.includes('localhost') || origin.includes('127.0.0.1')
    );
    
    if (hasLocalhost) {
      results.warnings.push('Production environment contains localhost origins');
    }
  }

  // Проверяем, что есть кастомные домены в продакшене
  if (results.isProduction && !results.hasCustomOrigins) {
    results.recommendations.push('Set ALLOWED_ORIGINS environment variable for production');
  }

  // Проверяем, что BASE_URL настроен
  if (!process.env.BASE_URL) {
    results.warnings.push('BASE_URL environment variable not set');
  }

  return results;
}

/**
 * Логирует информацию о CORS безопасности
 */
function logCorsSecurity() {
  const validation = validateCorsSecurity();
  
  console.log('🔒 CORS Security Configuration:');
  console.log(`   Environment: ${validation.isProduction ? 'Production' : 'Development'}`);
  console.log(`   Allowed Origins: ${validation.allowedOrigins.length}`);
  validation.allowedOrigins.forEach(origin => {
    console.log(`     - ${origin}`);
  });
  
  if (validation.warnings.length > 0) {
    console.log('   ⚠️  Warnings:');
    validation.warnings.forEach(warning => {
      console.log(`     - ${warning}`);
    });
  }
  
  if (validation.recommendations.length > 0) {
    console.log('   💡 Recommendations:');
    validation.recommendations.forEach(rec => {
      console.log(`     - ${rec}`);
    });
  }
}

module.exports = {
  createOriginChecker,
  getBaseAllowedOrigins,
  createStaticCors,
  createApiCors,
  createAuthCors,
  createDefaultCors,
  validateCorsSecurity,
  logCorsSecurity,
  staticCorsConfig,
  apiCorsConfig,
  authCorsConfig,
  defaultCorsConfig
};
