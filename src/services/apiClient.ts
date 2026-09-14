import axios from 'axios';
import { useAuthStore } from '../store/useAuthStore';

const getBaseURL = (): string => {
  const envUrl = (import.meta as any).env?.VITE_API_URL;
  if (envUrl && typeof envUrl === 'string' && envUrl.trim().length > 0) {
    return envUrl.endsWith('/') ? envUrl.slice(0, -1) : envUrl;
  }
  // If running in production browser on Vercel/Render, use relative /api (proxied by Vercel)
  if (typeof window !== 'undefined' && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    return '/api';
  }
  return 'http://localhost:5001/api';
};

const activeBaseURL = getBaseURL();
if (typeof window !== 'undefined') {
  console.info(`📡 [FleetOS] Active API Base URL: ${activeBaseURL}`);
}

const apiClient = axios.create({
  baseURL: activeBaseURL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 60000, // 60s timeout to accommodate Render free-tier spin-up delays
});

// Request Interceptor: Attach dynamic authorization JWT headers
apiClient.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().token;
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response Interceptor: Manage session expiries and standardized errors
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Detect authorization credentials expiration (401 Unauthorized)
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      
      // Perform automated session purge
      useAuthStore.getState().logout();
      
      // Redirect to authentication layout
      window.location.href = '/login';
    }

    // Identify common deployment/network issues for clearer error feedback
    let userFriendlyMessage = error.response?.data?.message || error.message || 'An unexpected network error occurred';
    
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      userFriendlyMessage = 'Server request timed out. The backend server might be starting up (Render cold-start), please retry in a few seconds.';
    } else if (error.code === 'ERR_NETWORK' || !error.response) {
      const currentBaseUrl = apiClient.defaults.baseURL || '';
      if (currentBaseUrl.includes('localhost') && typeof window !== 'undefined' && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
        userFriendlyMessage = 'Cannot reach API at localhost. Please configure VITE_API_URL in your Vercel Environment Variables to point to your Render backend.';
      } else {
        userFriendlyMessage = 'Network error: Unable to connect to server. Check your internet connection or backend server status.';
      }
    }

    // Wrap common HTTP statuses in descriptive developer envelopes
    const customError = {
      message: userFriendlyMessage,
      status: error.response?.status || 500,
      code: error.response?.data?.code || error.code || 'UNKNOWN_ERROR',
      response: error.response,
      raw: error
    };

    return Promise.reject(customError);
  }
);

export default apiClient;
