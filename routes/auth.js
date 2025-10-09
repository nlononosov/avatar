const path = require('path');
const crypto = require('crypto');
const { BASE_URL, CLIENT_ID, CLIENT_SECRET, SCOPES } = require('../lib/config');
const { logLine } = require('../lib/logger');
const { saveOrUpdateUser } = require('../db');

function registerAuthRoutes(app) {
  app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
  });

  app.get('/auth/status', async (req, res) => {
    logLine('[auth] GET /auth/status');
    try {
      const uid = req.cookies.uid;
      logLine(`[auth] Checking status for uid: ${uid || 'none'}`);
      
      if (!uid) {
        logLine('[auth] No uid cookie, returning not authenticated');
        return res.json({ authenticated: false });
      }

      // Проверяем что пользователь существует в БД
      const { getUserByTwitchId } = require('../db');
      logLine(`[auth] Checking user in DB: ${uid}`);
      const user = await getUserByTwitchId(String(uid));
      
      if (!user) {
        // Удаляем невалидную куку
        logLine(`[auth] User ${uid} not found in DB, clearing cookie`);
        res.clearCookie('uid');
        return res.json({ authenticated: false });
      }
      
      logLine(`[auth] User ${uid} authenticated`);
      res.json({ authenticated: true });
    } catch (error) {
      logLine(`[auth] Error checking auth status: ${error.message}`);
      // В случае ошибки БД возвращаем не авторизован, чтобы не ломать работу
      res.status(500).json({ authenticated: false, error: 'Database connection error' });
    }
  });

  app.get('/auth/twitch/init', (req, res) => {
    logLine('[auth] GET /auth/twitch/init');
    try {
      const state = crypto.randomBytes(16).toString('hex');
      res.cookie('oauth_state', state, { httpOnly: true, sameSite: 'lax' });
      const redirectUri = `${BASE_URL}/auth/twitch/callback`;
      const forceLogin = Boolean(req.cookies.force_login);
      const params = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPES.join(' '),
        state
      });
      if (forceLogin) params.set('force_verify', 'true');
      const url = `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
      logLine(`[auth] Generated OAuth URL, state: ${state}`);
      res.json({ authorizeUrl: url });
    } catch (error) {
      logLine(`[auth] Error in /auth/twitch/init: ${error.message}`);
      res.status(500).json({ error: 'Failed to initialize OAuth', message: error.message });
    }
  });

  app.get('/auth/twitch', (req, res) => {
    try {
      const state = crypto.randomBytes(16).toString('hex');
      res.cookie('oauth_state', state, { httpOnly: true, sameSite: 'lax' });
      const redirectUri = `${BASE_URL}/auth/twitch/callback`;
      const forceLogin = Boolean(req.cookies.force_login);
      const params = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPES.join(' '),
        state
      });
      if (forceLogin) params.set('force_verify', 'true');
      res.redirect(`https://id.twitch.tv/oauth2/authorize?${params.toString()}`);
    } catch (error) {
      logLine(`[auth] Error in /auth/twitch: ${error.message}`);
      res.status(500).send(`<meta charset="utf-8"><pre>Ошибка инициализации OAuth: ${error.message}</pre>`);
    }
  });

  app.get('/auth/twitch/callback', async (req, res) => {
    logLine('[auth] GET /auth/twitch/callback');
    res.setHeader('Cache-Control', 'no-store');
    const { code, state, error, error_description } = req.query;
    const savedState = req.cookies.oauth_state;
    res.clearCookie('oauth_state');
    res.clearCookie('force_login');

    if (error) {
      logLine(`[oauth] OAuth error: ${error} - ${error_description}`);
      return res.status(400).send(`<meta charset="utf-8"><pre>OAuth error: ${error} — ${error_description || ''}</pre>`);
    }
    if (!state || !savedState || state !== savedState) {
      logLine(`[oauth] Invalid state: ${state} vs ${savedState}`);
      return res.status(400).send(`<meta charset="utf-8"><pre>Invalid OAuth state</pre><script>setTimeout(()=>window.close(),1)</script>`);
    }
    if (!code) {
      logLine('[oauth] Missing code');
      return res.status(400).send(`<meta charset="utf-8"><pre>Missing code</pre>`);
    }

    logLine('[oauth] Starting token exchange...');
    try {
      const redirectUri = `${BASE_URL}/auth/twitch/callback`;
      const tokenParams = new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri
      });

      logLine('[oauth] Fetching token from Twitch...');
      const tokenResp = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenParams.toString()
      });
      if (!tokenResp.ok) {
        const txt = await tokenResp.text();
        logLine(`[oauth] token exchange failed: ${tokenResp.status} ${txt}`);
        return res.status(500).send(`<meta charset="utf-8"><pre>Token exchange failed: ${tokenResp.status}\n${txt}</pre>`);
      }
      logLine('[oauth] Token received, parsing...');
      const tokenData = await tokenResp.json();

      logLine('[oauth] Fetching user data from Twitch...');
      const userResp = await fetch('https://api.twitch.tv/helix/users', {
        headers: { Authorization: `Bearer ${tokenData.access_token}`, 'Client-ID': CLIENT_ID }
      });
      if (!userResp.ok) {
        const txt = await userResp.text();
        logLine(`[oauth] get user failed: ${userResp.status} ${txt}`);
        return res.status(500).send(`<meta charset=\"utf-8\"><pre>Failed to fetch user</pre>`);
      }
      logLine('[oauth] User data received, parsing...');
      const userJson = await userResp.json();
      const user = (userJson.data && userJson.data[0]) || null;
      if (!user) {
        logLine('[oauth] User payload empty');
        return res.status(500).send(`<meta charset="utf-8"><pre>User payload empty</pre>`);
      }

      const expiresAt = tokenData.expires_in ? Math.floor(Date.now() / 1000) + Number(tokenData.expires_in) : null;
      const twitchUserId = String(user.id);
      
      logLine(`[oauth] User authenticated: ${user.login} (${twitchUserId})`);
      
      // Сохраняем пользователя (аватар создается автоматически в saveOrUpdateUser)
      logLine(`[oauth] Saving user to database: ${twitchUserId}...`);
      try {
        await saveOrUpdateUser({
          twitch_user_id: twitchUserId,
          display_name: user.display_name || user.login,
          login: user.login,
          profile_image_url: user.profile_image_url || null,
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token || null,
          scope: tokenData.scope || SCOPES,
          expires_at: expiresAt
        });
        logLine(`[oauth] User saved to DB: ${twitchUserId}`);
      } catch (saveError) {
        logLine(`[oauth] Error saving user: ${saveError.message}`);
        return res.status(500).send(`<meta charset="utf-8"><pre>Error saving user: ${saveError.message}</pre>`);
      }

      res.cookie('uid', twitchUserId, { httpOnly: false, sameSite: 'lax' });
      logLine(`[oauth] Cookie set for user: ${twitchUserId}`);

      return res.status(200).send(`
      <!doctype html><meta charset="utf-8">
      <script>
        try {
          if (window.opener) {
            window.opener.postMessage({type:'twitch_auth_ok'}, '*');
            window.close();
          } else {
            window.location = '/success';
          }
        } catch (e) { window.location = '/success'; }
      </script>
    `);
    } catch (err) {
      logLine(`[oauth] internal error: ${err?.message || err}`);
      return res.status(500).send(`<meta charset="utf-8"><pre>Internal error: ${err?.message || err}</pre>`);
    }
  });
}

module.exports = { registerAuthRoutes };


