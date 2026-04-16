"use client";

import Image from "next/image";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Bell,
  CheckCircle2,
  Clock3,
  Droplets,
  LogOut,
  MapPinned,
  ShieldCheck,
  Siren,
  UserCheck,
} from "lucide-react";
import axios from "axios";
import api, { getApiHealthState, subscribeApiHealth } from "../../lib/api";
import { useI18n } from "../LanguageProvider";
import { useAuth } from "../AuthProvider";
import ProtectedRoute from "../ProtectedRoute";
import { useHasMounted } from "../../lib/useHasMounted";

type UserProfile = {
  id: string;
  name: string;
  email: string;
  phone: string;
  age: number;
  blood_type: string;
  is_active: boolean;
  last_donation_date: string | null;
  latitude: number | null;
  longitude: number | null;
};

type EmergencyItem = {
  id: string;
  requested_by: string;
  hospital_name: string;
  blood_type_needed: string;
  urgency: string;
  contact_email: string;
  contact_phone: string | null;
  patient_age: number;
  requisition_form_path: string | null;
  status: "PENDING" | "ACCEPTED" | "COMPLETED";
  accepted_by: string | null;
  accepted_by_user_id?: string | null;
  accepted_by_id?: string | null;
  accepted_by_name?: string | null;
  created_at: string | null;
  accepted_at: string | null;
  latitude: number | null;
  longitude: number | null;
  is_compatible?: boolean;
  can_accept: boolean;
  accept_block_reason: string | null;
};

type ApiNotification = {
  id: string;
  emergency_id: string | null;
  kind: string;
  message: string;
  created_at: string | null;
  is_read: boolean;
};

type MyRequestItem = EmergencyItem;

type BloodBank = {
  id: number;
  name: string;
  address: string;
  phone: string;
  latitude: number | null;
  longitude: number | null;
};

type Notice = {
  id: string;
  text: string;
  tone: "success" | "warning" | "info";
};

const bloodGroups = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const urgencies = ["Critical", "High", "Normal"];
const PROFILE_CACHE_KEY = "ankur_dashboard_profile_cache";
const PROFILE_CACHE_TTL_MS = 5000;
const VERIFICATION_WINDOW = process.env.NODE_ENV === "development" ? 60 : 24 * 60 * 60;

type ProfileCache = {
  cachedAt: number;
  data: UserProfile;
};

function isDataEqual<T>(left: T, right: T): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function getErrorCode(err: unknown): number | "NETWORK" {
  if (axios.isAxiosError(err)) {
    return err.response?.status ?? "NETWORK";
  }
  return "NETWORK";
}

function formatLoadError(statusCode: number | "NETWORK" | null): string {
  if (!statusCode) {
    return "Could not load dashboard data. Check backend connection and try again.";
  }
  if (statusCode === "NETWORK") {
    return "Could not load dashboard data (network timeout/connection error).";
  }
  return `Could not load dashboard data (HTTP ${statusCode}).`;
}

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

function hoursSince(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  return (now.getTime() - date.getTime()) / (1000 * 60 * 60);
}

function remainingSecondsFromAccepted(acceptedAt: string | null): number {
  if (!acceptedAt) return VERIFICATION_WINDOW;
  const accepted = new Date(acceptedAt).getTime();
  if (Number.isNaN(accepted)) return VERIFICATION_WINDOW;
  const elapsedSeconds = Math.floor((Date.now() - accepted) / 1000);
  return Math.max(0, VERIFICATION_WINDOW - elapsedSeconds);
}

function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${remaining}s`;
  }
  return `${minutes}m ${remaining}s`;
}

export default function DashboardPage() {
  const { t } = useI18n();
  const { isAuthenticated, isInitialized, logout: authLogout } = useAuth();
  const hasMounted = useHasMounted();
  const [mounted, setMounted] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [emergencies, setEmergencies] = useState<EmergencyItem[]>([]);
  const [banks, setBanks] = useState<BloodBank[]>([]);
  const [bankQuery, setBankQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadStatusCode, setLoadStatusCode] = useState<number | "NETWORK" | null>(null);
  const [isSystemDegraded, setIsSystemDegraded] = useState(getApiHealthState().isSystemDegraded);
  const [retryCountdown, setRetryCountdown] = useState(0);
  const [submittingRequest, setSubmittingRequest] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [backendNotifications, setBackendNotifications] = useState<ApiNotification[]>([]);
  const [myRequests, setMyRequests] = useState<MyRequestItem[]>([]);
  const [acceptingEmergencyIds, setAcceptingEmergencyIds] = useState<string[]>([]);
  const [optimisticAcceptedIds, setOptimisticAcceptedIds] = useState<string[]>([]);
  const [completingEmergencyIds, setCompletingEmergencyIds] = useState<string[]>([]);
  const [showOnlyMyRequests, setShowOnlyMyRequests] = useState(false);
  const [requestForm, setRequestForm] = useState({
    hospital_name: "",
    patient_age: "",
    contact_email: "",
    contact_phone: "",
    blood_type_needed: "O+",
    urgency: "Critical",
    latitude: "",
    longitude: "",
  });
  const [requisitionFile, setRequisitionFile] = useState<File | null>(null);
  const pendingRequestRef = useRef(false);
  const activeControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const lastDonationDays = daysSince(profile?.last_donation_date ?? null);
  const eligibleNow = Boolean(profile?.is_active);
  const nextEligibleIn = 0;
  const donationProgress =
    eligibleNow ? 100 : 0;

  const visibleEmergencies = useMemo(() => {
    if (!showOnlyMyRequests) return emergencies;
    return myRequests;
  }, [emergencies, myRequests, showOnlyMyRequests]);

  const timeline = useMemo(() => {
    const items: Array<{ id: string; label: string; time: string | null }> = [];
    items.push({ id: "registered", label: `${t("Welcome")} ANKUR`, time: null });

    emergencies
      .filter((e) => e.requested_by === profile?.id)
      .slice(0, 3)
      .forEach((e) => {
        items.push({ id: `req-${e.id}`, label: `${t("Create Blood Request")}: ${e.blood_type_needed} • ${e.hospital_name}`, time: e.created_at });
      });

    emergencies
      .filter((e) => e.accepted_by === profile?.id)
      .slice(0, 3)
      .forEach((e) => {
        items.push({ id: `acc-${e.id}`, label: `${t("Accepted by")} #${e.id}`, time: e.accepted_at });
      });

    if (profile && !profile.is_active) {
      items.push({ id: "deactivated", label: `${t("Account:")} ${t("Deactivated")}`, time: null });
    }

    return items.slice(0, 8);
  }, [emergencies, profile, t]);

  const addNotice = useCallback((text: string, tone: Notice["tone"] = "info") => {
    setNotices((prev) => [{ id: `${Date.now()}-${Math.random()}`, text, tone }, ...prev].slice(0, 6));
  }, []);

  const isRetryCoolingDown = retryCountdown > 0;

  const readCachedProfile = useCallback((): ProfileCache | null => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(PROFILE_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as ProfileCache;
      if (!parsed?.data || typeof parsed?.cachedAt !== "number") return null;
      return parsed;
    } catch {
      return null;
    }
  }, []);

  const writeCachedProfile = useCallback((nextProfile: UserProfile) => {
    if (typeof window === "undefined") return;
    const payload: ProfileCache = {
      cachedAt: Date.now(),
      data: nextProfile,
    };
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(payload));
  }, []);

  const hydrateProfileIntoForm = useCallback((sourceProfile: UserProfile) => {
    setRequestForm((prev) => ({
      ...prev,
      contact_email: prev.contact_email || sourceProfile?.email || "",
      contact_phone: prev.contact_phone || sourceProfile?.phone || "",
      latitude:
        prev.latitude ||
        (sourceProfile?.latitude != null && !Number.isNaN(sourceProfile.latitude) ? String(sourceProfile.latitude) : ""),
      longitude:
        prev.longitude ||
        (sourceProfile?.longitude != null && !Number.isNaN(sourceProfile.longitude) ? String(sourceProfile.longitude) : ""),
    }));
  }, []);

  const fetchBanks = useCallback(async (search = "", signal?: AbortSignal) => {
    const banksRes = await api.get("/api/blood-banks", { params: { query: search }, signal });
    const nextBanks = banksRes.data.items || [];
    setBanks((prev) => (isDataEqual(prev, nextBanks) ? prev : nextBanks));
  }, []);

  const fetchDashboardData = useCallback(async (search = "", signal?: AbortSignal) => {
    if (pendingRequestRef.current) {
      return {
        hasUsableProfile: true,
        profileErrorCode: null as number | "NETWORK" | null,
        unauthorized: false,
      };
    }

    pendingRequestRef.current = true;

    const [profileResult, emergencyResult, myRequestsResult, bankResult, notificationResult] = await Promise.allSettled([
      api.get("/api/me", { signal }),
      api.get("/api/emergencies", { signal }),
      api.get("/api/my-requests", { signal }),
      api.get("/api/blood-banks", { params: { query: search }, signal }),
      api.get("/api/notifications", { signal }),
    ]);

    let hasUsableProfile = false;
    let profileErrorCode: number | "NETWORK" | null = null;
    let unauthorized = false;

    if (profileResult.status === "fulfilled") {
      const nextProfile = profileResult.value.data as UserProfile;
      setProfile((prev) => (isDataEqual(prev, nextProfile) ? prev : nextProfile));
      hydrateProfileIntoForm(nextProfile);
      writeCachedProfile(nextProfile);
      hasUsableProfile = true;
      setLoadStatusCode((prev) => (prev === null ? prev : null));
      setLoadError((prev) => (prev === null ? prev : null));
    } else {
      profileErrorCode = getErrorCode(profileResult.reason);
      unauthorized = axios.isAxiosError(profileResult.reason) && profileResult.reason.response?.status === 401;
    }

    if (emergencyResult.status === "fulfilled") {
      const nextEmergencies = emergencyResult.value.data.items || [];
      setEmergencies((prev) => (isDataEqual(prev, nextEmergencies) ? prev : nextEmergencies));
    } else {
      addNotice(t("Emergency feed is delayed. Retrying shortly."), "warning");
    }

    if (myRequestsResult.status === "fulfilled") {
      const rawMyRequests = myRequestsResult.value.data.items || [];
      const nextMyRequests = rawMyRequests.map((item: Partial<EmergencyItem>) => ({
        ...item,
        can_accept: false,
        accept_block_reason: "Requester view",
      })) as MyRequestItem[];
      setMyRequests((prev) => (isDataEqual(prev, nextMyRequests) ? prev : nextMyRequests));
    } else {
      addNotice(t("My Requests feed is delayed. Retrying shortly."), "warning");
    }

    if (bankResult.status === "fulfilled") {
      const nextBanks = bankResult.value.data.items || [];
      setBanks((prev) => (isDataEqual(prev, nextBanks) ? prev : nextBanks));
    } else {
      addNotice(t("Blood bank list is delayed. You can keep using the dashboard."), "info");
    }

    if (notificationResult.status === "fulfilled") {
      const nextNotifications = notificationResult.value.data.items || [];
      setBackendNotifications((prev) => (isDataEqual(prev, nextNotifications) ? prev : nextNotifications));
    }

    pendingRequestRef.current = false;

    return {
      hasUsableProfile,
      profileErrorCode,
      unauthorized,
    };
  }, [addNotice, hydrateProfileIntoForm, t, writeCachedProfile]);

  const initializeDashboard = useCallback(async (options?: { useSkeleton?: boolean }) => {
    const useSkeleton = options?.useSkeleton ?? false;
    if (!isInitialized) return;
    if (!isAuthenticated) {
      const pendingToken = typeof window !== "undefined" ? window.localStorage.getItem("ankur_token") : null;
      if (pendingToken) {
        // Wait for AuthProvider /api/me verification to resolve.
        return;
      }
      window.location.href = "/login";
      return;
    }

    const cached = readCachedProfile();
    if (cached?.data) {
      setProfile((prev) => (isDataEqual(prev, cached.data) ? prev : cached.data));
      hydrateProfileIntoForm(cached.data);
      setLoading((prev) => (prev ? false : prev));

      const ageMs = Date.now() - cached.cachedAt;
      if (ageMs > PROFILE_CACHE_TTL_MS) {
        addNotice(t("Showing cached profile while refreshing in background."), "info");
      }
    }

    if (useSkeleton && !cached?.data) {
      setLoading(true);
    }

    const controller = new AbortController();
    activeControllerRef.current = controller;

    let result: { hasUsableProfile: boolean; profileErrorCode: number | "NETWORK" | null; unauthorized: boolean };
    try {
      result = await fetchDashboardData("", controller.signal);
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.code === "ERR_CANCELED") {
        pendingRequestRef.current = false;
        return;
      }
      pendingRequestRef.current = false;
      throw err;
    }

    if (result.unauthorized) {
      authLogout();
      window.location.href = "/login";
      return;
    }

    if (!result.hasUsableProfile && !cached?.data) {
      setLoadStatusCode((prev) => (prev === result.profileErrorCode ? prev : result.profileErrorCode));
      const nextError = formatLoadError(result.profileErrorCode);
      setLoadError((prev) => (prev === nextError ? prev : nextError));
      addNotice("Failed to refresh profile data.", "warning");
    }

    setLoading((prev) => (prev ? false : prev));
  }, [addNotice, authLogout, fetchDashboardData, hydrateProfileIntoForm, isAuthenticated, isInitialized, readCachedProfile]);

  useEffect(() => {
    initializeDashboard({ useSkeleton: true });
    return () => {
      activeControllerRef.current?.abort();
    };
  }, [initializeDashboard]);

  useEffect(() => {
    if (!isInitialized || !isAuthenticated) {
      return;
    }

    const timer = window.setInterval(() => {
      void fetchDashboardData(bankQuery);
    }, 5000);

    return () => window.clearInterval(timer);
  }, [bankQuery, fetchDashboardData, isAuthenticated, isInitialized]);

  useEffect(() => {
    const unsubscribe = subscribeApiHealth((state) => {
      setIsSystemDegraded((prev) => (prev === state.isSystemDegraded ? prev : state.isSystemDegraded));
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!isRetryCoolingDown) return;
    const timer = window.setInterval(() => {
      setRetryCountdown((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isRetryCoolingDown]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (!profile) return;
      try {
        await fetchBanks(bankQuery, controller.signal);
      } catch {
        // Keep last successful bank list.
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [bankQuery, fetchBanks, profile]);

  const handleRetry = async () => {
    if (isRetryCoolingDown) return;
    setRetryCountdown(5);
    await initializeDashboard({ useSkeleton: true });
  };

  const logout = () => {
    authLogout();
    window.location.href = "/login";
  };

  const useCurrentLocation = () => {
    if (!("geolocation" in navigator)) {
      addNotice("Geolocation not supported by browser.", "warning");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setRequestForm((prev) => ({
          ...prev,
          latitude: String(pos.coords.latitude),
          longitude: String(pos.coords.longitude),
        }));
        addNotice("Emergency coordinates updated from your device.", "success");
      },
      () => addNotice("Location permission denied.", "warning")
    );
  };

  const submitEmergencyRequest = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmittingRequest(true);
    try {
      const payload = new FormData();
      payload.append("hospital_name", requestForm.hospital_name);
      payload.append("patient_age", String(parseInt(requestForm.patient_age, 10)));
      payload.append("contact_email", requestForm.contact_email);
      payload.append("contact_phone", requestForm.contact_phone);
      payload.append("blood_type_needed", requestForm.blood_type_needed);
      payload.append("urgency", requestForm.urgency);
      payload.append("latitude", String(parseFloat(requestForm.latitude)));
      payload.append("longitude", String(parseFloat(requestForm.longitude)));
      if (requisitionFile) {
        payload.append("requisition_form", requisitionFile);
      }

      const res = await api.post("/api/request-blood", payload);
      addNotice(`Broadcasted to ${res.data.donors_found} eligible donors.`, "success");
      setShowRequestModal(false);
      setRequestForm((prev) => ({ ...prev, hospital_name: "", patient_age: "", contact_phone: "" }));
      setRequisitionFile(null);
      await fetchDashboardData(bankQuery);
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? (err.response?.data?.detail as string) || "Failed to create blood request."
        : "Failed to create blood request.";
      addNotice(msg, "warning");
    } finally {
      setSubmittingRequest(false);
    }
  };

  const acceptEmergency = async (id: string) => {
    if (acceptingEmergencyIds.includes(id)) return;

    const previousEmergencies = emergencies;

    setAcceptingEmergencyIds((prev) => [...prev, id]);
    setOptimisticAcceptedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setEmergencies((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              status: "ACCEPTED",
              can_accept: false,
              accept_block_reason: "Processing your acceptance...",
            }
          : item
      )
    );

    try {
      const res = await api.post("/api/accept-request", { emergency_id: id });
      addNotice(res.data.message || t("Request accepted."), "success");
      await fetchDashboardData(bankQuery);
      setOptimisticAcceptedIds((prev) => prev.filter((itemId) => itemId !== id));
    } catch (err: unknown) {
      setEmergencies(previousEmergencies);
      setOptimisticAcceptedIds((prev) => prev.filter((itemId) => itemId !== id));
      const msg = axios.isAxiosError(err)
        ? (err.response?.data?.detail as string) || t("Unable to accept request.")
        : t("Unable to accept request.");
      addNotice(msg, "warning");
      await fetchDashboardData(bankQuery);
    } finally {
      setAcceptingEmergencyIds((prev) => prev.filter((itemId) => itemId !== id));
    }
  };

  const completeEmergency = async (id: string) => {
    if (completingEmergencyIds.includes(id)) return;

    setCompletingEmergencyIds((prev) => [...prev, id]);
    try {
      const res = await api.post("/api/complete-request", { emergency_id: id });
      addNotice(res.data.message || t("Request marked completed."), "success");
      await fetchDashboardData(bankQuery);
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? (err.response?.data?.detail as string) || t("Unable to complete request.")
        : t("Unable to complete request.");
      addNotice(msg, "warning");
    } finally {
      setCompletingEmergencyIds((prev) => prev.filter((itemId) => itemId !== id));
    }
  };

  if (!mounted || !hasMounted || loading) {
    return <div className="bg-[#9D1720] h-screen" />;
  }

  if (!profile) {
    return (
      <main className="min-h-screen bg-[#FAF7F2] p-4 sm:p-6">
        <div className="mx-auto max-w-xl rounded-lg border border-[#f0ede6] bg-white p-4 text-center shadow-sm sm:p-6">
          <h2 className="font-montserrat text-xl font-bold text-[#9D1720]">{t("Dashboard unavailable")}</h2>
          <p className="mt-2 text-sm text-[#3F3F3F] opacity-70">{loadError || t("Unable to load your profile.")}</p>
          {loadStatusCode && (
            <p className="mt-1 text-xs font-medium text-[#9D1720]">
              {loadStatusCode === "NETWORK" ? "Error: NETWORK_TIMEOUT_OR_CONNECTION" : `Error: HTTP_${loadStatusCode}`}
            </p>
          )}
          {isSystemDegraded && (
            <p className="mt-1 text-xs font-medium text-[#9D1720]">{t("System is degraded after repeated backend failures.")}</p>
          )}
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              onClick={handleRetry}
              disabled={isRetryCoolingDown}
              className="rounded-md bg-[#9D1720] px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60 hover:bg-[#7D1019] transition-colors"
            >
              {isRetryCoolingDown ? `${t("Retry")} ${retryCountdown}s` : t("Retry")}
            </button>
            <button
              onClick={logout}
              className="rounded-md bg-[#f0ede6] px-4 py-2 text-sm font-semibold text-[#9D1720] hover:bg-[#e5dfd8] transition-colors"
            >
              {t("Back to Login")}
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <ProtectedRoute>
    <main className="min-h-screen bg-[#FAF7F2] px-4 pb-8 pt-24 text-[#3F3F3F] md:pt-20">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-lg border border-[#f0ede6] bg-white p-6 shadow-[0_4px_10px_rgba(0,0,0,0.05)] md:p-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-center gap-3 sm:gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-[#FEF2F2] font-montserrat font-bold text-[#9D1720]" title={`Blood Type: ${profile.blood_type}`}>
                {profile.blood_type}
              </div>
              <div className="min-w-0">
                <h1 className="font-montserrat text-2xl font-bold text-[#9D1720] tracking-wide md:text-4xl wrap-break-word">{t("Welcome")}, {profile.name}</h1>
                <p className="mt-1 text-sm text-[#3F3F3F] opacity-70">{t("Emergency blood operations network")}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`inline-block rounded-md px-3 py-2 text-xs font-bold ${
                  eligibleNow ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"
                }`}
              >
                {eligibleNow ? `${t("Eligible Now")}` : `${t("Next Eligible In")} ${nextEligibleIn}d`}
              </span>
              <button
                onClick={logout}
                className="inline-flex items-center gap-1 rounded-md bg-[#9D1720] px-3 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90"
              >
                <LogOut className="h-3.5 w-3.5" /> {t("Logout")}
              </button>
            </div>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-8">
            <div className="relative rounded-lg border-2 border-[#9D1720] bg-linear-to-r from-[#9D1720] to-[#DC2626] p-4 text-white shadow-[0_6px_20px_rgba(157,23,32,0.15)] sm:p-6 lg:p-8">
              <div className="absolute -right-3 -top-3 h-12 w-12 rounded-full bg-white/10 blur-xl" />
              <div className="flex flex-col gap-4 sm:gap-6 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="font-oswald text-xs uppercase tracking-widest text-white/80">{t("Emergency Action")}</p>
                  <h2 className="font-montserrat mt-2 text-2xl font-black sm:text-3xl lg:text-4xl" style={{ color: '#FAF7F2' }}>{t("Create Blood Request")}</h2>
                  <p className="mt-2 text-sm text-white/90">{t("Broadcast to eligible donors instantly with hospital details.")}</p>
                </div>
                <button
                  onClick={() => setShowRequestModal(true)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-white px-4 py-3 font-bold text-[#9D1720] transition-transform hover:scale-105 sm:w-auto sm:px-6"
                >
                  <Siren className="h-5 w-5" /> {t("Launch Request")}
                </button>
              </div>
            </div>

            <div className="ankur-card relative p-4 sm:p-6">
              <div className="absolute left-0 top-0 h-1 w-12 bg-[#9D1720]" />
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 sm:gap-3">
                  <span className="inline-block h-3 w-3 rounded-full bg-emerald-500 ankur-live-dot" />
                  <h3 className="font-montserrat text-lg font-bold text-[#9D1720]">{t("Live Emergency Feed")}</h3>
                </div>
                <div className="flex items-center gap-2 self-start sm:self-auto">
                  <button
                    type="button"
                    onClick={() => setShowOnlyMyRequests((prev) => !prev)}
                    className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                      showOnlyMyRequests ? "bg-[#9D1720] text-white" : "bg-[#FAF7F2] text-[#3F3F3F]"
                    }`}
                  >
                    {showOnlyMyRequests ? t("My Requests") : t("All Emergencies")}
                  </button>
                  <span className="text-xs text-[#3F3F3F] opacity-60">{visibleEmergencies.length}</span>
                </div>
              </div>
              <div className="space-y-3">
                {visibleEmergencies.length === 0 && (
                  <div className="rounded-md border border-[#9D1720]/20 bg-[#FEF2F2] px-4 py-6 text-center">
                    <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#FAF7F2] text-[#9D1720]">
                      <Droplets className="h-6 w-6 ankur-heartbeat" />
                    </div>
                    <p className="font-oswald text-sm font-semibold text-[#9D1720]">{t("The network is clear.")}</p>
                    <p className="mt-1 text-xs text-[#3F3F3F] opacity-70">{t("No active emergencies.")}</p>
                  </div>
                )}
                {visibleEmergencies.map((item) => (
                  <div
                    key={item.id}
                    className={`rounded-md border-2 p-4 transition-all ${
                      item.status === "PENDING" && item.is_compatible
                        ? "border-[#9D1720]/60 bg-[#FEF2F2]"
                        : "border-[#f0ede6]"
                    }`}
                  >
                    {(() => {
                      const isProcessing = acceptingEmergencyIds.includes(item.id);
                      const isCompleting = completingEmergencyIds.includes(item.id);
                      const isJoined = optimisticAcceptedIds.includes(item.id) || item.status === "ACCEPTED";
                      const remainingVerificationSeconds = remainingSecondsFromAccepted(item.accepted_at);
                      const canMarkDone =
                        item.status === "ACCEPTED" &&
                        item.requested_by === profile.id &&
                        remainingVerificationSeconds <= 0;

                      return (
                        <>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="rounded-sm bg-[#9D1720] px-2.5 py-1.5 font-oswald text-xs font-bold text-white">{item.blood_type_needed}</span>
                        <span className={`inline-block rounded-sm px-2.5 py-1.5 font-oswald text-xs font-bold ${item.urgency === "Critical" ? "rotate-2 border-2 border-[#9D1720] bg-[#9D1720] text-white" : "bg-[#FAF7F2] text-[#3F3F3F]"}`}>
                          {item.urgency}
                        </span>
                      </div>
                      <span className="font-semibold text-[#9D1720]">{item.status}</span>
                    </div>
                    <p className="mt-3 font-montserrat text-base font-bold text-[#3F3F3F]">{item.hospital_name}</p>
                    <p className="mt-1 text-xs text-[#3F3F3F] opacity-60">{t("Age")}: {item.patient_age} | {item.contact_email}</p>
                    {item.contact_phone && <p className="text-xs text-[#3F3F3F] opacity-60">{t("Contact Phone")}: {item.contact_phone}</p>}
                    {item.requisition_form_path && (
                      <p className="mt-2 text-xs">
                        <a
                          href={`${api.defaults.baseURL}${item.requisition_form_path}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold text-[#9D1720] underline"
                        >
                          {t("View requisition form")}
                        </a>
                      </p>
                    )}
                    {item.status === "ACCEPTED" && item.accepted_by != null && (
                      <p className="mt-2 text-xs text-[#3F3F3F] opacity-70">
                        {t("Accepted by")}: {item.accepted_by_name || `User #${item.accepted_by}`}
                      </p>
                    )}
                    <div className="mt-4 flex items-center justify-end gap-2">
                      {canMarkDone && (
                        <button
                          disabled={isCompleting}
                          onClick={() => completeEmergency(item.id)}
                          className="rounded-md bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isCompleting ? t("Confirming...") : t("Confirmed")}
                        </button>
                      )}
                      <button
                        disabled={isProcessing || isJoined || item.requested_by === profile.id || !item.can_accept}
                        onClick={() => acceptEmergency(item.id)}
                        className="rounded-md bg-[#9D1720] px-4 py-2 text-xs font-bold text-white transition-all hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
                        title={
                          item.requested_by === profile.id
                              ? t("You cannot accept your own request")
                            : isProcessing
                              ? t("Processing...")
                              : item.accept_block_reason || t("Accept")
                        }
                      >
                        {isProcessing ? t("Accepting...") : isJoined ? t("Joined") : t("Accept")}
                      </button>
                    </div>
                    {!item.can_accept && item.accept_block_reason && (
                      <p className="mt-2 text-right text-xs text-[#9D1720]/70">{item.accept_block_reason}</p>
                    )}
                        </>
                      );
                    })()}
                  </div>
                ))}
              </div>
            </div>

            <div className="ankur-card relative p-4 sm:p-6">
              <div className="absolute left-0 top-0 h-1 w-12 bg-[#9D1720]" />
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-montserrat text-lg font-bold text-[#9D1720]">{t("My Requests")}</h3>
                <span className="text-xs text-[#3F3F3F] opacity-60">{myRequests.length} {t("Active")}</span>
              </div>
              <div className="space-y-3">
                {myRequests.length === 0 && (
                  <div className="rounded-md border border-[#9D1720]/20 bg-[#FEF2F2] px-4 py-6 text-center">
                    <p className="text-xs text-[#3F3F3F] opacity-70">{t("No active requests.")}</p>
                  </div>
                )}
                {myRequests.map((item) => {
                  const isCompleting = completingEmergencyIds.includes(item.id);
                  const remainingVerificationSeconds = remainingSecondsFromAccepted(item.accepted_at);
                  const canMarkDone = item.status === "ACCEPTED" && remainingVerificationSeconds <= 0;

                  return (
                    <div key={`my-${item.id}`} className={`rounded-md border-2 p-4 transition-all ${item.status === "PENDING" ? "border-[#9D1720]/50 bg-[#FEF2F2] ankur-request-pulse" : "border-[#f0ede6]"}`}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className="rounded-sm bg-[#9D1720] px-2.5 py-1.5 font-oswald text-xs font-bold text-white">{item.blood_type_needed}</span>
                          <span className={`inline-block rounded-sm px-2.5 py-1.5 font-oswald text-xs font-bold ${item.urgency === "Critical" ? "rotate-2 border-2 border-[#9D1720] bg-[#9D1720] text-white" : "bg-[#FAF7F2] text-[#3F3F3F]"}`}>
                            {item.urgency}
                          </span>
                        </div>
                        <span className="font-semibold text-[#9D1720]">{item.status}</span>
                      </div>
                      <p className="mt-3 font-montserrat text-base font-bold text-[#3F3F3F]">{item.hospital_name}</p>
                      {item.status === "ACCEPTED" && (
                        <>
                          <p className="mt-2 text-xs text-[#3F3F3F] opacity-70">
                            {t("Accepted by")}: {item.accepted_by_name || item.accepted_by_id || t("Unknown donor")}
                          </p>
                          <p className="text-xs text-[#3F3F3F] opacity-70">
                            {remainingVerificationSeconds > 0
                              ? `Verify in ${formatCountdown(remainingVerificationSeconds)}`
                              : t("Ready to confirm.")}
                          </p>
                        </>
                      )}
                      {item.status === "PENDING" && (
                        <p className="mt-2 text-xs text-[#3F3F3F] opacity-70">{t("Broadcasting to donors...")}</p>
                      )}
                      {item.status === "ACCEPTED" && (
                        <div className="mt-4 flex items-center justify-end">
                          <button
                            disabled={!canMarkDone || isCompleting}
                            onClick={() => completeEmergency(item.id)}
                            className="rounded-md bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
                            title={canMarkDone ? t("Confirm donation and close request") : t("Waiting for verification window")}
                          >
                            {isCompleting ? t("Confirming...") : t("Confirmed")}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="space-y-6 lg:col-span-4">
            <div className="ankur-card relative p-4 sm:p-6">
              <div className="absolute left-0 top-0 h-1 w-12 bg-[#9D1720]" />
              <h3 className="font-montserrat text-lg font-bold text-[#9D1720]">{t("My Eligibility")}</h3>
              <p className="mt-2 text-xs text-[#3F3F3F] opacity-70">{t("Health-safe donor pacing enforced.")}</p>
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[#3F3F3F] opacity-70">{t("Last donation:")}</span>
                  <span className="font-semibold text-[#9D1720]">{profile.last_donation_date || "N/A"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#3F3F3F] opacity-70">{t("Days elapsed:")}</span>
                  <span className="font-semibold text-[#9D1720]">{lastDonationDays ?? "N/A"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#3F3F3F] opacity-70">{t("Account:")}</span>
                  <span className={`font-semibold ${profile.is_active ? "text-emerald-700" : "text-[#9D1720]"}`}>
                    {profile.is_active ? t("Active") : t("Deactivated")}
                  </span>
                </div>
              </div>
              <div className="mt-4 h-2 w-full rounded-full bg-[#FAF7F2]">
                <div className="h-2 rounded-full bg-emerald-500 transition-all" style={{ width: `${donationProgress}%` }} />
              </div>
              <p className="mt-2 text-xs text-[#3F3F3F] opacity-60">{t("Readiness progress")}</p>
            </div>

            <div className="ankur-card relative p-4 sm:p-6">
              <div className="absolute left-0 top-0 h-1 w-12 bg-[#9D1720]" />
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-montserrat text-lg font-bold text-[#9D1720]">{t("Blood Banks")}</h3>
                <MapPinned className="h-4 w-4 text-[#9D1720]/60" />
              </div>
              <input
                value={bankQuery}
                onChange={(e) => setBankQuery(e.target.value)}
                placeholder={t("Search district or name...")}
                className="mb-4 w-full rounded-md border border-[#f0ede6] bg-[#FAF7F2] px-3 py-2 text-sm text-[#3F3F3F] placeholder-[#3F3F3F]/40 outline-none transition-colors focus:border-[#9D1720] focus:bg-white focus:ring-1 focus:ring-[#9D1720]/20"
              />
              <div className="max-h-64 space-y-2 overflow-auto pr-1">
                {banks.slice(0, 8).map((bank) => (
                  <div key={bank.id} className="rounded-md border border-[#f0ede6] bg-[#FAF7F2] p-3 transition-colors hover:bg-white">
                    <p className="text-sm font-semibold text-[#3F3F3F]">{bank.name}</p>
                    <p className="text-xs text-[#3F3F3F] opacity-60">{bank.address}</p>
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className="text-[#3F3F3F] opacity-70">{bank.phone}</span>
                      {bank.latitude != null && bank.longitude != null ? (
                        <a
                          href={`https://www.google.com/maps?q=${bank.latitude},${bank.longitude}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold text-[#9D1720] hover:opacity-80 transition-opacity"
                        >
                          {t("Map")}
                        </a>
                      ) : (
                        <span className="text-[#3F3F3F] opacity-40">{t("No coords")}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-8">
            <div className="ankur-card relative p-4 sm:p-6">
              <div className="absolute left-0 top-0 h-1 w-12 bg-[#9D1720]" />
              <div className="mb-4 flex items-center gap-2">
                <Bell className="h-4 w-4 text-[#9D1720]" />
                <h3 className="font-montserrat text-lg font-bold text-[#9D1720]">{t("Notifications")}</h3>
              </div>
              <div className="space-y-2">
                {backendNotifications.length === 0 && notices.length === 0 && (
                  <p className="text-sm text-[#3F3F3F] opacity-60">{t("All quiet on the network.")}</p>
                )}
                {backendNotifications.map((notice) => (
                  <div key={`server-${notice.id}`} className="rounded-md border-l-2 border-[#9D1720] bg-[#FEF2F2] px-3 py-2 text-sm text-[#9D1720]">
                    {notice.message}
                  </div>
                ))}
                {notices.map((notice) => (
                  <div
                    key={notice.id}
                    className={`rounded-md border-l-2 px-3 py-2 text-sm ${
                      notice.tone === "success"
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                        : notice.tone === "warning"
                          ? "border-amber-500 bg-amber-50 text-amber-700"
                          : "border-[#9D1720] bg-[#FEF2F2] text-[#9D1720]"
                    }`}
                  >
                    {notice.text}
                  </div>
                ))}
              </div>
            </div>

            <div className="ankur-card relative p-4 sm:p-6">
              <div className="absolute left-0 top-0 h-1 w-12 bg-[#9D1720]" />
              <div className="mb-4 flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-[#9D1720]" />
                <h3 className="font-montserrat text-lg font-bold text-[#9D1720]">{t("Activity Timeline")}</h3>
              </div>
              <div className="space-y-2">
                {timeline.map((item) => (
                  <div key={item.id} className="rounded-md border border-[#f0ede6] bg-[#FAF7F2] px-3 py-2 text-sm">
                    <p className="font-medium text-[#3F3F3F]">{item.label}</p>
                    <p className="text-xs text-[#3F3F3F] opacity-60">{item.time || "-"}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-6 lg:col-span-4">
            <div className="ankur-card relative p-4 sm:p-6">
              <div className="absolute left-0 top-0 h-1 w-12 bg-[#9D1720]" />
              <div className="mb-4 flex items-center gap-2">
                <UserCheck className="h-4 w-4 text-[#9D1720]" />
                <h3 className="font-montserrat text-lg font-bold text-[#9D1720]">{t("Verification")}</h3>
              </div>
              <div className="space-y-3 text-sm">
                <p className="flex items-center justify-between">
                  <span className="text-[#3F3F3F] opacity-70">{t("Contact Verified")}</span>
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                </p>
                <p className="flex items-center justify-between">
                  <span className="text-[#3F3F3F] opacity-70">{t("Location Captured")}</span>
                  {profile.latitude != null && profile.longitude != null ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <span className="text-amber-700 font-semibold">{t("Missing")}</span>
                  )}
                </p>
                <p className="flex items-center justify-between">
                  <span className="text-[#3F3F3F] opacity-70">{t("Blood Group")}</span>
                  <Droplets className="h-4 w-4 text-[#9D1720]" />
                </p>
              </div>
              <div className="mt-4 h-2 w-full rounded-full bg-[#FAF7F2]">
                <div
                  className="h-2 rounded-full bg-[#9D1720] transition-all"
                  style={{
                    width: `${
                      [profile.phone, profile.latitude != null && profile.longitude != null, profile.blood_type].filter(Boolean)
                        .length *
                      33.33
                    }%`,
                  }}
                />
              </div>
              <p className="mt-2 text-xs text-[#3F3F3F] opacity-60">{t("Complete profile for faster matching.")}</p>
            </div>

            <div className="ankur-card relative p-6">
              <div className="absolute left-0 top-0 h-1 w-12 bg-[#9D1720]" />
              <div className="mb-4 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-[#9D1720]" />
                <h3 className="font-montserrat text-lg font-bold text-[#9D1720]">{t("Safety")}</h3>
              </div>
              <ul className="space-y-2 text-xs text-[#3F3F3F] opacity-70">
                <li>{t("90-day interval enforced for donor acceptance.")}</li>
                <li>{t("Ineligible acceptance attempts can deactivate account.")}</li>
                <li>{t("Update profile details for reliable emergency coordination.")}</li>
              </ul>
            </div>
          </div>
        </section>

      {showRequestModal && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 p-0 sm:p-3 md:items-center md:justify-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-h-[90vh] overflow-y-auto rounded-t-2xl border border-[#f0ede6] bg-[#FAF7F2] p-4 shadow-2xl sm:max-w-xl sm:rounded-lg sm:p-6"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="font-montserrat text-xl font-bold text-[#9D1720]">{t("Create Blood Request")}</h3>
                <p className="text-sm text-[#3F3F3F] opacity-70">{t("Broadcast to eligible donors instantly with hospital details.")}</p>
              </div>
              <button onClick={() => setShowRequestModal(false)} className="rounded-md bg-[#f0ede6] px-2 py-1 text-sm font-semibold text-[#9D1720] hover:bg-[#e5dfd8] transition-colors">
                ✕
              </button>
            </div>

            <form onSubmit={submitEmergencyRequest} className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="font-semibold text-[#9D1720]">{t("Hospital")}</span>
                  <input
                    required
                    value={requestForm.hospital_name}
                    onChange={(e) => setRequestForm((prev) => ({ ...prev, hospital_name: e.target.value }))}
                    className="w-full rounded-md border border-[#f0ede6] bg-white px-3 py-2 text-[#3F3F3F] outline-none transition-colors focus:border-[#9D1720] focus:ring-1 focus:ring-[#9D1720]/20"
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-semibold text-[#9D1720]">{t("Patient Age")}</span>
                  <input
                    required
                    inputMode="numeric"
                    value={requestForm.patient_age}
                    onChange={(e) => setRequestForm((prev) => ({ ...prev, patient_age: e.target.value }))}
                    className="w-full rounded-md border border-[#f0ede6] bg-white px-3 py-2 text-[#3F3F3F] outline-none transition-colors focus:border-[#9D1720] focus:ring-1 focus:ring-[#9D1720]/20"
                  />
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <label className="space-y-1 text-sm">
                  <span className="font-semibold text-[#9D1720]">{t("Blood Type")}</span>
                  <select
                    value={requestForm.blood_type_needed}
                    onChange={(e) => setRequestForm((prev) => ({ ...prev, blood_type_needed: e.target.value }))}
                    className="w-full rounded-md border border-[#f0ede6] bg-white px-3 py-2 text-[#3F3F3F] outline-none transition-colors focus:border-[#9D1720] focus:ring-1 focus:ring-[#9D1720]/20"
                  >
                    {bloodGroups.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1 text-sm">
                  <span className="font-semibold text-[#9D1720]">{t("Urgency")}</span>
                  <select
                    value={requestForm.urgency}
                    onChange={(e) => setRequestForm((prev) => ({ ...prev, urgency: e.target.value }))}
                    className="w-full rounded-md border border-[#f0ede6] bg-white px-3 py-2 text-[#3F3F3F] outline-none transition-colors focus:border-[#9D1720] focus:ring-1 focus:ring-[#9D1720]/20"
                  >
                    {urgencies.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="font-semibold text-[#9D1720]">{t("Contact Email")}</span>
                  <input
                    required
                    type="email"
                    value={requestForm.contact_email}
                    onChange={(e) => setRequestForm((prev) => ({ ...prev, contact_email: e.target.value }))}
                    className="w-full rounded-md border border-[#f0ede6] bg-white px-3 py-2 text-[#3F3F3F] outline-none transition-colors focus:border-[#9D1720] focus:ring-1 focus:ring-[#9D1720]/20"
                  />
                </label>

                <label className="space-y-1 text-sm">
                  <span className="font-semibold text-[#9D1720]">{t("Contact Phone")}</span>
                  <input
                    required
                    type="tel"
                    value={requestForm.contact_phone}
                    onChange={(e) => setRequestForm((prev) => ({ ...prev, contact_phone: e.target.value }))}
                    className="w-full rounded-md border border-[#f0ede6] bg-white px-3 py-2 text-[#3F3F3F] outline-none transition-colors focus:border-[#9D1720] focus:ring-1 focus:ring-[#9D1720]/20"
                  />
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="font-semibold text-[#9D1720]">{t("Latitude")}</span>
                  <input
                    required
                    value={requestForm.latitude}
                    onChange={(e) => setRequestForm((prev) => ({ ...prev, latitude: e.target.value }))}
                    className="w-full rounded-md border border-[#f0ede6] bg-white px-3 py-2 text-[#3F3F3F] outline-none transition-colors focus:border-[#9D1720] focus:ring-1 focus:ring-[#9D1720]/20"
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-semibold text-[#9D1720]">{t("Longitude")}</span>
                  <input
                    required
                    value={requestForm.longitude}
                    onChange={(e) => setRequestForm((prev) => ({ ...prev, longitude: e.target.value }))}
                    className="w-full rounded-md border border-[#f0ede6] bg-white px-3 py-2 text-[#3F3F3F] outline-none transition-colors focus:border-[#9D1720] focus:ring-1 focus:ring-[#9D1720]/20"
                  />
                </label>
              </div>

              <label className="block space-y-1 text-sm">
                <span className="font-semibold text-[#9D1720]">{t("Requisition Form (PDF/JPG/PNG, max 5MB)")}</span>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  onChange={(e) => setRequisitionFile(e.target.files?.[0] ?? null)}
                  className="w-full rounded-md border border-[#f0ede6] px-3 py-2 text-sm outline-none file:mr-3 file:rounded-md file:border-0 file:bg-[#f0ede6] file:px-3 file:py-1.5 file:font-semibold file:text-[#9D1720] file:cursor-pointer hover:file:bg-[#e8dfd4]"
                />
                {requisitionFile && <p className="text-xs text-[#3F3F3F] opacity-60">{t("Selected:")} {requisitionFile.name}</p>}
              </label>

              <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <button type="button" onClick={useCurrentLocation} className="w-full rounded-md bg-[#f0ede6] px-4 py-2 text-sm font-semibold text-[#9D1720] hover:bg-[#e5dfd8] transition-colors sm:w-auto">
                  {t("Use Location")}
                </button>
                <button
                  type="submit"
                  disabled={submittingRequest}
                  className="w-full rounded-md bg-[#9D1720] px-5 py-2 text-sm font-bold text-white disabled:opacity-60 hover:bg-[#7D1019] transition-colors sm:w-auto"
                >
                  {submittingRequest ? t("Broadcasting...") : t("Broadcast")}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      <div className="fixed bottom-4 left-0 right-0 z-40 px-4 lg:hidden">
        <button
          onClick={() => setShowRequestModal(true)}
          className="w-full rounded-md bg-[#9D1720] px-4 py-3 font-bold text-white shadow-lg shadow-[#9D1720]/20 hover:bg-[#7D1019] transition-colors"
        >
          {t("Create Blood Request")}
        </button>
      </div>
      </div>
    </main>
    </ProtectedRoute>
  );
}
