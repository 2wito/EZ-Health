import type { Metadata, Viewport } from "next";
import { Heebo, Inter } from "next/font/google";
import { Suspense } from "react";
import { Sidebar } from "@/components/shell/sidebar";
import { SyncStatus } from "@/components/shell/sync-status";
import { TabBar } from "@/components/shell/tab-bar";
import { ThemeProvider } from "@/components/theme-provider";
import { I18nProvider } from "@/lib/i18n/client";
import { localeDir } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import "./globals.css";

// Fallbacks for devices without SF Pro (Windows, Android). Inter has no Hebrew glyphs.
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const heebo = Heebo({ variable: "--font-hebrew", subsets: ["hebrew"], preload: false });

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: { default: "EZ Health", template: "%s | EZ Health" },
    description: t.meta.description,
  };
}

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f2f7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { locale } = await getI18n();
  return (
    <html lang={locale} dir={localeDir(locale)} suppressHydrationWarning>
      <body className={`${inter.variable} ${heebo.variable}`}>
        <I18nProvider locale={locale}>
          <ThemeProvider>
            <div className="flex min-h-dvh">
              <Sidebar
                footer={
                  <Suspense>
                    <SyncStatus />
                  </Suspense>
                }
              />
              {/* @container: lets the sticky nav bar span the full column. */}
              <main className="@container min-w-0 flex-1 pb-28 lg:pb-16">
                <div className="px-4 sm:px-6 lg:px-10">
                  <div className="mx-auto max-w-6xl">{children}</div>
                </div>
              </main>
            </div>
            <TabBar />
          </ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
