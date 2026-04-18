import { useState, useEffect } from 'react';
import { useAuthStore } from '../store';
import { authAPI, userAPI } from '../services/api';

export function useAuth() {
  const { user, isAuthenticated, login, logout } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const register = async (data: { email: string; password: string; username: string; firstName?: string; lastName?: string }) => {
    try {
      setLoading(true);
      setError(null);
      const response = await authAPI.register(data);
      
      if (!response.data.requiresVerification) {
        login(response.data.user, response.data.accessToken, response.data.refreshToken);
      }
      
      return response.data;
    } catch (err: any) {
      setError(err.response?.data?.error || 'Registration failed');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const loginUser = async (data: { email: string; password: string }) => {
    try {
      setLoading(true);
      setError(null);
      const response = await authAPI.login(data);
      login(response.data.user, response.data.accessToken, response.data.refreshToken);
      return response.data;
    } catch (err: any) {
      setError(err.response?.data?.error || 'Login failed');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const logoutUser = async () => {
    try {
      const refreshToken = useAuthStore.getState().refreshToken;
      if (refreshToken) {
        await authAPI.logout(refreshToken);
      }
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      logout();
    }
  };

  const verifyEmail = async (email: string, code: string) => {
    try {
      setLoading(true);
      setError(null);
      const response = await authAPI.verifyEmail({ email, code });
      return response.data;
    } catch (err: any) {
      setError(err.response?.data?.error || 'Verification failed');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const updateProfile = async (data: { firstName?: string; lastName?: string; bio?: string; avatarUrl?: string }) => {
    try {
      setLoading(true);
      setError(null);
      const response = await userAPI.updateProfile(data);
      return response.data;
    } catch (err: any) {
      setError(err.response?.data?.error || 'Update failed');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return {
    user,
    isAuthenticated,
    loading,
    error,
    register,
    login: loginUser,
    logout: logoutUser,
    verifyEmail,
    updateProfile
  };
}
