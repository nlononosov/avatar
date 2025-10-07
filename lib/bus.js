// Simple SSE event bus for overlay events (JSON payloads)
const subscribers = new Set();
const streamerChannels = new Map(); // streamerId -> Set of responses
const eventHandlers = new Map(); // eventName -> Set of handlers

function overlayEventsHandler(req, res) {
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
  const streamerDA = getStreamerDA(streamerId);
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
    streamerChannels.get(streamerId).delete(res);
    if (streamerChannels.get(streamerId).size === 0) {
      streamerChannels.delete(streamerId);
      console.log(`[bus] Removed empty channel for streamer ${streamerId}`);
    }
  });
}

function emit(event, payload) {
  const data = JSON.stringify(payload || {});
  console.log(`[bus] Emitting event "${event}" to ${subscribers.size} global subscribers:`, payload);
  
  if (subscribers.size === 0) {
    console.log(`[bus] WARNING: No global subscribers for event "${event}" - overlay might not be open`);
  }
  
  for (const res of subscribers) {
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${data}\n\n`);
    } catch (error) {
      console.log(`[bus] Error writing to global subscriber:`, error.message);
      subscribers.delete(res);
    }
  }
}

function emitToStreamer(streamerId, event, payload) {
  const data = JSON.stringify(payload || {});
  const streamerSubscribers = streamerChannels.get(streamerId);
  
  if (!streamerSubscribers || streamerSubscribers.size === 0) {
    console.log(`[bus] WARNING: No subscribers for streamer ${streamerId} for event "${event}"`);
    return;
  }
  
  console.log(`[bus] Emitting event "${event}" to streamer ${streamerId} (${streamerSubscribers.size} subscribers):`, payload);
  
  // Вызываем обработчики событий
  triggerEventHandlers(event, payload);
  
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

function getSubscriberCount() {
  return subscribers.size;
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


