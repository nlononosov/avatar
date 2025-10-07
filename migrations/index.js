/**
 * Система миграций базы данных
 * Поддерживает SQLite и PostgreSQL
 */

const { dbManager } = require('../lib/database');

// Миграции в порядке выполнения
const migrations = [
  {
    name: '001_create_users_table',
    up: {
      sqlite: `
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          twitch_user_id TEXT UNIQUE NOT NULL,
          display_name TEXT,
          login TEXT,
          profile_image_url TEXT,
          access_token TEXT NOT NULL,
          refresh_token TEXT,
          scope TEXT,
          expires_at INTEGER,
          coins INTEGER DEFAULT 0,
          da_username TEXT,
          created_at INTEGER DEFAULT (strftime('%s','now')),
          updated_at INTEGER DEFAULT (strftime('%s','now'))
        )
      `,
      postgresql: `
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          twitch_user_id VARCHAR(255) UNIQUE NOT NULL,
          display_name VARCHAR(255),
          login VARCHAR(255),
          profile_image_url TEXT,
          access_token TEXT NOT NULL,
          refresh_token TEXT,
          scope TEXT,
          expires_at BIGINT,
          coins INTEGER DEFAULT 0,
          da_username VARCHAR(255),
          created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
          updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
        )
      `
    }
  },
  {
    name: '002_create_streamers_table',
    up: {
      sqlite: `
        CREATE TABLE IF NOT EXISTS streamers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          streamer_twitch_id TEXT UNIQUE NOT NULL,
          twitch_login TEXT,
          da_user_id TEXT,
          da_access_token TEXT,
          da_refresh_token TEXT,
          da_expires_at INTEGER,
          status TEXT DEFAULT 'active',
          created_at INTEGER DEFAULT (strftime('%s','now')),
          updated_at INTEGER DEFAULT (strftime('%s','now'))
        )
      `,
      postgresql: `
        CREATE TABLE IF NOT EXISTS streamers (
          id SERIAL PRIMARY KEY,
          streamer_twitch_id VARCHAR(255) UNIQUE NOT NULL,
          twitch_login VARCHAR(255),
          da_user_id VARCHAR(255),
          da_access_token TEXT,
          da_refresh_token TEXT,
          da_expires_at BIGINT,
          status VARCHAR(50) DEFAULT 'active',
          created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
          updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
        )
      `
    }
  },
  {
    name: '003_create_gifts_table',
    up: {
      sqlite: `
        CREATE TABLE IF NOT EXISTS gifts (
          id TEXT PRIMARY KEY,
          gift_type TEXT NOT NULL,
          gift_id TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          created_at INTEGER DEFAULT (strftime('%s','now')),
          updated_at INTEGER DEFAULT (strftime('%s','now'))
        )
      `,
      postgresql: `
        CREATE TABLE IF NOT EXISTS gifts (
          id VARCHAR(255) PRIMARY KEY,
          gift_type VARCHAR(50) NOT NULL,
          gift_id VARCHAR(255) NOT NULL,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
          updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
        )
      `
    }
  },
  {
    name: '004_create_user_gifts_table',
    up: {
      sqlite: `
        CREATE TABLE IF NOT EXISTS user_gifts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          twitch_user_id TEXT NOT NULL,
          streamer_twitch_id TEXT NOT NULL,
          gift_type TEXT NOT NULL,
          gift_id TEXT NOT NULL,
          count INTEGER DEFAULT 1,
          created_at INTEGER DEFAULT (strftime('%s','now')),
          updated_at INTEGER DEFAULT (strftime('%s','now')),
          UNIQUE(twitch_user_id, streamer_twitch_id, gift_type, gift_id)
        )
      `,
      postgresql: `
        CREATE TABLE IF NOT EXISTS user_gifts (
          id SERIAL PRIMARY KEY,
          twitch_user_id VARCHAR(255) NOT NULL,
          streamer_twitch_id VARCHAR(255) NOT NULL,
          gift_type VARCHAR(50) NOT NULL,
          gift_id VARCHAR(255) NOT NULL,
          count INTEGER DEFAULT 1,
          created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
          updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
          UNIQUE(twitch_user_id, streamer_twitch_id, gift_type, gift_id)
        )
      `
    }
  },
  {
    name: '005_create_avatars_table',
    up: {
      sqlite: `
        CREATE TABLE IF NOT EXISTS avatars (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          twitch_user_id TEXT UNIQUE NOT NULL,
          body_skin INTEGER DEFAULT 1,
          face_skin INTEGER DEFAULT 1,
          clothes_type INTEGER DEFAULT 1,
          others_type INTEGER DEFAULT 1,
          created_at INTEGER DEFAULT (strftime('%s','now')),
          updated_at INTEGER DEFAULT (strftime('%s','now'))
        )
      `,
      postgresql: `
        CREATE TABLE IF NOT EXISTS avatars (
          id SERIAL PRIMARY KEY,
          twitch_user_id VARCHAR(255) UNIQUE NOT NULL,
          body_skin INTEGER DEFAULT 1,
          face_skin INTEGER DEFAULT 1,
          clothes_type INTEGER DEFAULT 1,
          others_type INTEGER DEFAULT 1,
          created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
          updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
        )
      `
    }
  },
  {
    name: '006_create_streamer_game_settings_table',
    up: {
      sqlite: `
        CREATE TABLE IF NOT EXISTS streamer_game_settings (
          streamer_id TEXT PRIMARY KEY,
          min_participants INTEGER NOT NULL DEFAULT 1,
          max_participants INTEGER NOT NULL DEFAULT 10,
          registration_time INTEGER NOT NULL DEFAULT 10,
          created_at INTEGER DEFAULT (strftime('%s','now')),
          updated_at INTEGER DEFAULT (strftime('%s','now'))
        )
      `,
      postgresql: `
        CREATE TABLE IF NOT EXISTS streamer_game_settings (
          streamer_id VARCHAR(255) PRIMARY KEY,
          min_participants INTEGER NOT NULL DEFAULT 1,
          max_participants INTEGER NOT NULL DEFAULT 10,
          registration_time INTEGER NOT NULL DEFAULT 10,
          created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
          updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
        )
      `
    }
  },
  {
    name: '007_create_donations_processed_table',
    up: {
      sqlite: `
        CREATE TABLE IF NOT EXISTS donations_processed (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          streamer_twitch_id TEXT NOT NULL,
          donation_id TEXT NOT NULL,
          processed_at INTEGER DEFAULT (strftime('%s','now')),
          UNIQUE(streamer_twitch_id, donation_id)
        )
      `,
      postgresql: `
        CREATE TABLE IF NOT EXISTS donations_processed (
          id SERIAL PRIMARY KEY,
          streamer_twitch_id VARCHAR(255) NOT NULL,
          donation_id VARCHAR(255) NOT NULL,
          processed_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
          UNIQUE(streamer_twitch_id, donation_id)
        )
      `
    }
  },
  {
    name: '008_create_indexes',
    up: {
      sqlite: 'CREATE INDEX IF NOT EXISTS idx_users_twitch_id ON users(twitch_user_id)',
      postgresql: 'CREATE INDEX IF NOT EXISTS idx_users_twitch_id ON users(twitch_user_id)'
    }
  },
  {
    name: '009_create_more_indexes',
    up: {
      sqlite: 'CREATE INDEX IF NOT EXISTS idx_users_login ON users(login)',
      postgresql: 'CREATE INDEX IF NOT EXISTS idx_users_login ON users(login)'
    }
  },
  {
    name: '010_create_streamer_indexes',
    up: {
      sqlite: 'CREATE INDEX IF NOT EXISTS idx_streamers_twitch_id ON streamers(streamer_twitch_id)',
      postgresql: 'CREATE INDEX IF NOT EXISTS idx_streamers_twitch_id ON streamers(streamer_twitch_id)'
    }
  },
  {
    name: '011_create_gift_indexes',
    up: {
      sqlite: 'CREATE INDEX IF NOT EXISTS idx_user_gifts_user_id ON user_gifts(twitch_user_id)',
      postgresql: 'CREATE INDEX IF NOT EXISTS idx_user_gifts_user_id ON user_gifts(twitch_user_id)'
    }
  },
  {
    name: '012_create_more_gift_indexes',
    up: {
      sqlite: 'CREATE INDEX IF NOT EXISTS idx_user_gifts_streamer_id ON user_gifts(streamer_twitch_id)',
      postgresql: 'CREATE INDEX IF NOT EXISTS idx_user_gifts_streamer_id ON user_gifts(streamer_twitch_id)'
    }
  },
  {
    name: '013_create_avatar_indexes',
    up: {
      sqlite: 'CREATE INDEX IF NOT EXISTS idx_avatars_user_id ON avatars(twitch_user_id)',
      postgresql: 'CREATE INDEX IF NOT EXISTS idx_avatars_user_id ON avatars(twitch_user_id)'
    }
  },
  {
    name: '014_create_donation_indexes',
    up: {
      sqlite: 'CREATE INDEX IF NOT EXISTS idx_donations_streamer_id ON donations_processed(streamer_twitch_id)',
      postgresql: 'CREATE INDEX IF NOT EXISTS idx_donations_streamer_id ON donations_processed(streamer_twitch_id)'
    }
  },
  {
    name: '015_insert_default_gifts',
    up: {
      sqlite: `
        INSERT OR IGNORE INTO gifts (id, gift_type, gift_id, name, description) VALUES
        ('gift_common_1', 'common', '1', 'Печенька', 'Вкусное печенье для поднятия настроения'),
        ('gift_uncommon_1', 'uncommon', '1', 'Коробочка', 'Загадочная коробочка с сюрпризом'),
        ('gift_rare_1', 'rare', '1', 'Тортик', 'Праздничный тортик для особого случая');
      `,
      postgresql: `
        INSERT INTO gifts (id, gift_type, gift_id, name, description) VALUES
        ('gift_common_1', 'common', '1', 'Печенька', 'Вкусное печенье для поднятия настроения'),
        ('gift_uncommon_1', 'uncommon', '1', 'Коробочка', 'Загадочная коробочка с сюрпризом'),
        ('gift_rare_1', 'rare', '1', 'Тортик', 'Праздничный тортик для особого случая')
        ON CONFLICT (id) DO NOTHING;
      `
    }
  },
  {
    name: '016_add_da_last_cursor',
    up: {
      sqlite: 'ALTER TABLE streamers ADD COLUMN da_last_cursor TEXT',
      postgresql: 'ALTER TABLE streamers ADD COLUMN IF NOT EXISTS da_last_cursor TEXT'
    }
  },
  {
    name: '017_add_webhook_enabled',
    up: {
      sqlite: 'ALTER TABLE streamers ADD COLUMN webhook_enabled BOOLEAN DEFAULT 0',
      postgresql: 'ALTER TABLE streamers ADD COLUMN IF NOT EXISTS webhook_enabled BOOLEAN DEFAULT FALSE'
    }
  },
  {
    name: '018_add_webhook_url',
    up: {
      sqlite: 'ALTER TABLE streamers ADD COLUMN webhook_url TEXT',
      postgresql: 'ALTER TABLE streamers ADD COLUMN IF NOT EXISTS webhook_url TEXT'
    }
  },
  {
    name: '019_add_webhook_id',
    up: {
      sqlite: 'ALTER TABLE streamers ADD COLUMN webhook_id TEXT',
      postgresql: 'ALTER TABLE streamers ADD COLUMN IF NOT EXISTS webhook_id TEXT'
    }
  }
];

async function runMigrations() {
  try {
    await dbManager.connect();
    
    console.log('🔄 Running database migrations...');
    
    // Сначала создаем таблицу migrations если её нет
    const createMigrationsTable = dbManager.isPostgreSQL()
      ? `
        CREATE TABLE IF NOT EXISTS migrations (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) UNIQUE NOT NULL,
          executed_at BIGINT NOT NULL
        )
      `
      : `
        CREATE TABLE IF NOT EXISTS migrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
          executed_at INTEGER NOT NULL
        )
      `;
    
    await dbManager.query(createMigrationsTable);
    console.log('   📋 Created migrations table');
    
    for (const migration of migrations) {
      const exists = await dbManager.get(
        dbManager.isPostgreSQL() 
          ? 'SELECT id FROM migrations WHERE name = $1'
          : 'SELECT id FROM migrations WHERE name = ?',
        [migration.name]
      );

      if (!exists) {
        console.log(`   Running: ${migration.name}`);
        
        const sql = dbManager.isPostgreSQL() 
          ? migration.up.postgresql 
          : migration.up.sqlite;
        
        await dbManager.query(sql);
        
        await dbManager.query(
          dbManager.isPostgreSQL()
            ? 'INSERT INTO migrations (name, executed_at) VALUES ($1, $2)'
            : 'INSERT INTO migrations (name, executed_at) VALUES (?, ?)',
          [migration.name, Date.now()]
        );
        
        console.log(`   ✅ Completed: ${migration.name}`);
      } else {
        console.log(`   ⏭️  Skipped: ${migration.name} (already exists)`);
      }
    }
    
    console.log('🎉 All migrations completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await dbManager.disconnect();
  }
}

async function checkMigrations() {
  try {
    await dbManager.connect();
    
    console.log('🔍 Checking migration status...');
    
    // Проверяем, существует ли таблица migrations
    const tableExists = await dbManager.get(
      dbManager.isPostgreSQL()
        ? "SELECT 1 FROM information_schema.tables WHERE table_name = 'migrations'"
        : "SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'"
    );
    
    if (!tableExists) {
      console.log('   ⚠️  Migrations table does not exist. Run migrations first.');
      return [];
    }
    
    const executedMigrations = await dbManager.all(
      'SELECT name, executed_at FROM migrations ORDER BY executed_at'
    );
    
    console.log(`   Total migrations: ${migrations.length}`);
    console.log(`   Executed migrations: ${executedMigrations.length}`);
    
    if (executedMigrations.length < migrations.length) {
      console.log('   ⚠️  Some migrations are pending');
      const pending = migrations.slice(executedMigrations.length);
      pending.forEach(migration => {
        console.log(`     - ${migration.name}`);
      });
    } else {
      console.log('   ✅ All migrations are up to date');
    }
    
    return executedMigrations;
    
  } catch (error) {
    console.error('❌ Failed to check migrations:', error);
    throw error;
  } finally {
    await dbManager.disconnect();
  }
}

// CLI интерфейс
if (require.main === module) {
  const command = process.argv[2];
  
  switch (command) {
    case 'migrate':
      runMigrations().then(() => {
        console.log('Migrations completed successfully');
        process.exit(0);
      }).catch(error => {
        console.error('Migration failed:', error);
        process.exit(1);
      });
      break;
      
    case 'check':
      checkMigrations().then(() => {
        process.exit(0);
      }).catch(error => {
        console.error('Check failed:', error);
        process.exit(1);
      });
      break;
      
    default:
      console.log('🔄 Database Migration Tool');
      console.log('');
      console.log('Usage:');
      console.log('  node migrations/index.js migrate  - Run all pending migrations');
      console.log('  node migrations/index.js check    - Check migration status');
      console.log('');
      console.log('Examples:');
      console.log('  node migrations/index.js migrate');
      console.log('  node migrations/index.js check');
      break;
  }
}

module.exports = {
  migrations,
  runMigrations,
  checkMigrations
};
