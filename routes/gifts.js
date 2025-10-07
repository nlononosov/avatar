const { addGiftToUser, getUserGifts, getUserGiftStats, getRandomGift, GIFT_TYPES } = require('../db');
const { validateUserStreamerAccess } = require('../lib/streamer-auth');

function registerGiftRoutes(app) {
  // Get user's gift statistics (защищенный эндпоинт)
  app.get('/api/gifts/:userId', validateUserStreamerAccess, (req, res) => {
    try {
      const { userId } = req.params;
      const streamerId = req.streamerId;
      
      // Проверяем, что запрашиваются данные для текущего пользователя или стримера
      if (userId !== req.userId && userId !== streamerId) {
        return res.status(403).json({
          success: false,
          error: 'Access denied to this user data'
        });
      }
      
      const gifts = getUserGifts(userId, streamerId);
      const stats = getUserGiftStats(userId, streamerId);
      
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

  // Give a gift to a user (защищенный эндпоинт)
  app.post('/api/gifts/give', validateUserStreamerAccess, (req, res) => {
    try {
      const { userId, giftType, giftId } = req.body;
      const streamerId = req.streamerId;
      
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

      addGiftToUser(userId, streamerId, giftType, giftId);
      
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
