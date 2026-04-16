"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import api from "../lib/api";

type AuthContextValue = {
  token: string | null;
  userId: string | null;
  isAuthenticated: boolean;
  isInitialized: boolean;
  login: (token: string, userId?: string | null) => void;
  logout: () => void;
};

const TOKEN_KEY = "ankur_token";
const USER_ID_KEY = "ankur_user_id";

const AuthContext = createContext<AuthContextValue | null>(null);

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [hasBackendSession, setHasBackendSession] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let active = true;

    const storedToken = window.localStorage.getItem(TOKEN_KEY);
    const storedUserId =
      window.localStorage.getItem(USER_ID_KEY) || window.sessionStorage.getItem(USER_ID_KEY);

    setToken(storedToken);
    setUserId(storedUserId);
    // Wait for backend verification before marking authenticated.
    setHasBackendSession(false);
    setIsInitialized(true);

    // Validate active backend session (httpOnly cookie flow) and map it to frontend auth state.
    void api
      .get("/api/me")
      .then((response) => {
        if (!active) return;
        const nextUserId = response?.data?.id ? String(response.data.id) : storedUserId;
        setUserId(nextUserId || null);
        setHasBackendSession(true);
      })
      .catch(() => {
        if (!active) return;

        // Re-check current token to avoid stale bootstrap requests overriding fresh login state.
        const currentToken = window.localStorage.getItem(TOKEN_KEY);
        const currentUserId =
          window.localStorage.getItem(USER_ID_KEY) || window.sessionStorage.getItem(USER_ID_KEY);

        if (currentToken) {
          setToken(currentToken);
          setUserId(currentUserId || null);
          setHasBackendSession(true);
          return;
        }

        setHasBackendSession(false);
        setToken(null);
        setUserId(null);
      });

    const handleAuthCleared = () => {
      setToken(null);
      setUserId(null);
      setHasBackendSession(false);
    };

    window.addEventListener("ankur-auth-cleared", handleAuthCleared);

    return () => {
      active = false;
      window.removeEventListener("ankur-auth-cleared", handleAuthCleared);
    };
  }, []);

  const login = (nextToken: string, nextUserId?: string | null) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TOKEN_KEY, nextToken);
      if (nextUserId) {
        window.localStorage.setItem(USER_ID_KEY, nextUserId);
        window.sessionStorage.setItem(USER_ID_KEY, nextUserId);
      }
    }

    setToken(nextToken);
    setUserId(nextUserId || null);
    setHasBackendSession(true);
  };

  const logout = () => {
    void api.post("/logout").catch(() => {
      // Local cleanup should continue even if backend logout endpoint is unreachable.
    });

    if (typeof window !== "undefined") {
      window.localStorage.removeItem(TOKEN_KEY);
      window.localStorage.removeItem(USER_ID_KEY);
      window.sessionStorage.removeItem(USER_ID_KEY);
    }

    setToken(null);
    setUserId(null);
    setHasBackendSession(false);
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      userId,
      isAuthenticated: hasBackendSession,
      isInitialized,
      login,
      logout,
    }),
    [hasBackendSession, isInitialized, token, userId]
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
