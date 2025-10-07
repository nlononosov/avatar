#!/usr/bin/env node

/**
 * Скрипт для оптимизации SQLite базы данных
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

function optimizeSQLite(dbPath) {
  console.log('🔧 Optimizing SQLite database...');
  
  if (!fs.existsSync(dbPath)) {
    console.error(`❌ Database file not found: ${dbPath}`);
    return false;
  }
  
  const db = new Database(dbPath);
  
  try {
    // 1. Включаем WAL режим для лучшей производительности
    console.log('   📝 Enabling WAL mode...');
    db.pragma('journal_mode = WAL');
    
    // 2. Настраиваем синхронизацию
    console.log('   ⚡ Setting synchronous mode...');
    db.pragma('synchronous = NORMAL');
    
    // 3. Увеличиваем размер кеша
    console.log('   💾 Increasing cache size...');
    db.pragma('cache_size = 10000'); // 10MB
    
    // 4. Используем память для временных таблиц
    console.log('   🧠 Setting temp store to memory...');
    db.pragma('temp_store = MEMORY');
    
    // 5. Включаем memory-mapped I/O
    console.log('   🗺️  Enabling memory-mapped I/O...');
    db.pragma('mmap_size = 268435456'); // 256MB
    
    // 6. Оптимизируем размер страницы
    console.log('   📄 Setting page size...');
    db.pragma('page_size = 4096');
    
    // 7. Включаем автоматическую очистку
    console.log('   🧹 Enabling auto vacuum...');
    db.pragma('auto_vacuum = INCREMENTAL');
    
    // 8. Анализируем базу данных для оптимизации запросов
    console.log('   📊 Analyzing database...');
    db.exec('ANALYZE');
    
    // 9. Выполняем VACUUM для освобождения места
    console.log('   🗑️  Vacuuming database...');
    db.exec('VACUUM');
    
    // 10. Проверяем целостность
    console.log('   🔍 Checking integrity...');
    const integrity = db.pragma('integrity_check');
    if (integrity[0].integrity_check !== 'ok') {
      console.error('❌ Database integrity check failed:', integrity);
      return false;
    }
    
    console.log('✅ SQLite optimization completed successfully!');
    return true;
    
  } catch (error) {
    console.error('❌ SQLite optimization failed:', error);
    return false;
  } finally {
    db.close();
  }
}

function getDatabaseStats(dbPath) {
  console.log('📊 Database Statistics:');
  
  if (!fs.existsSync(dbPath)) {
    console.error(`❌ Database file not found: ${dbPath}`);
    return;
  }
  
  const db = new Database(dbPath);
  
  try {
    // Размер файла
    const stats = fs.statSync(dbPath);
    const fileSizeMB = (stats.size / 1024 / 1024).toFixed(2);
    console.log(`   📁 File size: ${fileSizeMB} MB`);
    
    // Количество таблиц
    const tables = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `).all();
    console.log(`   📋 Tables: ${tables.length}`);
    
    // Количество записей в основных таблицах
    const mainTables = ['users', 'streamers', 'user_gifts', 'avatars', 'gifts'];
    mainTables.forEach(table => {
      try {
        const count = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
        console.log(`   📊 ${table}: ${count.count} records`);
      } catch (error) {
        // Таблица может не существовать
      }
    });
    
    // Настройки базы данных
    console.log('   ⚙️  Database settings:');
    const journalMode = db.pragma('journal_mode');
    console.log(`     Journal mode: ${journalMode[0].journal_mode}`);
    
    const synchronous = db.pragma('synchronous');
    console.log(`     Synchronous: ${synchronous[0].synchronous}`);
    
    const cacheSize = db.pragma('cache_size');
    console.log(`     Cache size: ${cacheSize[0].cache_size} pages`);
    
    const pageSize = db.pragma('page_size');
    console.log(`     Page size: ${pageSize[0].page_size} bytes`);
    
    const autoVacuum = db.pragma('auto_vacuum');
    console.log(`     Auto vacuum: ${autoVacuum[0].auto_vacuum}`);
    
  } catch (error) {
    console.error('❌ Failed to get database stats:', error);
  } finally {
    db.close();
  }
}

function createBackup(dbPath, backupPath = null) {
  if (!backupPath) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    backupPath = `${dbPath}.backup.${timestamp}`;
  }
  
  console.log(`💾 Creating backup: ${backupPath}`);
  
  if (!fs.existsSync(dbPath)) {
    console.error(`❌ Database file not found: ${dbPath}`);
    return false;
  }
  
  try {
    // Создаем резервную копию
    fs.copyFileSync(dbPath, backupPath);
    
    // Устанавливаем права доступа
    fs.chmodSync(backupPath, 0o600);
    
    const stats = fs.statSync(backupPath);
    const fileSizeMB = (stats.size / 1024 / 1024).toFixed(2);
    
    console.log(`✅ Backup created successfully: ${fileSizeMB} MB`);
    return true;
    
  } catch (error) {
    console.error('❌ Backup creation failed:', error);
    return false;
  }
}

function restoreBackup(backupPath, dbPath) {
  console.log(`🔄 Restoring from backup: ${backupPath}`);
  
  if (!fs.existsSync(backupPath)) {
    console.error(`❌ Backup file not found: ${backupPath}`);
    return false;
  }
  
  try {
    // Создаем резервную копию текущей БД
    if (fs.existsSync(dbPath)) {
      const currentBackup = `${dbPath}.before-restore.${Date.now()}`;
      fs.copyFileSync(dbPath, currentBackup);
      console.log(`📋 Current database backed up to: ${currentBackup}`);
    }
    
    // Восстанавливаем из бэкапа
    fs.copyFileSync(backupPath, dbPath);
    fs.chmodSync(dbPath, 0o600);
    
    console.log('✅ Database restored successfully');
    return true;
    
  } catch (error) {
    console.error('❌ Database restore failed:', error);
    return false;
  }
}

// CLI интерфейс
if (require.main === module) {
  const command = process.argv[2];
  const dbPath = process.argv[3] || path.join(process.cwd(), 'data.sqlite');
  
  switch (command) {
    case 'optimize':
      const success = optimizeSQLite(dbPath);
      process.exit(success ? 0 : 1);
      break;
      
    case 'stats':
      getDatabaseStats(dbPath);
      break;
      
    case 'backup':
      const backupPath = process.argv[4];
      const backupSuccess = createBackup(dbPath, backupPath);
      process.exit(backupSuccess ? 0 : 1);
      break;
      
    case 'restore':
      const restoreBackupPath = process.argv[4];
      if (!restoreBackupPath) {
        console.error('❌ Please provide backup file path');
        process.exit(1);
      }
      const restoreSuccess = restoreBackup(restoreBackupPath, dbPath);
      process.exit(restoreSuccess ? 0 : 1);
      break;
      
    default:
      console.log('🔧 SQLite Optimization Tool');
      console.log('');
      console.log('Usage:');
      console.log('  node scripts/optimize-sqlite.js optimize [db_path]');
      console.log('  node scripts/optimize-sqlite.js stats [db_path]');
      console.log('  node scripts/optimize-sqlite.js backup [db_path] [backup_path]');
      console.log('  node scripts/optimize-sqlite.js restore [db_path] [backup_path]');
      console.log('');
      console.log('Examples:');
      console.log('  node scripts/optimize-sqlite.js optimize');
      console.log('  node scripts/optimize-sqlite.js stats');
      console.log('  node scripts/optimize-sqlite.js backup');
      console.log('  node scripts/optimize-sqlite.js restore data.sqlite data.sqlite.backup.2024-01-01');
      break;
  }
}

module.exports = {
  optimizeSQLite,
  getDatabaseStats,
  createBackup,
  restoreBackup
};
