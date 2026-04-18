import { Router } from 'express';
import query from '../db/index';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();

// Get group details
router.get('/:chatId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { chatId } = req.params;

    const result = await query(
      `SELECT c.*, cp.role, cp.is_muted,
              (SELECT COUNT(*) FROM chat_participants WHERE chat_id = $1) as member_count
       FROM chats c
       JOIN chat_participants cp ON c.id = cp.chat_id
       WHERE c.id = $1 AND c.type = 'group' AND cp.user_id = $2`,
      [chatId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const group = result.rows[0];

    // Get participants
    const participantsResult = await query(
      `SELECT u.id, u.username, u.first_name, u.last_name, u.avatar_url, 
              cp.role, cp.joined_at
       FROM chat_participants cp
       JOIN users u ON cp.user_id = u.id
       WHERE cp.chat_id = $1
       ORDER BY cp.role DESC, cp.joined_at ASC`,
      [chatId]
    );

    res.json({
      group: {
        id: group.id,
        name: group.name,
        description: group.description,
        avatarUrl: group.avatar_url,
        ownerId: group.owner_id,
        isPublic: group.is_public,
        inviteLink: group.invite_link,
        role: group.role,
        isMuted: group.is_muted,
        memberCount: parseInt(group.member_count),
        participants: participantsResult.rows.map(p => ({
          id: p.id,
          username: p.username,
          firstName: p.first_name,
          lastName: p.last_name,
          avatarUrl: p.avatar_url,
          role: p.role,
          joinedAt: p.joined_at
        }))
      }
    });
  } catch (error) {
    console.error('Get group error:', error);
    res.status(500).json({ error: 'Failed to get group' });
  }
});

// Add participant to group
router.post('/:chatId/participants', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { chatId } = req.params;
    const { participantIds } = req.body;

    // Check if user has permission
    const participantCheck = await query(
      `SELECT role FROM chat_participants WHERE chat_id = $1 AND user_id = $2`,
      [chatId, userId]
    );

    if (participantCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const role = participantCheck.rows[0].role;
    if (role !== 'owner' && role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Add participants
    for (const participantId of participantIds) {
      await query(
        `INSERT INTO chat_participants (chat_id, user_id, role, joined_at)
         VALUES ($1, $2, 'member', CURRENT_TIMESTAMP)
         ON CONFLICT (chat_id, user_id) DO NOTHING`,
        [chatId, participantId]
      );
    }

    res.json({ message: 'Participants added successfully' });
  } catch (error) {
    console.error('Add participants error:', error);
    res.status(500).json({ error: 'Failed to add participants' });
  }
});

// Remove participant from group
router.delete('/:chatId/participants/:participantId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { chatId, participantId } = req.params;

    // Check if user has permission
    const participantCheck = await query(
      `SELECT role FROM chat_participants WHERE chat_id = $1 AND user_id = $2`,
      [chatId, userId]
    );

    if (participantCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const role = participantCheck.rows[0].role;
    if (role !== 'owner' && role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await query(
      `DELETE FROM chat_participants WHERE chat_id = $1 AND user_id = $2`,
      [chatId, participantId]
    );

    res.json({ message: 'Participant removed successfully' });
  } catch (error) {
    console.error('Remove participant error:', error);
    res.status(500).json({ error: 'Failed to remove participant' });
  }
});

// Update participant role
router.put('/:chatId/participants/:participantId/role', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { chatId, participantId } = req.params;
    const { role } = req.body;

    // Check if user is owner
    const ownerCheck = await query(
      `SELECT role FROM chat_participants WHERE chat_id = $1 AND user_id = $2`,
      [chatId, userId]
    );

    if (ownerCheck.rows.length === 0 || ownerCheck.rows[0].role !== 'owner') {
      return res.status(403).json({ error: 'Only owner can change roles' });
    }

    await query(
      `UPDATE chat_participants SET role = $1 WHERE chat_id = $2 AND user_id = $3`,
      [role, chatId, participantId]
    );

    res.json({ message: 'Role updated successfully' });
  } catch (error) {
    console.error('Update role error:', error);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// Mute/unmute participant
router.post('/:chatId/participants/:participantId/mute', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { chatId, participantId } = req.params;
    const { muted } = req.body;

    // Check if user has permission
    const participantCheck = await query(
      `SELECT role FROM chat_participants WHERE chat_id = $1 AND user_id = $2`,
      [chatId, userId]
    );

    if (participantCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const role = participantCheck.rows[0].role;
    if (role !== 'owner' && role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await query(
      `UPDATE chat_participants SET role = $1 WHERE chat_id = $2 AND user_id = $3`,
      [muted ? 'muted' : 'member', chatId, participantId]
    );

    res.json({ message: `Participant ${muted ? 'muted' : 'unmuted'}` });
  } catch (error) {
    console.error('Mute participant error:', error);
    res.status(500).json({ error: 'Failed to mute participant' });
  }
});

export default router;
