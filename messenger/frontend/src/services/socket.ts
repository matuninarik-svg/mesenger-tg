import { io, Socket } from 'socket.io-client';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001';

class SocketService {
  private socket: Socket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  connect(userId: string) {
    if (this.socket?.connected) return;

    this.socket = io(WS_URL, {
      reconnection: true,
      reconnectionAttempts: this.maxReconnectAttempts,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000
    });

    this.socket.on('connect', () => {
      console.log('Socket connected');
      this.reconnectAttempts = 0;
      
      // Notify server about user connection
      this.socket?.emit('user_connected', { userId });
    });

    this.socket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
    });

    this.socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
      this.reconnectAttempts++;
      
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.error('Max reconnection attempts reached');
      }
    });

    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  getSocket(): Socket | null {
    return this.socket;
  }

  // Chat methods
  joinChat(chatId: string) {
    this.socket?.emit('join_chat', { chatId });
  }

  leaveChat(chatId: string) {
    this.socket?.emit('leave_chat', { chatId });
  }

  sendMessage(data: { 
    chatId: string; 
    senderId: string; 
    content: string; 
    type: string;
    mediaUrl?: string;
    mediaMetadata?: any;
    replyToId?: string;
  }) {
    this.socket?.emit('send_message', data);
  }

  // Typing indicators
  startTyping(chatId: string, userId: string) {
    this.socket?.emit('typing_start', { chatId, userId });
  }

  stopTyping(chatId: string, userId: string) {
    this.socket?.emit('typing_stop', { chatId, userId });
  }

  // Message read receipts
  markMessageRead(chatId: string, messageId: string, userId: string) {
    this.socket?.emit('message_read', { chatId, messageId, userId });
  }

  // Call signaling
  initiateCall(data: { 
    callerId: string; 
    receiverId: string; 
    type: string; 
    offer: RTCSessionDescriptionInit;
    chatId?: string;
  }) {
    this.socket?.emit('call_initiate', data);
  }

  acceptCall(data: { 
    callId: string;
    callerId: string; 
    answer: RTCSessionDescriptionInit;
  }) {
    this.socket?.emit('call_accept', data);
  }

  rejectCall(callId: string, callerId: string) {
    this.socket?.emit('call_reject', { callId, callerId });
  }

  endCall(callId: string, targetUserId: string) {
    this.socket?.emit('call_end', { callId, targetUserId });
  }

  sendIceCandidate(targetUserId: string, candidate: RTCIceCandidateInit) {
    this.socket?.emit('ice_candidate', { targetUserId, candidate });
  }

  // Event listeners
  onNewMessage(callback: (message: any) => void) {
    this.socket?.on('new_message', callback);
  }

  onUserTyping(callback: (data: { chatId: string; userId: string }) => void) {
    this.socket?.on('user_typing', callback);
  }

  onUserStoppedTyping(callback: (data: { chatId: string; userId: string }) => void) {
    this.socket?.on('user_stopped_typing', callback);
  }

  onMessagesRead(callback: (data: { chatId: string; messageId: string; userId: string; timestamp: string }) => void) {
    this.socket?.on('messages_read', callback);
  }

  onIncomingCall(callback: (data: any) => void) {
    this.socket?.on('incoming_call', callback);
  }

  onCallAccepted(callback: (data: any) => void) {
    this.socket?.on('call_accepted', callback);
  }

  onCallRejected(callback: (data: any) => void) {
    this.socket?.on('call_rejected', callback);
  }

  onCallEnded(callback: (data: any) => void) {
    this.socket?.on('call_ended', callback);
  }

  onIceCandidate(callback: (data: { candidate: RTCIceCandidateInit }) => void) {
    this.socket?.on('ice_candidate', callback);
  }

  onUserOnline(callback: (data: { userId: string }) => void) {
    this.socket?.on('user_online', callback);
  }

  onUserOffline(callback: (data: { userId: string }) => void) {
    this.socket?.on('user_offline', callback);
  }

  removeListener(event: string, callback: (...args: any[]) => void) {
    this.socket?.off(event, callback);
  }
}

export const socketService = new SocketService();
