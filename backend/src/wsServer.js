const { WebSocketServer } = require('ws');
const tokenService = require('./services/tokenService');
const userService = require('./services/userService');
const tokenBlacklist = require('./services/tokenBlacklistService');
const liveEvents = require('./services/liveEventsService');

function attachWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', async (ws, req) => {
    try {
      const url = new URL(req.url || '/ws', 'http://localhost');
      const token = url.searchParams.get('token');
      if (!token) {
        ws.close(4001, 'token required');
        return;
      }

      const payload = tokenService.verifyAccessToken(token);
      if (payload.type !== 'access') {
        ws.close(4003, 'invalid token');
        return;
      }
      if (payload.jti && (await tokenBlacklist.isAccessTokenRevoked(payload.jti))) {
        ws.close(4003, 'token revoked');
        return;
      }

      const user = await userService.findUserById(payload.sub);
      if (!user || user.status !== 'active') {
        ws.close(4003, 'inactive user');
        return;
      }

      ws.companyId = user.company_id;
      ws.userId = user.id;
      liveEvents.addClient(user.company_id, ws);
      ws.send(JSON.stringify({ type: 'connected', data: { user_id: user.id } }));

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(String(raw));
          if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
        } catch {
          /* ignore */
        }
      });
    } catch {
      ws.close(4003, 'auth failed');
    }
  });

  return wss;
}

module.exports = { attachWebSocketServer };
