import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth-storage');
    if (token) {
      try {
        const parsed = JSON.parse(token);
        if (parsed.state?.accessToken) {
          config.headers.Authorization = `Bearer ${parsed.state.accessToken}`;
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    
    if (error.response?.status === 403 && !originalRequest._retry) {
      originalRequest._retry = true;
      
      try {
        const token = localStorage.getItem('auth-storage');
        if (token) {
          const parsed = JSON.parse(token);
          const refreshToken = parsed.state?.refreshToken;
          
          if (refreshToken) {
            const response = await axios.post(`${API_URL}/auth/refresh`, { refreshToken });
            const newAccessToken = response.data.accessToken;
            
            // Update stored tokens
            parsed.state.accessToken = newAccessToken;
            localStorage.setItem('auth-storage', JSON.stringify(parsed));
            
            // Retry original request
            originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
            return api(originalRequest);
          }
        }
      } catch (refreshError) {
        // Refresh failed, clear auth
        localStorage.removeItem('auth-storage');
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }
    
    return Promise.reject(error);
  }
);

export default api;

// Auth API
export const authAPI = {
  register: (data: { email: string; password: string; username: string; firstName?: string; lastName?: string }) =>
    api.post('/auth/register', data),
  
  login: (data: { email: string; password: string }) =>
    api.post('/auth/login', data),
  
  verifyEmail: (data: { email: string; code: string }) =>
    api.post('/auth/verify-email', data),
  
  logout: (refreshToken?: string) =>
    api.post('/auth/logout', { refreshToken }),
  
  getSessions: () => api.get('/auth/sessions'),
  
  terminateSession: (sessionId: string) =>
    api.delete(`/auth/sessions/${sessionId}`),
  
  terminateAllSessions: (refreshToken: string) =>
    api.delete('/auth/sessions/all-except-current', { data: { refreshToken } })
};

// User API
export const userAPI = {
  getProfile: () => api.get('/users/me'),
  
  updateProfile: (data: { firstName?: string; lastName?: string; bio?: string; avatarUrl?: string }) =>
    api.put('/users/me', data),
  
  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    api.put('/users/me/password', data),
  
  updatePrivacy: (data: { phone?: string; avatar?: string; lastSeen?: string; canWrite?: string; canAddToGroups?: string }) =>
    api.put('/users/me/privacy', data),
  
  deleteAccount: (password: string) =>
    api.delete('/users/me', { data: { password } }),
  
  searchUsers: (query: string) =>
    api.get(`/users/search?q=${encodeURIComponent(query)}`),
  
  getUserByUsername: (username: string) =>
    api.get(`/users/${username}`)
};

// Chat API
export const chatAPI = {
  getChats: () => api.get('/chats'),
  
  createPrivateChat: (otherUserId: string) =>
    api.post('/chats/private', { otherUserId }),
  
  createGroup: (data: { name: string; description?: string; participantIds?: string[]; isPublic?: boolean }) =>
    api.post('/chats/group', data),
  
  createChannel: (data: { name: string; description?: string; isPublic?: boolean; username?: string }) =>
    api.post('/chats/channel', data),
  
  getChat: (chatId: string) =>
    api.get(`/chats/${chatId}`),
  
  updateChat: (chatId: string, data: { name?: string; description?: string; avatarUrl?: string }) =>
    api.put(`/chats/${chatId}`, data),
  
  deleteChat: (chatId: string) =>
    api.delete(`/chats/${chatId}`),
  
  leaveChat: (chatId: string) =>
    api.post(`/chats/${chatId}/leave`),
  
  archiveChat: (chatId: string) =>
    api.post(`/chats/${chatId}/archive`),
  
  unarchiveChat: (chatId: string) =>
    api.post(`/chats/${chatId}/unarchive`),
  
  muteChat: (chatId: string, muted: boolean) =>
    api.post(`/chats/${chatId}/mute`, { muted })
};

// Message API
export const messageAPI = {
  getMessages: (chatId: string, limit?: number, before?: string) =>
    api.get(`/messages/chat/${chatId}`, { params: { limit, before } }),
  
  sendMessage: (chatId: string, data: { content?: string; type?: string; mediaUrl?: string; mediaMetadata?: any; replyToId?: string }) =>
    api.post(`/messages/chat/${chatId}`, data),
  
  editMessage: (messageId: string, content: string) =>
    api.put(`/messages/${messageId}`, { content }),
  
  deleteMessage: (messageId: string, forEveryone?: boolean) =>
    api.delete(`/messages/${messageId}`, { params: { forEveryone } }),
  
  pinMessage: (messageId: string) =>
    api.post(`/messages/${messageId}/pin`),
  
  addReaction: (messageId: string, emoji: string) =>
    api.post(`/messages/${messageId}/reaction`, { emoji }),
  
  removeReaction: (messageId: string, emoji: string) =>
    api.delete(`/messages/${messageId}/reaction/${encodeURIComponent(emoji)}`),
  
  searchMessages: (chatId: string, query: string) =>
    api.get(`/messages/chat/${chatId}/search`, { params: { q: query } })
};

// File API
export const fileAPI = {
  upload: (file: File, onProgress?: (progress: number) => void) => {
    const formData = new FormData();
    formData.append('file', file);
    
    return api.post('/files/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          onProgress(Math.round((progressEvent.loaded * 100) / progressEvent.total));
        }
      }
    });
  },
  
  getFiles: (limit?: number, offset?: number) =>
    api.get('/files', { params: { limit, offset } }),
  
  deleteFile: (fileId: string) =>
    api.delete(`/files/${fileId}`)
};

// Group API
export const groupAPI = {
  getGroup: (chatId: string) =>
    api.get(`/groups/${chatId}`),
  
  addParticipants: (chatId: string, participantIds: string[]) =>
    api.post(`/groups/${chatId}/participants`, { participantIds }),
  
  removeParticipant: (chatId: string, participantId: string) =>
    api.delete(`/groups/${chatId}/participants/${participantId}`),
  
  updateParticipantRole: (chatId: string, participantId: string, role: string) =>
    api.put(`/groups/${chatId}/participants/${participantId}/role`, { role }),
  
  muteParticipant: (chatId: string, participantId: string, muted: boolean) =>
    api.post(`/groups/${chatId}/participants/${participantId}/mute`, { muted })
};

// Channel API
export const channelAPI = {
  getChannel: (chatId: string) =>
    api.get(`/channels/${chatId}`),
  
  subscribe: (chatId: string) =>
    api.post(`/channels/${chatId}/subscribe`),
  
  unsubscribe: (chatId: string) =>
    api.post(`/channels/${chatId}/unsubscribe`),
  
  getSubscribers: (chatId: string) =>
    api.get(`/channels/${chatId}/subscribers`)
};

// Contact API
export const contactAPI = {
  addContact: (contactUserId: string, displayName?: string) =>
    api.post('/contacts', { contactUserId, displayName }),
  
  getContacts: () => api.get('/contacts'),
  
  removeContact: (contactId: string) =>
    api.delete(`/contacts/${contactId}`),
  
  blockContact: (contactId: string) =>
    api.post(`/contacts/${contactId}/block`),
  
  unblockContact: (contactId: string) =>
    api.post(`/contacts/${contactId}/unblock`)
};

// Call API
export const callAPI = {
  initiateCall: (receiverId: string, type: 'voice' | 'video' = 'voice', chatId?: string) =>
    api.post('/calls/initiate', { receiverId, type, chatId }),
  
  acceptCall: (callId: string) =>
    api.post(`/calls/${callId}/accept`),
  
  rejectCall: (callId: string) =>
    api.post(`/calls/${callId}/reject`),
  
  endCall: (callId: string) =>
    api.post(`/calls/${callId}/end`),
  
  getCallHistory: (limit?: number) =>
    api.get('/calls/history', { params: { limit } })
};
