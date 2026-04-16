import axios from 'axios';
import type { AxiosError, InternalAxiosRequestConfig } from 'axios';

type RequestConfigWithMeta = InternalAxiosRequestConfig & {
  metadata?: {
    startedAt: number;
  };
};

type ApiHealthState = {
  isSystemDegraded: boolean;
  consecutiveFailures: number;
  lastErrorStatus: number | null;
  lastErrorCode: string | null;
  lastResponseTimeMs: number | null;
};

const directBackendBaseURL =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  'http://127.0.0.1:8000';

const api = axios.create({
  baseURL: directBackendBaseURL,
  timeout: 20000,
  withCredentials: true,
});

const apiHealthState: ApiHealthState = {
  isSystemDegraded: false,
  consecutiveFailures: 0,
  lastErrorStatus: null,
  lastErrorCode: null,
  lastResponseTimeMs: null,
};

const apiHealthListeners = new Set<(state: ApiHealthState) => void>();
let networkCooldownUntil = 0;

function isNetworkFailure(code: string | null, status: number | null): boolean {
  if (status !== null) return false;
  return code === 'ERR_NETWORK' || code === 'ECONNABORTED' || code === 'ETIMEDOUT';
}

function emitApiHealthState() {
  for (const listener of apiHealthListeners) {
    listener({ ...apiHealthState });
  }
}

export function getApiHealthState(): ApiHealthState {
  return { ...apiHealthState };
}

export function subscribeApiHealth(listener: (state: ApiHealthState) => void): () => void {
  apiHealthListeners.add(listener);
  listener({ ...apiHealthState });
  return () => {
    apiHealthListeners.delete(listener);
  };
}

api.interceptors.request.use((config) => {
  if (Date.now() < networkCooldownUntil) {
    return Promise.reject(
      new axios.AxiosError('Network cooldown active. Retrying after socket pool reset window.', 'ERR_NETWORK_COOLDOWN', config)
    );
  }

  (config as RequestConfigWithMeta).metadata = { startedAt: Date.now() };

  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('ankur_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

api.interceptors.response.use(
  (response) => {
    const meta = (response.config as RequestConfigWithMeta).metadata;
    const responseTimeMs = meta?.startedAt ? Date.now() - meta.startedAt : null;

    apiHealthState.consecutiveFailures = 0;
    apiHealthState.isSystemDegraded = false;
    apiHealthState.lastErrorStatus = null;
    apiHealthState.lastErrorCode = null;
    apiHealthState.lastResponseTimeMs = responseTimeMs;
    emitApiHealthState();

    console.info(
      `[API] ${String(response.config.method || 'GET').toUpperCase()} ${response.config.url} -> ${response.status} in ${responseTimeMs ?? 'n/a'}ms`
    );

    return response;
  },
  (error: AxiosError) => {
    const config = (error.config || {}) as RequestConfigWithMeta;
    const meta = config.metadata;
    const responseTimeMs = meta?.startedAt ? Date.now() - meta.startedAt : null;
    const status = error.response?.status ?? null;
    const code = error.code ?? 'UNKNOWN';

    // Ignore canceled requests (e.g., debounced search aborts) to avoid noisy logs.
    if (code === 'ERR_CANCELED') {
      return Promise.reject(error);
    }

    const isNetworkError = isNetworkFailure(code, status);

    apiHealthState.consecutiveFailures += 1;
    apiHealthState.lastErrorStatus = status;
    apiHealthState.lastErrorCode = code;
    apiHealthState.lastResponseTimeMs = responseTimeMs;

    if (isNetworkError) {
      networkCooldownUntil = Date.now() + 3000;
    }

    if (apiHealthState.consecutiveFailures >= 3) {
      apiHealthState.isSystemDegraded = true;
    }

    emitApiHealthState();

    if (status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('token');
      localStorage.removeItem('ankur_token');
      localStorage.removeItem('ankur_user_id');
      localStorage.removeItem('ankur_user_cache');
      sessionStorage.removeItem('ankur_user_id');
      window.dispatchEvent(new Event('ankur-auth-cleared'));
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }

    const message = `[API] ${String(config.method || 'GET').toUpperCase()} ${String(config.url || '')} failed: status=${status ?? 'network'} code=${code} in ${responseTimeMs ?? 'n/a'}ms`;
    if (isNetworkError) {
      console.warn(message);
    } else {
      console.error(message);
    }

    return Promise.reject(error);
  }
);

export default api;