const { getStreamerOverlayState, setStreamerOverlayState } = require('../../db');

class PersistentSet extends Set {
  constructor(iterable, onChange) {
    super(iterable);
    this.onChange = onChange;
  }

  add(value) {
    const sizeBefore = this.size;
    super.add(value);
    if (this.size !== sizeBefore) {
      this.onChange();
    }
    return this;
  }

  delete(value) {
    const existed = super.delete(value);
    if (existed) {
      this.onChange();
    }
    return existed;
  }

  clear() {
    if (this.size > 0) {
      super.clear();
      this.onChange();
    }
  }
}

class PersistentMap extends Map {
  constructor(iterable, onChange) {
    super(iterable);
    this.onChange = onChange;
  }

  set(key, value) {
    const had = this.has(key);
    const prev = had ? super.get(key) : undefined;
    super.set(key, value);
    if (!had || prev !== value) {
      this.onChange();
    }
    return this;
  }

  delete(key) {
    const existed = super.delete(key);
    if (existed) {
      this.onChange();
    }
    return existed;
  }

  clear() {
    if (this.size > 0) {
      super.clear();
      this.onChange();
    }
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

  let persistTimer = null;
  const raw = getStreamerOverlayState(streamerId) || {};

  const overlayState = {};

  function persistNow() {
    const serialized = serializeState();
    setStreamerOverlayState(streamerId, serialized);
  }

  function schedulePersist() {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persistNow();
    }, 200);
  }

  const makeSet = data => new PersistentSet(toArray(data), schedulePersist);
  const makeMap = data => new PersistentMap(toEntries(data), schedulePersist);

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

  overlayState.activeAvatars = makeSet(raw.activeAvatars);
  overlayState.avatarLastActivity = makeMap(raw.avatarLastActivity);
  overlayState.avatarStates = makeMap(raw.avatarStates);
  overlayState.avatarTimeoutSeconds = Number.isFinite(raw.avatarTimeoutSeconds) ? raw.avatarTimeoutSeconds : 300;
  overlayState.raceState = restoreRaceState(raw.raceState);
  overlayState.foodGameState = restoreFoodGameState(raw.foodGameState);
  overlayState.planeGame = restorePlaneGame(raw.planeGame);
  overlayState.racePlanState = restoreRacePlanState(raw.racePlanState);
  overlayState.avatarMetrics = makeMap(raw.avatarMetrics);

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

  return {
    state: overlayState,
    touch: schedulePersist,
    flush: persistNow
  };
}

module.exports = { createOverlayState };
