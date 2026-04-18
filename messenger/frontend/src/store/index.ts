import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface User {
  id: string;
  email: string;
  username: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  bio?: string;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  login: (user: User, accessToken: string, refreshToken: string) => void;
  logout: () => void;
  updateUser: (user: Partial<User>) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      login: (user, accessToken, refreshToken) => set({ 
        user, 
        accessToken, 
        refreshToken, 
        isAuthenticated: true 
      }),
      logout: () => set({ 
        user: null, 
        accessToken: null, 
        refreshToken: null, 
        isAuthenticated: false 
      }),
      updateUser: (userData) => set((state) => ({
        user: state.user ? { ...state.user, ...userData } : null
      }))
    }),
    {
      name: 'auth-storage'
    }
  )
);

// Chat types
export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  senderUsername?: string;
  content: string;
  type: 'text' | 'image' | 'video' | 'audio' | 'file' | 'voice' | 'video_note' | 'sticker' | 'gif' | 'location' | 'contact' | 'poll';
  mediaUrl?: string;
  mediaMetadata?: any;
  replyToId?: string;
  isEdited?: boolean;
  isPinned?: boolean;
  viewsCount?: number;
  createdAt: string;
  reactions?: Array<{ emoji: string; userId: string }>;
  isRead?: boolean;
}

export interface Chat {
  id: string;
  type: 'private' | 'group' | 'channel';
  name?: string;
  description?: string;
  avatarUrl?: string;
  ownerId?: string;
  isPublic?: boolean;
  inviteLink?: string;
  role?: string;
  unreadCount?: number;
  lastMessage?: {
    content: string;
    type: string;
    time: string;
    senderId?: string;
  } | null;
}

interface ChatState {
  chats: Chat[];
  currentChat: Chat | null;
  messages: Map<string, Message[]>;
  typingUsers: Map<string, Set<string>>;
  onlineUsers: Set<string>;
  setChats: (chats: Chat[]) => void;
  setCurrentChat: (chat: Chat | null) => void;
  addMessage: (message: Message) => void;
  updateMessage: (messageId: string, updates: Partial<Message>) => void;
  setTypingUser: (chatId: string, userId: string, isTyping: boolean) => void;
  setOnlineUser: (userId: string, isOnline: boolean) => void;
  loadMessages: (chatId: string, messages: Message[]) => void;
}

export const useChatStore = create<ChatState>()((set, get) => ({
  chats: [],
  currentChat: null,
  messages: new Map(),
  typingUsers: new Map(),
  onlineUsers: new Set(),
  setChats: (chats) => set({ chats }),
  setCurrentChat: (chat) => set({ currentChat: chat }),
  addMessage: (message) => set((state) => {
    const chatMessages = state.messages.get(message.chatId) || [];
    const updatedMessages = new Map(state.messages);
    updatedMessages.set(message.chatId, [...chatMessages, message]);
    return { messages: updatedMessages };
  }),
  updateMessage: (messageId, updates) => set((state) => {
    const updatedMessages = new Map(state.messages);
    for (const [chatId, messages] of updatedMessages.entries()) {
      const index = messages.findIndex(m => m.id === messageId);
      if (index !== -1) {
        const newMessages = [...messages];
        newMessages[index] = { ...newMessages[index], ...updates };
        updatedMessages.set(chatId, newMessages);
        break;
      }
    }
    return { messages: updatedMessages };
  }),
  setTypingUser: (chatId, userId, isTyping) => set((state) => {
    const chatTyping = state.typingUsers.get(chatId) || new Set();
    if (isTyping) {
      chatTyping.add(userId);
    } else {
      chatTyping.delete(userId);
    }
    const updatedTyping = new Map(state.typingUsers);
    updatedTyping.set(chatId, chatTyping);
    return { typingUsers: updatedTyping };
  }),
  setOnlineUser: (userId, isOnline) => set((state) => {
    const updatedOnline = new Set(state.onlineUsers);
    if (isOnline) {
      updatedOnline.add(userId);
    } else {
      updatedOnline.delete(userId);
    }
    return { onlineUsers: updatedOnline };
  }),
  loadMessages: (chatId, messages) => set((state) => {
    const existingMessages = state.messages.get(chatId) || [];
    const mergedMessages = [...existingMessages, ...messages];
    const uniqueMessages = Array.from(
      new Map(mergedMessages.map(m => [m.id, m])).values()
    ).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const updatedMessages = new Map(state.messages);
    updatedMessages.set(chatId, uniqueMessages);
    return { messages: updatedMessages };
  })
}));
