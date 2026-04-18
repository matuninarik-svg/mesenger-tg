import { Router } from 'express';
import query from '../db/index';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { body, validationResult } from 'express-validator';

const router = Router();

// Get current user profile
router.get('/me', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;

    const result = await query(
      `SELECT id, email, username, first_name, last_name, avatar_url, bio, phone, 
              privacy_settings, is_verified, two_factor_enabled, created_at
       FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    res.json({
      id: user.id,
      email: user.email,
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
      avatarUrl: user.avatar_url,
      bio: user.bio,
      phone: user.phone,
      privacySettings: user.privacy_settings,
      isVerified: user.is_verified,
      twoFactorEnabled: user.two_factor_enabled,
      createdAt: user.created_at
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// Update profile
router.put('/me', authenticateToken, [
  body('firstName').optional().trim().isLength({ max: 100 }),
  body('lastName').optional().trim().isLength({ max: 100 }),
  body('bio').optional().trim().isLength({ max: 200 }),
  body('avatarUrl').optional()
], async (req: AuthRequest, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user?.userId;
    const { firstName, lastName, bio, avatarUrl } = req.body;

    const result = await query(
      `UPDATE users 
       SET first_name = COALESCE($1, first_name),
           last_name = COALESCE($2, last_name),
           bio = COALESCE($3, bio),
           avatar_url = COALESCE($4, avatar_url),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING id, email, username, first_name, last_name, avatar_url, bio`,
      [firstName, lastName, bio, avatarUrl, userId]
    );

    const user = result.rows[0];
    res.json({
      id: user.id,
      email: user.email,
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
      avatarUrl: user.avatar_url,
      bio: user.bio
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Change password
router.put('/me/password', authenticateToken, [
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 8 })
], async (req: AuthRequest, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user?.userId;
    const { currentPassword, newPassword } = req.body;

    // Get current user
    const userResult = await query(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const bcrypt = require('bcryptjs');
    const validPassword = await bcrypt.compare(currentPassword, userResult.rows[0].password_hash);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const newPasswordHash = await bcrypt.hash(newPassword, salt);

    // Update password
    await query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newPasswordHash, userId]
    );

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Update privacy settings
router.put('/me/privacy', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { phone, avatar, lastSeen, canWrite, canAddToGroups } = req.body;

    const privacySettings = {
      phone: phone || 'contacts',
      avatar: avatar || 'all',
      last_seen: lastSeen || 'all',
      can_write: canWrite || 'all',
      can_add_to_groups: canAddToGroups || 'all'
    };

    await query(
      'UPDATE users SET privacy_settings = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [JSON.stringify(privacySettings), userId]
    );

    res.json({ privacySettings });
  } catch (error) {
    console.error('Update privacy error:', error);
    res.status(500).json({ error: 'Failed to update privacy settings' });
  }
});

// Delete account
router.delete('/me', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { password } = req.body;

    // Verify password
    const userResult = await query(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const bcrypt = require('bcryptjs');
    const validPassword = await bcrypt.compare(password, userResult.rows[0].password_hash);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    // Delete user (cascade will handle related records)
    await query('DELETE FROM users WHERE id = $1', [userId]);

    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

// Search users by username
router.get('/search', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { q } = req.query;
    const userId = req.user?.userId;

    if (!q) {
      return res.status(400).json({ error: 'Search query required' });
    }

    const result = await query(
      `SELECT id, username, first_name, last_name, avatar_url, bio
       FROM users
       WHERE username ILIKE $1 AND id != $2
       LIMIT 20`,
      [`%${q}%`, userId]
    );

    res.json({
      users: result.rows.map(u => ({
        id: u.id,
        username: u.username,
        firstName: u.first_name,
        lastName: u.last_name,
        avatarUrl: u.avatar_url,
        bio: u.bio
      }))
    });
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

// Get user by username
router.get('/:username', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { username } = req.params;

    const result = await query(
      `SELECT id, username, first_name, last_name, avatar_url, bio
       FROM users WHERE username = $1`,
      [username.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    res.json({
      id: user.id,
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
      avatarUrl: user.avatar_url,
      bio: user.bio
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

export default router;
