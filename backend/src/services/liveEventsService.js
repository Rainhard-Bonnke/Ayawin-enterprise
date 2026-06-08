/** In-process pub/sub for WebSocket broadcasts per company. */

const companySockets = new Map();

function addClient(companyId, ws) {
  const key = String(companyId);
  if (!companySockets.has(key)) companySockets.set(key, new Set());
  companySockets.get(key).add(ws);
  ws.on('close', () => {
    companySockets.get(key)?.delete(ws);
  });
}

function broadcast(companyId, event) {
  const key = String(companyId);
  const payload = JSON.stringify({ ...event, ts: new Date().toISOString() });
  const sockets = companySockets.get(key);
  if (!sockets) return;
  for (const ws of sockets) {
    if (ws.readyState === 1) {
      try {
        ws.send(payload);
      } catch {
        /* ignore */
      }
    }
  }
}

function publish(companyId, type, data = {}) {
  broadcast(companyId, { type, data });
}

module.exports = { addClient, broadcast, publish };
