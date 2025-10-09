const axios = require('axios');
const crypto = require('crypto');
const { DA_CLIENT_ID, DA_CLIENT_SECRET, DA_REDIRECT_URI } = require('./config');

// DonationAlerts OAuth URLs
const DA_AUTH_URL = 'https://www.donationalerts.com/oauth/authorize';
const DA_TOKEN_URL = 'https://www.donationalerts.com/oauth/token';
const DA_USER_INFO_URL = 'https://www.donationalerts.com/api/v1/user/oauth';

// Generate state parameter for CSRF protection
function generateState() {
  return crypto.randomBytes(32).toString('hex');
}

// Get DonationAlerts authorization URL
function getAuthUrl() {
  const state = generateState();
  const params = new URLSearchParams({
    client_id: DA_CLIENT_ID,
    redirect_uri: DA_REDIRECT_URI,
    response_type: 'code',
    scope: 'oauth-user-show oauth-donation-index',
    state: state
  });
  
  return {
    url: `${DA_AUTH_URL}?${params.toString()}`,
    state: state
  };
}

// Exchange authorization code for access token
async function exchangeCodeForToken(code) {
  try {
    const response = await axios.post(DA_TOKEN_URL, {
      grant_type: 'authorization_code',
      client_id: DA_CLIENT_ID,
      client_secret: DA_CLIENT_SECRET,
      redirect_uri: DA_REDIRECT_URI,
      code: code
    }, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    
    return response.data;
  } catch (error) {
    console.error('[DA OAuth] Error exchanging code for token:', error.response?.data || error.message);
    throw error;
  }
}

// Get user info from DonationAlerts
async function getUserInfo(accessToken) {
  try {
    const response = await axios.get(DA_USER_INFO_URL, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    return response.data.data;
  } catch (error) {
    console.error('[DA OAuth] Error getting user info:', error.response?.data || error.message);
    throw error;
  }
}

// Get user donations from DonationAlerts
async function getUserDonations(accessToken, limit = 10) {
  try {
    const response = await axios.get('https://www.donationalerts.com/api/v1/alerts/donations', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      params: {
        limit: limit,
        sort: 'created_at',
        order: 'desc'
      }
    });
    
    return response.data.data || [];
  } catch (error) {
    console.error('[DA OAuth] Error getting user donations:', error.response?.data || error.message);
    throw error;
  }
}

module.exports = {
  getAuthUrl,
  exchangeCodeForToken,
  getUserInfo,
  getUserDonations,
  DA_CLIENT_ID,
  DA_REDIRECT_URI
};
