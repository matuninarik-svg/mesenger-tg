import { Server, Socket } from 'socket.io';
import query from '../db/index';

interface OnlineUser {
  userId: string;
  socketId: string;
}

const onlineUsers: Map<string, OnlineUser[]> = new Map();
const userTypingStatus: Map<string, Set<string>> = new Map();

export function initSocket(io: Server) {
  io.on('connection', (socket: Socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // User authentication and online status
    socket.on('user_connected', async (data: { userId: string }) => {
      const { userId } = data;
      
      // Add to online users
      if (!onlineUsers.has(userId)) {
        onlineUsers.set(userId, []);
      }
      onlineUsers.get(userId)?.push({ userId, socketId: socket.id });
      
      // Update last seen in database
      await query('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = $1', [userId]);
      
      // Notify others about online status
      socket.broadcast.emit('user_online', { userId });
      
      console.log(`User ${userId} connected with socket ${socket.id}`);
    });

    // Join chat room
    socket.on('join_chat', (data: { chatId: string }) => {
      const { chatId } = data;
      socket.join(chatId);
      console.log(`User joined chat: ${chatId}`);
    });

    // Leave chat room
    socket.on('leave_chat', (data: { chatId: string }) => {
      const { chatId } = data;
      socket.leave(chatId);
      console.log(`User left chat: ${chatId}`);
    });

    // New message
    socket.on('send_message', async (data: { 
      chatId: string; 
      senderId: string; 
      content: string; 
      type: string;
      mediaUrl?: string;
      mediaMetadata?: any;
      replyToId?: string;
    }) => {
      const { chatId, senderId, content, type, mediaUrl, mediaMetadata, replyToId } = data;
      
      try {
        // Save message to database
        const result = await query(
          `INSERT INTO messages (chat_id, sender_id, content, type, media_url, media_metadata, reply_to_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
           RETURNING *, 
             (SELECT username FROM users WHERE id = $2) as sender_username`,
          [chatId, senderId, content, type, mediaUrl || null, mediaMetadata ? JSON.stringify(mediaMetadata) : null, replyToId || null]
        );
        
        const message = result.rows[0];
        
        // Emit to all users in the chat
        io.to(chatId).emit('new_message', {
          id: message.id,
          chatId: message.chat_id,
          senderId: message.sender_id,
          senderUsername: message.sender_username,
          content: message.content,
          type: message.type,
          mediaUrl: message.media_url,
          mediaMetadata: message.media_metadata,
          replyToId: message.reply_to_id,
          isEdited: false,
          isPinned: false,
          viewsCount: 0,
          createdAt: message.created_at
        });
        
        // Clear typing status
        clearTypingStatus(chatId, senderId);
        
      } catch (error) {
        console.error('Send message error:', error);
        socket.emit('message_error', { error: 'Failed to send message' });
      }
    });

    // Typing indicator
    socket.on('typing_start', (data: { chatId: string; userId: string }) => {
      const { chatId, userId } = data;
      
      if (!userTypingStatus.has(chatId)) {
        userTypingStatus.set(chatId, new Set());
      }
      userTypingStatus.get(chatId)?.add(userId);
      
      socket.to(chatId).emit('user_typing', { chatId, userId });
    });

    socket.on('typing_stop', (data: { chatId: string; userId: string }) => {
      const { chatId, userId } = data;
      clearTypingStatus(chatId, userId);
    });

    function clearTypingStatus(chatId: string, userId: string) {
      const typingSet = userTypingStatus.get(chatId);
      if (typingSet) {
        typingSet.delete(userId);
        socket.to(chatId).emit('user_stopped_typing', { chatId, userId });
      }
    }

    // Message read receipt
    socket.on('message_read', (data: { chatId: string; messageId: string; userId: string }) => {
      const { chatId, messageId, userId } = data;
      
      socket.to(chatId).emit('messages_read', {
        chatId,
        messageId,
        userId,
        timestamp: new Date().toISOString()
      });
    });

    // Call signaling
    socket.on('call_initiate', (data: { 
      callerId: string; 
      receiverId: string; 
      type: string; 
      offer: RTCSessionDescriptionInit;
      chatId?: string;
    }) => {
      const { callerId, receiverId, type, offer, chatId } = data;
      
      const receiverSockets = onlineUsers.get(receiverId);
      if (receiverSockets) {
        receiverSockets.forEach(({ socketId }) => {
          io.to(socketId).emit('incoming_call', {
            callerId,
            type,
            offer,
            chatId
          });
        });
      }
    });

    socket.on('call_accept', (data: { 
      callId: string;
      callerId: string; 
      answer: RTCSessionDescriptionInit;
    }) => {
      const { callId, callerId, answer } = data;
      
      const callerSockets = onlineUsers.get(callerId);
      if (callerSockets) {
        callerSockets.forEach(({ socketId }) => {
          io.to(socketId).emit('call_accepted', {
            callId,
            answer
          });
        });
      }
    });

    socket.on('call_reject', (data: { callId: string; callerId: string }) => {
      const { callId, callerId } = data;
      
      const callerSockets = onlineUsers.get(callerId);
      if (callerSockets) {
        callerSockets.forEach(({ socketId }) => {
          io.to(socketId).emit('call_rejected', { callId });
        });
      }
    });

    socket.on('call_end', (data: { callId: string; targetUserId: string }) => {
      const { callId, targetUserId } = data;
      
      const targetSockets = onlineUsers.get(targetUserId);
      if (targetSockets) {
        targetSockets.forEach(({ socketId }) => {
          io.to(socketId).emit('call_ended', { callId });
        });
      }
    });

    // ICE candidate exchange
    socket.on('ice_candidate', (data: { 
      targetUserId: string; 
      candidate: RTCIceCandidateInit;
    }) => {
      const { targetUserId, candidate } = data;
      
      const targetSockets = onlineUsers.get(targetUserId);
      if (targetSockets) {
        targetSockets.forEach(({ socketId }) => {
          io.to(socketId).emit('ice_candidate', { candidate });
        });
      }
    });

    // User disconnect
    socket.on('disconnect', async () => {
      console.log(`Socket disconnected: ${socket.id}`);
      
      // Remove from online users
      for (const [userId, sockets] of onlineUsers.entries()) {
        const index = sockets.findIndex(s => s.socketId === socket.id);
        if (index !== -1) {
          sockets.splice(index, 1);
          
          if (sockets.length === 0) {
            onlineUsers.delete(userId);
            
            // Update last seen
            await query('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = $1', [userId]);
            
            // Notify others about offline status
            socket.broadcast.emit('user_offline', { userId });
          }
          break;
        }
      }
    });

    // Error handling
    socket.on('error', (error: any) => {
      console.error('Socket error:', error);
    });
  });

  console.log('Socket.io initialized');
}

export function getOnlineUsers(): string[] {
  return Array.from(onlineUsers.keys());
}

export function isUserOnline(userId: string): boolean {
  return onlineUsers.has(userId);
}
