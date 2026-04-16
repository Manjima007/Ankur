"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Language, translate } from "../lib/i18n";

type LanguageContextValue = {
  language: Language;
  setLanguage: (next: Language) => void;
  t: (text: string) => string;
};

const STORAGE_KEY = "ankur_language";

const LanguageContext = createContext<LanguageContextValue | null>(null);

function resolveInitialLanguage(): Language {
  if (typeof window === "undefined") {
    return "en";
  }

  const saved = window.localStorage.getItem(STORAGE_KEY) as Language | null;
  if (saved === "en" || saved === "hi" || saved === "bn") {
    return saved;
  }

  const browserLanguage = window.navigator.language.toLowerCase();
  if (browserLanguage.startsWith("hi")) {
    return "hi";
  }
  if (browserLanguage.startsWith("bn")) {
    return "bn";
  }
  return "en";
}

export default function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>("en");

  useEffect(() => {
    setLanguage(resolveInitialLanguage());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, language);
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      setLanguage,
      t: (text: string) => translate(language, text),
    }),
    [language]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useI18n must be used within LanguageProvider");
  }
  return context;
}
