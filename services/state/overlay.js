const { getStreamerOverlayState, setStreamerOverlayState } = require('../../db');
const { getRedisClient, createRedisSubscriber, redisInstanceId } = require('../../lib/redis');

const redis = getRedisClient();
const redisSubscriber = createRedisSubscriber('overlay-state');

const STATE_KEY_PREFIX = 'overlay:state:';
const STATE_CHANNEL_PREFIX = 'overlay:state:updates:';

const overlayStateListeners = new Map();
let subscriberReady = false;

// Проверка доступности Redis
if (!redis || !redisSubscriber) {
  console.warn('[overlay-state] Redis is not available. State sync between instances will not work.');
}

function ensureSubscriber() {
  if (subscriberReady || !redisSubscriber) {
    return;
  }

  subscriberReady = true;
  redisSubscriber.psubscribe(`${STATE_CHANNEL_PREFIX}*`, err => {
    if (err) {
      console.error('[overlay-state] Failed to subscribe to Redis updates:', err);
    }
  });

  redisSubscriber.on('pmessage', (pattern, channel, message) => {
    if (!channel.startsWith(STATE_CHANNEL_PREFIX)) {
      return;
    }

    const streamerId = channel.slice(STATE_CHANNEL_PREFIX.length);
    const handler = overlayStateListeners.get(streamerId);
    if (!handler) {
      return;
    }

    try {
      const payload = JSON.parse(message);
      if (!payload || payload.source === redisInstanceId) {
        return;
      }
      handler(payload.state || {});
    } catch (error) {
      console.error('[overlay-state] Failed to process Redis payload:', error);
    }
  });
}

class PersistentSet extends Set {
  constructor(iterable, onChange) {
    super(iterable);
    this.onChange = onChange;
    this.suspended = false;
  }

  add(value) {
    const sizeBefore = this.size;
    super.add(value);
    if (!this.suspended && this.size !== sizeBefore) {
      this.onChange();
    }
    return this;
  }

  delete(value) {
    const existed = super.delete(value);
    if (existed && !this.suspended) {
      this.onChange();
    }
    return existed;
  }

  clear() {
    if (this.size === 0) return;
    if (this.suspended) {
      super.clear();
      return;
    }
    super.clear();
    this.onChange();
  }

  replaceAll(values) {
    this.suspended = true;
    super.clear();
    for (const value of toArray(values)) {
      super.add(value);
    }
    this.suspended = false;
  }
}

class PersistentMap extends Map {
  constructor(iterable, onChange) {
    super(iterable);
    this.onChange = onChange;
    this.suspended = false;
  }

  set(key, value) {
    const had = this.has(key);
    const prev = had ? super.get(key) : undefined;
    super.set(key, value);
    if (!this.suspended && (!had || prev !== value)) {
      this.onChange();
    }
    return this;
  }

  delete(key) {
    const existed = super.delete(key);
    if (existed && !this.suspended) {
      this.onChange();
    }
    return existed;
  }

  clear() {
    if (this.size === 0) return;
    if (this.suspended) {
      super.clear();
      return;
    }
    super.clear();
    this.onChange();
  }

  replaceAll(entries) {
    this.suspended = true;
    super.clear();
    for (const [key, value] of toEntries(entries)) {
      super.set(key, value);
    }
    this.suspended = false;
  }
}

function toArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return Array.from(value);
  if (typeof value === 'object') return Object.values(value);
  return [];
}

function toEntries(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Map) return Array.from(value.entries());
  if (typeof value === 'object') return Object.entries(value);
  return [];
}

function createOverlayState(streamerId) {
  if (!streamerId) {
    throw new Error('streamerId is required to create overlay state');
  }

  ensureSubscriber();

  const stateKey = `${STATE_KEY_PREFIX}${streamerId}`;
  const channel = `${STATE_CHANNEL_PREFIX}${streamerId}`;

  let persistTimer = null;
  let persistSuspended = false;

  function schedulePersist() {
    if (persistSuspended) return;
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persistNow().catch(error => {
        console.error(`[overlay-state] Persist error for ${streamerId}:`, error);
      });
    }, 200);
  }

  const makeSet = data => new PersistentSet(toArray(data), schedulePersist);
  const makeMap = data => new PersistentMap(toEntries(data), schedulePersist);

  const overlayState = {
    activeAvatars: makeSet([]),
    avatarLastActivity: makeMap([]),
    avatarStates: makeMap([]),
    avatarTimeoutSeconds: 300,
    raceState: restoreRaceState(),
    foodGameState: restoreFoodGameState(),
    planeGame: restorePlaneGame(),
    racePlanState: restoreRacePlanState(),
    avatarMetrics: makeMap([])
  };

  async function persistNow() {
    const serialized = serializeState();

    try {
      await setStreamerOverlayState(streamerId, serialized);
    } catch (error) {
      console.error(`[overlay-state] Failed to persist to DB for ${streamerId}:`, error);
    }

    // Публикуем в Redis только если он доступен
    if (redis) {
      const payload = {
        source: redisInstanceId,
        state: serialized,
        updatedAt: Date.now()
      };

      try {
        await redis.set(stateKey, JSON.stringify(payload));
        await redis.publish(channel, JSON.stringify(payload));
      } catch (error) {
        console.error(`[overlay-state] Failed to replicate state for ${streamerId}:`, error);
      }
    }
  }

  function restoreRaceState(data = {}) {
    return {
      isActive: !!data.isActive,
      participants: makeSet(data.participants),
      participantNames: makeMap(data.participantNames),
      positions: makeMap(data.positions),
      speeds: makeMap(data.speeds),
      modifiers: makeMap(data.modifiers),
      maxParticipants: Number.isFinite(data.maxParticipants) ? data.maxParticipants : 10,
      countdown: Number.isFinite(data.countdown) ? data.countdown : 0,
      raceStarted: !!data.raceStarted,
      raceFinished: !!data.raceFinished,
      winner: data.winner ?? null,
      speedModifiers: makeMap(data.speedModifiers),
      startTime: data.startTime ?? null
    };
  }

  function restoreFoodGameState(data = {}) {
    return {
      isActive: !!data.isActive,
      participants: makeSet(data.participants),
      participantNames: makeMap(data.participantNames),
      scores: makeMap(data.scores),
      directions: makeMap(data.directions),
      speedModifiers: makeMap(data.speedModifiers),
      carrots: Array.isArray(data.carrots) ? data.carrots : [],
      gameStarted: !!data.gameStarted,
      gameFinished: !!data.gameFinished,
      startTime: data.startTime ?? null,
      winner: data.winner ?? null
    };
  }

  function restorePlaneGame(data = {}) {
    return {
      isActive: !!data.isActive,
      gameFinished: !!data.gameFinished,
      players: makeMap(data.players),
      obstacles: Array.isArray(data.obstacles) ? data.obstacles : [],
      lanes: Array.isArray(data.lanes) && data.lanes.length ? data.lanes : [0, 1, 2],
      maxLives: Number.isFinite(data.maxLives) ? data.maxLives : 3
    };
  }

  function restoreRacePlanState(data = {}) {
    return {
      isActive: !!data.isActive,
      participants: makeSet(data.participants),
      participantNames: makeMap(data.participantNames),
      positions: makeMap(data.positions),
      levels: makeMap(data.levels),
      lives: makeMap(data.lives),
      obstacles: Array.isArray(data.obstacles) ? data.obstacles : [],
      gameStarted: !!data.gameStarted,
      gameFinished: !!data.gameFinished,
      startTime: data.startTime ?? null,
      winner: data.winner ?? null,
      maxParticipants: Number.isFinite(data.maxParticipants) ? data.maxParticipants : 8,
      trackWidth: Number.isFinite(data.trackWidth) ? data.trackWidth : 1200
    };
  }

  const hydrateOverlayState = (data = {}) => {
    withSuppressedPersistence(() => {
      applySerializedState(data);
    });
  };
  hydrateOverlayState({});

  getStreamerOverlayState(streamerId)
    .then(state => {
      if (state) {
        hydrateOverlayState(state);
      }
    })
    .catch(error => {
      console.error(`[overlay-state] Failed to load initial state for ${streamerId}:`, error);
    });

  function withSuppressedPersistence(fn) {
    persistSuspended = true;
    try {
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      fn();
    } finally {
      persistSuspended = false;
    }
  }

  function applyRaceState(target, data = {}) {
    target.isActive = !!data.isActive;
    target.maxParticipants = Number.isFinite(data.maxParticipants) ? data.maxParticipants : target.maxParticipants;
    target.countdown = Number.isFinite(data.countdown) ? data.countdown : target.countdown;
    target.raceStarted = !!data.raceStarted;
    target.raceFinished = !!data.raceFinished;
    target.winner = data.winner ?? null;
    target.startTime = data.startTime ?? null;
    target.participants.replaceAll(data.participants);
    target.participantNames.replaceAll(data.participantNames);
    target.positions.replaceAll(data.positions);
    target.speeds.replaceAll(data.speeds);
    target.modifiers.replaceAll(data.modifiers);
    target.speedModifiers.replaceAll(data.speedModifiers);
  }

  function applyFoodState(target, data = {}) {
    target.isActive = !!data.isActive;
    target.gameStarted = !!data.gameStarted;
    target.gameFinished = !!data.gameFinished;
    target.startTime = data.startTime ?? null;
    target.winner = data.winner ?? null;
    target.carrots = Array.isArray(data.carrots) ? data.carrots : [];
    target.participants.replaceAll(data.participants);
    target.participantNames.replaceAll(data.participantNames);
    target.scores.replaceAll(data.scores);
    target.directions.replaceAll(data.directions);
    target.speedModifiers.replaceAll(data.speedModifiers);
  }

  function applyPlaneState(target, data = {}) {
    target.isActive = !!data.isActive;
    target.gameFinished = !!data.gameFinished;
    target.obstacles = Array.isArray(data.obstacles) ? data.obstacles : [];
    target.lanes = Array.isArray(data.lanes) && data.lanes.length ? data.lanes : target.lanes;
    target.maxLives = Number.isFinite(data.maxLives) ? data.maxLives : target.maxLives;
    target.players.replaceAll(data.players);
  }

  function applyRacePlanState(target, data = {}) {
    target.isActive = !!data.isActive;
    target.gameStarted = !!data.gameStarted;
    target.gameFinished = !!data.gameFinished;
    target.startTime = data.startTime ?? null;
    target.winner = data.winner ?? null;
    target.maxParticipants = Number.isFinite(data.maxParticipants) ? data.maxParticipants : target.maxParticipants;
    target.trackWidth = Number.isFinite(data.trackWidth) ? data.trackWidth : target.trackWidth;
    target.obstacles = Array.isArray(data.obstacles) ? data.obstacles : [];
    target.participants.replaceAll(data.participants);
    target.participantNames.replaceAll(data.participantNames);
    target.positions.replaceAll(data.positions);
    target.levels.replaceAll(data.levels);
    target.lives.replaceAll(data.lives);
  }

  function applySerializedState(serialized = {}) {
    overlayState.activeAvatars.replaceAll(serialized.activeAvatars);
    overlayState.avatarLastActivity.replaceAll(serialized.avatarLastActivity);
    overlayState.avatarStates.replaceAll(serialized.avatarStates);
    if (Number.isFinite(serialized.avatarTimeoutSeconds)) {
      overlayState.avatarTimeoutSeconds = serialized.avatarTimeoutSeconds;
    }

    applyRaceState(overlayState.raceState, serialized.raceState);
    applyFoodState(overlayState.foodGameState, serialized.foodGameState);
    applyPlaneState(overlayState.planeGame, serialized.planeGame);
    applyRacePlanState(overlayState.racePlanState, serialized.racePlanState);
    overlayState.avatarMetrics.replaceAll(serialized.avatarMetrics);
  }

  overlayStateListeners.set(streamerId, state => {
    withSuppressedPersistence(() => applySerializedState(state));
  });

  function serializeState() {
    return {
      activeAvatars: Array.from(overlayState.activeAvatars),
      avatarLastActivity: Array.from(overlayState.avatarLastActivity.entries()),
      avatarStates: Array.from(overlayState.avatarStates.entries()),
      avatarTimeoutSeconds: overlayState.avatarTimeoutSeconds,
      raceState: {
        isActive: overlayState.raceState.isActive,
        participants: Array.from(overlayState.raceState.participants),
        participantNames: Array.from(overlayState.raceState.participantNames.entries()),
        positions: Array.from(overlayState.raceState.positions.entries()),
        speeds: Array.from(overlayState.raceState.speeds.entries()),
        modifiers: Array.from(overlayState.raceState.modifiers.entries()),
        maxParticipants: overlayState.raceState.maxParticipants,
        countdown: overlayState.raceState.countdown,
        raceStarted: overlayState.raceState.raceStarted,
        raceFinished: overlayState.raceState.raceFinished,
        winner: overlayState.raceState.winner,
        speedModifiers: Array.from(overlayState.raceState.speedModifiers.entries()),
        startTime: overlayState.raceState.startTime
      },
      foodGameState: {
        isActive: overlayState.foodGameState.isActive,
        participants: Array.from(overlayState.foodGameState.participants),
        participantNames: Array.from(overlayState.foodGameState.participantNames.entries()),
        scores: Array.from(overlayState.foodGameState.scores.entries()),
        directions: Array.from(overlayState.foodGameState.directions.entries()),
        speedModifiers: Array.from(overlayState.foodGameState.speedModifiers.entries()),
        carrots: overlayState.foodGameState.carrots,
        gameStarted: overlayState.foodGameState.gameStarted,
        gameFinished: overlayState.foodGameState.gameFinished,
        startTime: overlayState.foodGameState.startTime,
        winner: overlayState.foodGameState.winner
      },
      planeGame: {
        isActive: overlayState.planeGame.isActive,
        gameFinished: overlayState.planeGame.gameFinished,
        players: Array.from(overlayState.planeGame.players.entries()),
        obstacles: overlayState.planeGame.obstacles,
        lanes: overlayState.planeGame.lanes,
        maxLives: overlayState.planeGame.maxLives
      },
      racePlanState: {
        isActive: overlayState.racePlanState.isActive,
        participants: Array.from(overlayState.racePlanState.participants),
        participantNames: Array.from(overlayState.racePlanState.participantNames.entries()),
        positions: Array.from(overlayState.racePlanState.positions.entries()),
        levels: Array.from(overlayState.racePlanState.levels.entries()),
        lives: Array.from(overlayState.racePlanState.lives.entries()),
        obstacles: overlayState.racePlanState.obstacles,
        gameStarted: overlayState.racePlanState.gameStarted,
        gameFinished: overlayState.racePlanState.gameFinished,
        startTime: overlayState.racePlanState.startTime,
        winner: overlayState.racePlanState.winner,
        maxParticipants: overlayState.racePlanState.maxParticipants,
        trackWidth: overlayState.racePlanState.trackWidth
      },
      avatarMetrics: Array.from(overlayState.avatarMetrics.entries())
    };
  }

  // Attempt to hydrate from Redis snapshot if available
  if (redis) {
    (async () => {
      try {
        const payload = await redis.get(stateKey);
        if (!payload) {
          return;
        }
        const parsed = JSON.parse(payload);
        if (parsed && parsed.state) {
          withSuppressedPersistence(() => applySerializedState(parsed.state));
        }
      } catch (error) {
        console.error(`[overlay-state] Failed to hydrate Redis state for ${streamerId}:`, error);
      }
    })();
  }

  return {
    state: overlayState,
    touch: schedulePersist,
    flush: persistNow
  };
}

module.exports = { createOverlayState };
