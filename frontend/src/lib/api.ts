import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useNavigate } from 'react-router-dom';
import { useCallback } from 'react';
import { toast } from 'sonner';
import * as authLib from '@/lib/auth';

interface ApiErrorBody {
  message?: string;
}

// Allow callers to opt out of the global error toast for best-effort requests that
// degrade gracefully in the UI (e.g. the reviewer directory fetch). Module augmentation
// keeps this type-safe wherever an AxiosRequestConfig is accepted.
declare module 'axios' {
  export interface AxiosRequestConfig {
    _suppressErrorToast?: boolean;
  }
}

// Extend Axios config to track retry state — prevents infinite retry loops
interface RetryableConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

/** Safely extract a human-readable message from an error response body. */
function serverMessage(error: AxiosError<ApiErrorBody>, fallback: string): string {
  return error.response?.data?.message ?? fallback;
}

let axiosInstance: AxiosInstance | null = null;

function createAxiosInstance(): AxiosInstance {
  const instance = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL,
    timeout: 10000,
  });

  instance.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
      // API Gateway Cognito Authorizer validates the ID token, not the access token
      const token = authLib.getIdToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    },
    (error) => Promise.reject(error)
  );

  instance.interceptors.response.use(
    (response) => response,
    async (error: AxiosError<ApiErrorBody>) => {
      const status = error.response?.status;
      const config = error.config as RetryableConfig | undefined;

      // 401 — attempt ONE silent token refresh, then retry the original request once.
      // _retry flag prevents infinite loop if the retried request also gets 401.
      if (status === 401 && config && !config._retry) {
        config._retry = true;

        const refreshed = await authLib.refreshTokens();
        if (refreshed) {
          const token = authLib.getIdToken();
          if (token) {
            config.headers.Authorization = `Bearer ${token}`;
          }
          // Single retry with new token — if this also 401s, _retry is set so we fall through
          return axiosInstance!.request(config);
        } else {
          // Refresh failed — session is dead, redirect to login
          authLib.logout();
          window.location.href = '/login';
          return Promise.reject(error);
        }
      }

      // If we're here on a 401 it means the retry also failed — log out
      if (status === 401) {
        authLib.logout();
        window.location.href = '/login';
        return Promise.reject(error);
      }

      // Callers may opt out of the global error toast (best-effort fetches that degrade
      // gracefully in the UI) by setting `_suppressErrorToast` on the request config.
      const suppressErrorToast = config?._suppressErrorToast === true;

      // Network / no-response errors (timeouts, DNS, offline).
      if (!error.response) {
        if (!suppressErrorToast) toast.error('Network error. Check your connection.');
        return Promise.reject(error);
      }

      if (suppressErrorToast) {
        return Promise.reject(error);
      }

      // Map HTTP status codes to human-readable toasts.
      switch (status) {
        case 400:
          toast.error('Invalid request: ' + serverMessage(error, 'Bad request'));
          break;
        case 403:
          toast.error("You don't have permission to do this");
          break;
        case 404:
          toast.error('Resource not found');
          break;
        case 409:
          toast.error(serverMessage(error, 'Conflict with the current state'));
          break;
        case 422:
          toast.error(serverMessage(error, 'Validation failed'));
          break;
        case 500:
        case 502:
          toast.error('Server error. Please try again.');
          break;
        default:
          break;
      }

      return Promise.reject(error);
    }
  );

  return instance;
}

export function useApiClient(): AxiosInstance {
  if (!axiosInstance) {
    axiosInstance = createAxiosInstance();
  }
  return axiosInstance;
}

export function useApi() {
  const navigate = useNavigate();
  const client = useApiClient();

  return {
    get: useCallback(async (url: string) => {
      try {
        const response = await client.get(url);
        return response.data;
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 401) {
          navigate('/login');
        }
        throw error;
      }
    }, [client, navigate]),

    post: useCallback(
      async (url: string, data?: unknown) => {
        try {
          const response = await client.post(url, data);
          return response.data;
        } catch (error) {
          if (axios.isAxiosError(error) && error.response?.status === 401) {
            navigate('/login');
          }
          throw error;
        }
      },
      [client, navigate]
    ),

    patch: useCallback(
      async (url: string, data?: unknown) => {
        try {
          const response = await client.patch(url, data);
          return response.data;
        } catch (error) {
          if (axios.isAxiosError(error) && error.response?.status === 401) {
            navigate('/login');
          }
          throw error;
        }
      },
      [client, navigate]
    ),

    delete: useCallback(
      async (url: string) => {
        try {
          const response = await client.delete(url);
          return response.data;
        } catch (error) {
          if (axios.isAxiosError(error) && error.response?.status === 401) {
            navigate('/login');
          }
          throw error;
        }
      },
      [client, navigate]
    ),

    client,
  };
}
