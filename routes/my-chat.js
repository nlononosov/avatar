const { getUserByTwitchId, getStreamerUsers, getUserAvatarPreview, getAvailableGifts, giveGiftToUser, getAvatarByTwitchId, setAvatarTimeoutSeconds, getAvatarTimeoutSeconds, setGameSettings, getGameSettings } = require('../lib/db/async');

function registerMyChatRoute(app) {
  // API для получения списка пользователей стримера
  app.get('/api/streamer/users', async (req, res) => {
    const streamerId = req.cookies.uid;
    if (!streamerId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const searchQuery = req.query.search || '';
    const users = await getStreamerUsers(streamerId, searchQuery);

    res.json({
      success: true,
      data: users
    });
  });

  // API для получения предпросмотра аватара пользователя
  app.get('/api/user/:userId/avatar-preview', async (req, res) => {
    const streamerId = req.cookies.uid;
    if (!streamerId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { userId } = req.params;
    const avatarData = await getUserAvatarPreview(userId);
    
    if (!avatarData) {
      return res.status(404).json({ error: 'Avatar not found' });
    }

    res.json({
      success: true,
      data: avatarData
    });
  });


  // API для получения списка доступных подарков
  app.get('/api/gifts', async (req, res) => {
    const streamerId = req.cookies.uid;
    if (!streamerId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const gifts = await getAvailableGifts();
      res.json({
        success: true,
        data: gifts
      });
    } catch (error) {
      console.error('Error getting gifts:', error);
      res.status(500).json({ error: 'Failed to get gifts' });
    }
  });

  // API для отправки подарка пользователю
  app.post('/api/user/:userId/give-gift', async (req, res) => {
    const streamerId = req.cookies.uid;
    if (!streamerId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { userId } = req.params;
    const { giftType, giftId } = req.body;

    if (!giftType || !giftId) {
      return res.status(400).json({ error: 'Missing giftType or giftId' });
    }

    try {
      const success = await giveGiftToUser(userId, giftType, giftId);
      if (success) {
        res.json({
          success: true,
          message: 'Gift sent successfully'
        });
      } else {
        res.status(500).json({ error: 'Failed to send gift' });
      }
    } catch (error) {
      console.error('Error giving gift:', error);
      res.status(500).json({ error: 'Failed to send gift' });
    }
  });

  // API для обновления ширины трека в игре race-plan
  app.post('/api/race-plan/update-track-width', (req, res) => {
    try {
      const { trackWidth } = req.body;
      
      if (typeof trackWidth !== 'number' || trackWidth <= 0) {
        return res.status(400).json({ error: 'Invalid track width' });
      }

      // Импортируем состояние игры
      const { racePlanState } = require('../services/bot');
      
      // Обновляем ширину трека
      racePlanState.trackWidth = trackWidth;
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error updating track width:', error);
      res.status(500).json({ error: 'Failed to update track width' });
    }
  });

  // API для финиша в игре race-plan
  app.post('/api/race-plan/finish', (req, res) => {
    try {
      const { winnerId } = req.body;
      
      if (!winnerId) {
        return res.status(400).json({ error: 'Missing winnerId' });
      }

      // Импортируем функции бота
      const { finishRacePlan, getBotClient, getBotChannel } = require('../services/bot');
      
      // Получаем имя победителя
      const { racePlanState } = require('../services/bot');
      const winnerName = racePlanState.participantNames.get(winnerId) || 'Unknown';
      
      // Завершаем игру
      const client = getBotClient();
      const channel = getBotChannel();
      finishRacePlan(winnerName, client, channel);
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error finishing race plan:', error);
      res.status(500).json({ error: 'Failed to finish race plan' });
    }
  });

  // API для запуска игры
  app.post('/api/games/start-race', async (req, res) => {
    const streamerId = req.cookies.uid;
    if (!streamerId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      // Получаем информацию о стримере
      const streamer = await getUserByTwitchId(streamerId);
      if (!streamer) {
        return res.status(404).json({ error: 'Streamer not found' });
      }

      // Получаем настройки гонки из запроса
      const { minParticipants = 1, maxParticipants = 10, registrationTime = 10 } = req.body;
      
      // Валидация настроек
      if (minParticipants < 1 || minParticipants > 50) {
        return res.status(400).json({ error: 'Min participants must be between 1 and 50' });
      }
      if (maxParticipants < 1 || maxParticipants > 50) {
        return res.status(400).json({ error: 'Max participants must be between 1 and 50' });
      }
      if (minParticipants > maxParticipants) {
        return res.status(400).json({ error: 'Min participants cannot be greater than max participants' });
      }
      if (registrationTime < 5 || registrationTime > 60) {
        return res.status(400).json({ error: 'Registration time must be between 5 and 60 seconds' });
      }

      // Импортируем функции бота для запуска гонки
      const { ensureBotFor, startRace, getBotClientFor, getBotChannelFor, getStreamerState } = require('../services/bot');
      // Убеждаемся, что бот запущен
      try { await ensureBotFor(streamerId); } catch (_) {}
      // Получаем активного бота и канал
      const client = getBotClientFor(streamerId);
      const channel = getBotChannelFor(streamerId);
      
      console.log(`[my-chat] Bot client:`, client ? 'active' : 'null');
      console.log(`[my-chat] Bot channel:`, channel);
      console.log(`[my-chat] Streamer login:`, streamer.login);
      console.log(`[my-chat] Race settings:`, { minParticipants, maxParticipants, registrationTime });
      
      if (!client || !channel) {
        return res.status(400).json({ error: 'Bot not active for this streamer' });
      }
      
      // Запускаем гонку с настройками
      console.log(`[my-chat] Starting race with client and channel:`, channel);
      const { raceState } = getStreamerState(streamerId);
      startRace(streamerId, client, channel, raceState, { minParticipants, maxParticipants, registrationTime });
      
      res.json({ success: true, message: 'Гонка запущена!' });
    } catch (error) {
      console.error('Error starting race:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // API для запуска игры "Собери еду"
  app.post('/api/games/start-food', async (req, res) => {
    const streamerId = req.cookies.uid;
    if (!streamerId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      // Получаем информацию о стримере
      const streamer = await getUserByTwitchId(streamerId);
      if (!streamer) {
        return res.status(404).json({ error: 'Streamer not found' });
      }

      // Получаем настройки игры из запроса
      const { minParticipants = 1, maxParticipants = 10, registrationTime = 10 } = req.body;
      
      // Валидация настроек
      if (minParticipants < 1 || minParticipants > 50) {
        return res.status(400).json({ error: 'Min participants must be between 1 and 50' });
      }
      if (maxParticipants < 1 || maxParticipants > 50) {
        return res.status(400).json({ error: 'Max participants must be between 1 and 50' });
      }
      if (minParticipants > maxParticipants) {
        return res.status(400).json({ error: 'Min participants cannot be greater than max participants' });
      }
      if (registrationTime < 5 || registrationTime > 60) {
        return res.status(400).json({ error: 'Registration time must be between 5 and 60 seconds' });
      }

      // Импортируем функции бота для запуска игры
      const { ensureBotFor, startFoodGame, getBotClientFor, getBotChannelFor } = require('../services/bot');
      try { await ensureBotFor(streamerId); } catch (_) {}
      const client = getBotClientFor(streamerId);
      const channel = getBotChannelFor(streamerId);
      
      console.log(`[my-chat] Bot client:`, client ? 'active' : 'null');
      console.log(`[my-chat] Bot channel:`, channel);
      console.log(`[my-chat] Streamer login:`, streamer.login);
      console.log(`[my-chat] Food game settings:`, { minParticipants, maxParticipants, registrationTime });
      
      if (!client || !channel) {
        return res.status(400).json({ error: 'Bot not active for this streamer' });
      }
      
      // Запускаем игру с настройками
      console.log(`[my-chat] Starting food game with client and channel:`, channel);
      startFoodGame(client, channel, { minParticipants, maxParticipants, registrationTime });
      
      res.json({ success: true, message: 'Игра "Собери еду" запущена!' });
    } catch (error) {
      console.error('Error starting food game:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // API для запуска игры "Гонка на самолетах"
  app.post('/api/games/start-race-plan', async (req, res) => {
    const streamerId = req.cookies.uid;
    if (!streamerId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      // Получаем информацию о стримере
      const streamer = await getUserByTwitchId(streamerId);
      if (!streamer) {
        return res.status(404).json({ error: 'Streamer not found' });
      }

      // Получаем настройки игры из запроса
      const { minParticipants = 1, maxParticipants = 8, registrationTime = 10 } = req.body;
      
      // Валидация настроек
      if (minParticipants < 1 || minParticipants > 50) {
        return res.status(400).json({ error: 'Min participants must be between 1 and 50' });
      }
      if (maxParticipants < 1 || maxParticipants > 50) {
        return res.status(400).json({ error: 'Max participants must be between 1 and 50' });
      }
      if (minParticipants > maxParticipants) {
        return res.status(400).json({ error: 'Min participants cannot be greater than max participants' });
      }
      if (registrationTime < 5 || registrationTime > 60) {
        return res.status(400).json({ error: 'Registration time must be between 5 and 60 seconds' });
      }

      // Импортируем функции бота для запуска игры
      const { ensureBotFor, startRacePlan, getBotClientFor, getBotChannelFor } = require('../services/bot');
      try { await ensureBotFor(streamerId); } catch (_) {}
      const client = getBotClientFor(streamerId);
      const channel = getBotChannelFor(streamerId);
      
      console.log(`[my-chat] Bot client:`, client ? 'active' : 'null');
      console.log(`[my-chat] Bot channel:`, channel);
      console.log(`[my-chat] Streamer login:`, streamer.login);
      console.log(`[my-chat] Race plan settings:`, { minParticipants, maxParticipants, registrationTime });
      
      if (!client || !channel) {
        return res.status(400).json({ error: 'Bot not active for this streamer' });
      }
      
      // Запускаем игру с настройками
      console.log(`[my-chat] Starting race plan with client and channel:`, channel);
      startRacePlan(client, channel, { minParticipants, maxParticipants, registrationTime });
      
      res.json({ success: true, message: 'Игра "Гонка на самолетах" запущена!' });
    } catch (error) {
      console.error('Error starting race plan:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // API для метрик хитбокса аватара
  app.post('/api/race-plan/avatar-metrics', (req, res) => {
    const { userId, halfW, halfH } = req.body || {};
    if (!userId || typeof halfW !== 'number' || typeof halfH !== 'number') {
      return res.status(400).json({ error: 'Bad metrics' });
    }
    try {
      const { setAvatarMetrics } = require('../services/bot');
      setAvatarMetrics(userId, halfW, halfH);
      return res.json({ success: true });
    } catch (e) {
      console.error('avatar-metrics error:', e);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // API для обработки коллизий в игре "Гонка на самолетах"
  app.post('/api/race-plan/collision', (req, res) => {
    const { playerId, obstacleId } = req.body;
    
    if (!playerId || !obstacleId) {
      return res.status(400).json({ error: 'Missing playerId or obstacleId' });
    }

    try {
      // Импортируем функции бота для обработки коллизии
      const { handleRacePlanCollision } = require('../services/bot');
      
      // Обрабатываем коллизию
      handleRacePlanCollision(playerId, obstacleId);
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error handling race plan collision:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // API для обновления счета в игре "Собери еду"
  app.post('/api/food-game/score-update', (req, res) => {
    const { userId, score } = req.body;
    
    if (!userId || score === undefined) {
      return res.status(400).json({ error: 'Missing userId or score' });
    }

    try {
      // Emit score update to overlay
      const { emit } = require('../lib/bus');
      emit('foodGameScoreUpdate', { userId, score });
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error updating food game score:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // API для сохранения настроек тайминга удаления аватаров
  app.post('/api/streamer/avatar-timeout-settings', async (req, res) => {
    const streamerId = req.cookies.uid;
    if (!streamerId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { avatarTimeoutSeconds } = req.body;
    
    if (avatarTimeoutSeconds === undefined || avatarTimeoutSeconds < 5 || avatarTimeoutSeconds > 3600) {
      return res.status(400).json({ error: 'Avatar timeout must be between 5 and 3600 seconds' });
    }

    try {
      // Сохраняем настройки в БД
      await setAvatarTimeoutSeconds(streamerId, avatarTimeoutSeconds);

      // Обновляем настройки в боте
      const { setAvatarTimeoutSeconds: setBotTimeout } = require('../services/bot');
      setBotTimeout(avatarTimeoutSeconds);
      
      res.json({ 
        success: true, 
        message: 'Настройки сохранены',
        data: { avatarTimeoutSeconds }
      });
    } catch (error) {
      console.error('Error saving avatar timeout settings:', error);
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        streamerId,
        avatarTimeoutSeconds
      });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // API для получения настроек тайминга удаления аватаров
  app.get('/api/streamer/avatar-timeout-settings', async (req, res) => {
    const streamerId = req.cookies.uid;
    if (!streamerId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      // Получаем текущие настройки из БД
      const avatarTimeoutSeconds = await getAvatarTimeoutSeconds(streamerId);
      
      res.json({ 
        success: true, 
        data: { avatarTimeoutSeconds }
      });
    } catch (error) {
      console.error('Error getting avatar timeout settings:', error);
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        streamerId
      });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // API для сохранения настроек игр
  app.post('/api/streamer/game-settings', async (req, res) => {
    const streamerId = req.cookies.uid;
    if (!streamerId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { minParticipants, maxParticipants, registrationTime } = req.body;
    
    if (minParticipants === undefined || maxParticipants === undefined || registrationTime === undefined) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    if (minParticipants < 1 || minParticipants > 50) {
      return res.status(400).json({ error: 'minParticipants must be between 1 and 50' });
    }

    if (maxParticipants < minParticipants || maxParticipants > 50) {
      return res.status(400).json({ error: 'maxParticipants must be between minParticipants and 50' });
    }

    if (registrationTime < 5 || registrationTime > 60) {
      return res.status(400).json({ error: 'registrationTime must be between 5 and 60 seconds' });
    }

    try {
      // Сохраняем настройки игр в БД
      await setGameSettings(streamerId, { minParticipants, maxParticipants, registrationTime });
      
      res.json({ 
        success: true, 
        message: 'Настройки игр сохранены',
        data: { minParticipants, maxParticipants, registrationTime }
      });
    } catch (error) {
      console.error('Error saving game settings:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // API для получения настроек игр
  app.get('/api/streamer/game-settings', async (req, res) => {
    const streamerId = req.cookies.uid;
    if (!streamerId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      // Получаем текущие настройки из БД
      const gameSettings = await getGameSettings(streamerId);
      
      res.json({ 
        success: true, 
        data: gameSettings
      });
    } catch (error) {
      console.error('Error getting game settings:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Страница "Мой чат"
  app.get('/my-chat', async (req, res) => {
    const streamerId = req.cookies.uid;
    if (!streamerId) {
      return res.redirect('/');
    }

    const streamer = await getUserByTwitchId(streamerId);
    if (!streamer) {
      return res.redirect('/');
    }

    const streamerAvatar = await getAvatarByTwitchId(streamerId);
    const { displayName, login, profileImageUrl } = streamer;
    const avatarUrl = profileImageUrl || 'https://via.placeholder.com/64';

    res.send(`
<!doctype html>
<html lang="ru">
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Мой чат</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; background:#0f172a; color:#e2e8f0; margin:0; min-height:100vh; }
  .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
  .header { display: flex; align-items: center; gap: 20px; margin-bottom: 30px; }
  .profile-pic { width: 64px; height: 64px; border-radius: 50%; object-fit: cover; background:#0b1220; }
  .header h1 { margin: 0; font-size: 28px; }
  .header p { margin: 5px 0 0; opacity: 0.8; }
  
  .streamer-avatar-preview { position: relative; width: 80px; height: 80px; border-radius: 50%; overflow: hidden; background: #1f2937; border: 3px solid #374151; }
  .streamer-avatar-preview .avatar-frame { position: relative; width: 100%; height: 100%; transform: translate(-32px, -7px) scale(0.8); }
  .streamer-avatar-preview .layer { position: absolute; width: 200%; height: 200%; object-fit: contain; image-rendering: -webkit-optimize-contrast; }
  .streamer-avatar-preview .layer.body { z-index: 1; }
  .streamer-avatar-preview .layer.face { z-index: 2; }
  .streamer-avatar-preview .layer.clothes { z-index: 3; }
  .streamer-avatar-preview .layer.others { z-index: 4; }
  
  .back-btn { display: inline-flex; align-items: center; justify-content: center; margin-bottom: 20px; text-decoration: none; height: 48px; padding: 0 18px; background: #7c3aed; color: white; border: none; border-radius: 12px; cursor: pointer; font-weight: 600; font-size: 16px; }
  .back-btn:hover { background: #6d28d9; }
  
  .main-content { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; }
  
  .users-section { background: #111827; padding: 30px; border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,.35); }
  .users-section h2 { margin: 0 0 20px; font-size: 22px; }
  
  .search-box { width: 100%; padding: 12px 16px; background: #1f2937; border: 2px solid #374151; border-radius: 8px; color: #e2e8f0; font-size: 16px; margin-bottom: 20px; }
  .search-box:focus { outline: none; border-color: #7c3aed; }
  .search-box::placeholder { color: #9ca3af; }
  
  .users-list { max-height: 500px; overflow-y: auto; }
  .user-item { display: flex; align-items: center; gap: 15px; padding: 15px; background: #1f2937; border-radius: 8px; margin-bottom: 10px; cursor: pointer; transition: all 0.2s; border: 2px solid transparent; }
  .user-item:hover { background: #374151; border-color: #6b7280; }
  .user-item.selected { background: #7c3aed; border-color: #a855f7; }
  .user-avatar { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; }
  .user-avatar-preview { position: relative; width: 40px; height: 40px; border-radius: 50%; overflow: hidden; background: #1f2937; border: 2px solid #374151; }
  .user-avatar-preview .avatar-frame { position: relative; width: 100%; height: 100%; transform: translate(-16px, -7px) scale(0.8); }
  .user-avatar-preview .layer { position: absolute; width: 200%; height: 200%; object-fit: contain; image-rendering: -webkit-optimize-contrast; }
  .user-avatar-preview .layer.body { z-index: 1; }
  .user-avatar-preview .layer.face { z-index: 2; }
  .user-avatar-preview .layer.clothes { z-index: 3; }
  .user-avatar-preview .layer.others { z-index: 4; }
  .user-info { flex: 1; }
  .user-name { font-weight: 600; margin-bottom: 5px; }
  .user-login { font-size: 14px; opacity: 0.8; }
  .user-date { font-size: 12px; opacity: 0.6; }
  
  .preview-section { background: #111827; padding: 30px; border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,.35); }
  .preview-section h2 { margin: 0 0 20px; font-size: 22px; }
  .preview-content { 
    height: 400px; 
    display: flex; 
    flex-direction: column; 
    justify-content: center; 
    align-items: center;
    overflow: hidden;
    transition: opacity 0.2s ease;
    position: relative;
  }
  
  .gift-btn-container { 
    height: 60px; 
    display: flex; 
    justify-content: center; 
    align-items: center; 
    margin-top: 20px;
    visibility: hidden;
    transition: visibility 0.2s ease;
  }
  
  .gift-btn-container.visible { 
    visibility: visible; 
  }
  
  .preview-avatar { position: relative; width: 256px; height: 256px; background: transparent; margin: 0 auto; transition: opacity 0.2s ease; }
  .preview-avatar .layer { position: absolute; inset: 0; width: 100%; height: 100%;
                   display:block; object-fit: contain; image-rendering: -webkit-optimize-contrast;
                   border-radius: 0 !important; pointer-events: none; transition: opacity 0.2s ease; }
  .preview-avatar .layer.body    { z-index: 1; }
  .preview-avatar .layer.face    { z-index: 2; }
  .preview-avatar .layer.clothes { z-index: 3; }
  .preview-avatar .layer.others  { z-index: 4; }
  
  .preview-info { text-align: center; margin-top: 20px; }
  .preview-name { font-size: 18px; font-weight: 600; margin-bottom: 5px; }
  .preview-login { font-size: 14px; opacity: 0.8; }
  
  .gift-btn { display: inline-flex; align-items: center; justify-content: center; margin-top: 15px; text-decoration: none; height: 40px; padding: 0 16px; background: #fbbf24; color: #1f2937; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 14px; }
  .gift-btn:hover { background: #f59e0b; }
  
  .modal { display: none; position: fixed; z-index: 1000; left: 0; top: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.8); }
  .modal-content { background-color: #111827; margin: 5% auto; padding: 30px; border-radius: 16px; width: 90%; max-width: 800px; max-height: 80vh; overflow-y: auto; }
  .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; }
  .modal-header h2 { margin: 0; font-size: 24px; }
  .close { color: #aaa; font-size: 28px; font-weight: bold; cursor: pointer; }
  .close:hover { color: white; }
  
  .gift-tabs { display: flex; gap: 10px; margin-bottom: 20px; }
  .gift-tab { padding: 10px 20px; background: #374151; color: #9ca3af; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; }
  .gift-tab.active { background: #7c3aed; color: white; }
  .gift-tab.common.active { background: #6b7280; }
  .gift-tab.uncommon.active { background: #3b82f6; }
  .gift-tab.rare.active { background: #f59e0b; }
  
  .gifts-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 15px; }
  .gift-item { text-align: center; cursor: pointer; padding: 15px; border-radius: 8px; transition: all 0.2s; border: 2px solid transparent; background: #1f2937; }
  .gift-item:hover { background: #374151; border-color: #6b7280; }
  .gift-item img { width: 60px; height: 60px; object-fit: contain; margin-bottom: 8px; }
  .gift-item .name { font-size: 12px; font-weight: 600; }
  
  .modal-actions { display: flex; gap: 15px; justify-content: flex-end; margin-top: 30px; }
  .btn { display: inline-flex; align-items: center; justify-content: center; text-decoration: none; height: 48px; padding: 0 18px; background: #7c3aed; color: white; border: none; border-radius: 12px; cursor: pointer; font-weight: 600; font-size: 16px; }
  .btn:hover { background: #6d28d9; }
  .btn.secondary { background: #374151; }
  .btn.secondary:hover { background: #4b5563; }
  
  .empty-state { text-align: center; padding: 40px; opacity: 0.6; }
  .empty-state img { width: 80px; height: 80px; opacity: 0.3; margin-bottom: 20px; }
  
  .loading { text-align: center; padding: 20px; opacity: 0.8; }
  .hidden { display: none; }
  
  .games-section { background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
  .games-section h2 { margin: 0 0 15px; font-size: 18px; color: #f1f5f9; }
  
  .race-settings { background: #334155; border-radius: 8px; padding: 15px; margin-bottom: 20px; border: 1px solid #475569; }
  .race-settings h3 { margin: 0 0 15px; font-size: 16px; color: #f1f5f9; }
  .settings-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; }
  .setting-group { display: flex; flex-direction: column; gap: 5px; }
  .setting-group label { font-size: 12px; color: #94a3b8; font-weight: 500; }
  .setting-group input { padding: 8px 12px; background: #1f2937; border: 1px solid #475569; border-radius: 6px; color: #f1f5f9; font-size: 14px; }
  .setting-group input:focus { outline: none; border-color: #7c3aed; }
  
  .games-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; }
  .game-card { background: #334155; border-radius: 8px; padding: 15px; border: 1px solid #475569; transition: all 0.2s; cursor: pointer; }
  .game-card:hover { background: #475569; border-color: #7c3aed; transform: translateY(-2px); }
  .game-card .game-icon { font-size: 24px; margin-bottom: 8px; }
  .game-card .game-name { font-weight: 600; margin-bottom: 4px; color: #f1f5f9; }
  .game-card .game-description { font-size: 12px; color: #94a3b8; margin-bottom: 10px; }
  .game-card .game-status { font-size: 11px; padding: 2px 6px; border-radius: 4px; background: #10b981; color: white; }
  .game-card .game-status.inactive { background: #6b7280; }
  
  /* Стили для заглушки игры */
  .game-card.disabled { 
    position: relative; 
    cursor: not-allowed; 
    opacity: 0.6; 
  }
  .game-card.disabled:hover { 
    background: #334155; 
    border-color: #475569; 
    transform: none; 
  }
  .game-card.disabled .game-overlay { 
    position: absolute; 
    top: 0; 
    left: 0; 
    right: 0; 
    bottom: 0; 
    background: rgba(0, 0, 0, 0.7); 
    border-radius: 8px; 
    display: flex; 
    align-items: center; 
    justify-content: center; 
    z-index: 10; 
  }
  .game-card.disabled .game-overlay-text { 
    color: #fbbf24; 
    font-weight: 700; 
    font-size: 14px; 
    text-align: center; 
    text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8); 
  }
  
  @media (max-width: 768px) {
    .main-content { grid-template-columns: 1fr; }
  }
</style>
<body>
  <div class="container">
    <a href="/success" class="back-btn">← Назад к панели</a>
    
    <div class="header">
      <div class="streamer-avatar-preview">
        <div class="avatar-frame">
          <img class="layer body"    alt="body"    src="/parts/body/${streamerAvatar?.body_skin || 'body_skin_1'}.png">
          <img class="layer face"    alt="face"    src="/parts/face/${streamerAvatar?.face_skin || 'face_skin_1'}.png">
          <img class="layer clothes" alt="clothes" src="/parts/clothes/${streamerAvatar?.clothes_type || 'clothes_type_1'}.png">
          <img class="layer others"  alt="others"  src="/parts/others/${streamerAvatar?.others_type || 'others_1'}.png">
        </div>
      </div>
      <div>
        <h1>Мой чат</h1>
        <p><b>${displayName}</b> ${login ? `(@${login})` : ''}</p>
      </div>
    </div>

    <div class="games-section">
      <h2>🎮 Игры и активности</h2>
      
      <div class="race-settings">
        <h3>⚙️ Настройки игр</h3>
        <div class="settings-grid">
          <div class="setting-group">
            <label for="minParticipants">Минимум участников:</label>
            <input type="number" id="minParticipants" min="1" max="50" value="1">
          </div>
          <div class="setting-group">
            <label for="maxParticipants">Максимум участников:</label>
            <input type="number" id="maxParticipants" min="1" max="50" value="10">
          </div>
          <div class="setting-group">
            <label for="registrationTime">Время сбора заявок (сек):</label>
            <input type="number" id="registrationTime" min="5" max="60" value="10">
          </div>
        </div>
      </div>
      
      <div class="race-settings">
        <h3>⏰ Настройки аватаров</h3>
        <div class="settings-grid">
          <div class="setting-group">
            <label for="avatarTimeoutSeconds">Удаление неактивных аватаров (сек):</label>
            <input type="number" id="avatarTimeoutSeconds" min="5" max="3600" value="300">
            <small style="color: #94a3b8; font-size: 11px; margin-top: 4px; display: block;">
              Аватары будут удаляться со стрима через указанное время неактивности (5 сек - 1 час)
            </small>
          </div>
        </div>
      </div>
      
      <div style="text-align: center; margin: 20px 0;">
        <button class="btn" id="saveAllSettings" style="padding: 12px 24px; font-size: 16px;">
          💾 Сохранить все настройки
        </button>
      </div>
      
      <div class="games-grid">
        <div class="game-card" onclick="startRace()">
          <div class="game-icon">🏁</div>
          <div class="game-name">Гонка</div>
          <div class="game-description">Запустить гонку в чате</div>
          <div class="game-status">Готово к запуску</div>
        </div>
        <div class="game-card" onclick="startFoodGame()">
          <div class="game-icon">🥕</div>
          <div class="game-name">Собери еду</div>
          <div class="game-description">Собирайте падающие морковки!</div>
          <div class="game-status">Готово к запуску</div>
        </div>
        <div class="game-card disabled">
          <div class="game-icon">✈️</div>
          <div class="game-name">Гонка на самолетах</div>
          <div class="game-description">Управляйте самолетами и избегайте препятствий!</div>
          <div class="game-status">В разработке</div>
          <div class="game-overlay">
            <div class="game-overlay-text">Новые игры<br>в разработке</div>
          </div>
        </div>
      </div>
    </div>

    <div class="main-content">
      <div class="users-section">
        <h2>Пользователи чата</h2>
        <input type="text" class="search-box" id="searchInput" placeholder="Поиск по имени или логину...">
        <div class="users-list" id="usersList">
          <div class="loading">Загрузка...</div>
        </div>
      </div>

      <div class="preview-section">
        <h2>Предпросмотр аватара</h2>
        <div id="previewContent" class="preview-content">
          <div class="empty-state">
            <img src="/parts/body/body_skin_1.png" alt="No selection">
            <p>Выберите пользователя для предпросмотра</p>
          </div>
        </div>
        
        <div id="giftBtnContainer" class="gift-btn-container">
          <button class="gift-btn" id="giveGiftBtn">🎁 Сделать подарок</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Gift Modal -->
  <div id="giftModal" class="modal">
    <div class="modal-content">
      <div class="modal-header">
        <h2>Выберите подарок</h2>
        <span class="close">&times;</span>
      </div>
      
      <div class="gift-tabs">
        <button class="gift-tab common active" data-rarity="common">Обычные</button>
        <button class="gift-tab uncommon" data-rarity="uncommon">Необычные</button>
        <button class="gift-tab rare" data-rarity="rare">Редкие</button>
      </div>
      
      <div id="giftsContainer">
        <div class="loading">Загрузка подарков...</div>
      </div>
      
      <div class="modal-actions">
        <button class="btn secondary" id="cancelGiftBtn">Отмена</button>
        <button class="btn" id="sendGiftBtn" disabled>Отправить подарок</button>
      </div>
    </div>
  </div>

  <script>
    let currentUsers = [];
    let selectedUserId = null;
    let availableGifts = {};
    let selectedGift = null;


    // Загрузка пользователей
    async function loadUsers(searchQuery = '') {
      try {
        const response = await fetch(\`/api/streamer/users?search=\${encodeURIComponent(searchQuery)}\`);
        const data = await response.json();
        
        if (data.success) {
          currentUsers = data.data;
          renderUsersList();
        } else {
          console.error('Error loading users:', data.error);
        }
      } catch (error) {
        console.error('Error loading users:', error);
      }
    }

    // Отображение списка пользователей
    function renderUsersList() {
      const usersList = document.getElementById('usersList');
      
      if (currentUsers.length === 0) {
        usersList.innerHTML = \`
          <div class="empty-state">
            <img src="/parts/body/body_skin_1.png" alt="No users">
            <p>Пользователи не найдены</p>
            <p>Пока никто не создавал аватаров на вашем стриме</p>
          </div>
        \`;
        return;
      }

      usersList.innerHTML = currentUsers.map(user => \`
        <div class="user-item \${selectedUserId === user.twitch_user_id ? 'selected' : ''}" 
             data-user-id="\${user.twitch_user_id}">
          <div class="user-avatar-preview">
            <div class="avatar-frame">
              <img class="layer body"    alt="body"    src="/parts/body/\${user.body_skin || 'body_skin_1'}.png">
              <img class="layer face"    alt="face"    src="/parts/face/\${user.face_skin || 'face_skin_1'}.png">
              <img class="layer clothes" alt="clothes" src="/parts/clothes/\${user.clothes_type || 'clothes_type_1'}.png">
              <img class="layer others"  alt="others"  src="/parts/others/\${user.others_type || 'others_1'}.png">
            </div>
          </div>
          <div class="user-info">
            <div class="user-name">\${user.display_name || 'Без имени'}</div>
            <div class="user-login">@\${user.login || 'unknown'}</div>
            <div class="user-date">Создан: \${new Date(user.created_at * 1000).toLocaleDateString('ru-RU')}</div>
          </div>
        </div>
      \`).join('');

      // Добавляем обработчики кликов
      document.querySelectorAll('.user-item').forEach(item => {
        item.addEventListener('click', function() {
          const userId = this.dataset.userId;
          selectUser(userId);
        });
      });
    }


    // Поиск с задержкой
    let searchTimeout;
    document.getElementById('searchInput').addEventListener('input', function() {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        loadUsers(this.value);
      }, 300);
    });

    // Загрузка подарков
    async function loadGifts() {
      try {
        const response = await fetch('/api/gifts');
        const data = await response.json();
        
        if (data.success) {
          availableGifts = data.data;
          renderGifts('common');
        } else {
          console.error('Error loading gifts:', data.error);
        }
      } catch (error) {
        console.error('Error loading gifts:', error);
      }
    }

    // Отображение подарков
    function renderGifts(rarity) {
      const container = document.getElementById('giftsContainer');
      const giftType = \`gift_\${rarity}\`;
      const gifts = availableGifts[giftType] || [];
      
      if (gifts.length === 0) {
        container.innerHTML = \`
          <div class="empty-state">
            <img src="/parts/gift_common/gift_common_1.png" alt="No gifts">
            <p>Подарки не найдены</p>
          </div>
        \`;
        return;
      }

      container.innerHTML = gifts.map(gift => \`
        <div class="gift-item" data-gift-type="\${giftType}" data-gift-id="\${gift.id}">
          <img src="\${gift.path}" alt="\${gift.name}">
          <div class="name">\${gift.name}</div>
        </div>
      \`).join('');

      // Добавляем обработчики кликов
      document.querySelectorAll('.gift-item').forEach(item => {
        item.addEventListener('click', function() {
          // Убираем выделение с других подарков
          document.querySelectorAll('.gift-item').forEach(el => {
            el.style.borderColor = 'transparent';
            el.style.backgroundColor = '#1f2937';
          });
          
          // Выделяем выбранный подарок
          this.style.borderColor = '#7c3aed';
          this.style.backgroundColor = '#374151';
          
          // Сохраняем выбранный подарок
          selectedGift = {
            type: this.dataset.giftType,
            id: this.dataset.giftId
          };
          
          // Активируем кнопку отправки
          document.getElementById('sendGiftBtn').disabled = false;
        });
      });
    }

    // Отправка подарка
    async function sendGift() {
      if (!selectedGift || !selectedUserId) {
        alert('Выберите подарок и получателя');
        return;
      }

      try {
        const response = await fetch(\`/api/user/\${selectedUserId}/give-gift\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            giftType: selectedGift.type,
            giftId: selectedGift.id
          })
        });

        const data = await response.json();
        
        if (data.success) {
          alert('Подарок успешно отправлен!');
          document.getElementById('giftModal').style.display = 'none';
          selectedGift = null;
          document.getElementById('sendGiftBtn').disabled = true;
          
        } else {
          alert('Ошибка при отправке подарка: ' + data.error);
        }
      } catch (error) {
        console.error('Error sending gift:', error);
        alert('Ошибка при отправке подарка');
      }
    }

    // Обновляем функцию selectUser для показа кнопки подарка
    async function selectUser(userId) {
      selectedUserId = userId;
      
      // Обновляем визуальное выделение
      document.querySelectorAll('.user-item').forEach(item => {
        item.classList.remove('selected');
      });
      document.querySelector(\`[data-user-id="\${userId}"]\`).classList.add('selected');

      // Скрываем кнопку подарка до загрузки аватара
      document.getElementById('giftBtnContainer').classList.remove('visible');
      
      // Загружаем предпросмотр аватара
      await loadAvatarPreview(userId);
    }

    // Обновляем функцию loadAvatarPreview для скрытия кнопки при ошибке
    async function loadAvatarPreview(userId) {
      const previewContent = document.getElementById('previewContent');

      try {
        const response = await fetch(\`/api/user/\${userId}/avatar-preview\`);
        const data = await response.json();
        
        if (data.success) {
          const avatar = data.data;
          // Плавно обновляем содержимое без скачков
          previewContent.style.opacity = '0.7';
          setTimeout(() => {
            previewContent.innerHTML = \`
              <div class="preview-avatar" aria-label="Аватар по слоям">
                <img class="layer body"    alt="body"    src="/parts/body/\${avatar.body_skin || 'body_skin_1'}.png">
                <img class="layer face"    alt="face"    src="/parts/face/\${avatar.face_skin || 'face_skin_1'}.png">
                <img class="layer clothes" alt="clothes" src="/parts/clothes/\${avatar.clothes_type || 'clothes_type_1'}.png">
                <img class="layer others"  alt="others"  src="/parts/others/\${avatar.others_type || 'others_1'}.png">
              </div>
              <div class="preview-info">
                <div class="preview-name">\${avatar.display_name || 'Без имени'}</div>
                <div class="preview-login">@\${avatar.login || 'unknown'}</div>
              </div>
            \`;
            previewContent.style.opacity = '1';
            // Показываем кнопку подарка только при успешной загрузке
            document.getElementById('giftBtnContainer').classList.add('visible');
          }, 50);
        } else {
          previewContent.innerHTML = \`
            <div class="empty-state">
              <img src="/parts/body/body_skin_1.png" alt="No avatar">
              <p>Аватар не найден</p>
            </div>
          \`;
          document.getElementById('giftBtnContainer').classList.remove('visible');
        }
      } catch (error) {
        console.error('Error loading avatar preview:', error);
        previewContent.innerHTML = \`
          <div class="empty-state">
            <img src="/parts/body/body_skin_1.png" alt="Error">
            <p>Ошибка загрузки аватара</p>
          </div>
        \`;
        document.getElementById('giftBtnContainer').classList.remove('visible');
      }
    }

    // Обработчики событий
    document.getElementById('giveGiftBtn').addEventListener('click', () => {
      document.getElementById('giftModal').style.display = 'block';
      loadGifts();
    });

    document.querySelectorAll('.gift-tab').forEach(tab => {
      tab.addEventListener('click', function() {
        // Убираем активный класс с других вкладок
        document.querySelectorAll('.gift-tab').forEach(t => t.classList.remove('active'));
        
        // Добавляем активный класс к текущей вкладке
        this.classList.add('active');
        
        // Показываем подарки выбранной редкости
        const rarity = this.dataset.rarity;
        renderGifts(rarity);
        
        // Сбрасываем выбор подарка
        selectedGift = null;
        document.getElementById('sendGiftBtn').disabled = true;
      });
    });

    document.getElementById('sendGiftBtn').addEventListener('click', sendGift);

    document.getElementById('cancelGiftBtn').addEventListener('click', () => {
      document.getElementById('giftModal').style.display = 'none';
      selectedGift = null;
      document.getElementById('sendGiftBtn').disabled = true;
    });

    // Закрытие модального окна
    document.querySelector('.close').addEventListener('click', () => {
      document.getElementById('giftModal').style.display = 'none';
      selectedGift = null;
      document.getElementById('sendGiftBtn').disabled = true;
    });

    window.addEventListener('click', (event) => {
      if (event.target === document.getElementById('giftModal')) {
        document.getElementById('giftModal').style.display = 'none';
        selectedGift = null;
        document.getElementById('sendGiftBtn').disabled = true;
      }
    });

    // Загружаем пользователей при загрузке страницы
    loadUsers();

    // Загружаем настройки тайминга аватаров при загрузке страницы
    loadAvatarTimeoutSettings();

    // Функция для загрузки настроек тайминга аватаров
    async function loadAvatarTimeoutSettings() {
      try {
        const response = await fetch('/api/streamer/avatar-timeout-settings');
        const data = await response.json();
        
        if (data.success) {
          document.getElementById('avatarTimeoutSeconds').value = data.data.avatarTimeoutSeconds;
        }
      } catch (error) {
        console.error('Error loading avatar timeout settings:', error);
      }
    }

    // Функция для сохранения настроек тайминга аватаров
    async function saveAvatarTimeoutSettings() {
      try {
        const avatarTimeoutSeconds = parseInt(document.getElementById('avatarTimeoutSeconds').value);
        
        if (avatarTimeoutSeconds < 5 || avatarTimeoutSeconds > 3600) {
          alert('Время удаления должно быть от 5 секунд до 1 часа');
          return;
        }

        const response = await fetch('/api/streamer/avatar-timeout-settings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            avatarTimeoutSeconds: avatarTimeoutSeconds
          })
        });

        const data = await response.json();
        
        if (data.success) {
          // Сохраняем в localStorage для персистентности
          localStorage.setItem('avatarTimeoutSeconds', avatarTimeoutSeconds.toString());
          
          // Показываем уведомление об успешном сохранении
          const saveBtn = document.getElementById('saveAvatarSettings');
          const originalText = saveBtn.textContent;
          saveBtn.textContent = '✅ Сохранено!';
          saveBtn.style.background = '#10b981';
          
          setTimeout(() => {
            saveBtn.textContent = originalText;
            saveBtn.style.background = '#7c3aed';
          }, 2000);
        } else {
          alert('Ошибка сохранения настроек: ' + data.error);
        }
      } catch (error) {
        console.error('Error saving avatar timeout settings:', error);
        alert('Ошибка сохранения настроек');
      }
    }

    // Функция для сохранения всех настроек
    async function saveAllSettings() {
      try {
        // Получаем настройки игр
        const minParticipants = parseInt(document.getElementById('minParticipants').value);
        const maxParticipants = parseInt(document.getElementById('maxParticipants').value);
        const registrationTime = parseInt(document.getElementById('registrationTime').value);
        
        // Получаем настройки аватаров
        const avatarTimeoutSeconds = parseInt(document.getElementById('avatarTimeoutSeconds').value);
        
        // Валидация настроек игр
        if (minParticipants < 1 || minParticipants > 50) {
          alert('Минимум участников должен быть от 1 до 50');
          return;
        }
        
        if (maxParticipants < minParticipants || maxParticipants > 50) {
          alert('Максимум участников должен быть от минимума до 50');
          return;
        }
        
        if (registrationTime < 5 || registrationTime > 60) {
          alert('Время регистрации должно быть от 5 до 60 секунд');
          return;
        }
        
        // Валидация настроек аватаров
        if (avatarTimeoutSeconds < 5 || avatarTimeoutSeconds > 3600) {
          alert('Время удаления аватаров должно быть от 5 секунд до 1 часа');
          return;
        }

        // Сохраняем настройки игр
        const gameResponse = await fetch('/api/streamer/game-settings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            minParticipants,
            maxParticipants,
            registrationTime
          })
        });

        const gameData = await gameResponse.json();
        
        if (!gameData.success) {
          alert('Ошибка сохранения настроек игр: ' + gameData.error);
          return;
        }

        // Сохраняем настройки аватаров
        const avatarResponse = await fetch('/api/streamer/avatar-timeout-settings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            avatarTimeoutSeconds: avatarTimeoutSeconds
          })
        });

        const avatarData = await avatarResponse.json();
        
        if (!avatarData.success) {
          alert('Ошибка сохранения настроек аватаров: ' + avatarData.error);
          return;
        }

        // Показываем уведомление об успешном сохранении
        const saveBtn = document.getElementById('saveAllSettings');
        const originalText = saveBtn.textContent;
        saveBtn.textContent = '✅ Все настройки сохранены!';
        saveBtn.style.background = '#10b981';
        
        setTimeout(() => {
          saveBtn.textContent = originalText;
          saveBtn.style.background = '#7c3aed';
        }, 3000);
        
      } catch (error) {
        console.error('Error saving all settings:', error);
        alert('Ошибка сохранения настроек');
      }
    }

    // Обработчик для общей кнопки сохранения всех настроек
    document.getElementById('saveAllSettings').addEventListener('click', saveAllSettings);

    // Загружаем настройки из базы данных при загрузке страницы
    document.addEventListener('DOMContentLoaded', async function() {
      try {
        // Загружаем настройки аватаров
        const avatarResponse = await fetch('/api/streamer/avatar-timeout-settings');
        const avatarData = await avatarResponse.json();
        
        if (avatarData.success) {
          document.getElementById('avatarTimeoutSeconds').value = avatarData.data.avatarTimeoutSeconds;
        }
        
        // Загружаем настройки игр
        const gameResponse = await fetch('/api/streamer/game-settings');
        const gameData = await gameResponse.json();
        
        if (gameData.success) {
          document.getElementById('minParticipants').value = gameData.data.minParticipants;
          document.getElementById('maxParticipants').value = gameData.data.maxParticipants;
          document.getElementById('registrationTime').value = gameData.data.registrationTime;
        }
      } catch (error) {
        console.error('Error loading settings:', error);
      }
    });

    // Функция для запуска гонки
    async function startRace() {
      try {
        // Получаем настройки из формы
        const minParticipants = parseInt(document.getElementById('minParticipants').value);
        const maxParticipants = parseInt(document.getElementById('maxParticipants').value);
        const registrationTime = parseInt(document.getElementById('registrationTime').value);
        
        const response = await fetch('/api/game/race/start', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            minParticipants,
            maxParticipants,
            registrationTime
          })
        });

        const result = await response.json();
        
        if (result.success) {
          // Показываем уведомление об успешном запуске
          const gameCard = document.querySelector('.game-card');
          const status = gameCard.querySelector('.game-status');
          status.textContent = 'Гонка запущена!';
          status.style.background = '#f59e0b';
          
          // Через 3 секунды возвращаем исходное состояние
          setTimeout(() => {
            status.textContent = 'Готово к запуску';
            status.style.background = '#10b981';
          }, 3000);
        } else {
          alert('Ошибка запуска гонки: ' + result.error);
        }
      } catch (error) {
        console.error('Error starting race:', error);
        alert('Ошибка запуска гонки');
      }
    }

    async function startFoodGame() {
      try {
        // Получаем настройки из формы
        const minParticipants = parseInt(document.getElementById('minParticipants').value);
        const maxParticipants = parseInt(document.getElementById('maxParticipants').value);
        const registrationTime = parseInt(document.getElementById('registrationTime').value);
        
        const response = await fetch('/api/game/food/start', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            minParticipants,
            maxParticipants,
            registrationTime
          })
        });

        const result = await response.json();
        
        if (result.success) {
          // Показываем уведомление об успешном запуске
          const gameCards = document.querySelectorAll('.game-card');
          const foodGameCard = gameCards[1]; // Вторая карточка - "Собери еду"
          const status = foodGameCard.querySelector('.game-status');
          status.textContent = 'Игра запущена!';
          status.style.background = '#f59e0b';
          
          // Через 3 секунды возвращаем исходное состояние
          setTimeout(() => {
            status.textContent = 'Готово к запуску';
            status.style.background = '#10b981';
          }, 3000);
        } else {
          alert('Ошибка запуска игры: ' + result.error);
        }
      } catch (error) {
        console.error('Error starting food game:', error);
        alert('Ошибка запуска игры');
      }
    }

  </script>
</body>
</html>
    `);
  });
}

module.exports = { registerMyChatRoute };
