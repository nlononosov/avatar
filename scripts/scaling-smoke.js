#!/usr/bin/env node
/**
 * Simple scaling smoke test to validate infrastructure expectations:
 * 1. verifies that /metrics endpoint responds
 * 2. opens several SSE connections to /overlay/events and ensures heartbeat frames arrive
 */

const { setTimeout: sleep } = require('timers/promises');

const BASE_URL = process.env.SCALING_BASE_URL || 'http://localhost:3000';
const STREAMER_ID = process.env.SCALING_STREAMER_ID || 'scaling-smoke-test';
const SSE_CONNECTIONS = Number(process.env.SCALING_SSE_CONNECTIONS || 5);
const HEARTBEAT_TIMEOUT_MS = Number(process.env.SCALING_HEARTBEAT_TIMEOUT_MS || 30000);

async function fetchMetrics() {
  const res = await fetch(new URL('/metrics', BASE_URL));
  if (!res.ok) {
    throw new Error(`/metrics responded with status ${res.status}`);
  }
  const text = await res.text();
  if (!text.includes('overlay_sse_connections')) {
    throw new Error('Metrics response does not contain overlay_sse_connections gauge');
  }
  return text.length;
}

async function openSseConnection(index) {
  const controller = new AbortController();
  const url = new URL('/overlay/events', BASE_URL);
  url.searchParams.set('streamer_id', STREAMER_ID);

  const res = await fetch(url, { signal: controller.signal });
  if (!res.ok) {
    throw new Error(`SSE connection #${index} failed with status ${res.status}`);
  }

  const reader = res.body.getReader();
  let lastHeartbeat = Date.now();
  let buffer = '';

  async function readLoop() {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        throw new Error(`SSE connection #${index} closed prematurely`);
      }
      buffer += new TextDecoder().decode(value);
      if (buffer.includes('\n\n')) {
        const frames = buffer.split('\n\n');
        buffer = frames.pop();
        for (const frame of frames) {
          if (frame.startsWith(':')) {
            lastHeartbeat = Date.now();
          }
        }
      }
      if (Date.now() - lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
        throw new Error(`SSE connection #${index} did not receive heartbeat within ${HEARTBEAT_TIMEOUT_MS}ms`);
      }
    }
  }

  const watchdog = (async () => {
    while (true) {
      await sleep(HEARTBEAT_TIMEOUT_MS / 2);
      if (Date.now() - lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
        controller.abort();
        throw new Error(`SSE connection #${index} heartbeat watchdog triggered`);
      }
    }
  })();

  return Promise.race([
    readLoop(),
    watchdog,
    sleep(HEARTBEAT_TIMEOUT_MS).then(() => {
      controller.abort();
      return { index, status: 'ok', lastHeartbeat };
    })
  ]);
}

(async () => {
  try {
    console.log(`[scaling] Checking metrics endpoint at ${BASE_URL}/metrics`);
    const metricsSize = await fetchMetrics();
    console.log(`[scaling] Metrics endpoint reachable (${metricsSize} bytes)`);

    console.log(`[scaling] Opening ${SSE_CONNECTIONS} overlay SSE connections to streamer "${STREAMER_ID}"`);
    const results = await Promise.allSettled(Array.from({ length: SSE_CONNECTIONS }, (_, i) => openSseConnection(i + 1)));

    const failures = results.filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
      failures.forEach((failure) => console.error('[scaling] SSE failure:', failure.reason));
      process.exitCode = 1;
    } else {
      console.log('[scaling] SSE heartbeat check passed');
    }
  } catch (error) {
    console.error('[scaling] Smoke test failed:', error);
    process.exitCode = 1;
  }
})();
