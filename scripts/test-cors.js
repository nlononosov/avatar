#!/usr/bin/env node

/**
 * Скрипт для тестирования CORS безопасности
 */

const axios = require('axios');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// Тестовые домены
const testOrigins = [
  'http://localhost:3000',      // Разрешенный
  'http://127.0.0.1:3000',     // Разрешенный
  'https://malicious-site.com', // Запрещенный
  'http://evil.com',           // Запрещенный
  'https://localhost:3000',    // Разрешенный в dev
  'http://localhost:8080'      // Разрешенный в dev
];

async function testCorsOrigin(origin, endpoint = '/api/health') {
  try {
    const response = await axios.get(`${BASE_URL}${endpoint}`, {
      headers: {
        'Origin': origin
      },
      validateStatus: () => true // Принимаем любые статусы
    });
    
    const corsHeaders = {
      'Access-Control-Allow-Origin': response.headers['access-control-allow-origin'],
      'Access-Control-Allow-Credentials': response.headers['access-control-allow-credentials'],
      'Access-Control-Allow-Methods': response.headers['access-control-allow-methods'],
      'Access-Control-Allow-Headers': response.headers['access-control-allow-headers']
    };
    
    return {
      origin,
      status: response.status,
      corsHeaders,
      allowed: response.headers['access-control-allow-origin'] === origin || 
               response.headers['access-control-allow-origin'] === '*'
    };
  } catch (error) {
    return {
      origin,
      error: error.message,
      allowed: false
    };
  }
}

async function testCorsPreflight(origin, endpoint = '/api/health') {
  try {
    const response = await axios.options(`${BASE_URL}${endpoint}`, {
      headers: {
        'Origin': origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, X-CSRF-Token'
      },
      validateStatus: () => true
    });
    
    return {
      origin,
      status: response.status,
      corsHeaders: {
        'Access-Control-Allow-Origin': response.headers['access-control-allow-origin'],
        'Access-Control-Allow-Credentials': response.headers['access-control-allow-credentials'],
        'Access-Control-Allow-Methods': response.headers['access-control-allow-methods'],
        'Access-Control-Allow-Headers': response.headers['access-control-allow-headers']
      },
      allowed: response.status === 200
    };
  } catch (error) {
    return {
      origin,
      error: error.message,
      allowed: false
    };
  }
}

async function testCredentialsRestriction() {
  console.log('🔒 Testing credentials restriction...\n');
  
  const endpoints = [
    { path: '/public/index.html', shouldHaveCredentials: false },
    { path: '/api/health', shouldHaveCredentials: true },
    { path: '/auth/status', shouldHaveCredentials: true },
    { path: '/', shouldHaveCredentials: false }
  ];
  
  const results = [];
  
  for (const endpoint of endpoints) {
    const result = await testCorsOrigin('http://localhost:3000', endpoint.path);
    const hasCredentials = result.corsHeaders?.['Access-Control-Allow-Credentials'] === 'true';
    const isCorrect = hasCredentials === endpoint.shouldHaveCredentials;
    
    results.push({
      endpoint: endpoint.path,
      expectedCredentials: endpoint.shouldHaveCredentials,
      actualCredentials: hasCredentials,
      correct: isCorrect
    });
  }
  
  return results;
}

async function runCorsTests() {
  console.log('🧪 CORS Security Tests\n');
  console.log(`Testing against: ${BASE_URL}\n`);
  
  // Тест 1: Проверка разрешенных/запрещенных доменов
  console.log('1️⃣ Testing origin restrictions...');
  const originResults = [];
  
  for (const origin of testOrigins) {
    const result = await testCorsOrigin(origin);
    originResults.push(result);
    
    const status = result.allowed ? '✅' : '❌';
    console.log(`   ${status} ${origin} - ${result.allowed ? 'Allowed' : 'Blocked'}`);
  }
  
  // Тест 2: Проверка preflight запросов
  console.log('\n2️⃣ Testing preflight requests...');
  const preflightResults = [];
  
  for (const origin of testOrigins.slice(0, 3)) { // Тестируем только первые 3
    const result = await testCorsPreflight(origin);
    preflightResults.push(result);
    
    const status = result.allowed ? '✅' : '❌';
    console.log(`   ${status} ${origin} - Preflight ${result.allowed ? 'Allowed' : 'Blocked'}`);
  }
  
  // Тест 3: Проверка ограничения credentials
  console.log('\n3️⃣ Testing credentials restriction...');
  const credentialsResults = await testCredentialsRestriction();
  
  for (const result of credentialsResults) {
    const status = result.correct ? '✅' : '❌';
    console.log(`   ${status} ${result.endpoint} - Credentials: ${result.actualCredentials} (expected: ${result.expectedCredentials})`);
  }
  
  // Итоговый отчет
  console.log('\n📋 Test Summary:');
  
  const allowedCount = originResults.filter(r => r.allowed).length;
  const blockedCount = originResults.filter(r => !r.allowed).length;
  console.log(`   Origins: ${allowedCount} allowed, ${blockedCount} blocked`);
  
  const preflightAllowed = preflightResults.filter(r => r.allowed).length;
  console.log(`   Preflight: ${preflightAllowed}/${preflightResults.length} allowed`);
  
  const credentialsCorrect = credentialsResults.filter(r => r.correct).length;
  console.log(`   Credentials: ${credentialsCorrect}/${credentialsResults.length} correct`);
  
  // Проверяем безопасность
  const isSecure = blockedCount > 0 && credentialsCorrect === credentialsResults.length;
  console.log(`\n${isSecure ? '🎉' : '⚠️'} CORS Security: ${isSecure ? 'SECURE' : 'NEEDS ATTENTION'}`);
  
  if (!isSecure) {
    console.log('\n🔧 Recommendations:');
    if (blockedCount === 0) {
      console.log('   - Block malicious origins');
    }
    if (credentialsCorrect < credentialsResults.length) {
      console.log('   - Fix credentials configuration');
    }
  }
  
  return isSecure;
}

// CLI интерфейс
if (require.main === module) {
  const command = process.argv[2];
  
  switch (command) {
    case 'test':
      runCorsTests().then(success => {
        process.exit(success ? 0 : 1);
      });
      break;
      
    case 'check':
      const { validateCorsSecurity } = require('../lib/cors-security');
      const validation = validateCorsSecurity();
      
      console.log('🔍 CORS Configuration Check:\n');
      console.log(`Environment: ${validation.isProduction ? 'Production' : 'Development'}`);
      console.log(`Allowed Origins: ${validation.allowedOrigins.length}`);
      validation.allowedOrigins.forEach(origin => {
        console.log(`  - ${origin}`);
      });
      
      if (validation.warnings.length > 0) {
        console.log('\n⚠️  Warnings:');
        validation.warnings.forEach(warning => {
          console.log(`  - ${warning}`);
        });
      }
      
      if (validation.recommendations.length > 0) {
        console.log('\n💡 Recommendations:');
        validation.recommendations.forEach(rec => {
          console.log(`  - ${rec}`);
        });
      }
      
      const isSecure = validation.warnings.length === 0;
      console.log(`\n${isSecure ? '✅' : '⚠️'} Configuration: ${isSecure ? 'SECURE' : 'NEEDS ATTENTION'}`);
      process.exit(isSecure ? 0 : 1);
      break;
      
    default:
      console.log('🧪 CORS Security Testing Tool');
      console.log('');
      console.log('Usage:');
      console.log('  node scripts/test-cors.js test   - Run CORS security tests');
      console.log('  node scripts/test-cors.js check  - Check CORS configuration');
      console.log('');
      console.log('Examples:');
      console.log('  node scripts/test-cors.js test');
      console.log('  node scripts/test-cors.js check');
      break;
  }
}

module.exports = {
  testCorsOrigin,
  testCorsPreflight,
  testCredentialsRestriction,
  runCorsTests
};
