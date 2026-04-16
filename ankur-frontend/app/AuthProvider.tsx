"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import api from "../lib/api";

type AuthUser = {
  id: string;
  [key: string]: unknown;
};

type AuthContextValue = {
  token: string | null;
  user: AuthUser | null;
  userId: string | null;
  isAuthenticated: boolean;
  isInitialized: boolean;
  isLoading: boolean;
  login: (token: string, userId?: string | null, userData?: AuthUser | null) => void;
  setUser: (user: AuthUser | null) => void;
  logout: () => void;
};

const TOKEN_KEY = "ankur_token";
const LEGACY_TOKEN_KEY = "token";
const USER_ID_KEY = "ankur_user_id";
const USER_CACHE_KEY = "ankur_user_cache";

const AuthContext = createContext<AuthContextValue | null>(null);

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let active = true;

    const clearLocalAuthState = () => {
      window.localStorage.removeItem(TOKEN_KEY);
      window.localStorage.removeItem(LEGACY_TOKEN_KEY);
      window.localStorage.removeItem(USER_ID_KEY);
      window.localStorage.removeItem(USER_CACHE_KEY);
      window.sessionStorage.removeItem(USER_ID_KEY);
    };

    const hydrateAuth = async () => {
      setIsLoading(true);

      const storedToken =
        window.localStorage.getItem(TOKEN_KEY) || window.localStorage.getItem(LEGACY_TOKEN_KEY);
      const storedUserId =
        window.localStorage.getItem(USER_ID_KEY) || window.sessionStorage.getItem(USER_ID_KEY);
      const cachedUserRaw = window.localStorage.getItem(USER_CACHE_KEY);
      const cachedUser = cachedUserRaw ? (JSON.parse(cachedUserRaw) as AuthUser) : null;

      if (!storedToken) {
        if (!active) return;
        setToken(null);
        setUser(null);
        setUserId(null);
        setIsLoading(false);
        setIsInitialized(true);
        return;
      }

      if (!active) return;
      setToken(storedToken);
      if (cachedUser?.id) {
        setUser(cachedUser);
        setUserId(String(cachedUser.id));
      } else if (storedUserId) {
        setUser({ id: String(storedUserId) });
        setUserId(String(storedUserId));
      }

      try {
        const response = await api.get("/api/me", {
          headers: {
            Authorization: `Bearer ${storedToken}`,
          },
        });

        if (!active) return;
        const resolvedUser = response?.data as AuthUser | undefined;
        const resolvedUserId = resolvedUser?.id ? String(resolvedUser.id) : storedUserId;

        if (resolvedUserId) {
          window.localStorage.setItem(USER_ID_KEY, resolvedUserId);
          window.sessionStorage.setItem(USER_ID_KEY, resolvedUserId);
        }
        if (resolvedUser) {
          window.localStorage.setItem(USER_CACHE_KEY, JSON.stringify(resolvedUser));
          setUser(resolvedUser);
          setUserId(String(resolvedUser.id));
        } else {
          setUser(resolvedUserId ? { id: String(resolvedUserId) } : null);
          setUserId(resolvedUserId || null);
        }
      } catch {
        if (!active) return;
        clearLocalAuthState();
        setToken(null);
        setUser(null);
        setUserId(null);
      } finally {
        if (!active) return;
        setIsLoading(false);
        setIsInitialized(true);
      }
    };

    void hydrateAuth();

    const handleAuthCleared = () => {
      clearLocalAuthState();
      setToken(null);
      setUser(null);
      setUserId(null);
      setIsLoading(false);
      setIsInitialized(true);
    };

    window.addEventListener("ankur-auth-cleared", handleAuthCleared);

    return () => {
      active = false;
      window.removeEventListener("ankur-auth-cleared", handleAuthCleared);
    };
  }, []);

  const setUser = (nextUser: AuthUser | null) => {
    setUserState(nextUser);
    if (typeof window !== "undefined") {
      if (nextUser) {
        window.localStorage.setItem(USER_CACHE_KEY, JSON.stringify(nextUser));
        window.localStorage.setItem(USER_ID_KEY, String(nextUser.id));
        window.sessionStorage.setItem(USER_ID_KEY, String(nextUser.id));
      } else {
        window.localStorage.removeItem(USER_CACHE_KEY);
      }
    }
  };

  const login = (nextToken: string, nextUserId?: string | null, userData?: AuthUser | null) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TOKEN_KEY, nextToken);
      window.localStorage.setItem(LEGACY_TOKEN_KEY, nextToken);
      if (nextUserId) {
        window.localStorage.setItem(USER_ID_KEY, nextUserId);
        window.sessionStorage.setItem(USER_ID_KEY, nextUserId);
      }
    }

    setToken(nextToken);
    setUserId(nextUserId || null);
    if (userData) {
      setUser(userData);
    } else if (nextUserId) {
      setUser({ id: String(nextUserId) });
    }
    setIsLoading(false);
    setIsInitialized(true);
  };

  const logout = () => {
    void api.post("/logout").catch(() => {
      // Local cleanup should continue even if backend logout endpoint is unreachable.
    });

    if (typeof window !== "undefined") {
      window.localStorage.removeItem(TOKEN_KEY);
      window.localStorage.removeItem(LEGACY_TOKEN_KEY);
      window.localStorage.removeItem(USER_ID_KEY);
      window.localStorage.removeItem(USER_CACHE_KEY);
      window.sessionStorage.removeItem(USER_ID_KEY);
    }

    setToken(null);
    setUser(null);
    setUserId(null);
    setIsLoading(false);
    setIsInitialized(true);
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      user,
      userId,
      isAuthenticated: Boolean(token && user),
      isInitialized,
      isLoading,
      login,
      setUser,
      logout,
    }),
    [isInitialized, isLoading, token, user, userId]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
