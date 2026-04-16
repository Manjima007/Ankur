"use client";
import Image from 'next/image';
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, BellRing, Cross, MapPin, ShieldCheck, Waves } from 'lucide-react';
import axios from 'axios';
// Changed from '@/lib/api' to '../lib/api' to match your folder structure
import api from '../lib/api';
import { useI18n } from './LanguageProvider';
import { useAuth } from './AuthProvider';

const bloodGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const manualLocations = [
  { value: 'kolkata', label: 'Kolkata', lat: 22.5726, lon: 88.3639 },
  { value: 'howrah', label: 'Howrah', lat: 22.5958, lon: 88.2636 },
  { value: 'siliguri', label: 'Siliguri', lat: 26.7271, lon: 88.3953 },
  { value: 'durgapur', label: 'Durgapur', lat: 23.5204, lon: 87.3119 },
  { value: 'asansol', label: 'Asansol', lat: 23.6739, lon: 86.9524 },
  { value: 'malda', label: 'Malda', lat: 25.0119, lon: 88.1411 },
  { value: 'berhampore', label: 'Berhampore', lat: 24.1047, lon: 88.2516 },
  { value: 'kharagpur', label: 'Kharagpur', lat: 22.346, lon: 87.232 },
];

export default function AuthPage() {
  const { t } = useI18n();
  const { isAuthenticated, isInitialized, login } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoTimedOut, setGeoTimedOut] = useState(false);
  const [manualLocation, setManualLocation] = useState('');
  const [emailReadOnly, setEmailReadOnly] = useState(true);

  const manualCoords = manualLocations.find((item) => item.value === manualLocation);
  const hasRegistrationLocation = Boolean(coords || manualCoords);

  useEffect(() => {
    if (!isInitialized) return;
    if (isAuthenticated) {
      window.location.href = '/dashboard';
    }
  }, [isAuthenticated, isInitialized]);

  // Automatically fetch GPS coordinates when the page loads
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setGeoError(t("Geolocation is not supported by your browser."));
      setGeoTimedOut(true);
      return;
    }

    let isResolved = false;
    const timeoutId = window.setTimeout(() => {
      if (!isResolved) {
        setGeoTimedOut(true);
        setGeoError(t("GPS request timed out. Choose your city manually to continue."));
      }
    }, 10000);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        isResolved = true;
        window.clearTimeout(timeoutId);
        setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setGeoTimedOut(false);
        setGeoError(null);
      },
      (err) => {
        isResolved = true;
        window.clearTimeout(timeoutId);
        console.error("Location access denied", err);
        setGeoTimedOut(true);
        setGeoError(t("Unable to fetch GPS location. Choose your city manually to continue."));
      },
      {
        timeout: 10000,
        maximumAge: 60000,
        enableHighAccuracy: false,
      }
    );

    return () => window.clearTimeout(timeoutId);
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    
    const formData = new FormData(e.currentTarget);
    const payload = Object.fromEntries(formData);
    const email =
      (payload.contact_email_input as string) ||
      (payload.user_email as string) ||
      (payload.email as string);

    try {
      if (isLogin) {
        // --- LOGIN LOGIC ---
        // FastAPI OAuth2 expects form-data for login
        const loginForm = new FormData();
        loginForm.append('username', email);
        loginForm.append('password', payload.password as string);
        
        const res = await api.post('/login', loginForm);
        const me = await api.get('/api/me');
        if (me?.data?.id) {
          login(res.data.access_token, String(me.data.id));
        } else {
          login(res.data.access_token, null);
        }
        alert(t("Login Successful! Moving to Dashboard..."));
        window.location.href = '/dashboard';
      } else {
        const resolvedCoords = coords || (manualCoords ? { lat: manualCoords.lat, lon: manualCoords.lon } : null);
        if (!resolvedCoords) {
          throw new Error(t("Location is required to register. Use GPS or select a manual city."));
        }

        // --- REGISTRATION LOGIC ---
        await api.post('/register', {
          name: payload.name,
          email,
          phone: payload.phone,
          age: parseInt(payload.age as string),
          blood_type: payload.blood_type,
          password: payload.password,
          latitude: resolvedCoords.lat,
          longitude: resolvedCoords.lon
        });
        alert(t("Registration successful! Now please Login."));
        setIsLogin(true);
      }
    } catch (err: unknown) {
      const apiBase =
        process.env.NEXT_PUBLIC_API_URL ||
        process.env.NEXT_PUBLIC_API_BASE_URL ||
        api.defaults.baseURL ||
        'http://127.0.0.1:8000';
      const errorMsg = axios.isAxiosError(err)
        ? err.response
          ? ((err.response.data?.detail as string) || `Request failed (${err.response.status}).`)
          : `Cannot reach backend at ${apiBase}. Ensure FastAPI is running and CORS allows your frontend origin.`
        : err instanceof Error
          ? err.message
            : t("Something went wrong.");
      alert(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#eef2f5] px-4 pb-8 pt-24 text-slate-900 md:pt-20">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-red-300/50 blur-3xl" />
        <div className="absolute bottom-0 left-0 h-64 w-64 rounded-full bg-amber-200/50 blur-3xl" />
        <div className="absolute right-0 top-20 h-72 w-72 rounded-full bg-sky-200/40 blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        className="relative mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[1.15fr_0.85fr]"
      >
        <section className="overflow-hidden rounded-3xl border border-red-300/30 bg-linear-to-br from-[#9e0b20] via-[#b1122c] to-[#d64545] p-7 text-white shadow-[0_30px_80px_-30px_rgba(124,14,35,0.55)] md:p-10">
          <div className="mb-8 flex items-center gap-3">
            <div className="rounded-2xl bg-white/15 p-3 backdrop-blur-md">
              <Image
                src="/ankur_logo.jpeg"
                alt="Ankur mark"
                width={28}
                height={28}
                className="h-auto w-auto rounded-md object-cover"
              />
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight" style={{ color: '#FAF7F2' }}>ANKUR</h1>
              <p className="text-sm uppercase tracking-[0.24em] text-red-100/90">{t('Blood Emergency Network')}</p>
            </div>
          </div>

          <div className="mb-6 rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur-sm">
            <div className="mx-auto w-fit">
              <Image
                src="/ankur_logo.jpeg"
                alt="Ankur logo"
                width={180}
                height={225}
                className="h-28 w-auto rounded-xl object-contain md:h-36"
                style={{ width: 'auto', height: 'auto' }}
                priority
              />
            </div>
          </div>

          <div className="space-y-4">
            <h2 className="max-w-lg text-3xl font-semibold leading-tight md:text-5xl" style={{ color: '#FAF7F2' }}>
              {t('Fast donor mobilization when every minute matters.')}
            </h2>
            <p className="max-w-xl text-base text-red-50/90 md:text-lg">
              {t('Built for hospitals, volunteers, and communities to coordinate life-saving blood support in real time.')}
            </p>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur-sm">
              <p className="text-xs uppercase tracking-[0.18em] text-red-100">{t('Response Mode')}</p>
              <p className="mt-2 text-2xl font-semibold" style={{ color: '#FAF7F2' }}>{t('Live')}</p>
            </div>
            <div className="rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur-sm">
              <p className="text-xs uppercase tracking-[0.18em] text-red-100">{t('Safety Rule')}</p>
              <p className="mt-2 text-2xl font-semibold" style={{ color: '#FAF7F2' }}>{t('90 Days')}</p>
            </div>
            <div className="rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur-sm">
              <p className="text-xs uppercase tracking-[0.18em] text-red-100">{t('Coverage')}</p>
              <p className="mt-2 text-2xl font-semibold" style={{ color: '#FAF7F2' }}>{t('WB Network')}</p>
            </div>
          </div>

          <div className="mt-8 space-y-2 text-sm text-red-50/95">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              {t('Verified donors and emergency request validation')}
            </div>
            <div className="flex items-center gap-2">
              <BellRing className="h-4 w-4" />
              {t('Instant emergency alert broadcast system')}
            </div>
            <div className="flex items-center gap-2">
              <Waves className="h-4 w-4" />
              {t('Health-safe donation eligibility enforcement')}
            </div>
          </div>
        </section>

        <motion.section
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.12 }}
          className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-[0_30px_80px_-35px_rgba(15,23,42,0.35)] backdrop-blur-sm md:p-8"
        >
          <div className="mb-5 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{t('Identity')}</p>
              <p className="text-sm font-semibold text-slate-800">{t('Ankur Emergency Console')}</p>
            </div>
            <Image
              src="/ankur_logo.jpeg"
              alt="Ankur mark"
              width={36}
              height={36}
              className="h-auto w-auto rounded-md object-cover"
            />
          </div>

          <div className="mb-6 grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-sm">
            <button
              type="button"
              onClick={() => setIsLogin(true)}
              className={`rounded-lg px-3 py-2 font-semibold transition ${
                isLogin ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
              }`}
            >
              {t('Login')}
            </button>
            <button
              type="button"
              onClick={() => setIsLogin(false)}
              className={`rounded-lg px-3 py-2 font-semibold transition ${
                !isLogin ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
              }`}
            >
              {t('Join as Donor')}
            </button>
          </div>

          <div className="mb-5">
            <h3 className="text-2xl font-semibold text-slate-900">
              {isLogin ? t('Welcome back to duty') : t('Register to save lives')}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {isLogin
                ? t('Sign in to view and respond to active blood emergencies.')
                : t('Create your donor profile with location and blood group details.')}
            </p>
          </div>

          <form key={isLogin ? 'login-form' : 'signup-form'} onSubmit={handleSubmit} autoComplete="off" className="space-y-4">
            <input
              type="text"
              name="fake_username"
              autoComplete="username"
              tabIndex={-1}
              aria-hidden="true"
              className="hidden"
            />
            <input
              type="password"
              name="fake_password"
              autoComplete="new-password"
              tabIndex={-1}
              aria-hidden="true"
              className="hidden"
            />

            {!isLogin && (
              <>
                <label className="block space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('Full Name')}</span>
                  <input
                    name="name"
                    placeholder="Ankur Das"
                    required
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100"
                  />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('Age')}</span>
                    <input
                      name="age"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]{1,3}"
                      maxLength={3}
                      placeholder="21"
                      required
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100"
                    />
                  </label>

                  <label className="block space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('Blood Group')}</span>
                    <select
                      name="blood_type"
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100"
                    >
                      {bloodGroups.map((group) => (
                        <option key={group} value={group}>
                          {group}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="block space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('Phone Number')}</span>
                  <input
                    name="phone"
                    type="tel"
                    autoComplete="tel"
                    placeholder="9876543210"
                    required
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100"
                  />
                </label>

                {(geoTimedOut || geoError) && !coords && (
                  <label className="block space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('Manual Location (City)')}</span>
                    <select
                      name="manual_location"
                      value={manualLocation}
                      onChange={(e) => setManualLocation(e.target.value)}
                      required={!coords}
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100"
                    >
                      <option value="">{t('Select a city')}</option>
                      {manualLocations.map((location) => (
                        <option key={location.value} value={location.value}>
                          {location.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}

            <label className="block space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('Email Address')}</span>
              <input
                name="contact_email_input"
                type="email"
                autoComplete="off"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                readOnly={emailReadOnly}
                onFocus={() => setEmailReadOnly(false)}
                onClick={() => setEmailReadOnly(false)}
                placeholder="ankur@example.com"
                pattern="^[^\s@]+@[^\s@]+\.[^\s@]+$"
                required
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t('Password')}</span>
              <input
                name="password"
                type="password"
                placeholder="••••••••"
                required
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100"
              />
            </label>

            {!isLogin && (
              <div
                className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs font-medium ${
                  coords
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                    : geoError
                      ? 'border-red-300 bg-red-50 text-red-700'
                      : 'border-amber-300 bg-amber-50 text-amber-700'
                }`}
              >
                {coords ? <MapPin className="mt-0.5 h-4 w-4" /> : <Cross className="mt-0.5 h-4 w-4" />}
                <span>
                  {coords
                    ? `${t('Location captured')}: ${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)}`
                    : manualCoords
                      ? `${t('Manual location selected')}: ${manualCoords.label}`
                      : geoError || t('Checking GPS permission (up to 10s)...')}
                </span>
              </div>
            )}

            <motion.button
              whileTap={{ scale: 0.985 }}
              disabled={loading || (!isLogin && !hasRegistrationLocation)}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-linear-to-r from-red-700 to-red-500 px-4 py-3.5 font-semibold text-white shadow-lg shadow-red-200 transition hover:from-red-800 hover:to-red-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading
                ? t('Processing...')
                : !isLogin && !hasRegistrationLocation
                  ? t('Waiting For Location')
                  : isLogin
                    ? t('Access Emergency Console')
                    : t('Complete Donor Registration')}
              {!loading && <ArrowRight className="h-4 w-4" />}
            </motion.button>

            <p className="pt-2 text-center text-sm text-slate-500">
              {isLogin ? t('New donor?') : t('Already registered?')}{' '}
              <button
                type="button"
                onClick={() => setIsLogin(!isLogin)}
                className="font-semibold text-red-700 underline-offset-4 hover:underline"
              >
                {isLogin ? t('Create an account') : t('Login here')}
              </button>
            </p>
          </form>
        </motion.section>
      </motion.div>
    </main>
  );
}