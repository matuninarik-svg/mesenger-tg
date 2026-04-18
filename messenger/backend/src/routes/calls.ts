import { Router } from 'express';
import query from '../db/index';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();

// Initiate call
router.post('/initiate', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { receiverId, type = 'voice', chatId } = req.body;

    if (!receiverId) {
      return res.status(400).json({ error: 'Receiver ID required' });
    }

    const callId = await query(
      `INSERT INTO calls (caller_id, receiver_id, chat_id, type, status, created_at)
       VALUES ($1, $2, $3, $4, 'initiated', CURRENT_TIMESTAMP)
       RETURNING *`,
      [userId, receiverId, chatId || null, type]
    );

    res.status(201).json({ call: callId.rows[0] });
  } catch (error) {
    console.error('Initiate call error:', error);
    res.status(500).json({ error: 'Failed to initiate call' });
  }
});

// Accept call
router.post('/:callId/accept', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { callId } = req.params;

    const callCheck = await query(
      'SELECT * FROM calls WHERE id = $1 AND receiver_id = $2',
      [callId, userId]
    );

    if (callCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Call not found' });
    }

    await query(
      `UPDATE calls SET status = 'accepted', started_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [callId]
    );

    res.json({ message: 'Call accepted' });
  } catch (error) {
    console.error('Accept call error:', error);
    res.status(500).json({ error: 'Failed to accept call' });
  }
});

// Reject call
router.post('/:callId/reject', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { callId } = req.params;

    const callCheck = await query(
      'SELECT * FROM calls WHERE id = $1 AND receiver_id = $2',
      [callId, userId]
    );

    if (callCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Call not found' });
    }

    await query(
      `UPDATE calls SET status = 'rejected', ended_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [callId]
    );

    res.json({ message: 'Call rejected' });
  } catch (error) {
    console.error('Reject call error:', error);
    res.status(500).json({ error: 'Failed to reject call' });
  }
});

// End call
router.post('/:callId/end', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { callId } = req.params;

    const callCheck = await query(
      'SELECT * FROM calls WHERE id = $1 AND (caller_id = $2 OR receiver_id = $2)',
      [callId, userId]
    );

    if (callCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Call not found' });
    }

    const call = callCheck.rows[0];
    const startedAt = new Date(call.started_at || call.created_at);
    const duration = Math.floor((Date.now() - startedAt.getTime()) / 1000);

    await query(
      `UPDATE calls 
       SET status = 'ended', ended_at = CURRENT_TIMESTAMP, duration = $1 
       WHERE id = $2`,
      [duration, callId]
    );

    res.json({ message: 'Call ended', duration });
  } catch (error) {
    console.error('End call error:', error);
    res.status(500).json({ error: 'Failed to end call' });
  }
});

// Get call history
router.get('/history', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    const { limit = 50 } = req.query;

    const result = await query(
      `SELECT c.*, 
              caller.username as caller_username,
              caller.first_name as caller_first_name,
              caller.last_name as caller_last_name,
              receiver.username as receiver_username,
              receiver.first_name as receiver_first_name,
              receiver.last_name as receiver_last_name
       FROM calls c
       JOIN users caller ON c.caller_id = caller.id
       JOIN users receiver ON c.receiver_id = receiver.id
       WHERE c.caller_id = $1 OR c.receiver_id = $1
       ORDER BY c.created_at DESC
       LIMIT $2`,
      [userId, parseInt(limit as string)]
    );

    res.json({
      calls: result.rows.map(c => ({
        id: c.id,
        callerId: c.caller_id,
        callerUsername: c.caller_username,
        callerFirstName: c.caller_first_name,
        callerLastName: c.caller_last_name,
        receiverId: c.receiver_id,
        receiverUsername: c.receiver_username,
        receiverFirstName: c.receiver_first_name,
        receiverLastName: c.receiver_last_name,
        chatId: c.chat_id,
        type: c.type,
        status: c.status,
        startedAt: c.started_at,
        endedAt: c.ended_at,
        duration: c.duration,
        createdAt: c.created_at
      }))
    });
  } catch (error) {
    console.error('Get call history error:', error);
    res.status(500).json({ error: 'Failed to get call history' });
  }
});

export default router;
