import { Router } from 'express';
import query from '../db/index';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();

// Get channel details
router.get('/:chatId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { chatId } = req.params;

    const result = await query(
      `SELECT c.*, cp.role,
              (SELECT COUNT(*) FROM channel_subscribers WHERE channel_id = $1) as subscriber_count
       FROM chats c
       LEFT JOIN chat_participants cp ON c.id = cp.chat_id AND cp.user_id = $2
       WHERE c.id = $1 AND c.type = 'channel'`,
      [chatId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    const channel = result.rows[0];

    // Check if subscribed
    const subscriptionCheck = await query(
      `SELECT 1 FROM channel_subscribers WHERE channel_id = $1 AND user_id = $2`,
      [chatId, userId]
    );

    res.json({
      channel: {
        id: channel.id,
        name: channel.name,
        description: channel.description,
        avatarUrl: channel.avatar_url,
        ownerId: channel.owner_id,
        isPublic: channel.is_public,
        inviteLink: channel.invite_link,
        role: channel.role,
        subscriberCount: parseInt(channel.subscriber_count),
        isSubscribed: subscriptionCheck.rows.length > 0
      }
    });
  } catch (error) {
    console.error('Get channel error:', error);
    res.status(500).json({ error: 'Failed to get channel' });
  }
});

// Subscribe to channel
router.post('/:chatId/subscribe', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { chatId } = req.params;

    await query(
      `INSERT INTO channel_subscribers (channel_id, user_id, subscribed_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (channel_id, user_id) DO NOTHING`,
      [chatId, userId]
    );

    res.json({ message: 'Subscribed successfully' });
  } catch (error) {
    console.error('Subscribe error:', error);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

// Unsubscribe from channel
router.post('/:chatId/unsubscribe', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { chatId } = req.params;

    await query(
      `DELETE FROM channel_subscribers WHERE channel_id = $1 AND user_id = $2`,
      [chatId, userId]
    );

    res.json({ message: 'Unsubscribed successfully' });
  } catch (error) {
    console.error('Unsubscribe error:', error);
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

// Get channel subscribers (for admins)
router.get('/:chatId/subscribers', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { chatId } = req.params;

    // Check if user is admin
    const adminCheck = await query(
      `SELECT 1 FROM chat_participants 
       WHERE chat_id = $1 AND user_id = $2 AND role IN ('owner', 'admin')`,
      [chatId, userId]
    );

    if (adminCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const result = await query(
      `SELECT u.id, u.username, u.first_name, u.last_name, u.avatar_url, cs.subscribed_at
       FROM channel_subscribers cs
       JOIN users u ON cs.user_id = u.id
       WHERE cs.channel_id = $1
       ORDER BY cs.subscribed_at DESC`,
      [chatId]
    );

    res.json({
      subscribers: result.rows.map(s => ({
        id: s.id,
        username: s.username,
        firstName: s.first_name,
        lastName: s.last_name,
        avatarUrl: s.avatar_url,
        subscribedAt: s.subscribed_at
      }))
    });
  } catch (error) {
    console.error('Get subscribers error:', error);
    res.status(500).json({ error: 'Failed to get subscribers' });
  }
});

export default router;
