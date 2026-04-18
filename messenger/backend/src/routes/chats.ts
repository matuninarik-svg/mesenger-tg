import { Router } from 'express';
import query from '../db/index';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Get all chats for user
router.get('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;

    const result = await query(
      `SELECT DISTINCT ON (c.id) c.*, 
              cp.role, cp.last_read_message_id, cp.is_archived, cp.is_muted,
              m.content as last_message_content,
              m.type as last_message_type,
              m.created_at as last_message_time,
              m.sender_id as last_message_sender_id,
              u.username as last_message_sender_username,
              u.first_name as last_message_sender_first_name,
              u.last_name as last_message_sender_last_name,
              (SELECT COUNT(*) FROM messages WHERE chat_id = c.id AND created_at > COALESCE(cp.last_read_message_id, to_timestamp(0))) as unread_count
       FROM chats c
       JOIN chat_participants cp ON c.id = cp.chat_id
       LEFT JOIN messages m ON c.id = m.chat_id
       LEFT JOIN users u ON m.sender_id = u.id
       WHERE cp.user_id = $1 AND cp.is_archived = FALSE
       ORDER BY c.id, m.created_at DESC`,
      [userId]
    );

    const chats = result.rows.map(chat => ({
      id: chat.id,
      type: chat.type,
      name: chat.name,
      description: chat.description,
      avatarUrl: chat.avatar_url,
      ownerId: chat.owner_id,
      isPublic: chat.is_public,
      inviteLink: chat.invite_link,
      role: chat.role,
      lastReadMessageId: chat.last_read_message_id,
      isMuted: chat.is_muted,
      unreadCount: parseInt(chat.unread_count),
      lastMessage: chat.last_message_content ? {
        content: chat.last_message_content,
        type: chat.last_message_type,
        time: chat.last_message_time,
        senderId: chat.last_message_sender_id,
        senderUsername: chat.last_message_sender_username,
        senderFirstName: chat.last_message_sender_first_name,
        senderLastName: chat.last_message_sender_last_name
      } : null
    }));

    res.json({ chats });
  } catch (error) {
    console.error('Get chats error:', error);
    res.status(500).json({ error: 'Failed to get chats' });
  }
});

// Create private chat (or get existing)
router.post('/private', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { otherUserId } = req.body;

    if (!otherUserId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    // Check if chat already exists
    const existingChat = await query(
      `SELECT c.* FROM chats c
       JOIN chat_participants cp1 ON c.id = cp1.chat_id AND cp1.user_id = $1
       JOIN chat_participants cp2 ON c.id = cp2.chat_id AND cp2.user_id = $2
       WHERE c.type = 'private'`,
      [userId, otherUserId]
    );

    if (existingChat.rows.length > 0) {
      return res.json({ chat: existingChat.rows[0], created: false });
    }

    // Create new private chat
    const chatId = uuidv4();
    
    await query(
      `INSERT INTO chats (id, type, created_at, updated_at)
       VALUES ($1, 'private', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [chatId]
    );

    // Add both users as participants
    await query(
      `INSERT INTO chat_participants (chat_id, user_id, role, joined_at)
       VALUES ($1, $2, 'member', CURRENT_TIMESTAMP),
              ($1, $3, 'member', CURRENT_TIMESTAMP)`,
      [chatId, userId, otherUserId]
    );

    const result = await query(
      'SELECT * FROM chats WHERE id = $1',
      [chatId]
    );

    res.status(201).json({ chat: result.rows[0], created: true });
  } catch (error) {
    console.error('Create private chat error:', error);
    res.status(500).json({ error: 'Failed to create chat' });
  }
});

// Create group
router.post('/group', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { name, description, participantIds, isPublic } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Group name required' });
    }

    const chatId = uuidv4();
    const inviteLink = isPublic ? uuidv4().replace(/-/g, '') : null;

    // Create group
    await query(
      `INSERT INTO chats (id, type, name, description, owner_id, is_public, invite_link, created_at, updated_at)
       VALUES ($1, 'group', $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [chatId, name, description || null, userId, isPublic || false, inviteLink]
    );

    // Add owner as participant
    await query(
      `INSERT INTO chat_participants (chat_id, user_id, role, joined_at)
       VALUES ($1, $2, 'owner', CURRENT_TIMESTAMP)`,
      [chatId, userId]
    );

    // Add other participants
    if (participantIds && participantIds.length > 0) {
      const values = participantIds.map((id: string, index: number) => 
        `($1, $${index + 2}, 'member', CURRENT_TIMESTAMP)`
      ).join(', ');
      
      await query(
        `INSERT INTO chat_participants (chat_id, user_id, role, joined_at) VALUES ${values}`,
        [chatId, ...participantIds]
      );
    }

    const result = await query('SELECT * FROM chats WHERE id = $1', [chatId]);

    res.status(201).json({ chat: result.rows[0] });
  } catch (error) {
    console.error('Create group error:', error);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// Create channel
router.post('/channel', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { name, description, isPublic, username } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Channel name required' });
    }

    const chatId = uuidv4();
    const inviteLink = isPublic ? (username || uuidv4().replace(/-/g, '')) : null;

    // Create channel
    await query(
      `INSERT INTO chats (id, type, name, description, owner_id, is_public, invite_link, created_at, updated_at)
       VALUES ($1, 'channel', $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [chatId, name, description || null, userId, isPublic || false, inviteLink]
    );

    // Add owner as participant with admin role
    await query(
      `INSERT INTO chat_participants (chat_id, user_id, role, joined_at)
       VALUES ($1, $2, 'owner', CURRENT_TIMESTAMP)`,
      [chatId, userId]
    );

    const result = await query('SELECT * FROM chats WHERE id = $1', [chatId]);

    res.status(201).json({ chat: result.rows[0] });
  } catch (error) {
    console.error('Create channel error:', error);
    res.status(500).json({ error: 'Failed to create channel' });
  }
});

// Get chat by ID
router.get('/:chatId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { chatId } = req.params;

    const result = await query(
      `SELECT c.*, cp.role, cp.is_muted
       FROM chats c
       JOIN chat_participants cp ON c.id = cp.chat_id
       WHERE c.id = $1 AND cp.user_id = $2`,
      [chatId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    res.json({ chat: result.rows[0] });
  } catch (error) {
    console.error('Get chat error:', error);
    res.status(500).json({ error: 'Failed to get chat' });
  }
});

// Update chat info
router.put('/:chatId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { chatId } = req.params;
    const { name, description, avatarUrl } = req.body;

    // Check if user is owner or admin
    const participantResult = await query(
      `SELECT role FROM chat_participants WHERE chat_id = $1 AND user_id = $2`,
      [chatId, userId]
    );

    if (participantResult.rows.length === 0) {
      return res.status(404).json({ error: 'Not a participant' });
    }

    const role = participantResult.rows[0].role;
    if (role !== 'owner' && role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await query(
      `UPDATE chats 
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           avatar_url = COALESCE($3, avatar_url),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4`,
      [name, description, avatarUrl, chatId]
    );

    res.json({ message: 'Chat updated successfully' });
  } catch (error) {
    console.error('Update chat error:', error);
    res.status(500).json({ error: 'Failed to update chat' });
  }
});

// Delete chat
router.delete('/:chatId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { chatId } = req.params;

    // Check if user is owner
    const participantResult = await query(
      `SELECT role FROM chat_participants WHERE chat_id = $1 AND user_id = $2`,
      [chatId, userId]
    );

    if (participantResult.rows.length === 0 || participantResult.rows[0].role !== 'owner') {
      return res.status(403).json({ error: 'Only owner can delete the chat' });
    }

    await query('DELETE FROM chats WHERE id = $1', [chatId]);

    res.json({ message: 'Chat deleted successfully' });
  } catch (error) {
    console.error('Delete chat error:', error);
    res.status(500).json({ error: 'Failed to delete chat' });
  }
});

// Leave chat/group/channel
router.post('/:chatId/leave', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { chatId } = req.params;

    await query(
      'DELETE FROM chat_participants WHERE chat_id = $1 AND user_id = $2',
      [chatId, userId]
    );

    res.json({ message: 'Left chat successfully' });
  } catch (error) {
    console.error('Leave chat error:', error);
    res.status(500).json({ error: 'Failed to leave chat' });
  }
});

// Archive chat
router.post('/:chatId/archive', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { chatId } = req.params;

    await query(
      `UPDATE chat_participants 
       SET is_archived = TRUE 
       WHERE chat_id = $1 AND user_id = $2`,
      [chatId, userId]
    );

    res.json({ message: 'Chat archived' });
  } catch (error) {
    console.error('Archive chat error:', error);
    res.status(500).json({ error: 'Failed to archive chat' });
  }
});

// Unarchive chat
router.post('/:chatId/unarchive', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { chatId } = req.params;

    await query(
      `UPDATE chat_participants 
       SET is_archived = FALSE 
       WHERE chat_id = $1 AND user_id = $2`,
      [chatId, userId]
    );

    res.json({ message: 'Chat unarchived' });
  } catch (error) {
    console.error('Unarchive chat error:', error);
    res.status(500).json({ error: 'Failed to unarchive chat' });
  }
});

// Mute/unmute chat
router.post('/:chatId/mute', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { chatId } = req.params;
    const { muted } = req.body;

    await query(
      `UPDATE chat_participants 
       SET is_muted = $1 
       WHERE chat_id = $2 AND user_id = $3`,
      [muted !== false, chatId, userId]
    );

    res.json({ message: `Chat ${muted !== false ? 'muted' : 'unmuted'}` });
  } catch (error) {
    console.error('Mute chat error:', error);
    res.status(500).json({ error: 'Failed to mute chat' });
  }
});

export default router;
