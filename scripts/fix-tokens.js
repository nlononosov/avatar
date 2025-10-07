#!/usr/bin/env node

/**
 * Скрипт для исправления проблемных токенов
 */

const { db } = require('../db');

function fixTokens() {
  console.log('🔧 Fixing problematic tokens...\n');
  
  try {
    // Получаем всех пользователей
    const users = db.prepare('SELECT twitch_user_id, access_token, refresh_token FROM users').all();
    console.log(`Found ${users.length} users to check`);
    
    let fixedCount = 0;
    let errorCount = 0;
    
    for (const user of users) {
      try {
        let needsUpdate = false;
        let newAccessToken = user.access_token;
        let newRefreshToken = user.refresh_token;
        
        // Проверяем access_token
        if (user.access_token) {
          try {
            const { extractToken } = require('../lib/token-encryption');
            const decrypted = extractToken(user.access_token);
            if (decrypted === null && user.access_token.length > 10) {
              // Токен не может быть расшифрован, обнуляем
              console.log(`Clearing problematic access_token for user ${user.twitch_user_id}`);
              newAccessToken = null;
              needsUpdate = true;
            }
          } catch (error) {
            console.log(`Error checking access_token for user ${user.twitch_user_id}: ${error.message}`);
            newAccessToken = null;
            needsUpdate = true;
          }
        }
        
        // Проверяем refresh_token
        if (user.refresh_token) {
          try {
            const { extractToken } = require('../lib/token-encryption');
            const decrypted = extractToken(user.refresh_token);
            if (decrypted === null && user.refresh_token.length > 10) {
              // Токен не может быть расшифрован, обнуляем
              console.log(`Clearing problematic refresh_token for user ${user.twitch_user_id}`);
              newRefreshToken = null;
              needsUpdate = true;
            }
          } catch (error) {
            console.log(`Error checking refresh_token for user ${user.twitch_user_id}: ${error.message}`);
            newRefreshToken = null;
            needsUpdate = true;
          }
        }
        
        // Обновляем если нужно
        if (needsUpdate) {
          // Если токены null, устанавливаем пустую строку вместо null
          const finalAccessToken = newAccessToken || '';
          const finalRefreshToken = newRefreshToken || '';
          
          const stmt = db.prepare(`
            UPDATE users 
            SET access_token = ?, refresh_token = ?, updated_at = ?
            WHERE twitch_user_id = ?
          `);
          
          stmt.run(
            finalAccessToken,
            finalRefreshToken,
            Math.floor(Date.now() / 1000),
            user.twitch_user_id
          );
          
          fixedCount++;
          console.log(`✅ Fixed tokens for user ${user.twitch_user_id}`);
        }
        
      } catch (error) {
        errorCount++;
        console.error(`❌ Error processing user ${user.twitch_user_id}: ${error.message}`);
      }
    }
    
    // Также проверяем стримеров
    console.log('\n🔧 Checking streamers...');
    const streamers = db.prepare('SELECT streamer_twitch_id, da_access_token, da_refresh_token FROM streamers').all();
    console.log(`Found ${streamers.length} streamers to check`);
    
    for (const streamer of streamers) {
      try {
        let needsUpdate = false;
        let newAccessToken = streamer.da_access_token;
        let newRefreshToken = streamer.da_refresh_token;
        
        // Проверяем da_access_token
        if (streamer.da_access_token) {
          try {
            const { extractToken } = require('../lib/token-encryption');
            const decrypted = extractToken(streamer.da_access_token);
            if (decrypted === null && streamer.da_access_token.length > 10) {
              console.log(`Clearing problematic da_access_token for streamer ${streamer.streamer_twitch_id}`);
              newAccessToken = null;
              needsUpdate = true;
            }
          } catch (error) {
            console.log(`Error checking da_access_token for streamer ${streamer.streamer_twitch_id}: ${error.message}`);
            newAccessToken = null;
            needsUpdate = true;
          }
        }
        
        // Проверяем da_refresh_token
        if (streamer.da_refresh_token) {
          try {
            const { extractToken } = require('../lib/token-encryption');
            const decrypted = extractToken(streamer.da_refresh_token);
            if (decrypted === null && streamer.da_refresh_token.length > 10) {
              console.log(`Clearing problematic da_refresh_token for streamer ${streamer.streamer_twitch_id}`);
              newRefreshToken = null;
              needsUpdate = true;
            }
          } catch (error) {
            console.log(`Error checking da_refresh_token for streamer ${streamer.streamer_twitch_id}: ${error.message}`);
            newRefreshToken = null;
            needsUpdate = true;
          }
        }
        
        // Обновляем если нужно
        if (needsUpdate) {
          // Если токены null, устанавливаем пустую строку вместо null
          const finalAccessToken = newAccessToken || '';
          const finalRefreshToken = newRefreshToken || '';
          
          const stmt = db.prepare(`
            UPDATE streamers 
            SET da_access_token = ?, da_refresh_token = ?, updated_at = ?
            WHERE streamer_twitch_id = ?
          `);
          
          stmt.run(
            finalAccessToken,
            finalRefreshToken,
            Math.floor(Date.now() / 1000),
            streamer.streamer_twitch_id
          );
          
          fixedCount++;
          console.log(`✅ Fixed tokens for streamer ${streamer.streamer_twitch_id}`);
        }
        
      } catch (error) {
        errorCount++;
        console.error(`❌ Error processing streamer ${streamer.streamer_twitch_id}: ${error.message}`);
      }
    }
    
    console.log(`\n🎉 Token fix completed!`);
    console.log(`   Fixed: ${fixedCount} records`);
    console.log(`   Errors: ${errorCount} records`);
    
    if (fixedCount > 0) {
      console.log(`\n⚠️  Note: Users with cleared tokens will need to re-authorize`);
    }
    
  } catch (error) {
    console.error('❌ Token fix failed:', error);
  }
}

if (require.main === module) {
  fixTokens();
}

module.exports = { fixTokens };
