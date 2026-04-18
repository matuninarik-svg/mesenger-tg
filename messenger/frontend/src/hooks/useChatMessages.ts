import { useState, useEffect, useRef } from 'react';
import { useChatStore, Message } from '../store';
import { messageAPI } from '../services/api';
import { socketService } from '../services/socket';

export function useChatMessages(chatId: string | null) {
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const messages = useChatStore((state) => 
    chatId ? state.messages.get(chatId) || [] : []
  );
  const loadMessages = useChatStore((state) => state.loadMessages);
  const addMessage = useChatStore((state) => state.addMessage);
  const updateMessage = useChatStore((state) => state.updateMessage);
  const currentUserId = useChatStore((state) => state.onlineUsers); // Just to get the store

  const lastMessageRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    if (!chatId) return;

    // Load initial messages
    loadInitialMessages();

    // Set up socket listeners
    const handleNewMessage = (message: Message) => {
      if (message.chatId === chatId) {
        addMessage(message);
      }
    };

    socketService.onNewMessage(handleNewMessage);

    return () => {
      socketService.removeListener('new_message', handleNewMessage);
    };
  }, [chatId]);

  const loadInitialMessages = async () => {
    if (!chatId) return;
    
    try {
      setLoading(true);
      const response = await messageAPI.getMessages(chatId, 50);
      loadMessages(chatId, response.data.messages);
      setHasMore(response.data.messages.length === 50);
    } catch (error) {
      console.error('Failed to load messages:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadMoreMessages = async () => {
    if (!chatId || loading || !hasMore) return;

    try {
      setLoading(true);
      const oldestMessage = messages[0];
      if (!oldestMessage) return;

      const response = await messageAPI.getMessages(chatId, 50, oldestMessage.createdAt);
      
      if (response.data.messages.length > 0) {
        loadMessages(chatId, response.data.messages);
        setHasMore(response.data.messages.length === 50);
      } else {
        setHasMore(false);
      }
    } catch (error) {
      console.error('Failed to load more messages:', error);
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async (content: string, type: string = 'text', mediaUrl?: string, replyToId?: string) => {
    if (!chatId || !content.trim()) return;

    try {
      const response = await messageAPI.sendMessage(chatId, { content, type, mediaUrl, replyToId });
      
      // Also emit via socket for real-time delivery
      socketService.sendMessage({
        chatId,
        senderId: response.data.message.senderId,
        content,
        type,
        mediaUrl,
        replyToId
      });
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  const editMessage = async (messageId: string, content: string) => {
    try {
      await messageAPI.editMessage(messageId, content);
      updateMessage(messageId, { content, isEdited: true });
    } catch (error) {
      console.error('Failed to edit message:', error);
    }
  };

  const deleteMessage = async (messageId: string, forEveryone: boolean = true) => {
    try {
      await messageAPI.deleteMessage(messageId, forEveryone);
      updateMessage(messageId, { content: 'This message was deleted', isEdited: false });
    } catch (error) {
      console.error('Failed to delete message:', error);
    }
  };

  const startTyping = () => {
    if (!chatId) return;
    
    socketService.startTyping(chatId, 'current-user-id');
    
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    
    typingTimeoutRef.current = setTimeout(() => {
      socketService.stopTyping(chatId, 'current-user-id');
    }, 3000);
  };

  const stopTyping = () => {
    if (!chatId) return;
    socketService.stopTyping(chatId, 'current-user-id');
  };

  return {
    messages,
    loading,
    hasMore,
    loadMoreMessages,
    sendMessage,
    editMessage,
    deleteMessage,
    startTyping,
    stopTyping
  };
}
