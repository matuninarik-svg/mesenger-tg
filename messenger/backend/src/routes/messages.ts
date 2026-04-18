import { Router } from 'express';
import query from '../db/index';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();

// Get messages for a chat with pagination
router.get('/chat/:chatId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { chatId } = req.params;
    const { limit = 50, before } = req.query;

    // Check if user is participant
    const participantCheck = await query(
      `SELECT 1 FROM chat_participants WHERE chat_id = $1 AND user_id = $2`,
      [chatId, userId]
    );

    if (participantCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    let messagesQuery = `
      SELECT m.*, 
             u.username as sender_username,
             u.first_name as sender_first_name,
             u.last_name as sender_last_name,
             u.avatar_url as sender_avatar_url,
             COALESCE((SELECT json_agg(json_build_object('emoji', emoji, 'user_id', user_id)) 
                       FROM message_reactions WHERE message_id = m.id), '[]') as reactions,
             EXISTS(SELECT 1 FROM message_reads WHERE message_id = m.id AND user_id = $2) as is_read
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.chat_id = $1 AND m.is_deleted = FALSE
    `;

    const params: any[] = [chatId, userId];

    if (before) {
      messagesQuery += ` AND m.created_at < $${params.length + 1}`;
      params.push(before);
    }

    messagesQuery += ` ORDER BY m.created_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit as string));

    const result = await query(messagesQuery, params);

    // Mark messages as read
    await query(
      `INSERT INTO message_reads (message_id, user_id, read_at)
       SELECT id, $2, CURRENT_TIMESTAMP
       FROM messages
       WHERE chat_id = $1 AND sender_id != $2
       ON CONFLICT (message_id, user_id) DO NOTHING`,
      [chatId, userId]
    );

    // Update last read message
    const lastMessage = result.rows[0];
    if (lastMessage) {
      await query(
        `UPDATE chat_participants 
         SET last_read_message_id = (
           SELECT id FROM messages 
           WHERE chat_id = $1 AND sender_id != $2 
           ORDER BY created_at DESC LIMIT 1
         )
         WHERE chat_id = $1 AND user_id = $2`,
        [chatId, userId]
      );
    }

    const messages = result.rows.map(m => ({
      id: m.id,
      chatId: m.chat_id,
      senderId: m.sender_id,
      senderUsername: m.sender_username,
      senderFirstName: m.sender_first_name,
      senderLastName: m.sender_last_name,
      senderAvatarUrl: m.sender_avatar_url,
      content: m.content,
      type: m.type,
      mediaUrl: m.media_url,
      mediaMetadata: m.media_metadata,
      replyToId: m.reply_to_id,
      isEdited: m.is_edited,
      isPinned: m.is_pinned,
      viewsCount: m.views_count,
      createdAt: m.created_at,
      reactions: m.reactions || [],
      isRead: m.is_read
    })).reverse(); // Reverse to get chronological order

    res.json({ messages });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

// Send message
router.post('/chat/:chatId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { chatId } = req.params;
    const { content, type = 'text', mediaUrl, mediaMetadata, replyToId } = req.body;

    // Check if user is participant and not muted/banned
    const participantCheck = await query(
      `SELECT role FROM chat_participants WHERE chat_id = $1 AND user_id = $2`,
      [chatId, userId]
    );

    if (participantCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    const role = participantCheck.rows[0].role;
    if (role === 'muted' || role === 'banned') {
      return res.status(403).json({ error: 'You are not allowed to send messages' });
    }

    // For channels, only admins can post
    const chatResult = await query('SELECT type FROM chats WHERE id = $1', [chatId]);
    if (chatResult.rows[0].type === 'channel' && role !== 'owner' && role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can post in channels' });
    }

    const messageId = await query(
      `INSERT INTO messages (chat_id, sender_id, content, type, media_url, media_metadata, reply_to_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
       RETURNING id, created_at`,
      [chatId, userId, content || null, type, mediaUrl || null, mediaMetadata ? JSON.stringify(mediaMetadata) : null, replyToId || null]
    );

    const newMessage = messageId.rows[0];

    // Increment view count for sender
    await query(
      `UPDATE messages SET views_count = views_count + 1 WHERE id = $1`,
      [newMessage.id]
    );

    res.status(201).json({
      message: {
        id: newMessage.id,
        chatId,
        senderId: userId,
        content,
        type,
        mediaUrl,
        mediaMetadata,
        replyToId,
        isEdited: false,
        isPinned: false,
        viewsCount: 1,
        createdAt: newMessage.created_at
      }
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Edit message
router.put('/:messageId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { messageId } = req.params;
    const { content } = req.body;

    const messageCheck = await query(
      'SELECT sender_id, type FROM messages WHERE id = $1',
      [messageId]
    );

    if (messageCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (messageCheck.rows[0].sender_id !== userId) {
      return res.status(403).json({ error: 'Not authorized to edit this message' });
    }

    await query(
      `UPDATE messages 
       SET content = $1, is_edited = TRUE, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2`,
      [content, messageId]
    );

    res.json({ message: 'Message edited successfully' });
  } catch (error) {
    console.error('Edit message error:', error);
    res.status(500).json({ error: 'Failed to edit message' });
  }
});

// Delete message
router.delete('/:messageId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { messageId } = req.params;
    const { forEveryone = false } = req.query;

    const messageCheck = await query(
      'SELECT sender_id, chat_id FROM messages WHERE id = $1',
      [messageId]
    );

    if (messageCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (forEveryone === 'true' || messageCheck.rows[0].sender_id === userId) {
      // Delete for everyone
      await query(
        `UPDATE messages SET is_deleted = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [messageId]
      );
    } else {
      // TODO: Implement "delete for me" functionality
      return res.status(400).json({ error: 'Use forEveryone=true to delete for everyone' });
    }

    res.json({ message: 'Message deleted successfully' });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// Pin message
router.post('/:messageId/pin', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { messageId } = req.params;

    const messageCheck = await query(
      `SELECT m.*, cp.role FROM messages m
       JOIN chat_participants cp ON m.chat_id = cp.chat_id
       WHERE m.id = $1 AND cp.user_id = $2`,
      [messageId, userId]
    );

    if (messageCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const role = messageCheck.rows[0].role;
    if (role !== 'owner' && role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can pin messages' });
    }

    await query(
      `UPDATE messages SET is_pinned = TRUE WHERE id = $1`,
      [messageId]
    );

    res.json({ message: 'Message pinned successfully' });
  } catch (error) {
    console.error('Pin message error:', error);
    res.status(500).json({ error: 'Failed to pin message' });
  }
});

// Add reaction
router.post('/:messageId/reaction', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { messageId } = req.params;
    const { emoji } = req.body;

    if (!emoji) {
      return res.status(400).json({ error: 'Emoji required' });
    }

    await query(
      `INSERT INTO message_reactions (message_id, user_id, emoji, created_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (message_id, user_id, emoji) DO NOTHING`,
      [messageId, userId, emoji]
    );

    res.json({ message: 'Reaction added successfully' });
  } catch (error) {
    console.error('Add reaction error:', error);
    res.status(500).json({ error: 'Failed to add reaction' });
  }
});

// Remove reaction
router.delete('/:messageId/reaction/:emoji', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { messageId, emoji } = req.params;

    await query(
      `DELETE FROM message_reactions 
       WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
      [messageId, decodeURIComponent(emoji), userId]
    );

    res.json({ message: 'Reaction removed successfully' });
  } catch (error) {
    console.error('Remove reaction error:', error);
    res.status(500).json({ error: 'Failed to remove reaction' });
  }
});

// Search messages in chat
router.get('/chat/:chatId/search', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { chatId } = req.params;
    const { q, limit = 50 } = req.query;

    if (!q) {
      return res.status(400).json({ error: 'Search query required' });
    }

    const result = await query(
      `SELECT m.*, u.username as sender_username
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.chat_id = $1 AND m.content ILIKE $2 AND m.is_deleted = FALSE
       ORDER BY m.created_at DESC
       LIMIT $3`,
      [chatId, `%${q}%`, parseInt(limit as string)]
    );

    res.json({
      messages: result.rows.map(m => ({
        id: m.id,
        content: m.content,
        type: m.type,
        senderUsername: m.sender_username,
        createdAt: m.created_at
      }))
    });
  } catch (error) {
    console.error('Search messages error:', error);
    res.status(500).json({ error: 'Failed to search messages' });
  }
});

export default router;
