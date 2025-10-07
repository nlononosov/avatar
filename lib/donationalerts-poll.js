const axios = require('axios');
const { getStreamerDA, upsertStreamerDA, getAllStreamers, markDonationProcessed, isDonationProcessed, findUserByDAUserId, findUserByNormalizedLogin, getAvatarByTwitchId } = require('../db');
const { emitToStreamer } = require('./bus');
const botService = require('../services/bot');
const { DA_CLIENT_ID, DA_CLIENT_SECRET } = require('./config');

// Refresh token if needed
async function refreshIfNeeded(creds) {
  const now = Math.floor(Date.now() / 1000);
  
  // Проверяем, нужно ли обновить токен (за 60 сек до истечения)
  if (creds.da_expires_at && now >= creds.da_expires_at - 60) {
    try {
      console.log(`[DA Poll] Refreshing token for streamer ${creds.streamer_twitch_id} (token expires at ${creds.da_expires_at})`);
      
      const { exchangeCodeForToken } = require('./donationalerts-oauth');
      const tokenData = await axios.post('https://www.donationalerts.com/oauth/token', {
        grant_type: 'refresh_token',
        refresh_token: creds.da_refresh_token,
        client_id: DA_CLIENT_ID,
        client_secret: DA_CLIENT_SECRET
      }, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });
      
      const newCreds = {
        ...creds,
        da_access_token: tokenData.data.access_token,
        da_refresh_token: tokenData.data.refresh_token || creds.da_refresh_token,
        da_expires_at: now + tokenData.data.expires_in - 60,
        status: 'active'
      };
      
      upsertStreamerDA(newCreds);
      console.log(`[DA Poll] Token refreshed for streamer ${creds.streamer_twitch_id}`);
      
      return newCreds;
    } catch (error) {
      console.error(`[DA Poll] Failed to refresh token for streamer ${creds.streamer_twitch_id}:`, error.response?.data || error.message);
      
      // Помечаем как нуждающийся в повторной авторизации
      upsertStreamerDA({
        ...creds,
        status: 'need_reauth'
      });
      
      throw error;
    }
  }
  
  return creds;
}

// Fetch donations from DonationAlerts API
async function fetchDonations(creds, cursorOrSince) {
  try {
    const params = { limit: 50 };
    if (cursorOrSince) {
      // Используем cursor для более точного отслеживания
      if (typeof cursorOrSince === 'string' && cursorOrSince.includes('_')) {
        params.cursor = cursorOrSince;
      } else {
        params.since = cursorOrSince;
      }
    }
    
    const response = await axios.get('https://www.donationalerts.com/api/v1/alerts/donations', {
      headers: { 
        'Authorization': `Bearer ${creds.da_access_token}`,
        'Content-Type': 'application/json'
      },
      params
    });
    
    const donations = response.data?.data || [];
    const nextCursor = response.data?.next_cursor;
    
    console.log(`[DA Poll] Fetched ${donations.length} donations for streamer ${creds.streamer_twitch_id}${nextCursor ? `, next cursor: ${nextCursor}` : ''}`);
    
    return {
      donations,
      nextCursor,
      hasMore: !!nextCursor
    };
  } catch (error) {
    if (error.response?.status === 401) {
      console.error(`[DA Poll] Unauthorized for streamer ${creds.streamer_twitch_id}, marking for reauth`);
      upsertStreamerDA({
        ...creds,
        status: 'need_reauth'
      });
    }
    throw error;
  }
}

// Process individual donation
async function processDonation(streamerId, donation) {
  try {
    // Проверяем идемпотентность
    if (isDonationProcessed(streamerId, String(donation.id))) {
      console.log(`[DA Poll] Donation ${donation.id} already processed for streamer ${streamerId}`);
      return;
    }
    
    // Отмечаем как обработанный
    markDonationProcessed(streamerId, String(donation.id));
    
    console.log(`[DA Poll] Processing donation ${donation.id} from ${donation.username}: ${donation.amount} ${donation.currency}`);
    console.log(`[DA Poll] Donation data:`, {
      id: donation.id,
      username: donation.username,
      user_id: donation.user_id,
      amount: donation.amount,
      currency: donation.currency
    });
    
    // Матчинг пользователя
    let user = null;
    
    // Сначала ищем по da_user_id
    if (donation.user_id) {
      console.log(`[DA Poll] Trying to match by da_user_id: ${donation.user_id}`);
      user = findUserByDAUserId(String(donation.user_id));
      if (user) {
        console.log(`[DA Poll] Matched user by da_user_id: ${user.twitch_user_id} (${user.display_name})`);
      } else {
        console.log(`[DA Poll] No user found by da_user_id: ${donation.user_id}`);
      }
    } else {
      console.log(`[DA Poll] No user_id in donation, skipping da_user_id matching`);
    }
    
    // Fallback по нормализованному нику
    if (!user && donation.username) {
      console.log(`[DA Poll] Trying to match by username: "${donation.username}"`);
      try {
        user = findUserByNormalizedLogin(donation.username);
        if (user) {
          console.log(`[DA Poll] Matched user by normalized username: ${user.twitch_user_id} (${user.display_name})`);
        } else {
          console.log(`[DA Poll] No user found by normalized username: "${donation.username}"`);
        }
      } catch (error) {
        console.error(`[DA Poll] Error finding user by normalized login "${donation.username}":`, error.message);
      }
    } else if (!donation.username) {
      console.log(`[DA Poll] No username in donation, skipping username matching`);
    }
    
    if (!user) {
      console.log(`[DA Poll] No user found for donation from ${donation.username}`);
      return;
    }
    
    // Получаем аватар пользователя
    const avatar = getAvatarByTwitchId(user.twitch_user_id);
    if (!avatar) {
      console.log(`[DA Poll] No avatar found for user ${user.twitch_user_id}`);
      return;
    }
    
    // Добавляем пользователя в список стримера (как в команде !start)
    const { addUserToStreamer } = require('../db');
    try {
      const success = addUserToStreamer(user.twitch_user_id, streamerId);
      console.log(`[DA Poll] Added user ${user.twitch_user_id} to streamer ${streamerId}: ${success ? 'success' : 'failed'}`);
    } catch (error) {
      console.error(`[DA Poll] Error adding user to streamer: ${error.message}`);
    }
    
    // Создаем spawnData аналогично команде !start
    const spawnData = {
      userId: user.twitch_user_id,
      displayName: user.display_name || donation.username || 'Donator',
      color: null, // DonationAlerts не предоставляет цвет
      avatarData: avatar,
      ts: Date.now(),
      source: 'donationalerts',
      amount: Number(donation.amount),
      message: donation.message || '',
      da_username: donation.username || null,
      currency: donation.currency || 'RUB'
    };
    
    // Эмитим avatar:show событие (убрали spawn для избежания двойного спауна)
    emitToStreamer(streamerId, 'avatar:show', {
      streamerId: streamerId,
      twitchUserId: user.twitch_user_id,
      displayName: user.display_name || donation.username || 'Donator',
      color: null,
      avatarData: avatar,
      source: 'donationalerts',
      amount: Number(donation.amount),
      message: donation.message || '',
      da_username: donation.username || null,
      currency: donation.currency || 'RUB'
    });
    
    // Добавляем аватар в активный список ПОСЛЕ отправки событий (как в команде !start)
    try {
      botService.addActiveAvatar(streamerId, user.twitch_user_id);
      console.log(`[DA Poll] Added avatar ${user.twitch_user_id} to active list for chat monitoring`);

      // Автоматически удаляем аватар из активного списка через 5 минут
      // (аватар может остаться в overlay, но перестанет реагировать на сообщения)
      setTimeout(() => {
        try {
          botService.removeActiveAvatar(streamerId, user.twitch_user_id);
          console.log(`[DA Poll] Auto-removed avatar ${user.twitch_user_id} from active list after timeout`);
        } catch (error) {
          console.error(`[DA Poll] Error auto-removing avatar from active list: ${error.message}`);
        }
      }, 5 * 60 * 1000); // 5 минут
      
    } catch (error) {
      console.error(`[DA Poll] Error adding avatar to active list: ${error.message}`);
    }
    
    console.log(`[DA Poll] Emitted avatar:show for streamer ${streamerId}, user ${user.twitch_user_id} (${user.display_name})`);
    
  } catch (error) {
    console.error(`[DA Poll] Error processing donation ${donation.id}:`, error);
  }
}

// Poll donations for a specific streamer
async function pollStreamer(streamerId, lastCursor = null) {
  try {
    const creds = getStreamerDA(streamerId);
    if (!creds || creds.status !== 'active') {
      return;
    }
    
    // Обновляем токен если нужно
    const updatedCreds = await refreshIfNeeded(creds);
    
    // Получаем донаты с курсором
    const result = await fetchDonations(updatedCreds, lastCursor);
    const { donations, nextCursor } = result;
    
    // Обрабатываем каждый донат
    for (const donation of donations) {
      await processDonation(streamerId, donation);
    }
    
    // Сохраняем курсор для следующего запроса
    if (nextCursor) {
      // Обновляем курсор в БД или планировщике
      const { updateStreamerCursor } = require('../db');
      if (updateStreamerCursor) {
        updateStreamerCursor(streamerId, nextCursor);
      }
    }
    
    return {
      processed: donations.length,
      nextCursor,
      hasMore: result.hasMore
    };
    
  } catch (error) {
    console.error(`[DA Poll] Error polling streamer ${streamerId}:`, error.message);
    throw error;
  }
}

// Legacy functions - теперь используем планировщик
function startPolling() {
  console.log('[DA Poll] Legacy startPolling called - using scheduler instead');
  const { scheduler } = require('./donationalerts-scheduler');
  scheduler.start();
}

function stopPolling() {
  console.log('[DA Poll] Legacy stopPolling called - using scheduler instead');
  const { scheduler } = require('./donationalerts-scheduler');
  scheduler.stop();
}

module.exports = { 
  startPolling,
  stopPolling,
  processDonation,
  pollStreamer,
  refreshIfNeeded,
  fetchDonations
};
