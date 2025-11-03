const tmi = require('tmi.js');
const { logLine } = require('../lib/logger');
const db = require('../lib/db/async');
const { emit, emitToStreamer, getSubscriberCount, getStreamerSubscriberCount } = require('../lib/bus');
const { CLIENT_ID, CLIENT_SECRET } = require('../lib/config');
const { stateManager } = require('../lib/state-redis');

// ==================== MULTI-BOT MANAGER ====================
// Хранилище всех активных ботов по streamer_id
const botClients = new Map(); // streamerId -> { client, profile, ready, states, interval }

function normalizeChannel(ch) {
  if (!ch) return ch;
  return ch.startsWith('#') ? ch : `#${ch}`;
}

// Получить или создать состояние для стримера
function getStreamerState(streamerId) {
  if (!botClients.has(streamerId)) {
    botClients.set(streamerId, {
      activeAvatars: new Set(),
      avatarLastActivity: new Map(),
      avatarStates: new Map(),
      avatarTimeoutInterval: null,
      avatarTimeoutSeconds: 300,
      __hydrated: false,
      __hydrating: null,
      __flushTimer: null,
      __persistInterval: null,
      raceState: {
        isActive: false,
        participants: new Set(),
        participantNames: new Map(),
        positions: new Map(),
        speeds: new Map(),
        modifiers: new Map(),
        maxParticipants: 10,
        countdown: 0,
        raceStarted: false,
        raceFinished: false,
        winner: null,
        speedModifiers: new Map(),
        startTime: null
      },
      foodGameState: {
        isActive: false,
        participants: new Set(),
        participantNames: new Map(),
        scores: new Map(),
        directions: new Map(),
        speedModifiers: new Map(),
        carrots: [],
        gameStarted: false,
        gameFinished: false,
        startTime: null,
        winner: null
      },
      racePlanState: {
        isActive: false,
        participants: new Set(),
        participantNames: new Map(),
        positions: new Map(),
        levels: new Map(),
        lives: new Map(),
        obstacles: [],
        gameStarted: false,
        gameFinished: false,
        startTime: null,
        winner: null,
        maxParticipants: 8,
        trackWidth: 1200
      },
      Game: {
        isActive: false,
        gameFinished: false,
        players: new Map(),
        obstacles: [],
        lanes: [0, 1, 2],
        maxLives: 3
      }
    });
  }
  return botClients.get(streamerId);
}
// ==================== END MULTI-BOT MANAGER ====================

function serializeSet(set) {
  return Array.from(set || []);
}

function serializeMap(map) {
  return Array.from((map || new Map()).entries());
}

function deserializeSet(values) {
  return new Set(Array.isArray(values) ? values : []);
}

function deserializeMap(entries) {
  const map = new Map();
  if (Array.isArray(entries)) {
    for (const [key, value] of entries) {
      map.set(key, value);
    }
  }
  return map;
}

function serializeRaceState(state) {
  if (!state) return null;
  return {
    ...state,
    participants: serializeSet(state.participants),
    participantNames: serializeMap(state.participantNames),
    positions: serializeMap(state.positions),
    speeds: serializeMap(state.speeds),
    modifiers: serializeMap(state.modifiers),
    speedModifiers: serializeMap(state.speedModifiers)
  };
}

function applyRaceState(target, data) {
  if (!data || !target) return target;
  target.isActive = Boolean(data.isActive);
  target.participants = deserializeSet(data.participants);
  target.participantNames = deserializeMap(data.participantNames);
  target.positions = deserializeMap(data.positions);
  target.speeds = deserializeMap(data.speeds);
  target.modifiers = deserializeMap(data.modifiers);
  target.speedModifiers = deserializeMap(data.speedModifiers);
  target.maxParticipants = data.maxParticipants ?? target.maxParticipants;
  target.minParticipants = data.minParticipants ?? target.minParticipants;
  target.countdown = data.countdown ?? 0;
  target.raceStarted = Boolean(data.raceStarted);
  target.raceFinished = Boolean(data.raceFinished);
  target.winner = data.winner ?? null;
  target.startTime = data.startTime ?? null;
  return target;
}

function serializeFoodGameState(state) {
  if (!state) return null;
  return {
    ...state,
    participants: serializeSet(state.participants),
    participantNames: serializeMap(state.participantNames),
    scores: serializeMap(state.scores),
    directions: serializeMap(state.directions),
    speedModifiers: serializeMap(state.speedModifiers)
  };
}

function applyFoodGameState(target, data) {
  if (!data || !target) return target;
  target.isActive = Boolean(data.isActive);
  target.participants = deserializeSet(data.participants);
  target.participantNames = deserializeMap(data.participantNames);
  target.scores = deserializeMap(data.scores);
  target.directions = deserializeMap(data.directions);
  target.speedModifiers = deserializeMap(data.speedModifiers);
  target.carrots = Array.isArray(data.carrots) ? data.carrots : [];
  target.gameStarted = Boolean(data.gameStarted);
  target.gameFinished = Boolean(data.gameFinished);
  target.startTime = data.startTime ?? null;
  target.winner = data.winner ?? null;
  return target;
}

function serializeRacePlanState(state) {
  if (!state) return null;
  return {
    ...state,
    participants: serializeSet(state.participants),
    participantNames: serializeMap(state.participantNames),
    positions: serializeMap(state.positions),
    levels: serializeMap(state.levels),
    lives: serializeMap(state.lives)
  };
}

function applyRacePlanState(target, data) {
  if (!data || !target) return target;
  target.isActive = Boolean(data.isActive);
  target.participants = deserializeSet(data.participants);
  target.participantNames = deserializeMap(data.participantNames);
  target.positions = deserializeMap(data.positions);
  target.levels = deserializeMap(data.levels);
  target.lives = deserializeMap(data.lives);
  target.obstacles = Array.isArray(data.obstacles) ? data.obstacles : [];
  target.gameStarted = Boolean(data.gameStarted);
  target.gameFinished = Boolean(data.gameFinished);
  target.startTime = data.startTime ?? null;
  target.winner = data.winner ?? null;
  target.maxParticipants = data.maxParticipants ?? target.maxParticipants;
  target.trackWidth = data.trackWidth ?? target.trackWidth;
  return target;
}

function serializeGameState(game) {
  if (!game) return null;
  return {
    ...game,
    players: serializeMap(game.players),
    obstacles: Array.isArray(game.obstacles) ? game.obstacles : []
  };
}

function applyGameState(target, data) {
  if (!data || !target) return target;
  target.isActive = Boolean(data.isActive);
  target.gameFinished = Boolean(data.gameFinished);
  target.players = deserializeMap(data.players);
  target.obstacles = Array.isArray(data.obstacles) ? data.obstacles : [];
  target.lanes = Array.isArray(data.lanes) ? data.lanes : target.lanes;
  target.maxLives = data.maxLives ?? target.maxLives;
  return target;
}

function serializeStreamerState(state) {
  return {
    avatarTimeoutSeconds: state.avatarTimeoutSeconds,
    activeAvatars: serializeSet(state.activeAvatars),
    avatarLastActivity: serializeMap(state.avatarLastActivity),
    avatarStates: serializeMap(state.avatarStates),
    raceState: serializeRaceState(state.raceState),
    foodGameState: serializeFoodGameState(state.foodGameState),
    racePlanState: serializeRacePlanState(state.racePlanState),
    gameState: serializeGameState(state.Game)
  };
}

async function persistStreamerState(streamerId) {
  try {
    const state = getStreamerState(streamerId);
    await stateManager.setBotState(streamerId, serializeStreamerState(state));
  } catch (error) {
    logLine(`[bot] Failed to persist state for streamer ${streamerId}: ${error.message}`);
  }
}

function scheduleStateFlush(streamerId) {
  const state = getStreamerState(streamerId);
  if (state.__flushTimer) {
    return;
  }

  state.__flushTimer = setTimeout(() => {
    state.__flushTimer = null;
    persistStreamerState(streamerId);
  }, 500);
}

async function hydrateStateFromStorage(streamerId) {
  const state = getStreamerState(streamerId);
  if (state.__hydrated) {
    return state;
  }

  if (state.__hydrating) {
    await state.__hydrating;
    return state;
  }

  state.__hydrating = (async () => {
    try {
      const storedState = await stateManager.getBotState(streamerId);
      if (!storedState) {
        return;
      }

      if (typeof storedState.avatarTimeoutSeconds === 'number') {
        state.avatarTimeoutSeconds = storedState.avatarTimeoutSeconds;
      }

      state.activeAvatars = deserializeSet(storedState.activeAvatars);
      state.avatarLastActivity = deserializeMap(storedState.avatarLastActivity);
      state.avatarStates = deserializeMap(storedState.avatarStates);

      if (storedState.raceState) {
        applyRaceState(state.raceState, storedState.raceState);
      }

      if (storedState.foodGameState) {
        applyFoodGameState(state.foodGameState, storedState.foodGameState);
      }

      if (storedState.racePlanState) {
        applyRacePlanState(state.racePlanState, storedState.racePlanState);
      }

      if (storedState.gameState) {
        applyGameState(state.Game, storedState.gameState);
      }
    } catch (error) {
      logLine(`[bot] Failed to hydrate state for streamer ${streamerId}: ${error.message}`);
    }
  })();

  try {
    await state.__hydrating;
  } finally {
    state.__hydrating = null;
    state.__hydrated = true;
  }

  return state;
}

// Помощник для отправки событий в канал стримера
function emitOverlay(event, payload, channel, streamerId) {
  if (streamerId) {
    emitToStreamer(streamerId, event, payload);
  } else {
    emit(event, payload);
  }
}

// Функция для обновления тайминга удаления аватаров (для конкретного стримера)
function setAvatarTimeoutSeconds(streamerId, seconds) {
  const state = getStreamerState(streamerId);
  const oldTimeout = state.avatarTimeoutSeconds;
  state.avatarTimeoutSeconds = seconds;
  logLine(`[bot] Avatar timeout updated from ${oldTimeout}s to ${seconds}s for streamer ${streamerId}`);

  // Перезапускаем интервал с новым таймингом
  if (state.avatarTimeoutInterval) {
    clearInterval(state.avatarTimeoutInterval);
  }
  startAvatarTimeoutChecker(streamerId);
  scheduleStateFlush(streamerId);
}

// Функция для запуска проверки неактивных аватаров
function startAvatarTimeoutChecker(streamerId) {
  const state = getStreamerState(streamerId);
  if (state.avatarTimeoutInterval) {
    clearInterval(state.avatarTimeoutInterval);
  }
  
  // Проверяем чаще: раз в секунду, либо динамически от таймаута
  const period = Math.max(1000, Math.min(10000, Math.floor(state.avatarTimeoutSeconds * 1000 / 4)));
  state.avatarTimeoutInterval = setInterval(() => {
    checkInactiveAvatars(streamerId).catch((error) => {
      logLine(`[bot] Avatar timeout checker error for ${streamerId}: ${error.message}`);
    });
  }, period);

  // Мгновенно проверить один раз при старте
  checkInactiveAvatars(streamerId).catch((error) => {
    logLine(`[bot] Initial avatar timeout check failed for ${streamerId}: ${error.message}`);
  });
  
  logLine(`[bot] Started avatar timeout checker (timeout=${state.avatarTimeoutSeconds}s, period=${period}ms) for streamer ${streamerId}`);
}

// Функция для проверки и удаления неактивных аватаров
async function checkInactiveAvatars(streamerId) {
  const state = getStreamerState(streamerId);
  const now = Date.now();

  // Загружаем актуальные настройки из БД для текущего стримера
  let currentTimeoutSeconds = state.avatarTimeoutSeconds;
  try {
    const dbTimeout = await db.getAvatarTimeoutSeconds(streamerId);
    if (dbTimeout) {
      currentTimeoutSeconds = dbTimeout;
      if (dbTimeout !== state.avatarTimeoutSeconds) {
        state.avatarTimeoutSeconds = dbTimeout;
      }
    }
  } catch (error) {
    logLine(`[bot] Error loading timeout from DB: ${error.message}`);
  }
  
  const timeoutMs = currentTimeoutSeconds * 1000;
  const tiredTimeoutMs = timeoutMs / 2;
  const inactiveUsers = [];
  const tiredUsers = [];
  
  const botData = botClients.get(streamerId);
  if (!botData || !botData.client) return;
  
  for (const [userId, lastActivity] of state.avatarLastActivity.entries()) {
    const timeSinceActivity = now - lastActivity;
    
    if (timeSinceActivity > timeoutMs) {
      inactiveUsers.push(userId);
    } else if (timeSinceActivity > tiredTimeoutMs) {
      const currentState = state.avatarStates.get(userId);
      if (currentState !== 'tired') {
        tiredUsers.push(userId);
      }
    }
  }
  
  if (tiredUsers.length > 0) {
    for (const userId of tiredUsers) {
      state.avatarStates.set(userId, 'tired');
      emitOverlay('avatarStateChanged', { userId, state: 'tired' }, null, streamerId);
    }
    scheduleStateFlush(streamerId);
  }
  
  if (inactiveUsers.length > 0) {
    for (const userId of inactiveUsers) {
      state.activeAvatars.delete(userId);
      state.avatarLastActivity.delete(userId);
      state.avatarStates.delete(userId);
      emitOverlay('avatarRemoved', { userId }, null, streamerId);
    }
    scheduleStateFlush(streamerId);
  }
}

// Функция для обновления активности аватара
async function updateAvatarActivity(streamerId, userId) {
  const state = getStreamerState(streamerId);
  const previousState = state.avatarStates.get(userId);
  state.avatarLastActivity.set(userId, Date.now());
  state.activeAvatars.add(userId);

  if (previousState === 'tired') {
    state.avatarStates.set(userId, 'normal');
    emitOverlay('avatarStateChanged', { userId, state: 'normal' }, null, streamerId);
  } else if (!previousState) {
    state.avatarStates.set(userId, 'normal');
  }

  scheduleStateFlush(streamerId);
}

// Функция для получения текущего тайминга
function getAvatarTimeoutSeconds(streamerId) {
  const state = getStreamerState(streamerId);
  return state.avatarTimeoutSeconds;
}

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
    await db.saveOrUpdateUser({
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
  // Проверяем, есть ли уже бот для этого стримера
  if (botClients.has(uid) && botClients.get(uid).client) {
    const botData = botClients.get(uid);
    logLine(`[bot] Already connected for user ${uid}`);
    return { profile: botData.profile, client: botData.client };
  }

  let profile = await db.getUserByTwitchId(uid);
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

  const client = new tmi.Client({
    options: { debug: false },
    connection: { secure: true, reconnect: true },
    identity: { username: profile.login, password: `oauth:${profile.access_token}` },
    channels: [ profile.login ]
  });

  const states = getStreamerState(uid);
  await hydrateStateFromStorage(uid);
  let avatarShowHandler = null;
  let connectionResolver = null;
  let connectionRejector = null;
  
  // Создаем Promise для ожидания подключения
  const connectionPromise = new Promise((resolve, reject) => {
    connectionResolver = resolve;
    connectionRejector = reject;
  });
  
  client.on('connected', (addr, port) => {
    (async () => {
      logLine(`[bot] connected to ${addr}:${port} → #${profile.login} for streamer ${uid}`);
      states.client = client;
      states.profile = profile;
      states.ready = true;
      botClients.set(uid, states);

      try {
        const dbTimeout = await db.getAvatarTimeoutSeconds(uid);
        if (dbTimeout && dbTimeout !== states.avatarTimeoutSeconds) {
          states.avatarTimeoutSeconds = dbTimeout;
          logLine(`[bot] Loaded avatar timeout from DB: ${dbTimeout} seconds`);
        }
      } catch (error) {
        logLine(`[bot] Error loading timeout from DB: ${error.message}`);
      }

      startAvatarTimeoutChecker(uid);

      if (!states.__persistInterval) {
        states.__persistInterval = setInterval(() => {
          persistStreamerState(uid).catch((error) => {
            logLine(`[bot] Failed to persist state for streamer ${uid}: ${error.message}`);
          });
        }, 2000);
      }

      await stateManager.registerStreamer(uid);
      scheduleStateFlush(uid);

      // Подписываемся на события bus для отслеживания аватаров из донатов
      const { on } = require('../lib/bus');
      avatarShowHandler = async (data) => {
        if (data.streamerId === uid && data.twitchUserId) {
          logLine(`[bot] Avatar shown via donation for user ${data.twitchUserId}`);
          try {
            await updateAvatarActivity(uid, data.twitchUserId);
          } catch (error) {
            logLine(`[bot] Failed to update avatar activity from donation for ${data.twitchUserId}: ${error.message}`);
          }
        }
      };
      on('avatar:show', avatarShowHandler);

      // Разрешаем промис подключения
      if (connectionResolver) {
        connectionResolver({ profile, client });
      }
    })().catch((error) => {
      logLine(`[bot] connected handler error for streamer ${uid}: ${error.message}`);
      if (connectionRejector) {
        connectionRejector(error);
      }
    });
  });
  client.on('disconnected', (reason) => {
    logLine(`[bot] disconnected for streamer ${uid}: ${reason}`);
    const botData = botClients.get(uid);
    if (botData) {
      botData.ready = false;
    }
    // Отписываемся от событий
    if (avatarShowHandler) {
      const { off } = require('../lib/bus');
      off('avatar:show', avatarShowHandler);
      avatarShowHandler = null;
    }
  });
  client.on('notice', (channel, msgid, message) => {
    if (msgid === 'login_unrecognized') {
      logLine(`[bot] authentication failed for streamer ${uid}: ${message}`);
      botClients.delete(uid);
      if (connectionRejector) {
        connectionRejector(new Error(`Login authentication failed: ${message}`));
      }
    }
  });
  client.on('message', async (channel, tags, message, self) => {
    if (self) return;

    const botData = botClients.get(uid);
    if (!botData || !botData.ready) {
      return;
    }

    try {
      const text = message.trim().toLowerCase();
      const userId = tags['user-id'];
      const displayName = tags['display-name'] || tags.username;
      const color = tags['color'] || null;

      // Обновляем активность аватара при любом сообщении
      await updateAvatarActivity(uid, userId);
    
    if (text === '!ping') {
      client.say(channel, 'pong').catch(err => logLine(`[bot] say error: ${err.message}`));
      return;
    }

    if (text === '!start') {
      // Ensure user exists in database first
      let user = await db.getUserByTwitchId(userId);
      if (!user) {
        const userData = {
          twitch_user_id: userId,
          display_name: displayName,
          login: displayName.toLowerCase().replace(/\s+/g, ''),
          profile_image_url: null,
          access_token: 'chat_user',
          refresh_token: null,
          scope: null,
          expires_at: null
        };
        await db.saveOrUpdateUser(userData);
      }

      // Load or create default avatar
      let avatarData = await db.getAvatarByTwitchId(userId);
      if (!avatarData) {
        try {
          avatarData = {
            body_skin: 'body_skin_1',
            face_skin: 'face_skin_1',
            clothes_type: 'clothes_type_1',
            others_type: 'others_1'
          };
          await db.saveOrUpdateAvatar(userId, avatarData);
        } catch (error) {
          avatarData = {
            body_skin: 'body_skin_1',
            face_skin: 'face_skin_1',
            clothes_type: 'clothes_type_1',
            others_type: 'others_1'
          };
        }
      }

      // Add user to streamer's chat list
      try {
        await db.addUserToStreamer(userId, uid);
      } catch (error) {
        logLine(`[bot] Error adding user to streamer: ${error.message}`);
      }

      // Emit avatar:show event
      emitToStreamer(uid, 'avatar:show', {
        streamerId: uid,
        twitchUserId: userId,
        displayName: displayName,
        color: color,
        avatarData,
        source: 'twitch_chat'
      });

      states.activeAvatars.add(userId);
      scheduleStateFlush(uid);
      logLine(`[overlay] spawn requested by ${displayName} (${userId}) for streamer ${uid}`);
      return;
    }

    // Race command
    if (text === '!race') {
      if (states.raceState.isActive && !states.raceState.raceFinished) {
        client.say(channel, '🏁 Гонка уже идет! Дождитесь завершения.').catch(err => logLine(`[bot] say error: ${err.message}`));
        return;
      }
      startRace(uid, client, channel, states.raceState);
      return;
    }



    // Check for race participation
    if (text === '+' && states.raceState.isActive && !states.raceState.raceStarted) {
      joinRace(uid, userId, displayName, client, channel, states.raceState);
      return;
    }

    // Check for race cheering (mentions during race)
    if (states.raceState.isActive && states.raceState.raceStarted && !states.raceState.raceFinished) {
      checkRaceCheering(text, client, channel, states.raceState, uid);
    }

    // Check for food game registration
    if (text === '+' && states.foodGameState.isActive && !states.foodGameState.gameStarted) {
      joinFoodGame(userId, displayName, client, channel, states.foodGameState);
      return;
    }

    // Check for food game commands
    if (states.foodGameState.isActive && states.foodGameState.gameStarted && !states.foodGameState.gameFinished) {
      checkFoodGameCommand(text, userId, displayName, client, channel, states.foodGameState);
      checkFoodGameCheering(text, client, channel, states.foodGameState);
    }

    // Race plan command
    if (text === '!race-plan') {
      if (states.racePlanState.isActive && !states.racePlanState.gameFinished) {
        client.say(channel, '✈️ Гонка на самолетах уже идет! Дождитесь завершения.').catch(err => logLine(`[bot] say error: ${err.message}`));
        return;
      }
      startRacePlan(uid, client, channel, states.racePlanState, states.Game);
      return;
    }

    // Check for race plan registration
    if (text === '+' && states.racePlanState.isActive && !states.racePlanState.gameStarted) {
      joinRacePlan(userId, displayName, client, channel, states.racePlanState, states.Game);
      return;
    }

    // Check for race plan commands
    if (states.racePlanState.isActive && states.racePlanState.gameStarted && !states.racePlanState.gameFinished) {
      checkRacePlanCommand(text, userId, displayName, client, channel, states.racePlanState, states.Game);
      checkRacePlanCheering(text, client, channel, states.racePlanState, uid);
    }


    // смена полосы
    if (states.Game.isActive && !states.Game.gameFinished) {
      if (UP_WORDS.has(text)) {
        let p = states.Game.players.get(userId);
        if (!p) {
          p = { lane: 1, x: 50, width: 72, lives: 3, out: false, prevX: 50 };
          states.Game.players.set(userId, p);
        }
        const oldLane = p.lane ?? 1;
        p.lane = clampLane(oldLane - 1);
        emitLevelUpdate(userId, p.lane, client, channel, uid); 
        return;
      }
      if (DOWN_WORDS.has(text)) {
        let p = states.Game.players.get(userId);
        if (!p) {
          p = { lane: 1, x: 50, width: 72, lives: 3, out: false, prevX: 50 };
          states.Game.players.set(userId, p);
        }
        const oldLane = p.lane ?? 1;
        p.lane = clampLane(oldLane + 1);
        emitLevelUpdate(userId, p.lane, client, channel, uid); 
        return;
      }
    }

    // Если пользователь не активен в памяти — попробуем «лениво» восстановить
    if (!states.activeAvatars.has(userId)) {
      const avatarData = await db.getAvatarByTwitchId(userId);
      if (avatarData) {
        states.activeAvatars.add(userId);
        scheduleStateFlush(uid);
        emitOverlay('spawn', {
          userId,
          displayName,
          color,
          avatarData,
          ts: Date.now()
        }, channel, uid);
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
      emitOverlay('hi', { userId }, channel, uid);
      return;
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
    
    if (isLaughing(message)) {
      emitOverlay('laugh', { userId }, channel, uid);
      return;
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
      emitOverlay('emoji', { userId, emoji }, channel, uid);
      return;
    }
    
    // No emotes found - normal movement
    const messageLength = message.length;
    const moveDistance = Math.min(messageLength * 8, 200);
    const direction = Math.random() > 0.5 ? 1 : -1;
    
    emitOverlay('move', {
      userId,
      distance: moveDistance * direction,
      messageLength
    }, channel, uid);
  } catch (error) {
    logLine(`[bot] message handler error for streamer ${uid}: ${error.message}`);
  }
  });

  try {
    // Запускаем подключение
    await client.connect();
    
    // Устанавливаем таймаут для промиса подключения
    const timeout = setTimeout(() => {
      if (connectionRejector) {
        connectionRejector(new Error('Connection timeout'));
      }
    }, 10000);
    
    // Ожидаем успешного подключения или ошибки
    const result = await Promise.race([
      connectionPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), 10000))
    ]);
    
    clearTimeout(timeout);
    return result;
  } catch (error) {
    logLine(`[bot] connection failed: ${error.message}`);
    botClients.delete(uid);
    throw error;
  }
}

async function stopBot(streamerId) {
  if (!streamerId) {
    // Stop all bots if no streamerId provided
    const promises = Array.from(botClients.keys()).map(id => stopBotForStreamer(id));
    await Promise.all(promises);
    return true;
  }
  return await stopBotForStreamer(streamerId);
}

async function stopBotForStreamer(streamerId) {
  if (!botClients.has(streamerId)) return false;

  const botData = botClients.get(streamerId);
  if (botData.client) {
    try {
      await botData.client.disconnect();
    } catch (error) {
      logLine(`[bot] error disconnecting bot for streamer ${streamerId}: ${error.message}`);
    }
  }

  if (botData.avatarTimeoutInterval) {
    clearInterval(botData.avatarTimeoutInterval);
  }

  if (botData.__persistInterval) {
    clearInterval(botData.__persistInterval);
    botData.__persistInterval = null;
  }

  if (botData.__flushTimer) {
    clearTimeout(botData.__flushTimer);
    botData.__flushTimer = null;
  }

  try {
    await stateManager.unregisterStreamer(streamerId);
    await stateManager.deleteBotState(streamerId);
  } catch (error) {
    logLine(`[bot] error cleaning Redis state for streamer ${streamerId}: ${error.message}`);
  }

  botClients.delete(streamerId);
  logLine(`[bot] stopped for streamer ${streamerId}`);
  return true;
}

async function restoreBotsFromRedis() {
  try {
    const streamerIds = await stateManager.listStreamers();
    if (!Array.isArray(streamerIds) || streamerIds.length === 0) {
      logLine('[bot] No streamer sessions found in Redis for restoration');
      return [];
    }

    const restored = [];
    for (const streamerId of streamerIds) {
      try {
        await ensureBotFor(streamerId);
        restored.push(streamerId);
      } catch (error) {
        logLine(`[bot] Failed to restore bot for streamer ${streamerId}: ${error.message}`);
      }
    }

    return restored;
  } catch (error) {
    logLine(`[bot] restoreBotsFromRedis error: ${error.message}`);
    return [];
  }
}

function status() {
  return { 
    running: botClients.size > 0,
    bot_count: botClients.size,
    bots: Array.from(botClients.entries()).map(([streamerId, data]) => ({
      streamerId,
      ready: data.ready,
      activeAvatars: Array.from(data.activeAvatars || [])
    }))
  };
}

// Функция для добавления аватара в активный список (для донатов)
function addActiveAvatar(streamerId, userId) {
  const state = getStreamerState(streamerId);
  state.activeAvatars.add(userId);
  logLine(`[bot] Added avatar ${userId} to active list for streamer ${streamerId}`);
  scheduleStateFlush(streamerId);
}

// Функция для удаления аватара из активного списка
function removeActiveAvatar(streamerId, userId) {
  const state = getStreamerState(streamerId);
  state.activeAvatars.delete(userId);
  logLine(`[bot] Removed avatar ${userId} from active list for streamer ${streamerId}`);
  scheduleStateFlush(streamerId);
}

function getBotClientFor(streamerId) {
  if (!streamerId) return null;
  const botData = botClients.get(streamerId);
  return botData ? botData.client : null;
}

// Получить Twitch-канал ("#login") для конкретного стримера
function getBotChannelFor(streamerId) {
  if (!streamerId) return null;
  const botData = botClients.get(streamerId);
  if (botData && botData.profile && botData.profile.login) {
    return normalizeChannel(botData.profile.login);
  }
  return null;
}

// Доступ к состояниям стримера (гонки/игры)
// getStreamerState уже объявлена выше в менеджере ботов

// Race game functions
function startRace(streamerId, client, channel, raceState, settings = {}) {
  const { minParticipants = 1, maxParticipants = 10, registrationTime = 10 } = settings;
  
  // Prevent multiple race starts
  if (raceState.isActive && !raceState.raceFinished) {
    return;
  }
  
  if (raceState.isActive) {
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

  raceState.isActive = true;
  raceState.countdown = 0;
  raceState.raceStarted = false;
  raceState.raceFinished = false;
  raceState.winner = null;
  raceState.startTime = null;
  raceState.minParticipants = minParticipants;
  raceState.maxParticipants = maxParticipants;

  client.say(channel, `🏁 Кто хочет участвовать в гонке, отправьте + в чат! У вас есть ${registrationTime} секунд! (${minParticipants}-${maxParticipants} участников)`).catch(err => logLine(`[bot] say error: ${err.message}`));
  
  setTimeout(() => {
    if (raceState.participants.size < minParticipants) {
      client.say(channel, `⏰ Время вышло! Недостаточно участников (${raceState.participants.size}/${minParticipants}). Гонка отменена.`).catch(err => logLine(`[bot] say error: ${err.message}`));
      raceState.isActive = false;
      return;
    }
    
    if (raceState.participants.size > maxParticipants) {
      const participantsArray = Array.from(raceState.participants);
      const selectedParticipants = participantsArray.slice(0, maxParticipants);
      raceState.participants.clear();
      raceState.participantNames.clear();
      selectedParticipants.forEach(participantId => {
        raceState.participants.add(participantId);
      });
      client.say(channel, `🎯 Слишком много участников! Выбраны первые ${maxParticipants} участников.`).catch(err => logLine(`[bot] say error: ${err.message}`));
    }
    
    startRaceCountdown(streamerId, client, channel, raceState);
  }, registrationTime * 1000);
}

function joinRace(streamerId, userId, displayName, client, channel, raceState) {
  if (raceState.participants.has(userId)) {
    return;
  }

  if (raceState.participants.size >= raceState.maxParticipants) {
    client.say(channel, `@${displayName} Гонка уже заполнена! Максимум ${raceState.maxParticipants} участников.`).catch(err => logLine(`[bot] say error: ${err.message}`));
    return;
  }

  raceState.participants.add(userId);
  raceState.participantNames.set(userId, displayName);
  client.say(channel, `@${displayName} присоединился к гонке! (${raceState.participants.size}/${raceState.maxParticipants})`).catch(err => logLine(`[bot] say error: ${err.message}`));

  if (raceState.participants.size >= raceState.maxParticipants) {
    setTimeout(() => startRaceCountdown(streamerId, client, channel, raceState), 1000);
  }
}

function startRaceCountdown(streamerId, client, channel, raceState) {
  if (!raceState.isActive) return;

  raceState.raceStarted = true;
  raceState.startTime = Date.now();

  // Emit race start event to overlay
  const raceStartData = {
    participants: Array.from(raceState.participants),
    countdown: 3
  };
  logLine(`[bot] Emitting raceStart event: ${JSON.stringify(raceStartData)}`);
  emitOverlay('raceStart', raceStartData, channel, streamerId);

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
      startRaceMonitoring(streamerId, client, channel, raceState);
    }
  }, 1000);
}

function startRaceMonitoring(streamerId, client, channel, raceState) {
  // Emit race monitoring start
  emitOverlay('raceMonitoring', {
    participants: Array.from(raceState.participants),
    speedModifiers: Object.fromEntries(raceState.speedModifiers)
  }, channel, streamerId);
}

function checkRaceCheering(text, client, channel, raceState, streamerId) {
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
      }, channel, streamerId);
      
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
  for (const data of botClients.values()) {
    if (data.client) {
      return data.client;
    }
  }
  return null;
}

function getBotChannel() {
  for (const data of botClients.values()) {
    if (data?.profile?.login) {
      return normalizeChannel(data.profile.login);
    }
  }
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

module.exports = { ensureBotFor, stopBot, status, addActiveAvatar, removeActiveAvatar, finishRace, finishFoodGame, getBotClient, getBotClientFor, getBotChannel, getBotChannelFor, startRace, startFoodGame, checkFoodGameCommand, checkFoodGameCheering, checkCarrotCollisions, spawnCarrot, joinFoodGame, startFoodGameCountdown, startFoodGameMonitoring, setAvatarTimeoutSeconds, getAvatarTimeoutSeconds, startRacePlan, joinRacePlan, checkRacePlanCommand, checkRacePlanCheering, spawnObstacle, checkRacePlanCollisions, handleRacePlanCollision, finishRacePlan, setAvatarMetrics, Game, racePlanState, getStreamerState, restoreBotsFromRedis };


