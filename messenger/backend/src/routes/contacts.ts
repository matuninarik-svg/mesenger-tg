import { Router } from 'express';
import query from '../db/index';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();

// Add contact
router.post('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { contactUserId, displayName } = req.body;

    if (!contactUserId) {
      return res.status(400).json({ error: 'Contact user ID required' });
    }

    await query(
      `INSERT INTO contacts (user_id, contact_user_id, display_name, created_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id, contact_user_id) DO UPDATE SET display_name = $3`,
      [userId, contactUserId, displayName || null]
    );

    res.json({ message: 'Contact added successfully' });
  } catch (error) {
    console.error('Add contact error:', error);
    res.status(500).json({ error: 'Failed to add contact' });
  }
});

// Get contacts
router.get('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;

    const result = await query(
      `SELECT c.*, u.username, u.first_name, u.last_name, u.avatar_url, u.last_seen
       FROM contacts c
       JOIN users u ON c.contact_user_id = u.id
       WHERE c.user_id = $1 AND c.is_blocked = FALSE
       ORDER BY COALESCE(c.display_name, u.first_name, u.username) ASC`,
      [userId]
    );

    res.json({
      contacts: result.rows.map(c => ({
        id: c.contact_user_id,
        displayName: c.display_name,
        phone: c.phone,
        username: c.username,
        firstName: c.first_name,
        lastName: c.last_name,
        avatarUrl: c.avatar_url,
        lastSeen: c.last_seen
      }))
    });
  } catch (error) {
    console.error('Get contacts error:', error);
    res.status(500).json({ error: 'Failed to get contacts' });
  }
});

// Remove contact
router.delete('/:contactId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { contactId } = req.params;

    await query(
      'DELETE FROM contacts WHERE user_id = $1 AND contact_user_id = $2',
      [userId, contactId]
    );

    res.json({ message: 'Contact removed successfully' });
  } catch (error) {
    console.error('Remove contact error:', error);
    res.status(500).json({ error: 'Failed to remove contact' });
  }
});

// Block contact
router.post('/:contactId/block', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { contactId } = req.params;

    await query(
      `UPDATE contacts SET is_blocked = TRUE WHERE user_id = $1 AND contact_user_id = $2`,
      [userId, contactId]
    );

    res.json({ message: 'Contact blocked successfully' });
  } catch (error) {
    console.error('Block contact error:', error);
    res.status(500).json({ error: 'Failed to block contact' });
  }
});

// Unblock contact
router.post('/:contactId/unblock', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { contactId } = req.params;

    await query(
      `UPDATE contacts SET is_blocked = FALSE WHERE user_id = $1 AND contact_user_id = $2`,
      [userId, contactId]
    );

    res.json({ message: 'Contact unblocked successfully' });
  } catch (error) {
    console.error('Unblock contact error:', error);
    res.status(500).json({ error: 'Failed to unblock contact' });
  }
});

export default router;
