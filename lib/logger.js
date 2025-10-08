// Lightweight logger with in-memory ring buffer and SSE helpers
const recentLogs = [];
const sseClients = new Set();

function logLine(line) {
  const msg = `[${new Date().toLocaleTimeString()}] ${line}`;
  recentLogs.push(msg);
  if (recentLogs.length > 200) recentLogs.shift();
  for (const res of sseClients) res.write(`data: ${msg}\n\n`);
  // Also mirror to stdout without the timestamp prefix duplication
  console.log(line);
}

function sseHandler(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  for (const l of recentLogs) res.write(`data: ${l}\n\n`);
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
}

module.exports = { logLine, sseHandler };


