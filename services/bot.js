const tmi = require('tmi.js');
const { logLine } = require('../lib/logger');
const { getUserByTwitchId, saveOrUpdateAvatar, getAvatarByTwitchId, saveOrUpdateUser, addUserToStreamer } = require('../db');
const { emit, emitToStreamer, getSubscriberCount, getStreamerSubscriberCount } = require('../lib/bus');

// Помощник для отправки событий в канал стримера
function emitOverlay(event, payload, channel) {
  logLine(`[debug] emitOverlay: event="${event}", payload=`, payload, `channel="${channel}", botForUser="${botForUser}"`);
  
  // Оставляем обратную совместимость (глобальный), но главное — в канал стримера
  try { emit(event, payload); } catch {}
  let streamerId = botForUser;
  if (!streamerId && channel) {
    // channel вида "#login" → достаём логин и маппим на twitch_user_id
    const login = String(channel).replace(/^#/, '');
    try {
      const { getUserByLogin } = require('../db'); // добавь экспорт, если его нет
      const s = getUserByLogin(login);
      if (s && s.twitch_user_id) streamerId = s.twitch_user_id;
    } catch {}
  }
  
  logLine(`[debug] emitOverlay: final streamerId="${streamerId}"`);
  
  if (streamerId) {
    emitToStreamer(streamerId, event, payload);
    logLine(`[debug] emitOverlay: sent to streamer ${streamerId}`);
  } else {
    logLine(`[debug] emitOverlay: no streamerId, event not sent to streamer`);
  }
}
const { CLIENT_ID, CLIENT_SECRET } = require('../lib/config');

function normalizeChannel(ch) {
  if (!ch) return ch;
  return ch.startsWith('#') ? ch : `#${ch}`;
}

let tmiClient = null;
let botForUser = null;
let botReady = false; // Track if bot is fully connected and ready
const activeAvatars = new Set(); // Track active avatar user IDs
const avatarLastActivity = new Map(); // Track last activity time for each avatar
const avatarStates = new Map(); // Track avatar states (normal, tired)
let avatarTimeoutSeconds = 300; // Default timeout for inactive avatars (5 minutes)
let avatarTimeoutInterval = null; // Interval for checking inactive avatars

// Функция для обновления тайминга удаления аватаров
function setAvatarTimeoutSeconds(seconds) {
  const oldTimeout = avatarTimeoutSeconds;
  avatarTimeoutSeconds = seconds;
  logLine(`[bot] Avatar timeout updated from ${oldTimeout}s to ${seconds}s`);
  
  // Перезапускаем интервал с новым таймингом
  if (avatarTimeoutInterval) {
    clearInterval(avatarTimeoutInterval);
  }
  startAvatarTimeoutChecker();
}

// Функция для запуска проверки неактивных аватаров
function startAvatarTimeoutChecker() {
  if (avatarTimeoutInterval) {
    clearInterval(avatarTimeoutInterval);
  }
  
  // Проверяем чаще: раз в секунду, либо динамически от таймаута
  const period = Math.max(1000, Math.min(10000, Math.floor(avatarTimeoutSeconds * 1000 / 4)));
  avatarTimeoutInterval = setInterval(checkInactiveAvatars, period);
  
  // Мгновенно проверить один раз при старте
  checkInactiveAvatars();
  
  logLine(`[bot] Started avatar timeout checker (timeout=${avatarTimeoutSeconds}s, period=${period}ms)`);
}

// Функция для проверки и удаления неактивных аватаров
function checkInactiveAvatars() {
  const now = Date.now();
  
  // Загружаем актуальные настройки из БД для текущего стримера
  let currentTimeoutSeconds = avatarTimeoutSeconds; // Fallback на глобальную переменную
  try {
    if (botForUser) {
      const { getAvatarTimeoutSeconds } = require('../db');
      const dbTimeout = getAvatarTimeoutSeconds(botForUser);
      if (dbTimeout) {
        currentTimeoutSeconds = dbTimeout;
        // Обновляем глобальную переменную для консистентности
        if (dbTimeout !== avatarTimeoutSeconds) {
          avatarTimeoutSeconds = dbTimeout;
        }
      }
    }
  } catch (error) {
    logLine(`[bot] Error loading timeout from DB: ${error.message}`);
  }
  
  const timeoutMs = currentTimeoutSeconds * 1000; // Конвертируем секунды в миллисекунды
  const tiredTimeoutMs = timeoutMs / 2; // Половина времени для перехода в tired
  const inactiveUsers = [];
  const tiredUsers = [];
  
  // Логируем текущие настройки для отладки
  logLine(`[bot] Checking avatars with timeout: ${currentTimeoutSeconds}s (tired: ${Math.round(tiredTimeoutMs/1000)}s)`);
  
  for (const [userId, lastActivity] of avatarLastActivity.entries()) {
    const timeSinceActivity = now - lastActivity;
    
    if (timeSinceActivity > timeoutMs) {
      // Полное время истекло - удаляем аватар
      inactiveUsers.push(userId);
    } else if (timeSinceActivity > tiredTimeoutMs) {
      // Половина времени истекла - переводим в tired
      const currentState = avatarStates.get(userId);
      if (currentState !== 'tired') {
        tiredUsers.push(userId);
      }
    }
  }
  
  // Обрабатываем аватары, которые нужно перевести в tired
  if (tiredUsers.length > 0) {
    logLine(`[bot] Setting ${tiredUsers.length} avatars to tired state`);
    
    for (const userId of tiredUsers) {
      avatarStates.set(userId, 'tired');
      
      // Отправляем событие смены состояния на tired
      emitOverlay('avatarStateChanged', { 
        userId, 
        state: 'tired' 
      }, getBotChannel());
    }
  }
  
  // Обрабатываем аватары, которые нужно удалить
  if (inactiveUsers.length > 0) {
    logLine(`[bot] Removing ${inactiveUsers.length} inactive avatars`);
    
    for (const userId of inactiveUsers) {
      // Удаляем из активных аватаров
      activeAvatars.delete(userId);
      avatarLastActivity.delete(userId);
      avatarStates.delete(userId);
      
      // Отправляем событие удаления аватара
      emitOverlay('avatarRemoved', { userId }, getBotChannel());
    }
  }
}

// Функция для обновления активности аватара
function updateAvatarActivity(userId) {
  const previousState = avatarStates.get(userId);
  avatarLastActivity.set(userId, Date.now());
  activeAvatars.add(userId);
  
  // Если аватар был в состоянии tired, сбрасываем его в normal
  if (previousState === 'tired') {
    avatarStates.set(userId, 'normal');
    logLine(`[bot] Avatar ${userId} returned to normal state after activity`);
    
    // Отправляем событие смены состояния на normal
    emitOverlay('avatarStateChanged', { 
      userId, 
      state: 'normal' 
    }, getBotChannel());
  } else if (!previousState) {
    // Если это новый аватар, устанавливаем нормальное состояние
    avatarStates.set(userId, 'normal');
    logLine(`[bot] New avatar ${userId} added with normal state`);
  }
}

// Функция для получения текущего тайминга
function getAvatarTimeoutSeconds() {
  return avatarTimeoutSeconds;
}

// Race game state
let raceState = {
  isActive: false,
  participants: new Set(),
  participantNames: new Map(), // userId -> displayName
  positions: new Map(),
  speeds: new Map(),
  modifiers: new Map(),
  maxParticipants: 10,
  countdown: 0,
  raceStarted: false,
  raceFinished: false,
  winner: null,
  speedModifiers: new Map(), // userId -> speed modifier
  startTime: null
};

async function refreshToken(profile) {
  if (!profile.refresh_token) {
    throw new Error('No refresh token available');
  }

  try {
    const tokenParams = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: profile.refresh_token
    });

    const tokenResp = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString()
    });

    if (!tokenResp.ok) {
      const txt = await tokenResp.text();
      throw new Error(`Token refresh failed: ${tokenResp.status} ${txt}`);
    }

    const tokenData = await tokenResp.json();
    const expiresAt = tokenData.expires_in ? Math.floor(Date.now() / 1000) + Number(tokenData.expires_in) : null;

    // Update user with new tokens
    saveOrUpdateUser({
      twitch_user_id: profile.twitch_user_id,
      display_name: profile.display_name,
      login: profile.login,
      profile_image_url: profile.profile_image_url,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || profile.refresh_token,
      scope: tokenData.scope || profile.scope,
      expires_at: expiresAt
    });

    return {
      ...profile,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || profile.refresh_token,
      expires_at: expiresAt
    };
  } catch (error) {
    logLine(`[bot] token refresh error: ${error.message}`);
    throw error;
  }
}

async function ensureBotFor(uid) {
  let profile = getUserByTwitchId(uid);
  if (!profile) throw new Error('User not found in DB');

  // Check if token is expired and refresh if needed
  if (profile.expires_at && Date.now() / 1000 > profile.expires_at) {
    logLine(`[bot] Token expired for user ${uid}, refreshing...`);
    try {
      profile = await refreshToken(profile);
    } catch (error) {
      throw new Error(`Token refresh failed: ${error.message}`);
    }
  }

  if (tmiClient && botForUser === uid) {
    logLine(`[bot] Already connected for user ${uid}`);
    return { profile, client: tmiClient };
  }

  if (tmiClient) { 
    logLine(`[bot] Disconnecting previous client for user ${botForUser}`);
    try { await tmiClient.disconnect(); } catch(_) {} 
    tmiClient = null; 
    botForUser = null;
    botReady = false;
  }

  const client = new tmi.Client({
    options: { debug: false },
    connection: { secure: true, reconnect: true },
    identity: { username: profile.login, password: `oauth:${profile.access_token}` },
    channels: [ profile.login ]
  });

  client.on('connected', (addr, port) => {
    logLine(`[bot] connected to ${addr}:${port} → #${profile.login}`);
    botReady = true; // Bot is ready to process commands
    
    // Загружаем настройки тайминга из БД
    try {
      const { getAvatarTimeoutSeconds } = require('../db');
      const dbTimeout = getAvatarTimeoutSeconds(uid);
      if (dbTimeout && dbTimeout !== avatarTimeoutSeconds) {
        avatarTimeoutSeconds = dbTimeout;
        logLine(`[bot] Loaded avatar timeout from DB: ${dbTimeout} seconds`);
      }
    } catch (error) {
      logLine(`[bot] Error loading timeout from DB: ${error.message}`);
    }
    
    startAvatarTimeoutChecker(); // Запускаем проверку неактивных аватаров
    
    // Подписываемся на события bus для отслеживания аватаров из донатов
    const { on } = require('../lib/bus');
    on('avatar:show', (data) => {
      if (data.streamerId === uid && data.twitchUserId) {
        logLine(`[bot] Avatar shown via donation for user ${data.twitchUserId}`);
        updateAvatarActivity(data.twitchUserId);
      }
    });
  });
  client.on('disconnected', (reason) => {
    logLine(`[bot] disconnected: ${reason}`);
    botReady = false; // Bot is not ready
  });
  client.on('notice', (channel, msgid, message) => {
    if (msgid === 'login_unrecognized') {
      logLine(`[bot] authentication failed: ${message}`);
      throw new Error('Login authentication failed');
    }
  });
  client.on('message', (channel, tags, message, self) => {
    logLine(`[chat] ${channel} ${tags['display-name'] || tags.username}: ${message}`);
    logLine(`[bot] Client object in message handler:`, typeof client, client ? 'exists' : 'null');
    if (self) return;
    
    // Check if bot is ready to process commands
    if (!botReady) {
      logLine(`[bot] Ignoring command "${message}" - bot not ready yet`);
      return;
    }
    
    const text = message.trim().toLowerCase();
    const userId = tags['user-id'];
    const displayName = tags['display-name'] || tags.username;
    const color = tags['color'] || null;
    const isStreamer = tags['badges'] && (tags['badges'].broadcaster || tags['badges'].moderator);
    
    // Обновляем активность аватара при любом сообщении
    updateAvatarActivity(userId);
    
    if (text === '!ping') {
      client.say(channel, 'pong').catch(err => logLine(`[bot] say error: ${err.message}`));
      return;
    }

    if (text === '!start') {
      logLine(`[bot] !start command from ${displayName} (${userId}), botReady: ${botReady}, botForUser: ${botForUser}`);
      
      // Check if bot is ready
      if (!botReady) {
        logLine(`[bot] Bot not ready, ignoring !start command from ${displayName}`);
        return;
      }
      
      // Ensure user exists in database first
      let user = getUserByTwitchId(userId);
      if (!user) {
        // Create user record for chat user
        const userData = {
          twitch_user_id: userId,
          display_name: displayName,
          login: displayName.toLowerCase().replace(/\s+/g, ''), // Generate login from display name
          profile_image_url: null,
          access_token: 'chat_user', // Placeholder for chat users
          refresh_token: null,
          scope: null,
          expires_at: null
        };
        saveOrUpdateUser(userData);
        logLine(`[bot] Created user record for ${displayName} (${userId})`);
      }
      
      // Load or create default avatar
      let avatarData = getAvatarByTwitchId(userId);
      if (!avatarData) {
        try {
          // Create default avatar for new user
          avatarData = {
            body_skin: 'body_skin_1',
            face_skin: 'face_skin_1', 
            clothes_type: 'clothes_type_1',
            others_type: 'others_1'
          };
          saveOrUpdateAvatar(userId, avatarData);
          logLine(`[bot] Created avatar for ${displayName} (${userId})`);
        } catch (error) {
          logLine(`[bot] Error creating avatar for ${displayName}: ${error.message}`);
          // Use default avatar data even if save failed
          avatarData = {
            body_skin: 'body_skin_1',
            face_skin: 'face_skin_1', 
            clothes_type: 'clothes_type_1',
            others_type: 'others_1'
          };
        }
      }
      
      // Add user to streamer's chat list
      if (botForUser) {
        try {
          const success = addUserToStreamer(userId, botForUser);
          logLine(`[bot] Added user ${userId} to streamer ${botForUser}: ${success ? 'success' : 'failed'}`);
        } catch (error) {
          logLine(`[bot] Error adding user to streamer: ${error.message}`);
        }
      } else {
        logLine(`[bot] Warning: botForUser is null, cannot add user ${userId} to streamer list`);
      }
      
      // Fire overlay spawn event with avatar data
      const globalSubscriberCount = getSubscriberCount();
      const streamerSubscriberCount = botForUser ? getStreamerSubscriberCount(botForUser) : 0;
      logLine(`[bot] About to emit spawn event for ${displayName} (${userId}), global subscribers: ${globalSubscriberCount}, streamer subscribers: ${streamerSubscriberCount}`);
      
      const spawnData = {
        userId,
        displayName,
        color,
        avatarData,
        ts: Date.now()
      };
      
      // Emit avatar:show event for better handling
      if (botForUser) {
        emitToStreamer(botForUser, 'avatar:show', {
          streamerId: botForUser,
          twitchUserId: userId,
          displayName: displayName,
          color: color,
          avatarData,
          source: 'twitch_chat'
        });
        
        logLine(`[bot] Emitted avatar:show event to streamer ${botForUser}`);
      } else {
        // на всякий случай оставим глобал только для старого дебага
        emit('avatar:show', { twitchUserId: userId, displayName: displayName, color: color, avatarData, source: 'twitch_chat' });
        logLine(`[bot] Warning: botForUser is null, emitted to global channel`);
      }
      
      activeAvatars.add(userId);
      logLine(`[overlay] spawn requested by ${displayName} (${userId})`);
      return;
    }

    // Race command - only for streamer (temporarily disabled for testing)
    if (text === '!race') {
      // Check if race is already active
      if (raceState.isActive && !raceState.raceFinished) {
        client.say(channel, '🏁 Гонка уже идет! Дождитесь завершения.').catch(err => logLine(`[bot] say error: ${err.message}`));
        return;
      }
      // Temporarily allow all users to start race for testing
      startRace(client, channel);
      return;
    }



    // Check for race participation
    if (text === '+' && raceState.isActive && !raceState.raceStarted) {
      joinRace(userId, displayName, client, channel);
      return;
    }

    // Check for race cheering (mentions during race)
    if (raceState.isActive && raceState.raceStarted && !raceState.raceFinished) {
      checkRaceCheering(text, client, channel);
    }

    // Check for food game registration
    if (text === '+' && foodGameState.isActive && !foodGameState.gameStarted) {
      joinFoodGame(userId, displayName, client, channel);
      return;
    }

    // Check for food game commands
    if (foodGameState.isActive && foodGameState.gameStarted && !foodGameState.gameFinished) {
      checkFoodGameCommand(text, userId, displayName, client, channel);
      checkFoodGameCheering(text, client, channel);
    }

    // Race plan command
    if (text === '!race-plan') {
      logLine(`[bot] Race plan command received from ${displayName} in channel ${channel}`);
      logLine(`[bot] Client object in race-plan handler:`, typeof client, client ? 'exists' : 'null');
      logLine(`[bot] client.say available:`, !!(client && client.say));
      
      // Check if race plan is already active
      if (racePlanState.isActive && !racePlanState.gameFinished) {
        logLine(`[bot] Race plan already active, sending message to channel`);
        if (client && client.say) {
          client.say(channel, '✈️ Гонка на самолетах уже идет! Дождитесь завершения.').catch(err => {
            logLine(`[bot] say error: ${err.message}`);
            logLine(`[bot] Full error: ${JSON.stringify(err)}`);
          });
        } else {
          logLine(`[bot] ERROR: Cannot send message - client not available`);
        }
        return;
      }
      logLine(`[bot] Starting race plan...`);
      startRacePlan(client, channel);
      return;
    }

    // Check for race plan registration
    if (text === '+' && racePlanState.isActive && !racePlanState.gameStarted) {
      joinRacePlan(userId, displayName, client, channel);
      return;
    }

    // Check for race plan commands
    if (racePlanState.isActive && racePlanState.gameStarted && !racePlanState.gameFinished) {
      checkRacePlanCommand(text, userId, displayName, client, channel);
      checkRacePlanCheering(text, client, channel);
    }


    // смена полосы
    if (Game.isActive && !Game.gameFinished) {
      logLine(`[bot] Lane change command "${text}" from user ${userId}, Game.isActive: ${Game.isActive}, Game.gameFinished: ${Game.gameFinished}`);
      if (UP_WORDS.has(text)) {
        let p = Game.players.get(userId);
        if (!p) {
          p = { lane: 1, x: 50, width: 72, lives: 3, out: false, prevX: 50 };
          Game.players.set(userId, p);
        }
        const oldLane = p.lane ?? 1;
        p.lane = clampLane(oldLane - 1);
        emitLevelUpdate(userId, p.lane, client, channel); // ← ключевая строка
        logLine(`[bot] Player ${userId} moved from lane ${oldLane} to lane ${p.lane} (up)`);
        return;
      }
      if (DOWN_WORDS.has(text)) {
        let p = Game.players.get(userId);
        if (!p) {
          p = { lane: 1, x: 50, width: 72, lives: 3, out: false, prevX: 50 };
          Game.players.set(userId, p);
        }
        const oldLane = p.lane ?? 1;
        p.lane = clampLane(oldLane + 1);
        emitLevelUpdate(userId, p.lane, client, channel); // ← ключевая строка
        logLine(`[bot] Player ${userId} moved from lane ${oldLane} to lane ${p.lane} (down)`);
        return;
      }
    }

    // Если пользователь не активен в памяти — попробуем «лениво» восстановить
    if (!activeAvatars.has(userId)) {
      const avatarData = getAvatarByTwitchId(userId);
      if (avatarData) {
        // вернуть в активные и сразу же заспавнить на оверлее
        addActiveAvatar(userId);
        emitOverlay('spawn', {
          userId,
          displayName,
          color,
          avatarData,
          ts: Date.now()
        }, channel);
      } else {
        // у пользователя нет аватара в БД — ничего не делаем
        return;
      }
    }

    // Приветствия: распознаём разумный набор, игнорируем пунктуацию в начале
    function isGreeting(s) {
      const t = String(s || '').toLowerCase().replace(/[.,!?:;()\[\]{}'"`«»]+/g, ' ').trim();
      // примеры: "привет", "привет всем", "здарова", "добрый вечер",
      // "hi", "hello there", "hey", "yo", "good morning", "howdy", "greetings"
      
      // Простые русские приветствия
      const russianGreetings = /^(привет(ик|ствую)?|здравствуй(те)?|здар(ова|овa|ов)|салют|хай|ку|добр(ое утро|ый день|ый вечер))/;
      // Английские приветствия
      const englishGreetings = /^(hi|hello|hey|yo|good (morning|afternoon|evening)|howdy|greetings)\b/;
      
      const russianOk = russianGreetings.test(t);
      const englishOk = englishGreetings.test(t);
      const ok = russianOk || englishOk;
      
      logLine(`[debug] isGreeting("${s}") → "${t}" → russian: ${russianOk}, english: ${englishOk}, final: ${ok}`);
      return ok;
    }
    
    // Проверяем приветствие
    const isGreetingResult = isGreeting(message);
    logLine(`[debug] Greeting check for "${message}": ${isGreetingResult}`);
    
    if (isGreetingResult) {
      emitOverlay('hi', { userId }, channel);
      logLine(`[overlay] hi requested by ${displayName} (${userId}) for: "${message}"`);
      return; // только анимация hi, без движения
    }

    // Смех: Unicode-регэксп с явными разделителями до/после ИЛИ концом строки
    // Покрывает: lol/lmao/rofl/kek/кек/ахаха/ахааа/хааа/хехе/хи-хи/хо-хо/ржу/орууу и варианты со знаками
    function isLaughing(s) {
      const t = String(s || '').toLowerCase().trim();
      
      // Простые слова смеха (точное совпадение)
      const simpleLaugh = /^(лол|лул|кек|ржу|lol|lmao|rofl|kek)$/;
      
      // Смех по первым буквам (независимо от длины)
      // ахах, ахахах, ахахахах - начинается с "ах"
      // хах, хахах, хахахах - начинается с "ха" 
      // хех, хехех, хехехех - начинается с "хе"
      // хих, хихих, хихихих - начинается с "хи"
      // хох, хохох, хохохох - начинается с "хо"
      // ор, орр, орру, оррууу - начинается с "ор"
      // ха, хаха, хахаха - начинается с "ха"
      const patternLaugh = /(^|[\s.,!?…:;()"'«»\-\[\]\\\/])(ах[ах]*|ха[ха]*|хе[хе]*|хи[хи]*|хо[хо]*|ор[ру]*|haha+|hehe+|hoho+)(?=$|[\s.,!?…:;()"'«»\-\[\]\\\/])/u;
      
      const simpleOk = simpleLaugh.test(t);
      const patternOk = patternLaugh.test(t);
      const ok = simpleOk || patternOk;
      
      logLine(`[debug] isLaughing("${s}") → "${t}" → simple: ${simpleOk}, pattern: ${patternOk}, final: ${ok}`);
      return ok;
    }
    
    // Вопросы: определяем по наличию знака вопроса в сообщении
    function isQuestion(s) {
      const t = String(s || '').trim();
      const hasQuestionMark = t.includes('?');
      
      logLine(`[debug] isQuestion("${s}") → "${t}" → hasQuestionMark: ${hasQuestionMark}`);
      return hasQuestionMark;
    }
    
    if (isLaughing(message)) {
      emitOverlay('laugh', { userId }, channel);
      logLine(`[overlay] laugh requested by ${displayName} (${userId}) for: "${message}"`);
      return; // только анимация laugh, без движения
    }
    
    // Проверяем вопрос
    const isQuestionResult = isQuestion(message);
    logLine(`[debug] Question check for "${message}": ${isQuestionResult}`);
    
    if (isQuestionResult) {
      emitOverlay('question', { userId }, channel);
      logLine(`[overlay] question requested by ${displayName} (${userId}) for: "${message}"`);
      return; // только анимация question, без движения
    }
    
    // 1) Эмоты Twitch приходят в tags.emotes как диапазоны "start-end"
    const emoteMap = tags?.emotes || {};
    const hasTwitchEmotes = Object.keys(emoteMap).length > 0;

    // Считаем, покрывают ли эмоты всё содержимое (игнорируя пробелы)
    const noSpaces = message.replace(/\s+/g, '');
    let emoteChars = 0;
    for (const ranges of Object.values(emoteMap)) {
      for (const range of ranges) {
        const [s, e] = range.split('-').map(Number);
        emoteChars += (e - s + 1);
      }
    }
    const emoteOnly = hasTwitchEmotes && emoteChars === noSpaces.length;

    // 2) Поддержка «чистых» Unicode-эмодзи (если Twitch их не пометил как emotes)
    const unicodeEmojiOnly =
      !hasTwitchEmotes &&
      /^[\p{Extended_Pictographic}\uFE0F\u200D\s]+$/u.test(message) &&
      /[\p{Extended_Pictographic}]/u.test(message);

    if (emoteOnly || unicodeEmojiOnly) {
      // Функция для извлечения URL первого эмодзи
      function extractFirstEmojiUrl(message, tags) {
        const emoteMap = (tags && (tags.emotes || tags['emotes'])) || {};
        if (Object.keys(emoteMap).length > 0) {
          const firstId = Object.keys(emoteMap)[0]; // ← ID смайлика
          // Twitch CDN: варианты размеров 1.0 / 2.0 / 3.0
          return `https://static-cdn.jtvnw.net/emoticons/v2/${firstId}/default/dark/3.0`;
        }
        // если это юникод-эмодзи, просто возвращаем сам символ
        return message.trim() || '🙂';
      }
      
      const emoji = extractFirstEmojiUrl(message, tags);
      console.log(`[bot] Emoji detected: "${emoji}" for user ${displayName}`);
      emitOverlay('emoji', { userId, emoji }, channel);
      return; // критично: НЕ отправляем move
    }
    
    // No emotes found - normal movement
    const messageLength = message.length;
    const moveDistance = Math.min(messageLength * 8, 200); // Max 200px movement
    const direction = Math.random() > 0.5 ? 1 : -1; // Random left/right
    
    logLine(`[overlay] move requested by ${displayName} (${userId}) for message: "${message}" - distance: ${moveDistance * direction}`);
    emitOverlay('move', {
      userId,
      distance: moveDistance * direction,
      messageLength
    }, channel);
  });

  try {
    await client.connect();
    tmiClient = client;
    botForUser = profile.twitch_user_id; // ID стримера для связи с пользователями
    return { profile, client };
  } catch (error) {
    logLine(`[bot] connection failed: ${error.message}`);
    throw error;
  }
}

async function stopBot() {
  if (!tmiClient) return false;
  await tmiClient.disconnect();
  tmiClient = null; 
  botForUser = null;
  botReady = false;
  activeAvatars.clear();
  logLine('[bot] stopped');
  return true;
}

function status() {
  return { 
    running: Boolean(tmiClient), 
    for_user: botForUser || null,
    activeAvatars: Array.from(activeAvatars)
  };
}

// Функция для добавления аватара в активный список (для донатов)
function addActiveAvatar(userId) {
  activeAvatars.add(userId);
  logLine(`[bot] Added avatar ${userId} to active list`);
}

// Функция для удаления аватара из активного списка
function removeActiveAvatar(userId) {
  activeAvatars.delete(userId);
  logLine(`[bot] Removed avatar ${userId} from active list`);
}

function getBotClient() {
  return tmiClient;
}

// Race game functions
function startRace(client, channel, settings = {}) {
  const { minParticipants = 1, maxParticipants = 10, registrationTime = 10 } = settings;
  
  logLine(`[bot] Starting race in channel: ${channel} with settings:`, settings);
  
  // Prevent multiple race starts
  if (raceState.isActive && !raceState.raceFinished) {
    logLine(`[bot] Race already active, ignoring start request`);
    return;
  }
  
  // Allow starting new race even if one is active (reset previous race)
  if (raceState.isActive) {
    logLine(`[bot] Resetting previous race state`);
    // Reset race state
    raceState.isActive = false;
    raceState.participants.clear();
    raceState.participantNames.clear();
    raceState.positions.clear();
    raceState.speeds.clear();
    raceState.modifiers.clear();
    raceState.speedModifiers.clear();
    raceState.winner = null;
    raceState.raceStarted = false;
    raceState.raceFinished = false;
    raceState.startTime = null;
    raceState.countdown = 0;
  }

  // Set race state
  raceState.isActive = true;
  raceState.countdown = 0;
  raceState.raceStarted = false;
  raceState.raceFinished = false;
  raceState.winner = null;
  raceState.startTime = null;
  raceState.minParticipants = minParticipants;
  raceState.maxParticipants = maxParticipants;

  // Announce race with settings
  client.say(channel, `🏁 Кто хочет участвовать в гонке, отправьте + в чат! У вас есть ${registrationTime} секунд! (${minParticipants}-${maxParticipants} участников)`).catch(err => logLine(`[bot] say error: ${err.message}`));
  logLine(`[bot] Race announced in channel: ${channel}`);
  
  // Start registration timer
  setTimeout(() => {
    if (raceState.participants.size < minParticipants) {
      client.say(channel, `⏰ Время вышло! Недостаточно участников (${raceState.participants.size}/${minParticipants}). Гонка отменена.`).catch(err => logLine(`[bot] say error: ${err.message}`));
      raceState.isActive = false;
      return;
    }
    
    // Limit participants if too many joined
    if (raceState.participants.size > maxParticipants) {
      const participantsArray = Array.from(raceState.participants);
      const selectedParticipants = participantsArray.slice(0, maxParticipants);
      
      // Reset participants to only selected ones
      raceState.participants.clear();
      raceState.participantNames.clear();
      
      selectedParticipants.forEach(participantId => {
        raceState.participants.add(participantId);
        // Note: We'd need to store participant names separately to show them here
      });
      
      client.say(channel, `🎯 Слишком много участников! Выбраны первые ${maxParticipants} участников.`).catch(err => logLine(`[bot] say error: ${err.message}`));
    }
    
    startRaceCountdown(client, channel);
  }, registrationTime * 1000);
}

function joinRace(userId, displayName, client, channel) {
  if (raceState.participants.has(userId)) {
    return; // Already joined
  }

  if (raceState.participants.size >= raceState.maxParticipants) {
    client.say(channel, `@${displayName} Гонка уже заполнена! Максимум ${raceState.maxParticipants} участников.`).catch(err => logLine(`[bot] say error: ${err.message}`));
    return;
  }

  raceState.participants.add(userId);
  raceState.participantNames.set(userId, displayName);
  client.say(channel, `@${displayName} присоединился к гонке! (${raceState.participants.size}/${raceState.maxParticipants})`).catch(err => logLine(`[bot] say error: ${err.message}`));

  // If we have enough participants, start immediately
  if (raceState.participants.size >= raceState.maxParticipants) {
    setTimeout(() => startRaceCountdown(client, channel), 1000);
  }
}

function startRaceCountdown(client, channel) {
  if (!raceState.isActive) return;

  raceState.raceStarted = true;
  raceState.startTime = Date.now();

  // Emit race start event to overlay
  const raceStartData = {
    participants: Array.from(raceState.participants),
    countdown: 3
  };
  logLine(`[bot] Emitting raceStart event: ${JSON.stringify(raceStartData)}`);
  emitOverlay('raceStart', raceStartData, channel);

  // Countdown
  let count = 3;
  const countdownInterval = setInterval(() => {
    if (count > 0) {
      client.say(channel, `🏁 ${count}...`).catch(err => logLine(`[bot] say error: ${err.message}`));
      count--;
    } else {
      clearInterval(countdownInterval);
      client.say(channel, '🏁 ГОНКА НАЧАЛАСЬ! Бегите к финишу!').catch(err => logLine(`[bot] say error: ${err.message}`));
      
      // Start race monitoring
      startRaceMonitoring(client, channel);
    }
  }, 1000);
}

function startRaceMonitoring(client, channel) {
  // Emit race monitoring start
  emitOverlay('raceMonitoring', {
    participants: Array.from(raceState.participants),
    speedModifiers: Object.fromEntries(raceState.speedModifiers)
  }, channel);
}

function checkRaceCheering(text, client, channel) {
  // Check if message mentions any race participant
  const participants = Array.from(raceState.participants);
  
  for (const participantId of participants) {
    // This is a simplified check - in real implementation you'd need to get display names
    // and check if they're mentioned in the message
    if (text.toLowerCase().includes('@') || text.includes('cheer') || text.includes('go')) {
      // Add speed modifier
      const currentModifier = raceState.speedModifiers.get(participantId) || 0;
      raceState.speedModifiers.set(participantId, currentModifier + 0.05); // 5% speed boost per cheer (уменьшено в 2 раза)
      
      // Emit speed update
      emitOverlay('raceSpeedUpdate', {
        participantId: participantId,
        speedModifier: raceState.speedModifiers.get(participantId)
      }, channel);
      
      client.say(channel, `💨 Участник получил ускорение!`).catch(err => logLine(`[bot] say error: ${err.message}`));
      break;
    }
  }
}

function joinFoodGame(userId, displayName, client, channel) {
  if (foodGameState.participants.has(userId)) {
    client.say(channel, `@${displayName} вы уже участвуете в игре!`).catch(err => logLine(`[bot] say error: ${err.message}`));
    return;
  }

  foodGameState.participants.add(userId);
  foodGameState.participantNames.set(userId, displayName);
  foodGameState.scores.set(userId, 0);
  foodGameState.directions.set(userId, 1); // Start moving right
  foodGameState.speedModifiers.set(userId, 0); // No speed modifier initially

  const participantCount = foodGameState.participants.size;
  client.say(channel, `🥕 @${displayName} присоединился к игре! Участников: ${participantCount}`).catch(err => logLine(`[bot] say error: ${err.message}`));
  logLine(`[bot] User ${displayName} (${userId}) joined food game. Total participants: ${participantCount}`);
}

function finishRace(winnerId, client, channel) {
  if (raceState.raceFinished) return;
  
  raceState.raceFinished = true;
  raceState.winner = winnerId;
  
  // Get winner's display name from participants
  const winnerName = raceState.participantNames.get(winnerId) || winnerId;
  
  // Emit race finish
  emitOverlay('raceFinish', {
    winner: winnerId,
    participants: Array.from(raceState.participants)
  }, channel);
  
  client.say(
    normalizeChannel(channel),
    `🏆 Гонка завершена! Поздравляем победителя @${winnerName}!`
  ).catch(err => logLine(`[bot] say error: ${err.message}`));
  
  // Reset race state after 5 seconds
  setTimeout(() => {
    raceState.isActive = false;
    raceState.participants.clear();
    raceState.participantNames.clear();
    raceState.speedModifiers.clear();
    raceState.raceStarted = false;
    raceState.raceFinished = false;
    raceState.winner = null;
  }, 5000);
}

function getBotClient() {
  return tmiClient;
}

function getBotChannel() {
  logLine(`[bot] getBotChannel: botForUser=${botForUser}`);
  if (!botForUser) {
    logLine(`[bot] getBotChannel: no botForUser, returning null`);
    return null;
  }
  
  // botForUser is twitch_user_id, we need to get the login
  // For now, we'll use a simple approach - get the login from the profile
  // This is a temporary fix - ideally we should store the login separately
  const { getUserByTwitchId } = require('../db');
  const profile = getUserByTwitchId(botForUser);
  logLine(`[bot] getBotChannel: profile=${profile ? 'found' : 'not found'}, login=${profile?.login}`);
  if (profile && profile.login) {
    const channel = normalizeChannel(profile.login);
    logLine(`[bot] getBotChannel: returning channel=${channel}`);
    return channel;
  }
  
  logLine(`[bot] getBotChannel: no profile or login, returning null`);
  return null;
}

// Состояние игры "Собери еду"
const foodGameState = {
  isActive: false,
  participants: new Set(),
  participantNames: new Map(),
  scores: new Map(), // userId -> score
  directions: new Map(), // userId -> direction (1 = right, -1 = left)
  speedModifiers: new Map(), // userId -> speed modifier
  carrots: [], // Массив падающих морковок
  gameStarted: false,
  gameFinished: false,
  startTime: null,
  winner: null
};


// === Константы команд ===
const UP_WORDS  = new Set(['верх','вверх','up','u','w','↑']);
const DOWN_WORDS= new Set(['низ','вниз','down','d','s','↓']);

// === Константы для препятствий ===
const LANES = [0,1,2]; // 0=верх, 1=центр, 2=низ
const OBSTACLE_TYPES = ['bird', 'plane', 'rock'];

function randInt(min, max) { 
  return min + Math.floor(Math.random() * (max - min + 1)); 
}

function sweptPass(prevX, currX, c2, halfSum) {
  // пересёк ли отрезок [prevX, currX] горизонтальный интервал [c2 - halfSum, c2 + halfSum]
  const minX = Math.min(prevX, currX);
  const maxX = Math.max(prevX, currX);
  return !(maxX < c2 - halfSum || minX > c2 + halfSum);
}

// Метрики хитбокса аватаров (половины размеров, поступают с клиента)
const AvatarMetrics = new Map(); // userId -> { halfW, halfH }

// Пример структуры состояния
const Game = {
  isActive: false,     // true со старта отсчёта и до конца гонки на самолетах
  gameFinished: false,
  players: new Map(),  // id -> { lane:1, lives:3, out:false, ... }
  obstacles: [],       // [{ id, lane, x, speed, width, hit, type }]
  lanes: [0,1,2],
  maxLives: 3,
};

// Вспомогательно
function clampLane(l) { return Math.max(0, Math.min(2, l|0)); }

function setAvatarMetrics(userId, halfW, halfH) {
  AvatarMetrics.set(userId, { halfW, halfH });
}
function emitLevelUpdate(userId, level, client, channel) {
  // на всякий случай синхронизируем server state
  racePlanState.levels.set(userId, level);
  emitOverlay('racePlanLevelUpdate', { userId, level }, channel);
}

function spawnGameObstacle(channel) {
  if (!Game.isActive || Game.gameFinished) return;
  
  const id = `obs_${Date.now()}_${Math.random().toString(16).slice(2,6)}`;
  const lane = LANES[randInt(0, 2)]; // случайная дорожка
  const speed = randInt(6, 10); // пикс/тик
  const xStart = 1200; // стартовое X справа за экраном
  const width = 80; // для хитбокса
  const type = OBSTACLE_TYPES[randInt(0, OBSTACLE_TYPES.length - 1)];

  const obs = { id, lane, x: xStart, speed, width, hit: false, type };
  Game.obstacles.push(obs);

  logLine(`[bot] Spawning obstacle ${id} in lane ${lane} (type: ${type})`);
  
  // говорим оверлею создать DOM-элемент, lane передаём обязательно
  emitOverlay('racePlanObstacleSpawn', { id, lane, x: xStart, type }, channel);
}



function serverTick() {
  logLine(`[bot] serverTick called: Game.isActive=${Game.isActive}, Game.gameFinished=${Game.gameFinished}`);
  if (!Game.isActive || Game.gameFinished) {
    logLine(`[bot] serverTick early return due to flags`);
    return;
  }
  
  const now = Date.now();
  const dt = Math.min(200, now - (serverTick.lastTs || now)); // защита от лагов
  serverTick.lastTs = now;

  logLine(`[bot] serverTick: dt=${dt}ms, players=${Game.players.size}, obstacles=${Game.obstacles.length}`);

  // Константы движения
  const AVATAR_SPEED = 20; // px/сек (уменьшено в 4 раза)
  const OBSTACLE_SPEED = 180; // px/сек
  
  // Двигаем всех игроков
  Game.players.forEach((p, id) => {
    if (p.out || p.lives <= 0) return;
    p.prevX = p.x; // сохраняем предыдущую позицию для swept-test
    p.x += AVATAR_SPEED * (dt / 1000); // движение вправо
    logLine(`[bot] Player ${id} moved: x=${p.x.toFixed(1)}`);
  });

  // Спавним препятствия
  maybeSpawnObstacle(now);

  // Двигаем препятствия
  Game.obstacles.forEach(o => {
    o.x -= OBSTACLE_SPEED * (dt / 1000); // движение влево
  });

  // Проверяем коллизии
  handleGameCollisions();
  
  // Проверяем финишную линию
  checkFinishLine();
  
  // Удаляем препятствия за экраном
  Game.obstacles = Game.obstacles.filter(o => o.x + (o.width ?? 80) > 0);
  
  // Рассылаем состояние
  broadcastState();
}

function checkFinishLine() {
  if (Game.gameFinished) return; // Игра уже завершена
  
  // Используем динамическую ширину трека, обновляемую с клиента
  const FINISH_LINE = racePlanState.trackWidth - 50; // Правая граница минус отступ
  
  // Проверяем, есть ли живые игроки
  let alivePlayers = 0;
  let winner = null;
  let maxX = 0;
  
  Game.players.forEach((p, id) => {
    if (p.out || p.lives <= 0) return; // Пропускаем выбывших игроков
    
    alivePlayers++;
    
    // Проверяем пересечение правого края аватара с финишной линией
    const avatarWidth = 40; // примерная ширина аватара
    if (p.x + avatarWidth >= FINISH_LINE) {
      if (!winner || p.x > maxX) {
        winner = id;
        maxX = p.x;
      }
    }
  });
  
  // Если нет живых игроков - игра заканчивается без победителя
  if (alivePlayers === 0) {
    Game.gameFinished = true;
    Game.isActive = false;
    
    logLine(`[bot] Game finished! No winners - all players died`);
    
    // Отправляем событие завершения игры без победителя
    emitOverlay('racePlanEnd', {
      winner: null,
      winnerName: null,
      noWinners: true,
      finalLives: Object.fromEntries(racePlanState.lives)
    }, getBotChannel());
    
    // Объявляем в чате что победителей нет
    const client = getBotClient();
    const channel = getBotChannel();
    if (client && channel) {
      client.say(channel, `💀 Гонка завершена! Победителей нет - все игроки выбыли!`).catch(err => logLine(`[bot] say error: ${err.message}`));
    }
    
    // Очищаем состояние через 5 секунд
    setTimeout(() => {
      resetGameState();
    }, 5000);
    return;
  }
  
  // Если есть победитель (достиг финишной линии)
  if (winner) {
    // Игра завершена!
    Game.gameFinished = true;
    Game.isActive = false;
    
    // Получаем имя победителя
    const winnerName = racePlanState.participantNames.get(winner) || 'Unknown';
    
    logLine(`[bot] Game finished! Winner: ${winnerName} (${winner}) at x:${maxX.toFixed(1)}`);
    
    // Отправляем событие завершения игры
    emitOverlay('racePlanEnd', {
      winner: winner,
      winnerName: winnerName,
      noWinners: false,
      finalLives: Object.fromEntries(racePlanState.lives)
    }, getBotChannel());
    
    // Объявляем победителя в чате
    const client = getBotClient();
    const channel = getBotChannel();
    if (client && channel) {
      client.say(channel, `🏆 Гонка завершена! Победитель: @${winnerName}!`).catch(err => logLine(`[bot] say error: ${err.message}`));
    }
    
    // Очищаем состояние через 5 секунд
    setTimeout(() => {
      resetGameState();
    }, 5000);
  }
}

function resetGameState() {
  // Сбрасываем состояние игры
  Game.isActive = false;
  Game.gameFinished = false;
  Game.players.clear();
  Game.obstacles = [];
  
  // Сбрасываем состояние гонки на самолетах
  racePlanState.isActive = false;
  racePlanState.gameFinished = true;
  racePlanState.participants.clear();
  racePlanState.participantNames.clear();
  racePlanState.positions.clear();
  racePlanState.levels.clear();
  racePlanState.lives.clear();
  racePlanState.obstacles = [];
  racePlanState.winner = null;
  
  logLine(`[bot] Game state reset after finish`);
}

function maybeSpawnObstacle(now) {
  if (!maybeSpawnObstacle.next) maybeSpawnObstacle.next = now;
  if (now < maybeSpawnObstacle.next) return;
  
  spawnGameObstacle(getBotChannel());
  maybeSpawnObstacle.next = now + 1600; // каждые ~1.6 сек (уменьшено в 2 раза)
}

function sweptOverlap1D(x0, x1, cx2, halfSum) {
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  return !(maxX < cx2 - halfSum || minX > cx2 + halfSum);
}

function handleGameCollisions() {
  const AVATAR_BASE_W = 72;     // как у тебя было
  const AVATAR_SCALE  = 0.4;    // как в overlay.css

  Game.players.forEach((p, id) => {
    if (p.out || p.lives <= 0) return;

    for (const o of Game.obstacles) {
      if (o.hitFor?.has(id)) continue;           // чтобы не бить дважды одним объектом
      if (p.lane !== o.lane) continue;           // по вертикали — lane-only

      // Используем метрики хитбокса игрока или масштабируем базовую ширину
      const pHalf = Number.isFinite(p.halfW) ? p.halfW : ((p.width ?? AVATAR_BASE_W) * AVATAR_SCALE) / 2;
      const obstacleHalf = Number.isFinite(o.width) ? o.width/2 : 40;
      const halfSum = pHalf + obstacleHalf;

      // Используем swept-test для предотвращения пролета между тиками
      const hit = sweptOverlap1D(p.prevX ?? p.x, p.x, o.x, halfSum);
      if (!hit) continue;

      // столкновение
      logLine(`[bot] Collision detected: player ${id} at x:${p.x.toFixed(1)} with obstacle at x:${o.x.toFixed(1)} (pHalf:${pHalf}, oHalf:${obstacleHalf})`);
      p.lives = Math.max(0, (p.lives ?? 3) - 1);
      if (p.lives <= 0) p.out = true;

      if (!o.hitFor) o.hitFor = new Set();
      o.hitFor.add(id);

      // синхронизируем с racePlanState
      racePlanState.lives.set(id, p.lives);
      
      emitOverlay('racePlanCollision', { playerId: id, lives: p.lives }, getBotChannel());
      break;
    }
    
    // Сохраняем текущую позицию для следующего тика
    p.prevX = p.x;
  });

  // убрать с поля «сработавшие» препятствия (те, что столкнулись с игроками)
  const obstaclesToRemove = [];
  Game.obstacles = Game.obstacles.filter(o => {
    if (o.hitFor && o.hitFor.size > 0) {
      // Препятствие столкнулось с игроком - удаляем его
      obstaclesToRemove.push(o);
      return false; // удаляем из массива
    }
    return true; // оставляем в массиве
  });
  
  // Отправляем события удаления препятствий на клиент
  obstaclesToRemove.forEach(o => {
    emitOverlay('obstacleRemove', { id: o.id }, getBotChannel());
    logLine(`[bot] Removing obstacle ${o.id} after collision`);
    
    // Также удаляем из racePlanState.obstacles
    const index = racePlanState.obstacles.findIndex(obs => obs.id === o.id);
    if (index !== -1) {
      racePlanState.obstacles.splice(index, 1);
    }
  });
}

function broadcastState() {
  logLine(`[bot] === BROADCAST STATE ===`);
  logLine(`[bot] Game.players.size: ${Game.players.size}`);
  logLine(`[bot] Game.obstacles.length: ${Game.obstacles.length}`);
  
  const players = Array.from(Game.players.entries()).map(([id, p]) => ({
    id,
    lane: p.lane ?? 1,
    x: p.x ?? 50, // позиция по X с сервера
    lives: Math.max(0, p.lives ?? Game.maxLives),
    out: !!p.out,
  }));
  
  logLine(`[bot] Broadcasting state: ${players.length} players, Game.isActive: ${Game.isActive}`);
  
  if (players.length > 0) {
    logLine(`[bot] First player data:`, players[0]);
  }
  
  const stateData = {
    players,
    started: !!Game.isActive,
    finished: !!Game.gameFinished,
  };
  
  const botChannel = getBotChannel();
  logLine(`[bot] Emitting racePlanState:`, JSON.stringify(stateData));
  logLine(`[bot] Bot channel: ${botChannel}`);
  emitOverlay('racePlanState', stateData, botChannel);
  
  // Также отправляем батч препятствий
  const obstaclesData = Game.obstacles.map(o => ({ 
    id: o.id, 
    x: o.x, 
    lane: o.lane, 
    type: o.type 
  }));
  
  if (obstaclesData.length > 0) {
    logLine(`[bot] Emitting racePlanObstacleBatch:`, obstaclesData);
    emitOverlay('racePlanObstacleBatch', obstaclesData, getBotChannel());
  }
}

function startFoodGame(client, channel, settings = {}) {
  const { minParticipants = 1, maxParticipants = 10, registrationTime = 10 } = settings;
  
  logLine(`[bot] Starting food game in channel: ${channel} with settings:`, settings);
  
  // Prevent multiple game starts
  if (foodGameState.isActive && !foodGameState.gameFinished) {
    logLine(`[bot] Food game already active, ignoring start request`);
    return;
  }
  
  // Allow starting new game even if one is active (reset previous game)
  if (foodGameState.isActive) {
    logLine(`[bot] Resetting previous food game state`);
    // Reset game state
    foodGameState.isActive = false;
    foodGameState.participants.clear();
    foodGameState.participantNames.clear();
    foodGameState.scores.clear();
    foodGameState.directions.clear();
    foodGameState.speedModifiers.clear();
    foodGameState.carrots = [];
    foodGameState.winner = null;
    foodGameState.gameStarted = false;
    foodGameState.gameFinished = false;
    foodGameState.startTime = null;
  }

  // Set game state
  foodGameState.isActive = true;
  foodGameState.participants.clear();
  foodGameState.participantNames.clear();
  foodGameState.scores.clear();
  foodGameState.directions.clear();
  foodGameState.speedModifiers.clear();
  foodGameState.carrots = [];
  foodGameState.winner = null;
  foodGameState.gameStarted = false;
  foodGameState.gameFinished = false;
  foodGameState.startTime = null;

  // Announce game with settings
  client.say(channel, `🥕 Кто хочет участвовать в игре "Собери еду", отправьте + в чат! У вас есть ${registrationTime} секунд! (${minParticipants}-${maxParticipants} участников)`).catch(err => logLine(`[bot] say error: ${err.message}`));
  logLine(`[bot] Food game announced in channel: ${channel}`);
  
  // Start registration timer
  setTimeout(() => {
    if (foodGameState.participants.size < minParticipants) {
      client.say(channel, `⏰ Время вышло! Недостаточно участников (${foodGameState.participants.size}/${minParticipants}). Игра отменена.`).catch(err => logLine(`[bot] say error: ${err.message}`));
      foodGameState.isActive = false;
      return;
    }
    
    // Limit participants if too many joined
    if (foodGameState.participants.size > maxParticipants) {
      const participantsArray = Array.from(foodGameState.participants);
      const selectedParticipants = participantsArray.slice(0, maxParticipants);
      
      // Reset participants to only selected ones
      foodGameState.participants.clear();
      foodGameState.participantNames.clear();
      
      selectedParticipants.forEach(participantId => {
        foodGameState.participants.add(participantId);
      });
      
      client.say(channel, `🎯 Слишком много участников! Выбраны первые ${maxParticipants} участников.`).catch(err => logLine(`[bot] say error: ${err.message}`));
    }
    
    startFoodGameCountdown(client, channel);
  }, registrationTime * 1000);
}

function startFoodGameCountdown(client, channel) {
  if (!foodGameState.isActive) return;

  foodGameState.gameStarted = true;
  foodGameState.startTime = Date.now();

  // Initialize scores, directions and speed modifiers for all participants
  foodGameState.participants.forEach(participantId => {
    foodGameState.scores.set(participantId, 0);
    foodGameState.directions.set(participantId, 1); // Start moving right
    foodGameState.speedModifiers.set(participantId, 0); // No speed modifier initially
  });

  // Emit food game start event to overlay
  const foodGameStartData = {
    participants: Array.from(foodGameState.participants).map(participantId => ({
      userId: participantId,
      displayName: foodGameState.participantNames.get(participantId) || `Пользователь ${participantId}`
    })),
    countdown: 3
  };
  logLine(`[bot] Emitting foodGameStart event: ${JSON.stringify(foodGameStartData)}`);
  emitOverlay('foodGameStart', foodGameStartData, channel);

  // Countdown
  let count = 3;
  const countdownInterval = setInterval(() => {
    if (count > 0) {
      client.say(channel, `🥕 ${count}...`).catch(err => logLine(`[bot] say error: ${err.message}`));
      count--;
    } else {
      clearInterval(countdownInterval);
      client.say(channel, '🥕 ИГРА НАЧАЛАСЬ! Собирайте падающие морковки! Пишите "1" чтобы повернуть!').catch(err => logLine(`[bot] say error: ${err.message}`));
      
      // Start food game monitoring
      startFoodGameMonitoring(client, channel);
    }
  }, 1000);
}

function startFoodGameMonitoring(client, channel) {
  // Emit food game monitoring start
  emitOverlay('foodGameMonitoring', {
    participants: Array.from(foodGameState.participants).map(participantId => ({
      userId: participantId,
      displayName: foodGameState.participantNames.get(participantId) || `Пользователь ${participantId}`
    })),
    scores: Object.fromEntries(foodGameState.scores),
    directions: Object.fromEntries(foodGameState.directions),
    speedModifiers: Object.fromEntries(foodGameState.speedModifiers)
  }, channel);

  // Start carrot spawning
  const carrotInterval = setInterval(() => {
    if (!foodGameState.isActive || foodGameState.gameFinished) {
      clearInterval(carrotInterval);
      return;
    }
    spawnCarrot(channel);
  }, 2000); // Spawn carrot every 2 seconds

  // Start collision checking
  const collisionInterval = setInterval(() => {
    if (!foodGameState.isActive || foodGameState.gameFinished) {
      clearInterval(collisionInterval);
      return;
    }
    checkCarrotCollisions();
  }, 100); // Check collisions every 100ms
}

function checkFoodGameCommand(text, userId, displayName, client, channel) {
  if (!foodGameState.isActive || !foodGameState.gameStarted || foodGameState.gameFinished) return;
  
  // Check if user is a participant
  if (!foodGameState.participants.has(userId)) return;
  
  // Check for direction change command
  if (text.trim() === '1') {
    const currentDirection = foodGameState.directions.get(userId) || 1;
    const newDirection = -currentDirection; // Reverse direction
    
    foodGameState.directions.set(userId, newDirection);
    
    // Emit direction update
    emitOverlay('foodGameDirectionUpdate', {
      userId: userId,
      direction: newDirection
    }, channel);
    
    logLine(`[bot] User ${displayName} changed direction to ${newDirection > 0 ? 'right' : 'left'}`);
  }
}

function checkFoodGameCheering(text, client, channel) {
  if (!foodGameState.isActive || !foodGameState.gameStarted || foodGameState.gameFinished) return;
  
  // Check if message mentions any food game participant
  const participants = Array.from(foodGameState.participants);
  
  for (const participantId of participants) {
    const participantName = foodGameState.participantNames.get(participantId);
    if (!participantName) continue;
    
    // Check if participant is mentioned in the message
    const mentionPattern = new RegExp(`@?${participantName}`, 'i');
    if (mentionPattern.test(text) || text.toLowerCase().includes('cheer') || text.includes('go')) {
      // Add speed modifier
      const currentModifier = foodGameState.speedModifiers.get(participantId) || 0;
      const newModifier = Math.min(currentModifier + 0.05, 3.0); // Max 300% speed boost (уменьшено в 2 раза)
      foodGameState.speedModifiers.set(participantId, newModifier);
      
      // Emit speed update
      emitOverlay('foodGameSpeedUpdate', {
        userId: participantId,
        speedModifier: newModifier
      }, channel);
      
      client.say(channel, `💨 @${participantName} получил ускорение! Скорость: +${Math.round(newModifier * 100)}%`).catch(err => logLine(`[bot] say error: ${err.message}`));
      logLine(`[bot] User ${participantName} got speed boost: +${Math.round(newModifier * 100)}%`);
      break;
    }
  }
}

function spawnCarrot(channel) {
  if (!foodGameState.isActive || foodGameState.gameFinished) return;
  
  const carrot = {
    id: Date.now() + Math.random(),
    x: Math.random() * 1200, // Random X position (assuming 1200px width)
    y: -30, // Start above screen
    speed: 2 + Math.random() * 2, // Random fall speed
    collected: false
  };
  
  foodGameState.carrots.push(carrot);
  
  // Emit carrot spawn
  emitOverlay('carrotSpawn', carrot, channel);
  
  // Remove carrot after 15 seconds if not collected (10s falling + 3s on ground + 2s buffer)
  setTimeout(() => {
    const index = foodGameState.carrots.findIndex(c => c.id === carrot.id);
    if (index !== -1) {
      foodGameState.carrots.splice(index, 1);
      emitOverlay('carrotRemove', { id: carrot.id }, channel);
    }
  }, 15000);
}

function checkCarrotCollisions() {
  if (!foodGameState.isActive || foodGameState.gameFinished) return;
  
  foodGameState.participants.forEach(userId => {
    const score = foodGameState.scores.get(userId) || 0;
    if (score >= 10) {
      // Winner found!
      foodGameState.winner = userId;
      foodGameState.gameFinished = true;
      foodGameState.isActive = false;
      
      const winnerName = foodGameState.participantNames.get(userId) || 'Unknown';
      logLine(`[bot] Food game winner: ${winnerName} (${userId})`);
      
      // Emit game end
      emitOverlay('foodGameEnd', {
        winner: userId,
        winnerName: winnerName,
        finalScores: Object.fromEntries(foodGameState.scores)
      }, channel);
      
      return;
    }
  });
}

/**
 * Завершает игру "Собери морковку" и объявляет победителя в чате.
 * @param {string} winnerName - Имя победителя.
 * @param {Object} client - Клиент Twitch бота.
 * @param {string} channel - Канал Twitch.
 */
function finishFoodGame(winnerName, client, channel) {
  if (client && channel) {
    client.say(channel, `🏁 Игра "Собери морковку" завершена! Поздравляем победителя: ${winnerName}! 🏆`);
    console.log(`[Bot] Announced food game winner: ${winnerName} in channel: ${channel}`);
  } else {
    console.error('[Bot] Cannot announce food game winner: Bot client or channel not available.');
  }
}

// Race Plan Game Functions
// Состояние игры "Гонка на самолетах"
const racePlanState = {
  isActive: false,
  participants: new Set(),
  participantNames: new Map(),
  positions: new Map(), // userId -> { x: number, y: number }
  levels: new Map(), // userId -> level (0, 1, 2) - 3 уровня высоты
  lives: new Map(), // userId -> lives (3, 2, 1, 0)
  obstacles: [], // Массив препятствий
  gameStarted: false,
  gameFinished: false,
  startTime: null,
  winner: null,
  maxParticipants: 8,
  trackWidth: 1200 // Динамически обновляется с клиента
};

function startRacePlan(client, channel, settings = {}) {
  const { minParticipants = 1, maxParticipants = 8, registrationTime = 10 } = settings;
  
  logLine(`[bot] Starting race plan in channel: ${channel} with settings:`, settings);
  logLine(`[bot] Client object:`, typeof client, client ? 'exists' : 'null');
  logLine(`[bot] Channel:`, channel);
  
  // Проверяем client объект
  if (!client) {
    logLine(`[bot] ERROR: No client provided to startRacePlan!`);
    return;
  }
  
  if (!client.say) {
    logLine(`[bot] ERROR: client.say is not available!`);
    return;
  }
  
  // Prevent multiple game starts
  if (racePlanState.isActive && !racePlanState.gameFinished) {
    logLine(`[bot] Race plan already active, ignoring start request`);
    return;
  }
  
  // Allow starting new game even if one is active (reset previous game)
  if (racePlanState.isActive) {
    logLine(`[bot] Resetting previous race plan state`);
    // Reset game state
    racePlanState.isActive = false;
    racePlanState.participants.clear();
    racePlanState.participantNames.clear();
    racePlanState.positions.clear();
    racePlanState.levels.clear();
    racePlanState.lives.clear();
    racePlanState.obstacles = [];
    racePlanState.winner = null;
    racePlanState.gameStarted = false;
    racePlanState.gameFinished = false;
    racePlanState.startTime = null;
  }

  // Set game state
  racePlanState.isActive = true;
  racePlanState.participants.clear();
  racePlanState.participantNames.clear();
  racePlanState.positions.clear();
  racePlanState.levels.clear();
  racePlanState.lives.clear();
  racePlanState.obstacles = [];
  racePlanState.winner = null;
  racePlanState.gameStarted = false;
  racePlanState.gameFinished = false;
  racePlanState.startTime = null;

  // Синхронизируем с новым состоянием Game
  Game.isActive = true; // активируем сразу при старте регистрации
  Game.gameFinished = false;
  Game.players.clear();
  Game.obstacles = []; // очищаем препятствия

  // Announce game with settings
  logLine(`[bot] About to send announcement message to channel: ${channel}`);
  if (!client || !client.say) {
    logLine(`[bot] ERROR: client or client.say is not available!`);
    return;
  }
  client.say(channel, `✈️ Кто хочет участвовать в гонке на самолетах, отправьте + в чат! У вас есть ${registrationTime} секунд! (${minParticipants}-${maxParticipants} участников)`).catch(err => {
    logLine(`[bot] say error: ${err.message}`);
    logLine(`[bot] Full error: ${JSON.stringify(err)}`);
  });
  logLine(`[bot] Race plan announced in channel: ${channel}`);
  
  // Start registration timer
  setTimeout(() => {
    if (racePlanState.participants.size < minParticipants) {
      client.say(channel, `⏰ Время вышло! Недостаточно участников (${racePlanState.participants.size}/${minParticipants}). Гонка отменена.`).catch(err => {
        logLine(`[bot] say error: ${err.message}`);
        logLine(`[bot] Full error: ${JSON.stringify(err)}`);
      });
      racePlanState.isActive = false;
      return;
    }
    
    // Limit participants if too many joined
    if (racePlanState.participants.size > maxParticipants) {
      const participantsArray = Array.from(racePlanState.participants);
      const selectedParticipants = participantsArray.slice(0, maxParticipants);
      
      // Reset participants to only selected ones
      racePlanState.participants.clear();
      racePlanState.participantNames.clear();
      
      selectedParticipants.forEach(participantId => {
        racePlanState.participants.add(participantId);
      });
      
      client.say(channel, `🎯 Слишком много участников! Выбраны первые ${maxParticipants} участников.`).catch(err => {
        logLine(`[bot] say error: ${err.message}`);
        logLine(`[bot] Full error: ${JSON.stringify(err)}`);
      });
    }
    
    logLine(`[bot] About to call startRacePlanCountdown with client: ${typeof client}, channel: ${channel}`);
    startRacePlanCountdown(client, channel);
  }, registrationTime * 1000);
}

function joinRacePlan(userId, displayName, client, channel) {
  logLine(`[bot] joinRacePlan called with client: ${typeof client}, channel: ${channel}`);
  
  if (!client || !client.say) {
    logLine(`[bot] ERROR: client or client.say not available in joinRacePlan!`);
    return;
  }
  
  if (racePlanState.participants.has(userId)) {
    client.say(channel, `@${displayName} вы уже участвуете в гонке на самолетах!`).catch(err => {
      logLine(`[bot] say error: ${err.message}`);
      logLine(`[bot] Full error: ${JSON.stringify(err)}`);
    });
    return;
  }

  racePlanState.participants.add(userId);
  racePlanState.participantNames.set(userId, displayName);
  racePlanState.positions.set(userId, { x: 50, y: 0 }); // Start at left side, middle level
  racePlanState.levels.set(userId, 1); // Start at middle level (0=top, 1=middle, 2=bottom)
  racePlanState.lives.set(userId, 3); // Start with 3 lives

  // Добавляем в Game состояние
  Game.players.set(userId, {
    lane: 1, // middle lane
    lives: 3,
    out: false,
    x: 50, // стартовая позиция по X
    width: 72, // ширина аватара для коллизий
    prevX: 50 // предыдущая позиция для swept-test
  });

  const participantCount = racePlanState.participants.size;
  client.say(channel, `✈️ @${displayName} присоединился к гонке на самолетах! Участников: ${participantCount}`).catch(err => {
    logLine(`[bot] say error: ${err.message}`);
    logLine(`[bot] Full error: ${JSON.stringify(err)}`);
  });
  logLine(`[bot] User ${displayName} (${userId}) joined race plan. Total participants: ${participantCount}`);
}

function startRacePlanCountdown(client, channel) {
  logLine(`[bot] startRacePlanCountdown called with client: ${typeof client}, channel: ${channel}`);
  
  if (!racePlanState.isActive) {
    logLine(`[bot] Race plan not active, returning from countdown`);
    return;
  }

  if (!client || !client.say) {
    logLine(`[bot] ERROR: client or client.say not available in countdown!`);
    return;
  }

  racePlanState.gameStarted = true;
  racePlanState.startTime = Date.now();

  // Активируем Game состояние со старта отсчета
  Game.isActive = true;

  // Emit plane race start event to overlay
  const racePlanStartData = {
    participants: Array.from(racePlanState.participants),
    countdown: 3,
    levels: Object.fromEntries(racePlanState.levels),
    lives: Object.fromEntries(racePlanState.lives)
  };
  logLine(`[bot] Emitting racePlanStart event: ${JSON.stringify(racePlanStartData)}`);
  logLine(`[bot] Race plan participants count: ${racePlanState.participants.size}`);
  logLine(`[bot] Race plan participants: ${Array.from(racePlanState.participants).join(', ')}`);
  emitOverlay('racePlanStart', racePlanStartData, channel);

  // Countdown
  let count = 3;
  logLine(`[bot] Starting countdown with client: ${typeof client}, channel: ${channel}`);
  
  const countdownInterval = setInterval(() => {
    logLine(`[bot] Countdown tick: ${count}, client available: ${!!client}, client.say available: ${!!(client && client.say)}`);
    
    if (count > 0) {
      if (client && client.say) {
        client.say(channel, `✈️ ${count}...`).catch(err => {
          logLine(`[bot] say error: ${err.message}`);
          logLine(`[bot] Full error: ${JSON.stringify(err)}`);
        });
        logLine(`[bot] Sent countdown message: ${count}`);
      } else {
        logLine(`[bot] ERROR: Cannot send countdown message - client not available`);
      }
      count--;
    } else {
      clearInterval(countdownInterval);
      if (client && client.say) {
        client.say(channel, '✈️ ГОНКА НАЧАЛАСЬ! Пишите "верх" или "низ" для управления!').catch(err => {
          logLine(`[bot] say error: ${err.message}`);
          logLine(`[bot] Full error: ${JSON.stringify(err)}`);
        });
        logLine(`[bot] Sent start message`);
      } else {
        logLine(`[bot] ERROR: Cannot send start message - client not available`);
      }
      
      // Start plane race monitoring
      startPlaneRaceMonitoring(client, channel);
    }
  }, 1000);
}

function startPlaneRaceMonitoring(client, channel) {
  logLine(`[bot] === STARTING PLANE RACE MONITORING ===`);
  logLine(`[bot] Game.isActive: ${Game.isActive}, Game.gameFinished: ${Game.gameFinished}`);
  logLine(`[bot] Game.players.size: ${Game.players.size}`);
  
  // Emit plane race monitoring start
  emitOverlay('racePlanMonitoring', {
    participants: Array.from(racePlanState.participants),
    positions: Object.fromEntries(racePlanState.positions),
    levels: Object.fromEntries(racePlanState.levels),
    lives: Object.fromEntries(racePlanState.lives)
  }, channel);

  // Start obstacle spawning
  const obstacleInterval = setInterval(() => {
    logLine(`[bot] Obstacle spawn check: Game.isActive=${Game.isActive}, Game.gameFinished=${Game.gameFinished}`);
    if (!Game.isActive || Game.gameFinished) {
      logLine(`[bot] Stopping obstacle spawn interval`);
      clearInterval(obstacleInterval);
      return;
    }
    logLine(`[bot] Spawning obstacle`);
    spawnGameObstacle(channel);
  }, 4000); // Spawn obstacle every 4 seconds (уменьшено в 2 раза)

  // Start server tick (движение аватаров, препятствий и коллизии)
  const gameTickInterval = setInterval(() => {
    logLine(`[bot] Tick check: Game.isActive=${Game.isActive}, Game.gameFinished=${Game.gameFinished}`);
    if (!Game.isActive || Game.gameFinished) {
      logLine(`[bot] Stopping game tick interval`);
      clearInterval(gameTickInterval);
      return;
    }
    
    logLine(`[bot] Running serverTick()`);
    serverTick();
  }, 100); // Game tick every 100ms
  
  logLine(`[bot] Game tick started, interval ID: ${gameTickInterval}`);
}

function checkRacePlanCommand(text, userId, displayName, client, channel) {
  if (!racePlanState.isActive || !racePlanState.gameStarted || racePlanState.gameFinished) return;
  
  // Check if user is a participant
  if (!racePlanState.participants.has(userId)) return;
  
  // Check for level change commands
  if (text.trim() === 'верх') {
    const currentLevel = racePlanState.levels.get(userId) || 1;
    if (currentLevel > 0) {
      const newLevel = currentLevel - 1; // Move up (0=top, 1=middle, 2=bottom)
      racePlanState.levels.set(userId, newLevel);
      
      // Update Game state as well
      const gamePlayer = Game.players.get(userId);
      if (gamePlayer) {
        gamePlayer.lane = newLevel;
      }
      
      // Emit level update
      emitOverlay('racePlanLevelUpdate', {
        userId: userId,
        level: newLevel
      }, channel);
      
      logLine(`[bot] User ${displayName} moved to level ${newLevel}`);
    }
  } else if (text.trim() === 'низ') {
    const currentLevel = racePlanState.levels.get(userId) || 1;
    if (currentLevel < 2) {
      const newLevel = currentLevel + 1; // Move down (0=top, 1=middle, 2=bottom)
      racePlanState.levels.set(userId, newLevel);
      
      // Update Game state as well
      const gamePlayer = Game.players.get(userId);
      if (gamePlayer) {
        gamePlayer.lane = newLevel;
      }
      
      // Emit level update
      emitOverlay('racePlanLevelUpdate', {
        userId: userId,
        level: newLevel
      }, channel);
      
      logLine(`[bot] User ${displayName} moved to level ${newLevel}`);
    }
  }
}

function checkRacePlanCheering(text, client, channel) {
  if (!racePlanState.isActive || !racePlanState.gameStarted || racePlanState.gameFinished) return;
  
  // Check if message mentions any plane race participant
  const participants = Array.from(racePlanState.participants);
  
  for (const participantId of participants) {
    const participantName = racePlanState.participantNames.get(participantId);
    if (!participantName) continue;
    
    // Check if participant is mentioned in the message
    const mentionPattern = new RegExp(`@?${participantName}`, 'i');
    if (mentionPattern.test(text) || text.toLowerCase().includes('cheer') || text.includes('go')) {
      // Add speed boost (temporary)
      const currentPos = racePlanState.positions.get(participantId) || { x: 50, y: 0 };
      racePlanState.positions.set(participantId, { x: currentPos.x + 5, y: currentPos.y }); // Уменьшено в 2 раза
      
      // Emit position update
      emitOverlay('racePlanPositionUpdate', {
        userId: participantId,
        position: racePlanState.positions.get(participantId)
      }, channel);
      
      client.say(channel, `💨 @${participantName} получил ускорение!`).catch(err => logLine(`[bot] say error: ${err.message}`));
      logLine(`[bot] User ${participantName} got speed boost`);
      break;
    }
  }
}

function spawnObstacle(channel) {
  if (!racePlanState.isActive || racePlanState.gameFinished) return;
  
  const randomLevel = Math.floor(Math.random() * 3); // Random level (0, 1, or 2)
  const obstacle = {
    id: Date.now() + Math.random(),
    x: 1200, // Start from right side
    y: randomLevel, // Random level (0, 1, or 2)
    speed: 3 + Math.random() * 2, // Random speed
    type: Math.random() > 0.5 ? 'bird' : 'plane' // Random obstacle type
  };
  
  racePlanState.obstacles.push(obstacle);
  
  logLine(`[bot] Spawning obstacle in lane ${randomLevel} (type: ${obstacle.type})`);
  
  // Emit obstacle spawn
  emitOverlay('obstacleSpawn', obstacle, channel);
  
  // Remove obstacle after 15 seconds if not hit
  setTimeout(() => {
    const index = racePlanState.obstacles.findIndex(o => o.id === obstacle.id);
    if (index !== -1) {
      racePlanState.obstacles.splice(index, 1);
      emitOverlay('obstacleRemove', { id: obstacle.id }, channel);
    }
  }, 15000);
}

// Удаляем дублированную функцию serverTick - используем первую версию

// Функция обработки коллизий
function handleCollision(playerId) {
  const p = Game.players.get(playerId);
  if (!p) return;
  
  p.lives = Math.max(0, p.lives - 1);
  if (p.lives <= 0) {
    p.out = true;
  }
  
  // Синхронизируем с racePlanState
  racePlanState.lives.set(playerId, p.lives);
  
  // Отправляем событие коллизии
  emitOverlay('racePlanCollision', { playerId, lives: p.lives }, getBotChannel());
  
  logLine(`[bot] Player ${playerId} collision: lives=${p.lives}, out=${p.out}`);
}

function checkRacePlanCollisions() {
  if (!racePlanState.isActive || racePlanState.gameFinished) return;
  
  racePlanState.participants.forEach(userId => {
    const position = racePlanState.positions.get(userId) || { x: 50, y: 0 };
    const level = racePlanState.levels.get(userId) || 1;
    const lives = racePlanState.lives.get(userId) || 3;
    
    if (lives <= 0) return; // Player is out
    
    // Check collision with obstacles
    for (let i = racePlanState.obstacles.length - 1; i >= 0; i--) {
      const obstacle = racePlanState.obstacles[i];
      
      // Точная проверка коллизий с учетом реальных размеров хитбоксов
      if (obstacle.y === level) {
        // halfW аватара
        const m = AvatarMetrics.get(userId) || { halfW: 36, halfH: 36 };
        // половина ширины препятствия (в spawnGameObstacle width уже задаётся)
        const halfObs = (obstacle.width || 80) / 2;

        // position.x и obstacle.x трактуются как центр по X в твоём серверном состоянии
        const dx = Math.abs(position.x - obstacle.x);
        const overlapX = dx <= (m.halfW + halfObs);

        if (overlapX) {
          // Используем новую функцию handleCollision
          handleCollision(userId);

          // убрать препятствие
          racePlanState.obstacles.splice(i, 1);
          emitOverlay('obstacleRemove', { id: obstacle.id }, getBotChannel());
          
          // защитимся от повторного удара по тому же препятствию
          obstacle.hit = true;
          
          logLine(`[bot] User ${userId} hit obstacle! dx: ${dx}, halfW: ${m.halfW}, halfObs: ${halfObs}`);
          break;
        }
      }
    }
    
    // Check if player reached finish line
    if (position.x >= 1100) {
      if (!racePlanState.winner) {
        racePlanState.winner = userId;
        racePlanState.gameFinished = true;
        racePlanState.isActive = false;
        
        const winnerName = racePlanState.participantNames.get(userId) || 'Unknown';
        logLine(`[bot] Plane race winner: ${winnerName} (${userId})`);
        
        // Emit race end
        emitOverlay('racePlanEnd', {
          winner: userId,
          winnerName: winnerName,
          finalLives: Object.fromEntries(racePlanState.lives)
        }, channel);
        
        // Announce winner in chat
        client.say(channel, `🏆 Гонка завершена! Победитель: @${winnerName}!`).catch(err => logLine(`[bot] say error: ${err.message}`));
      }
    }
  });
}

function handleRacePlanCollision(playerId, obstacleId) {
  logLine(`[bot] handleRacePlanCollision called for player: ${playerId}, obstacle: ${obstacleId}`);
  
  // Получаем игрока из Game состояния
  const player = Game.players.get(playerId);
  if (!player) {
    logLine(`[bot] Player ${playerId} not found in Game state`);
    return;
  }
  
  // Уменьшаем жизни игрока
  player.lives = Math.max(0, player.lives - 1);
  logLine(`[bot] Player ${playerId} lives reduced to: ${player.lives}`);
  
  // Обновляем состояние в racePlanState
  racePlanState.lives.set(playerId, player.lives);
  
  // Если жизни закончились, исключаем игрока
  if (player.lives <= 0) {
    player.out = true;
    logLine(`[bot] Player ${playerId} is out of the race`);
    
    // Отправляем событие коллизии на overlay
    emitOverlay('racePlanCollision', { playerId, lives: 0 }, getBotChannel());
  } else {
    // Отправляем событие коллизии с оставшимися жизнями
    emitOverlay('racePlanCollision', { playerId, lives: player.lives }, getBotChannel());
  }
  
  logLine(`[bot] Player ${playerId} collision: lives=${player.lives}, out=${player.out}`);
}

function finishRacePlan(winnerName, client, channel) {
  // Завершаем Game состояние
  Game.isActive = false;
  Game.gameFinished = true;
  Game.obstacles = []; // очищаем препятствия

  if (client && channel) {
    client.say(channel, `🏆 Гонка на самолетах завершена! Поздравляем победителя: ${winnerName}! 🏆`);
    console.log(`[Bot] Announced plane race winner: ${winnerName} in channel: ${channel}`);
  } else {
    console.error('[Bot] Cannot announce plane race winner: Bot client or channel not available.');
  }
}

module.exports = { ensureBotFor, stopBot, status, addActiveAvatar, removeActiveAvatar, finishRace, finishFoodGame, getBotClient, getBotChannel, startRace, startFoodGame, checkFoodGameCommand, checkFoodGameCheering, checkCarrotCollisions, spawnCarrot, joinFoodGame, startFoodGameCountdown, startFoodGameMonitoring, setAvatarTimeoutSeconds, getAvatarTimeoutSeconds, startRacePlan, joinRacePlan, checkRacePlanCommand, checkRacePlanCheering, spawnObstacle, checkRacePlanCollisions, handleRacePlanCollision, finishRacePlan, setAvatarMetrics, Game, racePlanState };


