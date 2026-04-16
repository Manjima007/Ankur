import type { Metadata } from "next";
import { Sora, IBM_Plex_Sans, Montserrat, Oswald } from "next/font/google";
import "./globals.css";
import NotificationManager from "./NotificationManager";
import LanguageProvider from "./LanguageProvider";
import LanguageSwitcher from "./LanguageSwitcher";
import AuthProvider from "./AuthProvider";
import PWAServiceWorkerRegistrar from "./PWAServiceWorkerRegistrar";

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
});

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-ibm-plex-sans",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

const montserrat = Montserrat({
  variable: "--font-montserrat",
  weight: ["600", "700", "800"],
  subsets: ["latin"],
});

const oswald = Oswald({
  variable: "--font-oswald",
  weight: ["600", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ANKUR | Blood Emergency Network",
  description: "Real-time emergency blood donation platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${sora.variable} ${ibmPlexSans.variable} ${montserrat.variable} ${oswald.variable} h-full antialiased`}
    >
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#9D1720" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="ANKUR" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.__ankurInstallPrompt = null;
              window.addEventListener('beforeinstallprompt', function (event) {
                event.preventDefault();
                window.__ankurInstallPrompt = event;
                window.dispatchEvent(new Event('ankur-beforeinstallprompt-ready'));
              });
              window.addEventListener('appinstalled', function () {
                window.__ankurInstallPrompt = null;
              });
            `,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <PWAServiceWorkerRegistrar />
        <AuthProvider>
          <LanguageProvider>
            <div className="pointer-events-none fixed inset-x-0 top-0 z-50 px-3 pt-3">
              <div className="pointer-events-auto mx-auto flex w-full max-w-7xl flex-wrap items-start justify-between gap-2">
                <LanguageSwitcher />
                <NotificationManager />
              </div>
            </div>
            {children}
          </LanguageProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
