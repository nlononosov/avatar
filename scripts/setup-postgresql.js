#!/usr/bin/env node

/**
 * Скрипт для настройки PostgreSQL
 */

const { Client } = require('pg');

async function createDatabase(config) {
  console.log('🐘 Setting up PostgreSQL database...');
  
  // Подключаемся к postgres для создания базы данных
  const adminClient = new Client({
    host: config.host || 'localhost',
    port: config.port || 5432,
    database: 'postgres', // Подключаемся к системной БД
    user: config.adminUser || 'postgres',
    password: config.adminPassword || config.password
  });
  
  try {
    await adminClient.connect();
    console.log('   ✅ Connected to PostgreSQL server');
    
    // Проверяем, существует ли база данных
    const dbExists = await adminClient.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [config.database]
    );
    
    if (dbExists.rows.length > 0) {
      console.log(`   ⏭️  Database '${config.database}' already exists`);
    } else {
      // Создаем базу данных
      await adminClient.query(`CREATE DATABASE "${config.database}"`);
      console.log(`   ✅ Created database '${config.database}'`);
    }
    
    // Создаем пользователя если нужно
    if (config.user !== 'postgres') {
      try {
        await adminClient.query(`CREATE USER "${config.user}" WITH PASSWORD '${config.password}'`);
        console.log(`   ✅ Created user '${config.user}'`);
      } catch (error) {
        if (error.code === '42710') { // User already exists
          console.log(`   ⏭️  User '${config.user}' already exists`);
        } else {
          throw error;
        }
      }
      
      // Даем права на базу данных
      await adminClient.query(`GRANT ALL PRIVILEGES ON DATABASE "${config.database}" TO "${config.user}"`);
      console.log(`   ✅ Granted privileges to user '${config.user}'`);
    }
    
  } catch (error) {
    console.error('❌ Failed to setup PostgreSQL:', error.message);
    throw error;
  } finally {
    await adminClient.end();
  }
}

async function testConnection(config) {
  console.log('🔍 Testing PostgreSQL connection...');
  
  const client = new Client({
    host: config.host || 'localhost',
    port: config.port || 5432,
    database: config.database,
    user: config.user,
    password: config.password
  });
  
  try {
    await client.connect();
    console.log('   ✅ Connection successful');
    
    // Тестируем базовые операции
    const result = await client.query('SELECT version()');
    console.log(`   📋 PostgreSQL version: ${result.rows[0].version.split(' ')[0]}`);
    
    // Проверяем расширения
    const extensions = await client.query(`
      SELECT extname FROM pg_extension 
      WHERE extname IN ('uuid-ossp', 'pgcrypto')
    `);
    
    if (extensions.rows.length > 0) {
      console.log(`   🔌 Available extensions: ${extensions.rows.map(r => r.extname).join(', ')}`);
    }
    
    return true;
    
  } catch (error) {
    console.error('❌ Connection test failed:', error.message);
    return false;
  } finally {
    await client.end();
  }
}

async function optimizePostgreSQL(config) {
  console.log('⚡ Optimizing PostgreSQL configuration...');
  
  const client = new Client({
    host: config.host || 'localhost',
    port: config.port || 5432,
    database: config.database,
    user: config.user,
    password: config.password
  });
  
  try {
    await client.connect();
    
    // Настройки для оптимизации
    const optimizations = [
      {
        name: 'shared_preload_libraries',
        description: 'Enable connection pooling',
        sql: "ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements'"
      },
      {
        name: 'max_connections',
        description: 'Set max connections',
        sql: 'ALTER SYSTEM SET max_connections = 100'
      },
      {
        name: 'shared_buffers',
        description: 'Set shared buffers',
        sql: 'ALTER SYSTEM SET shared_buffers = 256MB'
      },
      {
        name: 'effective_cache_size',
        description: 'Set effective cache size',
        sql: 'ALTER SYSTEM SET effective_cache_size = 1GB'
      },
      {
        name: 'work_mem',
        description: 'Set work memory',
        sql: 'ALTER SYSTEM SET work_mem = 4MB'
      },
      {
        name: 'maintenance_work_mem',
        description: 'Set maintenance work memory',
        sql: 'ALTER SYSTEM SET maintenance_work_mem = 64MB'
      }
    ];
    
    for (const opt of optimizations) {
      try {
        await client.query(opt.sql);
        console.log(`   ✅ ${opt.description}`);
      } catch (error) {
        console.log(`   ⚠️  ${opt.description}: ${error.message}`);
      }
    }
    
    // Перезагружаем конфигурацию
    await client.query('SELECT pg_reload_conf()');
    console.log('   🔄 Configuration reloaded');
    
  } catch (error) {
    console.error('❌ Optimization failed:', error.message);
  } finally {
    await client.end();
  }
}

async function createExtensions(config) {
  console.log('🔌 Creating PostgreSQL extensions...');
  
  const client = new Client({
    host: config.host || 'localhost',
    port: config.port || 5432,
    database: config.database,
    user: config.user,
    password: config.password
  });
  
  try {
    await client.connect();
    
    const extensions = [
      { name: 'uuid-ossp', description: 'UUID generation' },
      { name: 'pgcrypto', description: 'Cryptographic functions' },
      { name: 'pg_stat_statements', description: 'Query statistics' }
    ];
    
    for (const ext of extensions) {
      try {
        await client.query(`CREATE EXTENSION IF NOT EXISTS "${ext.name}"`);
        console.log(`   ✅ Created extension: ${ext.description}`);
      } catch (error) {
        console.log(`   ⚠️  Extension ${ext.name}: ${error.message}`);
      }
    }
    
  } catch (error) {
    console.error('❌ Extension creation failed:', error.message);
  } finally {
    await client.end();
  }
}

async function setupPostgreSQL() {
  const config = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'avatar_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    adminUser: process.env.DB_ADMIN_USER || 'postgres',
    adminPassword: process.env.DB_ADMIN_PASSWORD || process.env.DB_PASSWORD
  };
  
  if (!config.password) {
    console.error('❌ DB_PASSWORD environment variable is required');
    process.exit(1);
  }
  
  try {
    // 1. Создаем базу данных и пользователя
    await createDatabase(config);
    
    // 2. Тестируем соединение
    const connectionOk = await testConnection(config);
    if (!connectionOk) {
      throw new Error('Connection test failed');
    }
    
    // 3. Создаем расширения
    await createExtensions(config);
    
    // 4. Оптимизируем конфигурацию
    await optimizePostgreSQL(config);
    
    console.log('🎉 PostgreSQL setup completed successfully!');
    console.log('');
    console.log('📋 Configuration:');
    console.log(`   Host: ${config.host}:${config.port}`);
    console.log(`   Database: ${config.database}`);
    console.log(`   User: ${config.user}`);
    console.log('');
    console.log('🔧 Next steps:');
    console.log('   1. Set DB_TYPE=postgresql in your .env file');
    console.log('   2. Run migrations: node migrations/index.js migrate');
    console.log('   3. Start your application');
    
  } catch (error) {
    console.error('❌ PostgreSQL setup failed:', error.message);
    process.exit(1);
  }
}

// CLI интерфейс
if (require.main === module) {
  const command = process.argv[2];
  
  switch (command) {
    case 'setup':
      setupPostgreSQL();
      break;
      
    case 'test':
      const config = {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME || 'avatar_db',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD
      };
      
      if (!config.password) {
        console.error('❌ DB_PASSWORD environment variable is required');
        process.exit(1);
      }
      
      testConnection(config).then(success => {
        process.exit(success ? 0 : 1);
      });
      break;
      
    default:
      console.log('🐘 PostgreSQL Setup Tool');
      console.log('');
      console.log('Usage:');
      console.log('  node scripts/setup-postgresql.js setup');
      console.log('  node scripts/setup-postgresql.js test');
      console.log('');
      console.log('Environment variables:');
      console.log('  DB_HOST - PostgreSQL host (default: localhost)');
      console.log('  DB_PORT - PostgreSQL port (default: 5432)');
      console.log('  DB_NAME - Database name (default: avatar_db)');
      console.log('  DB_USER - Database user (default: postgres)');
      console.log('  DB_PASSWORD - Database password (required)');
      console.log('  DB_ADMIN_USER - Admin user for setup (default: postgres)');
      console.log('  DB_ADMIN_PASSWORD - Admin password (default: DB_PASSWORD)');
      console.log('');
      console.log('Examples:');
      console.log('  DB_PASSWORD=mypassword node scripts/setup-postgresql.js setup');
      console.log('  DB_PASSWORD=mypassword node scripts/setup-postgresql.js test');
      break;
  }
}

module.exports = {
  createDatabase,
  testConnection,
  optimizePostgreSQL,
  createExtensions,
  setupPostgreSQL
};
