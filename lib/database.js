/**
 * Абстракция для работы с базой данных
 * Поддерживает SQLite и PostgreSQL
 */

const path = require('path');

class DatabaseAdapter {
  constructor(config) {
    this.config = config;
    this.db = null;
    this.type = config.type || 'sqlite';
  }

  async connect() {
    throw new Error('connect() method must be implemented');
  }

  async disconnect() {
    throw new Error('disconnect() method must be implemented');
  }

  async query(sql, params = []) {
    throw new Error('query() method must be implemented');
  }

  async get(sql, params = []) {
    throw new Error('get() method must be implemented');
  }

  async all(sql, params = []) {
    throw new Error('all() method must be implemented');
  }

  async run(sql, params = []) {
    throw new Error('run() method must be implemented');
  }

  async transaction(callback) {
    throw new Error('transaction() method must be implemented');
  }

  async migrate(migrations) {
    throw new Error('migrate() method must be implemented');
  }
}

class SQLiteAdapter extends DatabaseAdapter {
  constructor(config) {
    super(config);
    this.Database = require('better-sqlite3');
  }

  async connect() {
    const dbPath = this.config.path || path.join(process.cwd(), 'data.sqlite');
    this.db = new this.Database(dbPath, { 
      fileMustExist: false,
      verbose: this.config.verbose ? console.log : null
    });

    // Настройки для продакшена
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = 10000');
    this.db.pragma('temp_store = MEMORY');
    this.db.pragma('mmap_size = 268435456'); // 256MB

    console.log(`📁 Connected to SQLite: ${dbPath}`);
    return this.db;
  }

  async disconnect() {
    if (this.db) {
      this.db.close();
      this.db = null;
      console.log('📁 Disconnected from SQLite');
    }
  }

  async query(sql, params = []) {
    if (!this.db) throw new Error('Database not connected');
    
    try {
      const stmt = this.db.prepare(sql);
      return stmt.run(params);
    } catch (error) {
      console.error('SQLite query error:', error);
      throw error;
    }
  }

  async get(sql, params = []) {
    if (!this.db) throw new Error('Database not connected');
    
    try {
      const stmt = this.db.prepare(sql);
      return stmt.get(params);
    } catch (error) {
      console.error('SQLite get error:', error);
      throw error;
    }
  }

  async all(sql, params = []) {
    if (!this.db) throw new Error('Database not connected');
    
    try {
      const stmt = this.db.prepare(sql);
      return stmt.all(params);
    } catch (error) {
      console.error('SQLite all error:', error);
      throw error;
    }
  }

  async run(sql, params = []) {
    return this.query(sql, params);
  }

  async transaction(callback) {
    if (!this.db) throw new Error('Database not connected');
    
    const transaction = this.db.transaction(callback);
    return transaction();
  }

  async migrate(migrations) {
    if (!this.db) throw new Error('Database not connected');
    
    // Создаем таблицу миграций
    await this.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        executed_at INTEGER NOT NULL
      )
    `);

    for (const migration of migrations) {
      const exists = await this.get(
        'SELECT id FROM migrations WHERE name = ?',
        [migration.name]
      );

      if (!exists) {
        console.log(`🔄 Running migration: ${migration.name}`);
        await this.query(migration.up);
        await this.query(
          'INSERT INTO migrations (name, executed_at) VALUES (?, ?)',
          [migration.name, Date.now()]
        );
      }
    }
  }
}

class PostgreSQLAdapter extends DatabaseAdapter {
  constructor(config) {
    super(config);
    this.pool = null;
  }

  async connect() {
    const { Pool } = require('pg');
    
    this.pool = new Pool({
      host: this.config.host || 'localhost',
      port: this.config.port || 5432,
      database: this.config.database || 'avatar_db',
      user: this.config.user || 'postgres',
      password: this.config.password,
      max: this.config.maxConnections || 20,
      idleTimeoutMillis: this.config.idleTimeout || 30000,
      connectionTimeoutMillis: this.config.connectionTimeout || 2000,
    });

    // Тестируем соединение
    const client = await this.pool.connect();
    client.release();

    console.log(`🐘 Connected to PostgreSQL: ${this.config.database}`);
    return this.pool;
  }

  async disconnect() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      console.log('🐘 Disconnected from PostgreSQL');
    }
  }

  async query(sql, params = []) {
    if (!this.pool) throw new Error('Database not connected');
    
    try {
      const result = await this.pool.query(sql, params);
      return {
        changes: result.rowCount,
        lastInsertRowid: result.rows[0]?.id
      };
    } catch (error) {
      console.error('PostgreSQL query error:', error);
      throw error;
    }
  }

  async get(sql, params = []) {
    if (!this.pool) throw new Error('Database not connected');
    
    try {
      const result = await this.pool.query(sql, params);
      return result.rows[0] || null;
    } catch (error) {
      console.error('PostgreSQL get error:', error);
      throw error;
    }
  }

  async all(sql, params = []) {
    if (!this.pool) throw new Error('Database not connected');
    
    try {
      const result = await this.pool.query(sql, params);
      return result.rows;
    } catch (error) {
      console.error('PostgreSQL all error:', error);
      throw error;
    }
  }

  async run(sql, params = []) {
    return this.query(sql, params);
  }

  async transaction(callback) {
    if (!this.pool) throw new Error('Database not connected');
    
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async migrate(migrations) {
    if (!this.pool) throw new Error('Database not connected');
    
    // Создаем таблицу миграций
    await this.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        executed_at BIGINT NOT NULL
      )
    `);

    for (const migration of migrations) {
      const exists = await this.get(
        'SELECT id FROM migrations WHERE name = $1',
        [migration.name]
      );

      if (!exists) {
        console.log(`🔄 Running migration: ${migration.name}`);
        await this.query(migration.up);
        await this.query(
          'INSERT INTO migrations (name, executed_at) VALUES ($1, $2)',
          [migration.name, Date.now()]
        );
      }
    }
  }
}

class DatabaseManager {
  constructor() {
    this.adapter = null;
    this.config = this.loadConfig();
  }

  loadConfig() {
    const dbType = process.env.DB_TYPE || 'sqlite';
    
    if (dbType === 'postgresql') {
      return {
        type: 'postgresql',
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME || 'avatar_db',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD,
        maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS) || 20,
        idleTimeout: parseInt(process.env.DB_IDLE_TIMEOUT) || 30000,
        connectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 2000
      };
    } else {
      return {
        type: 'sqlite',
        path: process.env.DB_PATH || path.join(process.cwd(), 'data.sqlite'),
        verbose: process.env.DB_VERBOSE === 'true'
      };
    }
  }

  async connect() {
    if (this.config.type === 'postgresql') {
      this.adapter = new PostgreSQLAdapter(this.config);
    } else {
      this.adapter = new SQLiteAdapter(this.config);
    }

    await this.adapter.connect();
    return this.adapter;
  }

  async disconnect() {
    if (this.adapter) {
      await this.adapter.disconnect();
      this.adapter = null;
    }
  }

  getAdapter() {
    if (!this.adapter) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.adapter;
  }

  async query(sql, params = []) {
    return this.getAdapter().query(sql, params);
  }

  async get(sql, params = []) {
    return this.getAdapter().get(sql, params);
  }

  async all(sql, params = []) {
    return this.getAdapter().all(sql, params);
  }

  async run(sql, params = []) {
    return this.getAdapter().run(sql, params);
  }

  async transaction(callback) {
    return this.getAdapter().transaction(callback);
  }

  async migrate(migrations) {
    return this.getAdapter().migrate(migrations);
  }

  getType() {
    return this.config.type;
  }

  isPostgreSQL() {
    return this.config.type === 'postgresql';
  }

  isSQLite() {
    return this.config.type === 'sqlite';
  }
}

// Создаем глобальный экземпляр
const dbManager = new DatabaseManager();

module.exports = {
  DatabaseAdapter,
  SQLiteAdapter,
  PostgreSQLAdapter,
  DatabaseManager,
  dbManager
};
