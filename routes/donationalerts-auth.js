const { getAuthUrl, exchangeCodeForToken, getUserInfo } = require('../lib/donationalerts-oauth');
const { saveOrUpdateUser, getUserByTwitchId, saveOrUpdateAvatar } = require('../db');

// Store state for CSRF protection
const stateStore = new Map();

function registerDonationAlertsAuthRoutes(app) {
  // Start DonationAlerts OAuth flow
  app.get('/auth/donationalerts', (req, res) => {
    try {
      const { url, state } = getAuthUrl();
      
      // Store state for verification
      stateStore.set(state, {
        timestamp: Date.now(),
        userId: req.session.userId || req.cookies.uid // Store current user ID if any
      });
      
      console.log(`[DA OAuth] Starting OAuth flow for user ${req.session.userId || req.cookies.uid || 'anonymous'}`);
      res.redirect(url);
    } catch (error) {
      console.error('[DA OAuth] Error starting OAuth flow:', error);
      res.status(500).send('OAuth initialization failed');
    }
  });
  
  // DonationAlerts OAuth callback
  app.get('/auth/donationalerts/callback', async (req, res) => {
    try {
      const { code, state, error } = req.query;
      
      if (error) {
        console.error('[DA OAuth] OAuth error:', error);
        return res.redirect('/?error=oauth_denied');
      }
      
      if (!code || !state) {
        console.error('[DA OAuth] Missing code or state');
        return res.redirect('/?error=invalid_request');
      }
      
      // Verify state
      const storedState = stateStore.get(state);
      if (!storedState) {
        console.error('[DA OAuth] Invalid state');
        return res.redirect('/?error=invalid_state');
      }
      
      // Check if state is not too old (5 minutes)
      if (Date.now() - storedState.timestamp > 5 * 60 * 1000) {
        console.error('[DA OAuth] State expired');
        stateStore.delete(state);
        return res.redirect('/?error=state_expired');
      }
      
      // Clean up state
      stateStore.delete(state);
      
      console.log(`[DA OAuth] Exchanging code for token`);
      
      // Exchange code for token
      const tokenData = await exchangeCodeForToken(code);
      const { access_token, refresh_token, expires_in } = tokenData;
      
      console.log(`[DA OAuth] Got access token, getting user info`);
      
      // Get user info
      const userInfo = await getUserInfo(access_token);
      
      console.log(`[DA OAuth] User info:`, userInfo);
      
      // Проверяем обязательные поля
      if (!userInfo.id) {
        throw new Error('Missing user ID in DonationAlerts response');
      }
      
      // Безопасно извлекаем username и display_name
      const username = userInfo.username || userInfo.name || `user_${userInfo.id}`;
      const displayName = userInfo.display_name || userInfo.name || userInfo.username || `User ${userInfo.id}`;
      
      console.log(`[DA OAuth] Processed user info:`, {
        id: userInfo.id,
        username: username,
        display_name: displayName
      });
      
      // Сохраняем токены стримера в таблицу streamers
      const { upsertStreamerDA } = require('../db');
      const streamerData = {
        streamer_twitch_id: storedState.userId || userInfo.id.toString(),
        twitch_login: username.toLowerCase(),
        da_user_id: userInfo.id.toString(),
        da_access_token: access_token,
        da_refresh_token: refresh_token,
        da_expires_at: Math.floor(Date.now() / 1000) + expires_in - 60, // -60 сек для безопасности
        status: 'active'
      };
      
      console.log(`[DA OAuth] Saving streamer data:`, {
        streamer_twitch_id: streamerData.streamer_twitch_id,
        da_user_id: streamerData.da_user_id,
        has_access_token: !!streamerData.da_access_token,
        has_refresh_token: !!streamerData.da_refresh_token,
        access_token_length: streamerData.da_access_token?.length || 0,
        refresh_token_length: streamerData.da_refresh_token?.length || 0,
        stored_state_userId: storedState.userId,
        session_userId: req.session.userId
      });
      
      upsertStreamerDA(streamerData);
      console.log(`[DA OAuth] Saved streamer DA credentials for ${displayName}`);
      
      // Также обновляем пользователя в таблице users (если это существующий пользователь)
      const userId = storedState.userId || userInfo.id.toString();
      const existingUser = getUserByTwitchId(userId);
      
      let userData;
      if (existingUser) {
        // Обновляем DA данные пользователя
        const { setUserDA } = require('../db');
        setUserDA(userId, {
          da_user_id: userInfo.id.toString(),
          da_username: username
        });
        console.log(`[DA OAuth] Updated existing user ${existingUser.display_name} with DA data`);
        
        // Используем данные существующего пользователя
        userData = {
          login: existingUser.login,
          display_name: existingUser.display_name
        };
      } else {
        // Создаем нового пользователя
        userData = {
          twitch_user_id: userInfo.id.toString(),
          display_name: displayName,
          login: username.toLowerCase(),
          profile_image_url: userInfo.avatar || userInfo.profile_image_url || null,
          access_token: access_token,
          refresh_token: refresh_token,
          scope: 'oauth-user-show oauth-donation-index',
          expires_at: Math.floor(Date.now() / 1000) + expires_in,
          coins: 0,
          da_user_id: userInfo.id.toString(),
          da_username: username
        };
        
        saveOrUpdateUser(userData);
        console.log(`[DA OAuth] Created new user ${userData.display_name}`);
      }
      
      // Create default avatar if doesn't exist
      let avatarData = require('../db').getAvatarByTwitchId(userId);
      if (!avatarData) {
        try {
          avatarData = {
            body_skin: 'body_skin_1',
            face_skin: 'face_skin_1', 
            clothes_type: 'clothes_type_1',
            others_type: 'others_1'
          };
          saveOrUpdateAvatar(userId, avatarData);
          console.log(`[DA OAuth] Created default avatar for user ${userId}`);
        } catch (error) {
          console.error(`[DA OAuth] Error creating avatar: ${error.message}`);
        }
      }
      
      // Сохраняем пользователя в сессии
      req.session.userId = userId;
      req.session.userLogin = userData.login;
      req.session.userDisplayName = userData.display_name || userData.login;
      
      console.log(`[DA OAuth] OAuth flow completed successfully for user ${userId}`);
      res.redirect('/success?da_connected=true');
      
    } catch (error) {
      console.error('[DA OAuth] OAuth callback error:', error);
      
      // Более детальная обработка ошибок
      let errorMessage = 'oauth_failed';
      if (error.message.includes('Missing user ID')) {
        errorMessage = 'invalid_user_data';
      } else if (error.response?.status === 401) {
        errorMessage = 'invalid_credentials';
      } else if (error.response?.status === 404) {
        errorMessage = 'api_not_found';
      }
      
      res.redirect(`/?error=${errorMessage}&details=${encodeURIComponent(error.message)}`);
    }
  });
  
  // Get current user's donations
  app.get('/api/donationalerts/my-donations', async (req, res) => {
    try {
      const uid = req.session.userId;
      if (!uid) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      
      const user = getUserByTwitchId(uid);
      if (!user || !user.access_token) {
        return res.status(401).json({ error: 'No DonationAlerts token' });
      }
      
      const { getUserDonations } = require('../lib/donationalerts-oauth');
      const donations = await getUserDonations(user.access_token);
      
      res.json({
        success: true,
        donations: donations
      });
      
    } catch (error) {
      console.error('[DA OAuth] Error getting user donations:', error);
      res.status(500).json({ error: 'Failed to get donations' });
    }
  });
}

module.exports = { registerDonationAlertsAuthRoutes };
