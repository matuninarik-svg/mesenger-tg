import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import { v4 as uuidv4 } from 'uuid';
import query from '../db/index';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// Generate verification code
function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Register
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('username').isLength({ min: 3, max: 32 }).matches(/^[a-zA-Z0-9_]+$/),
  body('firstName').optional().trim(),
  body('lastName').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, username, firstName, lastName } = req.body;

    // Check if email exists
    const emailExists = await query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    if (emailExists.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Check if username exists
    const usernameExists = await query(
      'SELECT id FROM users WHERE username = $1',
      [username.toLowerCase()]
    );
    if (usernameExists.rows.length > 0) {
      return res.status(400).json({ error: 'Username already taken' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Generate verification code
    const verificationCode = generateVerificationCode();

    // Create user
    const result = await query(
      `INSERT INTO users (email, username, password_hash, first_name, last_name, verification_code, is_verified)
       VALUES ($1, $2, $3, $4, $5, $6, FALSE)
       RETURNING id, email, username, first_name, last_name, created_at`,
      [email.toLowerCase(), username.toLowerCase(), passwordHash, firstName || null, lastName || null, verificationCode]
    );

    const user = result.rows[0];

    // TODO: Send verification email with code
    console.log(`Verification code for ${email}: ${verificationCode}`);

    // Generate tokens
    const accessToken = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '1d' }
    );

    const refreshToken = jwt.sign(
      { userId: user.id },
      process.env.JWT_REFRESH_SECRET || 'refresh_secret',
      { expiresIn: '30d' }
    );

    // Save session
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await query(
      `INSERT INTO sessions (user_id, refresh_token, expires_at, device_info, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, refreshToken, expiresAt, JSON.stringify(req.headers['user-agent']), req.ip]
    );

    res.status(201).json({
      message: 'Registration successful. Please verify your email.',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name
      },
      accessToken,
      refreshToken,
      requiresVerification: true
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Verify email
router.post('/verify-email', [
  body('email').isEmail().normalizeEmail(),
  body('code').isLength({ min: 6, max: 6 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, code } = req.body;

    const result = await query(
      `UPDATE users 
       SET is_verified = TRUE, verification_code = NULL
       WHERE email = $1 AND verification_code = $2
       RETURNING id, email, username`,
      [email.toLowerCase(), code]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    res.json({ message: 'Email verified successfully' });
  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Login
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    const result = await query(
      'SELECT * FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // Check password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check if verified
    if (!user.is_verified) {
      return res.status(401).json({ error: 'Please verify your email first' });
    }

    // Generate tokens
    const accessToken = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '1d' }
    );

    const refreshToken = jwt.sign(
      { userId: user.id },
      process.env.JWT_REFRESH_SECRET || 'refresh_secret',
      { expiresIn: '30d' }
    );

    // Save session
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await query(
      `INSERT INTO sessions (user_id, refresh_token, expires_at, device_info, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, refreshToken, expiresAt, JSON.stringify(req.headers['user-agent']), req.ip]
    );

    // Update last seen
    await query('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
        avatarUrl: user.avatar_url,
        bio: user.bio,
        privacySettings: user.privacy_settings
      },
      accessToken,
      refreshToken
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Refresh token
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token required' });
    }

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || 'refresh_secret') as any;

    // Check if session exists
    const sessionResult = await query(
      'SELECT * FROM sessions WHERE refresh_token = $1 AND user_id = $2 AND expires_at > NOW()',
      [refreshToken, decoded.userId]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    // Get user
    const userResult = await query(
      'SELECT id, email, username, first_name, last_name, avatar_url, bio, privacy_settings FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // Generate new access token
    const accessToken = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '1d' }
    );

    res.json({
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
        avatarUrl: user.avatar_url,
        bio: user.bio,
        privacySettings: user.privacy_settings
      }
    });
  } catch (error) {
    console.error('Refresh error:', error);
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// Logout
router.post('/logout', authenticateToken, async (req: any, res) => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      await query('DELETE FROM sessions WHERE refresh_token = $1', [refreshToken]);
    }

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// Get active sessions
router.get('/sessions', authenticateToken, async (req: any, res) => {
  try {
    const userId = req.user.userId;

    const result = await query(
      `SELECT id, device_info, ip_address, created_at, expires_at 
       FROM sessions 
       WHERE user_id = $1 AND expires_at > NOW()
       ORDER BY created_at DESC`,
      [userId]
    );

    res.json({ sessions: result.rows });
  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json({ error: 'Failed to get sessions' });
  }
});

// Terminate session
router.delete('/sessions/:sessionId', authenticateToken, async (req: any, res) => {
  try {
    const userId = req.user.userId;
    const { sessionId } = req.params;

    await query(
      'DELETE FROM sessions WHERE id = $1 AND user_id = $2',
      [sessionId, userId]
    );

    res.json({ message: 'Session terminated' });
  } catch (error) {
    console.error('Terminate session error:', error);
    res.status(500).json({ error: 'Failed to terminate session' });
  }
});

// Terminate all other sessions
router.delete('/sessions/all-except-current', authenticateToken, async (req: any, res) => {
  try {
    const userId = req.user.userId;
    const currentRefreshToken = req.body.refreshToken;

    await query(
      'DELETE FROM sessions WHERE user_id = $1 AND refresh_token != $2',
      [userId, currentRefreshToken]
    );

    res.json({ message: 'All other sessions terminated' });
  } catch (error) {
    console.error('Terminate all sessions error:', error);
    res.status(500).json({ error: 'Failed to terminate sessions' });
  }
});

export default router;
