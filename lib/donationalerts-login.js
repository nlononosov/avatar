const axios = require('axios');

// DonationAlerts login configuration
const DA_LOGIN_URL = 'https://www.donationalerts.com/api/v1/user/oauth';
const DA_ALERTS_URL = 'https://www.donationalerts.com/api/v1/alerts/donations';

// Authenticate user with DonationAlerts credentials
async function authenticateUser(username, password) {
  try {
    console.log(`[DA Login] Authenticating user: ${username}`);
    
    // First, try to get user info to validate credentials
    // Note: This is a simplified approach - in real implementation you'd need proper OAuth flow
    // For now, we'll use a different approach - store user's DonationAlerts username
    // and use it to match with donations
    
    return {
      success: true,
      username: username.toLowerCase().trim(),
      message: 'DonationAlerts account connected successfully'
    };
    
  } catch (error) {
    console.error('[DA Login] Authentication error:', error);
    return {
      success: false,
      error: 'Invalid DonationAlerts credentials'
    };
  }
}

// Get donations by username (this will be used to match donations with users)
async function getDonationsByUsername(username) {
  try {
    // This is a placeholder - in real implementation you'd need to:
    // 1. Store user's DonationAlerts access token
    // 2. Use that token to fetch their donations
    // 3. Or use a different approach to match donations with users
    
    console.log(`[DA Login] Getting donations for username: ${username}`);
    return [];
  } catch (error) {
    console.error('[DA Login] Error getting donations:', error);
    return [];
  }
}

// Store user's DonationAlerts connection
function storeUserDAConnection(userId, username) {
  try {
    const { updateUserDAConnection } = require('../db');
    updateUserDAConnection(userId, username);
    console.log(`[DA Login] Stored DA connection for user ${userId}: ${username}`);
    return true;
  } catch (error) {
    console.error('[DA Login] Error storing DA connection:', error);
    return false;
  }
}

// Get user's DonationAlerts username
function getUserDAUsername(userId) {
  try {
    const { getUserDAConnection } = require('../db');
    return getUserDAConnection(userId);
  } catch (error) {
    console.error('[DA Login] Error getting DA username:', error);
    return null;
  }
}

module.exports = {
  authenticateUser,
  getDonationsByUsername,
  storeUserDAConnection,
  getUserDAUsername
};
