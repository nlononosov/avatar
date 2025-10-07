// Simple SSE event bus for overlay events (JSON payloads)
const { getRedisClient, createRedisSubscriber, redisInstanceId } = require('./redis');

const redis = getRedisClient();
const redisSubscriber = createRedisSubscriber('overlay-events');

const GLOBAL_CHANNEL = 'overlay:events:global';
const STREAMER_CHANNEL_PREFIX = 'overlay:events:streamer:';

const subscribers = new Set();
const streamerChannels = new Map(); // streamerId -> Set of responses
const eventHandlers = new Map(); // eventName -> Set of handlers

function safeParse(message) {
  try {
    return JSON.parse(message);
  } catch (error) {
    console.error('[bus] Failed to parse Redis payload:', error);
    return null;
  }
}

function deliverGlobal(event, payload) {
  const data = JSON.stringify(payload || {});
  console.log(`[bus] Delivering global event "${event}" to ${subscribers.size} subscribers`);
  for (const res of subscribers) {
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${data}\n\n`);
    } catch (error) {
      console.log('[bus] Error writing to global subscriber:', error.message);
      subscribers.delete(res);
    }
  }
}

function deliverToStreamer(streamerId, event, payload) {
  const data = JSON.stringify(payload || {});
  const streamerSubscribers = streamerChannels.get(streamerId);

  if (!streamerSubscribers || streamerSubscribers.size === 0) {
    console.log(`[bus] WARNING: No subscribers for streamer ${streamerId} for event "${event}"`);
  }

  console.log(`[bus] Delivering event "${event}" to streamer ${streamerId} (${streamerSubscribers ? streamerSubscribers.size : 0} subscribers)`);

  triggerEventHandlers(event, payload);

  if (!streamerSubscribers) {
    return;
  }

  for (const res of streamerSubscribers) {
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${data}\n\n`);
    } catch (error) {
      console.log(`[bus] Error writing to streamer ${streamerId} subscriber:`, error.message);
      streamerSubscribers.delete(res);
    }
  }
}

redisSubscriber.subscribe(GLOBAL_CHANNEL, err => {
  if (err) {
    console.error('[bus] Failed to subscribe to global channel:', err);
  }
});

redisSubscriber.psubscribe(`${STREAMER_CHANNEL_PREFIX}*`, err => {
  if (err) {
    console.error('[bus] Failed to psubscribe streamer channel pattern:', err);
  }
});

redisSubscriber.on('message', (channel, message) => {
  if (channel !== GLOBAL_CHANNEL) return;
  const payload = safeParse(message);
  if (!payload || payload.source === redisInstanceId) return;
  deliverGlobal(payload.event, payload.data);
});

redisSubscriber.on('pmessage', (pattern, channel, message) => {
  if (!channel.startsWith(STREAMER_CHANNEL_PREFIX)) return;
  const payload = safeParse(message);
  if (!payload || payload.source === redisInstanceId) return;
  const streamerId = channel.slice(STREAMER_CHANNEL_PREFIX.length);
  deliverToStreamer(streamerId, payload.event, payload.data);
});

async function overlayEventsHandler(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // Get streamer ID from query parameter
  const streamerId = req.query.streamer_id || req.query.streamer;
  console.log(`[bus] New overlay connection, streamerId: "${streamerId}", query:`, req.query);
  
  if (!streamerId) {
    console.error(`[bus] ERROR: No streamer_id provided in query parameters`);
    res.write('event: error\n');
    res.write('data: {"error": "streamer_id parameter is required"}\n\n');
    res.end();
    return;
  }
  
  // Validate that streamer exists (optional check)
  const { getStreamerDA } = require('../db');
  let streamerDA = null;
  try {
    streamerDA = await getStreamerDA(streamerId);
  } catch (error) {
    console.error(`[bus] Failed to load DonationAlerts creds for ${streamerId}:`, error);
  }
  if (!streamerDA) {
    console.warn(`[bus] WARNING: No DA credentials found for streamer ${streamerId}`);
    // Не блокируем подключение, просто предупреждаем
  }
  
  // Add to specific streamer channel
  if (!streamerChannels.has(streamerId)) {
    streamerChannels.set(streamerId, new Set());
    console.log(`[bus] Created new channel for streamer ${streamerId}`);
  }
  streamerChannels.get(streamerId).add(res);
  console.log(`[bus] Added subscriber for streamer ${streamerId}, total: ${streamerChannels.get(streamerId).size}`);

  req.on('close', () => {
    const set = streamerChannels.get(streamerId);
    if (!set) {
      return;
    }
    set.delete(res);
    if (set.size === 0) {
      streamerChannels.delete(streamerId);
      console.log(`[bus] Removed empty channel for streamer ${streamerId}`);
    }
  });
}

function emit(event, payload) {
  deliverGlobal(event, payload);
  const message = JSON.stringify({ event, data: payload || {}, source: redisInstanceId });
  redis.publish(GLOBAL_CHANNEL, message).catch(err => {
    console.error('[bus] Failed to publish global event:', err);
  });
}

function emitToStreamer(streamerId, event, payload) {
  deliverToStreamer(streamerId, event, payload);
  const message = JSON.stringify({ event, data: payload || {}, source: redisInstanceId });
  redis.publish(`${STREAMER_CHANNEL_PREFIX}${streamerId}`, message).catch(err => {
    console.error(`[bus] Failed to publish streamer event ${event} for ${streamerId}:`, err);
  });
}

function getSubscriberCount() {
  let total = subscribers.size;
  for (const set of streamerChannels.values()) {
    total += set.size;
  }
  return total;
}

function getStreamerSubscriberCount(streamerId) {
  const streamerSubscribers = streamerChannels.get(streamerId);
  return streamerSubscribers ? streamerSubscribers.size : 0;
}

function getAllSubscriberCounts() {
  const counts = { global: subscribers.size };
  for (const [streamerId, streamerSubscribers] of streamerChannels) {
    counts[streamerId] = streamerSubscribers.size;
  }
  return counts;
}

// Функция для подписки на события
function on(eventName, handler) {
  if (!eventHandlers.has(eventName)) {
    eventHandlers.set(eventName, new Set());
  }
  eventHandlers.get(eventName).add(handler);
  console.log(`[bus] Added handler for event "${eventName}"`);
}

// Функция для отписки от событий
function off(eventName, handler) {
  if (eventHandlers.has(eventName)) {
    eventHandlers.get(eventName).delete(handler);
    console.log(`[bus] Removed handler for event "${eventName}"`);
  }
}

// Функция для вызова обработчиков событий
function triggerEventHandlers(eventName, data) {
  if (eventHandlers.has(eventName)) {
    const handlers = eventHandlers.get(eventName);
    for (const handler of handlers) {
      try {
        handler(data);
      } catch (error) {
        console.error(`[bus] Error in event handler for "${eventName}":`, error);
      }
    }
  }
}

module.exports = { overlayEventsHandler, emit, emitToStreamer, getSubscriberCount, getStreamerSubscriberCount, getAllSubscriberCounts, on, off, triggerEventHandlers };


