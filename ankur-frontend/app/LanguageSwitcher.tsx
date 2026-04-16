"use client";

import { useI18n } from "./LanguageProvider";
import { LANGUAGE_LABELS, Language } from "../lib/i18n";

export default function LanguageSwitcher() {
  const { language, setLanguage, t } = useI18n();

  return (
    <div className="flex items-center gap-2 rounded-xl border border-[#9D1720]/20 bg-white/90 px-3 py-2 shadow-sm backdrop-blur-sm">
      <span className="text-xs font-semibold text-[#9D1720]">{t("Language")}</span>
      <select
        value={language}
        onChange={(e) => setLanguage(e.target.value as Language)}
        className="rounded-md border border-[#9D1720]/25 bg-[#FAF7F2] px-2 py-1 text-xs font-medium text-[#3F3F3F] outline-none"
      >
        <option value="en">{LANGUAGE_LABELS.en}</option>
        <option value="hi">{LANGUAGE_LABELS.hi}</option>
        <option value="bn">{LANGUAGE_LABELS.bn}</option>
      </select>
    </div>
  );
}
