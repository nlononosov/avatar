const { addGiftToUser, getUserGifts, getUserGiftStats, getRandomGift, GIFT_TYPES } = require('../db');

function registerGiftRoutes(app) {
  // Get user's gift statistics
  app.get('/api/gifts/:userId', (req, res) => {
    try {
      const { userId } = req.params;
      const gifts = getUserGifts(userId);
      const stats = getUserGiftStats(userId);
      
      res.json({
        success: true,
        data: {
          gifts,
          stats
        }
      });
    } catch (error) {
      console.error('Error getting gift stats:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get gift statistics'
      });
    }
  });

  // Give a gift to a user
  app.post('/api/gifts/give', (req, res) => {
    try {
      const { userId, giftType, giftId } = req.body;
      
      if (!userId || !giftType || !giftId) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters: userId, giftType, giftId'
        });
      }

      if (!Object.values(GIFT_TYPES).includes(giftType)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid gift type'
        });
      }

      addGiftToUser(userId, giftType, giftId);
      
      res.json({
        success: true,
        message: 'Gift added successfully'
      });
    } catch (error) {
      console.error('Error giving gift:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to give gift'
      });
    }
  });

  // Get random gift
  app.get('/api/gifts/random', (req, res) => {
    try {
      const gift = getRandomGift();
      res.json({
        success: true,
        data: gift
      });
    } catch (error) {
      console.error('Error getting random gift:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get random gift'
      });
    }
  });
}

module.exports = { registerGiftRoutes };
