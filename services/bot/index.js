const fs = require('fs');
const path = require('path');
const Module = require('module');

const SINGLE_BOT_PATH = path.join(__dirname, 'single.js');
const singleBotSource = fs.readFileSync(SINGLE_BOT_PATH, 'utf8');

const instances = new Map();

function createInstance(streamerId) {
  const moduleFilename = `${SINGLE_BOT_PATH}?uid=${streamerId}`;
  const botModule = new Module(moduleFilename, module.parent);
  botModule.filename = moduleFilename;
  botModule.paths = Module._nodeModulePaths(path.dirname(SINGLE_BOT_PATH));
  botModule._compile(singleBotSource, moduleFilename);
  return botModule.exports;
}

function getInstance(streamerId) {
  if (!streamerId) {
    throw new Error('streamerId is required');
  }

  let instance = instances.get(streamerId);
  if (!instance) {
    instance = createInstance(streamerId);
    instances.set(streamerId, instance);
  }
  return instance;
}

function getExistingInstance(streamerId) {
  return instances.get(streamerId);
}

async function ensureBotFor(streamerId) {
  const instance = getInstance(streamerId);
  return instance.ensureBotFor(streamerId);
}

async function stopBot(streamerId) {
  if (!streamerId) {
    const ids = Array.from(instances.keys());
    const results = await Promise.all(ids.map(async id => {
      const inst = instances.get(id);
      if (!inst) return false;
      const stopped = await inst.stopBot();
      if (stopped) {
        instances.delete(id);
      }
      return stopped;
    }));
    return results.some(Boolean);
  }

  const instance = getExistingInstance(streamerId);
  if (!instance) {
    return false;
  }
  const stopped = await instance.stopBot();
  if (stopped) {
    instances.delete(streamerId);
  }
  return stopped;
}

function status(streamerId) {
  if (streamerId) {
    const instance = getExistingInstance(streamerId);
    return instance ? instance.status() : { streamerId, running: false };
  }

  const bots = {};
  for (const [id, inst] of instances.entries()) {
    bots[id] = inst.status();
  }
  return {
    running: instances.size > 0,
    bots
  };
}

function proxyCall(streamerId, method, args, optional = false) {
  const instance = optional ? getExistingInstance(streamerId) : getInstance(streamerId);
  if (!instance) {
    return null;
  }
  const fn = instance[method];
  if (typeof fn !== 'function') {
    throw new Error(`Method ${method} is not available on bot instance`);
  }
  return fn(...args);
}

function getBotClient(streamerId) {
  return proxyCall(streamerId, 'getBotClient', [], true);
}

function getBotChannel(streamerId) {
  return proxyCall(streamerId, 'getBotChannel', [], true);
}

function addActiveAvatar(streamerId, userId) {
  return proxyCall(streamerId, 'addActiveAvatar', [userId]);
}

function removeActiveAvatar(streamerId, userId) {
  return proxyCall(streamerId, 'removeActiveAvatar', [userId]);
}

function finishRace(streamerId, ...args) {
  return proxyCall(streamerId, 'finishRace', args, true);
}

function finishFoodGame(streamerId, ...args) {
  return proxyCall(streamerId, 'finishFoodGame', args, true);
}

function startRace(streamerId, ...args) {
  return proxyCall(streamerId, 'startRace', args);
}

function startFoodGame(streamerId, ...args) {
  return proxyCall(streamerId, 'startFoodGame', args);
}

function checkFoodGameCommand(streamerId, ...args) {
  return proxyCall(streamerId, 'checkFoodGameCommand', args, true);
}

function checkFoodGameCheering(streamerId, ...args) {
  return proxyCall(streamerId, 'checkFoodGameCheering', args, true);
}

function checkCarrotCollisions(streamerId, ...args) {
  return proxyCall(streamerId, 'checkCarrotCollisions', args, true);
}

function spawnCarrot(streamerId, ...args) {
  return proxyCall(streamerId, 'spawnCarrot', args, true);
}

function joinFoodGame(streamerId, ...args) {
  return proxyCall(streamerId, 'joinFoodGame', args, true);
}

function startFoodGameCountdown(streamerId, ...args) {
  return proxyCall(streamerId, 'startFoodGameCountdown', args, true);
}

function startFoodGameMonitoring(streamerId, ...args) {
  return proxyCall(streamerId, 'startFoodGameMonitoring', args, true);
}

function setAvatarTimeoutSeconds(streamerId, seconds) {
  return proxyCall(streamerId, 'setAvatarTimeoutSeconds', [seconds], true);
}

function getAvatarTimeoutSeconds(streamerId) {
  return proxyCall(streamerId, 'getAvatarTimeoutSeconds', [], true);
}

function startRacePlan(streamerId, ...args) {
  return proxyCall(streamerId, 'startRacePlan', args);
}

function joinRacePlan(streamerId, ...args) {
  return proxyCall(streamerId, 'joinRacePlan', args);
}

function checkRacePlanCommand(streamerId, ...args) {
  return proxyCall(streamerId, 'checkRacePlanCommand', args, true);
}

function checkRacePlanCheering(streamerId, ...args) {
  return proxyCall(streamerId, 'checkRacePlanCheering', args, true);
}

function spawnObstacle(streamerId, ...args) {
  return proxyCall(streamerId, 'spawnObstacle', args, true);
}

function checkRacePlanCollisions(streamerId, ...args) {
  return proxyCall(streamerId, 'checkRacePlanCollisions', args, true);
}

function handleRacePlanCollision(streamerId, ...args) {
  return proxyCall(streamerId, 'handleRacePlanCollision', args, true);
}

function finishRacePlan(streamerId, ...args) {
  return proxyCall(streamerId, 'finishRacePlan', args, true);
}

function setAvatarMetrics(streamerId, ...args) {
  return proxyCall(streamerId, 'setAvatarMetrics', args, true);
}

function getGame(streamerId) {
  const instance = getExistingInstance(streamerId);
  return instance ? instance.Game : null;
}

function getRacePlanState(streamerId) {
  const instance = getExistingInstance(streamerId);
  return instance ? instance.racePlanState : null;
}

module.exports = {
  ensureBotFor,
  stopBot,
  status,
  getBotClient,
  getBotChannel,
  addActiveAvatar,
  removeActiveAvatar,
  finishRace,
  finishFoodGame,
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
  getGame,
  getRacePlanState
};
