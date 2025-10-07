#!/usr/bin/env node

/**
 * Скрипт инициализации безопасности
 * Выполняет все необходимые шаги для настройки безопасности приложения
 */

const { generateEncryptionKey, saveKeyToEnv, validateKey } = require('./generate-encryption-key');
const { secureDatabaseFiles, checkDatabaseSecurity } = require('./secure-database');
const { isEncryptionKeyConfigured } = require('../lib/token-encryption');

function initSecurity() {
  console.log('🔒 Initializing security for Avatar application...\n');
  
  let allGood = true;
  
  // 1. Проверяем ключ шифрования
  console.log('1️⃣ Checking token encryption key...');
  if (!isEncryptionKeyConfigured()) {
    console.log('   ⚠️  Token encryption key not configured');
    console.log('   🔑 Generating new encryption key...');
    
    const newKey = generateEncryptionKey();
    if (saveKeyToEnv(newKey)) {
      console.log('   ✅ Encryption key generated and saved to .env');
    } else {
      console.log('   ❌ Failed to save encryption key');
      allGood = false;
    }
  } else {
    console.log('   ✅ Token encryption key is configured');
  }
  
  // 2. Проверяем безопасность БД
  console.log('\n2️⃣ Checking database security...');
  if (checkDatabaseSecurity()) {
    console.log('   ✅ Database files are secure');
  } else {
    console.log('   ⚠️  Database files need securing');
    console.log('   🔒 Securing database files...');
    secureDatabaseFiles();
    
    // Проверяем еще раз
    if (checkDatabaseSecurity()) {
      console.log('   ✅ Database files secured successfully');
    } else {
      console.log('   ❌ Failed to secure database files');
      allGood = false;
    }
  }
  
  // 3. Проверяем переменные окружения
  console.log('\n3️⃣ Checking environment variables...');
  const requiredVars = [
    'TWITCH_CLIENT_ID',
    'TWITCH_CLIENT_SECRET',
    'DONATIONALERTS_CLIENT_ID',
    'DONATIONALERTS_CLIENT_SECRET'
  ];
  
  const missingVars = [];
  requiredVars.forEach(varName => {
    if (!process.env[varName]) {
      missingVars.push(varName);
    }
  });
  
  if (missingVars.length === 0) {
    console.log('   ✅ All required environment variables are set');
  } else {
    console.log('   ⚠️  Missing environment variables:');
    missingVars.forEach(varName => {
      console.log(`      - ${varName}`);
    });
    console.log('   📝 Please add these to your .env file');
  }
  
  // 4. Финальный отчет
  console.log('\n📋 Security initialization summary:');
  if (allGood && missingVars.length === 0) {
    console.log('   🎉 All security checks passed!');
    console.log('   ✅ Your application is ready for production');
  } else {
    console.log('   ⚠️  Some security issues need attention:');
    if (!allGood) {
      console.log('      - Encryption or database security issues');
    }
    if (missingVars.length > 0) {
      console.log('      - Missing environment variables');
    }
    console.log('   📖 See SECURITY.md for detailed instructions');
  }
  
  console.log('\n🔗 Useful commands:');
  console.log('   node scripts/generate-encryption-key.js generate --save');
  console.log('   node scripts/secure-database.js secure');
  console.log('   node scripts/secure-database.js check');
  console.log('   node scripts/secure-database.js backup');
  
  return allGood && missingVars.length === 0;
}

function checkSecurity() {
  console.log('🔍 Running security check...\n');
  
  let issues = 0;
  
  // Проверяем ключ шифрования
  console.log('1️⃣ Token encryption key:');
  if (isEncryptionKeyConfigured()) {
    console.log('   ✅ Configured');
  } else {
    console.log('   ❌ Not configured');
    issues++;
  }
  
  // Проверяем безопасность БД
  console.log('\n2️⃣ Database security:');
  if (checkDatabaseSecurity()) {
    console.log('   ✅ Secure');
  } else {
    console.log('   ❌ Insecure permissions');
    issues++;
  }
  
  // Проверяем переменные окружения
  console.log('\n3️⃣ Environment variables:');
  const requiredVars = [
    'TWITCH_CLIENT_ID',
    'TWITCH_CLIENT_SECRET',
    'DONATIONALERTS_CLIENT_ID',
    'DONATIONALERTS_CLIENT_SECRET'
  ];
  
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length === 0) {
    console.log('   ✅ All required variables set');
  } else {
    console.log('   ❌ Missing variables:');
    missingVars.forEach(varName => {
      console.log(`      - ${varName}`);
    });
    issues += missingVars.length;
  }
  
  // Итоговый отчет
  console.log('\n📋 Security check results:');
  if (issues === 0) {
    console.log('   🎉 All security checks passed!');
  } else {
    console.log(`   ⚠️  Found ${issues} security issue(s)`);
    console.log('   🔧 Run "node scripts/init-security.js init" to fix');
  }
  
  return issues === 0;
}

// CLI интерфейс
if (require.main === module) {
  const command = process.argv[2];
  
  switch (command) {
    case 'init':
      const success = initSecurity();
      process.exit(success ? 0 : 1);
      break;
      
    case 'check':
      const secure = checkSecurity();
      process.exit(secure ? 0 : 1);
      break;
      
    default:
      console.log('🔒 Security Initialization Tool');
      console.log('');
      console.log('Usage:');
      console.log('  node scripts/init-security.js init   - Initialize security');
      console.log('  node scripts/init-security.js check  - Check current security');
      console.log('');
      console.log('Examples:');
      console.log('  node scripts/init-security.js init');
      console.log('  node scripts/init-security.js check');
      break;
  }
}

module.exports = {
  initSecurity,
  checkSecurity
};
