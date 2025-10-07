#!/usr/bin/env node

/**
 * Скрипт для тестирования DonationAlerts polling и webhooks
 */

const { scheduler } = require('../lib/donationalerts-scheduler');
const { webhooks } = require('../lib/donationalerts-webhooks');
const { getAllStreamers } = require('../db');

async function testScheduler() {
  console.log('🧪 Testing DonationAlerts Scheduler...\n');
  
  try {
    // Получаем статистику
    const stats = scheduler.getStats();
    console.log('📊 Scheduler Stats:');
    console.log(`   Running: ${stats.isRunning}`);
    console.log(`   Total Streamers: ${stats.totalStreamers}`);
    console.log(`   Ready Streamers: ${stats.readyStreamers}`);
    
    if (stats.streamers && Object.keys(stats.streamers).length > 0) {
      console.log('\n📋 Streamer Details:');
      for (const [streamerId, streamerStats] of Object.entries(stats.streamers)) {
        console.log(`   Streamer ${streamerId}:`);
        console.log(`     Last Poll: ${new Date(streamerStats.lastPoll).toISOString()}`);
        console.log(`     Next Poll: ${new Date(streamerStats.nextPoll).toISOString()}`);
        console.log(`     Backoff: ${streamerStats.backoff}`);
        console.log(`     Errors: ${streamerStats.errors}`);
        console.log(`     Webhook Enabled: ${streamerStats.webhookEnabled}`);
        console.log(`     Rate Limit: ${streamerStats.rateLimit.requests}/${scheduler.config.maxRequestsPerWindow}`);
      }
    }
    
    // Тестируем принудительный polling
    const streamers = getAllStreamers();
    if (streamers.length > 0) {
      const testStreamer = streamers[0];
      console.log(`\n🔄 Testing force poll for streamer ${testStreamer.streamer_twitch_id}...`);
      scheduler.forcePoll(testStreamer.streamer_twitch_id);
      
      // Ждем немного и проверяем статистику снова
      await new Promise(resolve => setTimeout(resolve, 2000));
      const updatedStats = scheduler.getStats();
      const updatedStreamer = updatedStats.streamers[testStreamer.streamer_twitch_id];
      
      if (updatedStreamer) {
        console.log(`   Next poll updated to: ${new Date(updatedStreamer.nextPoll).toISOString()}`);
      }
    }
    
    console.log('\n✅ Scheduler test completed');
    
  } catch (error) {
    console.error('❌ Scheduler test failed:', error);
  }
}

async function testWebhooks() {
  console.log('\n🧪 Testing DonationAlerts Webhooks...\n');
  
  try {
    // Получаем статистику webhooks
    const stats = webhooks.getStats();
    console.log('📊 Webhooks Stats:');
    console.log(`   Total Registered: ${stats.totalRegistered}`);
    
    if (stats.webhooks && stats.webhooks.length > 0) {
      console.log('\n📋 Registered Webhooks:');
      stats.webhooks.forEach(webhook => {
        console.log(`   Streamer ${webhook.streamerId}:`);
        console.log(`     URL: ${webhook.url}`);
        console.log(`     Registered: ${new Date(webhook.registeredAt).toISOString()}`);
      });
    }
    
    // Тестируем проверку статуса webhook
    const streamers = getAllStreamers();
    if (streamers.length > 0) {
      const testStreamer = streamers[0];
      console.log(`\n🔍 Testing webhook status for streamer ${testStreamer.streamer_twitch_id}...`);
      
      try {
        const status = await webhooks.checkWebhookStatus(testStreamer.streamer_twitch_id);
        console.log('   Webhook Status:');
        console.log(`     Registered: ${status.registered}`);
        console.log(`     Active: ${status.active}`);
        console.log(`     URL: ${status.url || 'N/A'}`);
        console.log(`     Last Delivery: ${status.lastDelivery || 'N/A'}`);
        console.log(`     Failures: ${status.failures || 0}`);
      } catch (error) {
        console.log(`   Error checking status: ${error.message}`);
      }
    }
    
    console.log('\n✅ Webhooks test completed');
    
  } catch (error) {
    console.error('❌ Webhooks test failed:', error);
  }
}

async function testRateLimiting() {
  console.log('\n🧪 Testing Rate Limiting...\n');
  
  try {
    const streamers = getAllStreamers();
    if (streamers.length === 0) {
      console.log('⚠️  No streamers found for rate limiting test');
      return;
    }
    
    const testStreamer = streamers[0];
    console.log(`🔄 Testing rate limit for streamer ${testStreamer.streamer_twitch_id}...`);
    
    // Симулируем множественные запросы
    let allowedRequests = 0;
    let blockedRequests = 0;
    
    for (let i = 0; i < 15; i++) { // Больше чем лимит
      const allowed = scheduler.checkRateLimit(testStreamer.streamer_twitch_id);
      if (allowed) {
        allowedRequests++;
      } else {
        blockedRequests++;
      }
      
      // Небольшая задержка между запросами
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`   Allowed Requests: ${allowedRequests}`);
    console.log(`   Blocked Requests: ${blockedRequests}`);
    console.log(`   Rate Limit: ${scheduler.config.maxRequestsPerWindow} requests per ${scheduler.config.rateLimitWindow / 1000} seconds`);
    
    if (blockedRequests > 0) {
      console.log('   ✅ Rate limiting is working correctly');
    } else {
      console.log('   ⚠️  Rate limiting may not be working as expected');
    }
    
    console.log('\n✅ Rate limiting test completed');
    
  } catch (error) {
    console.error('❌ Rate limiting test failed:', error);
  }
}

async function testBackoff() {
  console.log('\n🧪 Testing Backoff Mechanism...\n');
  
  try {
    const streamers = getAllStreamers();
    if (streamers.length === 0) {
      console.log('⚠️  No streamers found for backoff test');
      return;
    }
    
    const testStreamer = streamers[0];
    console.log(`🔄 Testing backoff for streamer ${testStreamer.streamer_twitch_id}...`);
    
    // Симулируем ошибки для активации backoff
    for (let i = 0; i < 3; i++) {
      scheduler.updateNextPoll(testStreamer.streamer_twitch_id, false); // false = ошибка
      const stats = scheduler.getStats();
      const streamerStats = stats.streamers[testStreamer.streamer_twitch_id];
      
      if (streamerStats) {
        console.log(`   Error ${i + 1}: Backoff ${streamerStats.backoff}, Next poll in ${streamerStats.nextPoll - Date.now()}ms`);
      }
    }
    
    // Симулируем успех для сброса backoff
    scheduler.updateNextPoll(testStreamer.streamer_twitch_id, true); // true = успех
    const finalStats = scheduler.getStats();
    const finalStreamerStats = finalStats.streamers[testStreamer.streamer_twitch_id];
    
    if (finalStreamerStats) {
      console.log(`   After success: Backoff ${finalStreamerStats.backoff}, Next poll in ${finalStreamerStats.nextPoll - Date.now()}ms`);
    }
    
    console.log('\n✅ Backoff test completed');
    
  } catch (error) {
    console.error('❌ Backoff test failed:', error);
  }
}

async function main() {
  const command = process.argv[2];
  
  console.log('🚀 DonationAlerts Testing Tool\n');
  
  switch (command) {
    case 'scheduler':
      await testScheduler();
      break;
    case 'webhooks':
      await testWebhooks();
      break;
    case 'rate-limit':
      await testRateLimiting();
      break;
    case 'backoff':
      await testBackoff();
      break;
    case 'all':
      await testScheduler();
      await testWebhooks();
      await testRateLimiting();
      await testBackoff();
      break;
    default:
      console.log('Usage: node scripts/test-donationalerts.js <command>');
      console.log('');
      console.log('Commands:');
      console.log('  scheduler   - Test scheduler functionality');
      console.log('  webhooks    - Test webhooks functionality');
      console.log('  rate-limit  - Test rate limiting');
      console.log('  backoff     - Test backoff mechanism');
      console.log('  all         - Run all tests');
      console.log('');
      console.log('Examples:');
      console.log('  node scripts/test-donationalerts.js scheduler');
      console.log('  node scripts/test-donationalerts.js all');
      break;
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  testScheduler,
  testWebhooks,
  testRateLimiting,
  testBackoff
};
