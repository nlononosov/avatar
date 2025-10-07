#!/usr/bin/env node

/**
 * Скрипт для генерации ключа шифрования токенов
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function generateEncryptionKey() {
  // Генерируем 256-битный ключ
  const key = crypto.randomBytes(32).toString('hex');
  
  console.log('🔑 Generated encryption key:');
  console.log(key);
  console.log('');
  console.log('📝 Add this to your .env file:');
  console.log(`TOKEN_ENCRYPTION_KEY=${key}`);
  console.log('');
  console.log('⚠️  IMPORTANT SECURITY NOTES:');
  console.log('1. Keep this key secret and secure');
  console.log('2. Store it separately from your database');
  console.log('3. Use different keys for different environments');
  console.log('4. Rotate keys regularly');
  console.log('5. Never commit keys to version control');
  
  return key;
}

function saveKeyToEnv(key, envPath = '.env') {
  const envFile = path.join(process.cwd(), envPath);
  
  try {
    let envContent = '';
    
    // Читаем существующий .env файл
    if (fs.existsSync(envFile)) {
      envContent = fs.readFileSync(envFile, 'utf8');
    }
    
    // Проверяем, есть ли уже ключ
    const keyRegex = /^TOKEN_ENCRYPTION_KEY=.*$/m;
    if (keyRegex.test(envContent)) {
      console.log('⚠️  TOKEN_ENCRYPTION_KEY already exists in .env file');
      console.log('   Please update it manually or remove the existing line');
      return false;
    }
    
    // Добавляем ключ
    envContent += `\n# Token encryption key (generated on ${new Date().toISOString()})\n`;
    envContent += `TOKEN_ENCRYPTION_KEY=${key}\n`;
    
    // Сохраняем файл
    fs.writeFileSync(envFile, envContent);
    
    console.log(`✅ Key saved to ${envPath}`);
    return true;
    
  } catch (error) {
    console.error(`❌ Failed to save key to ${envPath}:`, error.message);
    return false;
  }
}

function validateKey(key) {
  if (!key) {
    console.error('❌ No key provided');
    return false;
  }
  
  if (typeof key !== 'string') {
    console.error('❌ Key must be a string');
    return false;
  }
  
  if (key.length !== 64) {
    console.error('❌ Key must be 64 characters long (32 bytes in hex)');
    return false;
  }
  
  if (!/^[0-9a-fA-F]+$/.test(key)) {
    console.error('❌ Key must contain only hexadecimal characters');
    return false;
  }
  
  console.log('✅ Key validation passed');
  return true;
}

// CLI интерфейс
if (require.main === module) {
  const command = process.argv[2];
  const key = process.argv[3];
  
  switch (command) {
    case 'generate':
      const newKey = generateEncryptionKey();
      if (process.argv.includes('--save')) {
        saveKeyToEnv(newKey);
      }
      break;
      
    case 'validate':
      if (!key) {
        console.error('❌ Please provide a key to validate');
        console.log('Usage: node scripts/generate-encryption-key.js validate <key>');
        process.exit(1);
      }
      validateKey(key);
      break;
      
    case 'save':
      if (!key) {
        console.error('❌ Please provide a key to save');
        console.log('Usage: node scripts/generate-encryption-key.js save <key>');
        process.exit(1);
      }
      if (validateKey(key)) {
        saveKeyToEnv(key);
      }
      break;
      
    default:
      console.log('🔑 Token Encryption Key Generator');
      console.log('');
      console.log('Usage:');
      console.log('  node scripts/generate-encryption-key.js generate [--save]');
      console.log('  node scripts/generate-encryption-key.js validate <key>');
      console.log('  node scripts/generate-encryption-key.js save <key>');
      console.log('');
      console.log('Examples:');
      console.log('  node scripts/generate-encryption-key.js generate');
      console.log('  node scripts/generate-encryption-key.js generate --save');
      console.log('  node scripts/generate-encryption-key.js validate abc123...');
      console.log('  node scripts/generate-encryption-key.js save abc123...');
      break;
  }
}

module.exports = {
  generateEncryptionKey,
  saveKeyToEnv,
  validateKey
};
