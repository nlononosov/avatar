const { getAvailableAvatarParts, updateAvatarPart, getAvatarByTwitchId } = require('../db');

function registerAvatarCustomizeRoutes(app) {
  // Get available avatar parts
  app.get('/api/avatar/parts', (req, res) => {
    try {
      const parts = getAvailableAvatarParts();
      res.json({
        success: true,
        data: parts
      });
    } catch (error) {
      console.error('Error getting avatar parts:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get avatar parts'
      });
    }
  });

  // Get user avatar data
  app.get('/api/avatar/:userId', (req, res) => {
    try {
      const { userId } = req.params;
      const avatar = getAvatarByTwitchId(userId);
      
      if (!avatar) {
        return res.status(404).json({
          success: false,
          error: 'Avatar not found'
        });
      }

      res.json({
        success: true,
        data: avatar
      });
    } catch (error) {
      console.error('Error getting avatar:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get avatar'
      });
    }
  });

  // Clear user avatar cache
  app.post('/api/avatar/clear-cache', (req, res) => {
    try {
      const { userId } = req.body;
      
      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'Missing userId'
        });
      }

      // Emit cache clear event to overlay
      const { emit } = require('../lib/bus');
      emit('clearAvatarCache', { userId });
      
      res.json({
        success: true,
        message: 'Avatar cache cleared'
      });
    } catch (error) {
      console.error('Error clearing avatar cache:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to clear avatar cache'
      });
    }
  });

  // Update avatar part
  app.post('/api/avatar/update', (req, res) => {
    try {
      const { userId, partType, partId } = req.body;
      
      if (!userId || !partType || !partId) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters: userId, partType, partId'
        });
      }

      const validPartTypes = ['body', 'face', 'clothes', 'others'];
      if (!validPartTypes.includes(partType)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid part type'
        });
      }

      const success = updateAvatarPart(userId, partType, partId);
      
      if (success) {
        // Clear avatar cache for this user
        const { emit } = require('../lib/bus');
        emit('clearAvatarCache', { userId });
        
        // Get updated avatar data
        const updatedAvatar = getAvatarByTwitchId(userId);
        res.json({
          success: true,
          message: 'Avatar part updated successfully',
          data: updatedAvatar
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Avatar not found'
        });
      }
    } catch (error) {
      console.error('Error updating avatar part:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update avatar part'
      });
    }
  });

  // Update avatar on stream (for real-time updates)
  app.post('/api/avatar/update-stream', (req, res) => {
    try {
      const { userId, streamerId, body_skin, face_skin, clothes_type, others_type } = req.body;
      
      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'Missing userId'
        });
      }

      // Get updated avatar data
      const updatedAvatar = getAvatarByTwitchId(userId);
      if (!updatedAvatar) {
        return res.status(404).json({
          success: false,
          error: 'Avatar not found'
        });
      }

      // Send avatar update event to overlay
      const { emitToStreamer } = require('../lib/bus');
      const streamerIdToUse = streamerId || userId; // Use provided streamerId or fallback to userId
      
      emitToStreamer(streamerIdToUse, 'avatarUpdated', {
        userId: userId,
        avatarData: updatedAvatar
      });

      res.json({
        success: true,
        message: 'Avatar update sent to stream',
        data: updatedAvatar
      });
    } catch (error) {
      console.error('Error updating avatar on stream:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update avatar on stream'
      });
    }
  });
}

module.exports = { registerAvatarCustomizeRoutes };
