const fs = require('fs');
const path = require('path');
const Module = require('module');

const SINGLE_BOT_PATH = path.join(__dirname, 'bot-single.js');
const SINGLE_BOT_CODE = fs.readFileSync(SINGLE_BOT_PATH, 'utf8');

const botInstances = new Map();

function createInstance(streamerId) {
  const botModule = new Module(SINGLE_BOT_PATH, module);
  botModule.filename = SINGLE_BOT_PATH;
  botModule.paths = Module._nodeModulePaths(path.dirname(SINGLE_BOT_PATH));
  botModule._compile(SINGLE_BOT_CODE, SINGLE_BOT_PATH);
  const api = botModule.exports;
  return { api, streamerId };
}

function getInstance(streamerId) {
  if (!streamerId) {
    throw new Error('streamerId is required for multi-streamer bot operations');
  }
  if (!botInstances.has(streamerId)) {
    botInstances.set(streamerId, createInstance(streamerId));
  }
  return botInstances.get(streamerId);
}

function hasInstance(streamerId) {
  return botInstances.has(streamerId);
}

function call(streamerId, method, ...args) {
  const instance = getInstance(streamerId);
  const fn = instance.api[method];
  if (typeof fn !== 'function') {
    throw new Error(`Bot instance for ${streamerId} has no method ${method}`);
  }
  return fn(...args);
}

async function ensureBotFor(streamerId) {
  return call(streamerId, 'ensureBotFor', String(streamerId));
}

async function stopBot(streamerId) {
  if (!hasInstance(streamerId)) {
    return false;
  }
  const result = await call(streamerId, 'stopBot');
  return result;
}

function status(streamerId) {
  if (!hasInstance(streamerId)) {
    return {
      running: false,
      for_user: String(streamerId) || null,
      activeAvatars: []
    };
  }
  return call(streamerId, 'status');
}

function statusAll() {
  const summary = {};
  for (const [streamerId, instance] of botInstances.entries()) {
    summary[streamerId] = instance.api.status();
  }
  return summary;
}

function addActiveAvatar(streamerId, userId) {
  return call(streamerId, 'addActiveAvatar', userId);
}

function removeActiveAvatar(streamerId, userId) {
  if (!hasInstance(streamerId)) {
    return;
  }
  return call(streamerId, 'removeActiveAvatar', userId);
}

function finishRace(streamerId, winnerId, client, channel) {
  return call(streamerId, 'finishRace', winnerId, client, channel);
}

function finishFoodGame(streamerId, winnerName, client, channel) {
  return call(streamerId, 'finishFoodGame', winnerName, client, channel);
}

function getBotClient(streamerId) {
  if (!hasInstance(streamerId)) return null;
  return call(streamerId, 'getBotClient');
}

function getBotChannel(streamerId) {
  if (!hasInstance(streamerId)) return null;
  return call(streamerId, 'getBotChannel');
}

function startRace(streamerId, client, channel, settings) {
  return call(streamerId, 'startRace', client, channel, settings);
}

function startFoodGame(streamerId, client, channel, settings) {
  return call(streamerId, 'startFoodGame', client, channel, settings);
}

function checkFoodGameCommand(streamerId, ...args) {
  if (!hasInstance(streamerId)) return;
  return call(streamerId, 'checkFoodGameCommand', ...args);
}

function checkFoodGameCheering(streamerId, ...args) {
  if (!hasInstance(streamerId)) return;
  return call(streamerId, 'checkFoodGameCheering', ...args);
}

function checkCarrotCollisions(streamerId, ...args) {
  if (!hasInstance(streamerId)) return;
  return call(streamerId, 'checkCarrotCollisions', ...args);
}

function spawnCarrot(streamerId, ...args) {
  if (!hasInstance(streamerId)) return;
  return call(streamerId, 'spawnCarrot', ...args);
}

function joinFoodGame(streamerId, ...args) {
  return call(streamerId, 'joinFoodGame', ...args);
}

function startFoodGameCountdown(streamerId, ...args) {
  return call(streamerId, 'startFoodGameCountdown', ...args);
}

function startFoodGameMonitoring(streamerId, ...args) {
  return call(streamerId, 'startFoodGameMonitoring', ...args);
}

function setAvatarTimeoutSeconds(streamerId, seconds) {
  return call(streamerId, 'setAvatarTimeoutSeconds', seconds);
}

function getAvatarTimeoutSeconds(streamerId) {
  if (!hasInstance(streamerId)) return null;
  return call(streamerId, 'getAvatarTimeoutSeconds');
}

function startRacePlan(streamerId, ...args) {
  return call(streamerId, 'startRacePlan', ...args);
}

function joinRacePlan(streamerId, ...args) {
  return call(streamerId, 'joinRacePlan', ...args);
}

function checkRacePlanCommand(streamerId, ...args) {
  if (!hasInstance(streamerId)) return;
  return call(streamerId, 'checkRacePlanCommand', ...args);
}

function checkRacePlanCheering(streamerId, ...args) {
  if (!hasInstance(streamerId)) return;
  return call(streamerId, 'checkRacePlanCheering', ...args);
}

function spawnObstacle(streamerId, ...args) {
  if (!hasInstance(streamerId)) return;
  return call(streamerId, 'spawnObstacle', ...args);
}

function checkRacePlanCollisions(streamerId, ...args) {
  if (!hasInstance(streamerId)) return;
  return call(streamerId, 'checkRacePlanCollisions', ...args);
}

function handleRacePlanCollision(streamerId, ...args) {
  if (!hasInstance(streamerId)) return;
  return call(streamerId, 'handleRacePlanCollision', ...args);
}

function finishRacePlan(streamerId, ...args) {
  return call(streamerId, 'finishRacePlan', ...args);
}

function setAvatarMetrics(streamerId, ...args) {
  return call(streamerId, 'setAvatarMetrics', ...args);
}

function getGameState(streamerId) {
  return getInstance(streamerId).api.Game;
}

function getRacePlanState(streamerId) {
  return getInstance(streamerId).api.racePlanState;
}

module.exports = {
  ensureBotFor,
  stopBot,
  status,
  statusAll,
  addActiveAvatar,
  removeActiveAvatar,
  finishRace,
  finishFoodGame,
  getBotClient,
  getBotChannel,
  startRace,
  startFoodGame,
  checkFoodGameCommand,
  checkFoodGameCheering,
  checkCarrotCollisions,
  spawnCarrot,
  joinFoodGame,
  startFoodGameCountdown,
  startFoodGameMonitoring,
  setAvatarTimeoutSeconds,
  getAvatarTimeoutSeconds,
  startRacePlan,
  joinRacePlan,
  checkRacePlanCommand,
  checkRacePlanCheering,
  spawnObstacle,
  checkRacePlanCollisions,
  handleRacePlanCollision,
  finishRacePlan,
  setAvatarMetrics,
  getGameState,
  getRacePlanState
};
