const path = require('path');
const crypto = require('crypto');
const { BASE_URL, CLIENT_ID, CLIENT_SECRET, SCOPES } = require('../lib/config');
const { logLine } = require('../lib/logger');
const { saveOrUpdateUser } = require('../db');

function registerAuthRoutes(app) {
  app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
  });

  app.get('/auth/status', (req, res) => {
    const uid = req.cookies.uid;
    res.json({ authenticated: Boolean(uid) });
  });

  app.get('/auth/twitch/init', (req, res) => {
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
    res.json({ authorizeUrl: url });
  });

  app.get('/auth/twitch', (req, res) => {
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
  });

  app.get('/auth/twitch/callback', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const { code, state, error, error_description } = req.query;
    const savedState = req.cookies.oauth_state;
    res.clearCookie('oauth_state');
    res.clearCookie('force_login');

    if (error) {
      return res.status(400).send(`<meta charset="utf-8"><pre>OAuth error: ${error} — ${error_description || ''}</pre>`);
    }
    if (!state || !savedState || state !== savedState) {
      return res.status(400).send(`<meta charset="utf-8"><pre>Invalid OAuth state</pre><script>setTimeout(()=>window.close(),1)</script>`);
    }
    if (!code) return res.status(400).send(`<meta charset="utf-8"><pre>Missing code</pre>`);

    try {
      const redirectUri = `${BASE_URL}/auth/twitch/callback`;
      const tokenParams = new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri
      });

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
      const tokenData = await tokenResp.json();

      const userResp = await fetch('https://api.twitch.tv/helix/users', {
        headers: { Authorization: `Bearer ${tokenData.access_token}`, 'Client-ID': CLIENT_ID }
      });
      if (!userResp.ok) {
        const txt = await userResp.text();
        logLine(`[oauth] get user failed: ${userResp.status} ${txt}`);
        return res.status(500).send(`<meta charset=\"utf-8\"><pre>Failed to fetch user</pre>`);
      }
      const userJson = await userResp.json();
      const user = (userJson.data && userJson.data[0]) || null;
      if (!user) return res.status(500).send(`<meta charset="utf-8"><pre>User payload empty</pre>`);

      const expiresAt = tokenData.expires_in ? Math.floor(Date.now() / 1000) + Number(tokenData.expires_in) : null;
      saveOrUpdateUser({
        twitch_user_id: String(user.id),
        display_name: user.display_name || user.login,
        login: user.login,
        profile_image_url: user.profile_image_url || null,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || null,
        scope: tokenData.scope || SCOPES,
        expires_at: expiresAt
      });

      res.cookie('uid', String(user.id), { httpOnly: false, sameSite: 'lax' });

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


