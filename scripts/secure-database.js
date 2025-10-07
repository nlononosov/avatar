#!/usr/bin/env node

/**
 * Скрипт для обеспечения безопасности базы данных
 * Устанавливает правильные права доступа к файлам БД
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function secureDatabaseFiles() {
  const dbFiles = [
    'data.sqlite',
    'data.sqlite-shm',
    'data.sqlite-wal'
  ];
  
  const projectRoot = process.cwd();
  
  console.log('🔒 Securing database files...');
  
  dbFiles.forEach(file => {
    const filePath = path.join(projectRoot, file);
    
    if (fs.existsSync(filePath)) {
      try {
        // Устанавливаем права доступа только для владельца (600)
        // Владелец: чтение и запись
        // Группа и другие: нет доступа
        fs.chmodSync(filePath, 0o600);
        
        console.log(`✅ Secured ${file} (600)`);
      } catch (error) {
        console.error(`❌ Failed to secure ${file}:`, error.message);
      }
    } else {
      console.log(`⚠️  ${file} not found, skipping...`);
    }
  });
  
  // Проверяем права доступа
  console.log('\n📋 Current file permissions:');
  dbFiles.forEach(file => {
    const filePath = path.join(projectRoot, file);
    
    if (fs.existsSync(filePath)) {
      try {
        const stats = fs.statSync(filePath);
        const mode = stats.mode.toString(8).slice(-3);
        console.log(`${file}: ${mode}`);
      } catch (error) {
        console.error(`Failed to check ${file}:`, error.message);
      }
    }
  });
}

function checkDatabaseSecurity() {
  const dbFiles = [
    'data.sqlite',
    'data.sqlite-shm', 
    'data.sqlite-wal'
  ];
  
  const projectRoot = process.cwd();
  let allSecure = true;
  
  console.log('🔍 Checking database security...');
  
  dbFiles.forEach(file => {
    const filePath = path.join(projectRoot, file);
    
    if (fs.existsSync(filePath)) {
      try {
        const stats = fs.statSync(filePath);
        const mode = stats.mode.toString(8).slice(-3);
        
        // Проверяем, что права доступа не более 600
        if (parseInt(mode, 8) > 0o600) {
          console.log(`❌ ${file} has insecure permissions: ${mode}`);
          allSecure = false;
        } else {
          console.log(`✅ ${file} is secure: ${mode}`);
        }
      } catch (error) {
        console.error(`Failed to check ${file}:`, error.message);
        allSecure = false;
      }
    }
  });
  
  if (allSecure) {
    console.log('\n🎉 All database files are properly secured!');
  } else {
    console.log('\n⚠️  Some database files have insecure permissions.');
    console.log('Run this script to fix: node scripts/secure-database.js');
  }
  
  return allSecure;
}

function createSecureBackup() {
  const dbFiles = [
    'data.sqlite',
    'data.sqlite-shm',
    'data.sqlite-wal'
  ];
  
  const projectRoot = process.cwd();
  const backupDir = path.join(projectRoot, 'backups');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `backup-${timestamp}`);
  
  console.log('💾 Creating secure backup...');
  
  try {
    // Создаем директорию для бэкапов
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { mode: 0o700 });
    }
    
    // Создаем директорию для конкретного бэкапа
    fs.mkdirSync(backupPath, { mode: 0o700 });
    
    // Копируем файлы БД
    dbFiles.forEach(file => {
      const sourcePath = path.join(projectRoot, file);
      const destPath = path.join(backupPath, file);
      
      if (fs.existsSync(sourcePath)) {
        fs.copyFileSync(sourcePath, destPath);
        // Устанавливаем безопасные права доступа
        fs.chmodSync(destPath, 0o600);
        console.log(`✅ Backed up ${file}`);
      }
    });
    
    console.log(`🎉 Backup created at: ${backupPath}`);
    console.log('⚠️  Remember to store backup encryption keys separately!');
    
  } catch (error) {
    console.error('❌ Backup failed:', error.message);
  }
}

// CLI интерфейс
if (require.main === module) {
  const command = process.argv[2];
  
  switch (command) {
    case 'secure':
      secureDatabaseFiles();
      break;
    case 'check':
      checkDatabaseSecurity();
      break;
    case 'backup':
      createSecureBackup();
      break;
    default:
      console.log('Database Security Tool');
      console.log('');
      console.log('Usage:');
      console.log('  node scripts/secure-database.js secure  - Set secure file permissions');
      console.log('  node scripts/secure-database.js check   - Check current permissions');
      console.log('  node scripts/secure-database.js backup  - Create secure backup');
      console.log('');
      console.log('Examples:');
      console.log('  node scripts/secure-database.js secure');
      console.log('  node scripts/secure-database.js check');
      break;
  }
}

module.exports = {
  secureDatabaseFiles,
  checkDatabaseSecurity,
  createSecureBackup
};
