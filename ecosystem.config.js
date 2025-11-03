// PM2 ecosystem configuration для кластеризации
// Использование: pm2 start ecosystem.config.js

module.exports = {
  apps: [{
    name: 'avatar-server',
    script: './server.js',
    instances: 'max', // Использовать все доступные CPU ядра
    exec_mode: 'cluster', // Режим кластера
    
    // Переменные окружения
    env: {
      NODE_ENV: 'production',
      REDIS_REQUIRED: 'true', // Обязательно для production
    },
    env_development: {
      NODE_ENV: 'development',
      REDIS_REQUIRED: 'false',
    },
    
    // Лимиты памяти и перезапуск
    max_memory_restart: '2G', // Перезапуск при превышении 2GB памяти
    
    // Логирование
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    
    // Автоперезапуск
    autorestart: true,
    watch: false,
    
    // Максимальное количество перезапусков
    max_restarts: 10,
    min_uptime: '10s',
    
    // Graceful shutdown
    kill_timeout: 5000,
    wait_ready: true,
    
    // Мониторинг
    pmx: true,
    instance_var: 'INSTANCE_ID'
  }]
};

