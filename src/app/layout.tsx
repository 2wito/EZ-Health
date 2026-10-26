import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Suspense } from "react";
import { Sidebar } from "@/components/shell/sidebar";
import { SyncStatus } from "@/components/shell/sync-status";
import { TabBar } from "@/components/shell/tab-bar";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

// Fallback for devices without SF Pro (Windows, Android).
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "EZ Health", template: "%s | EZ Health" },
  description: "Heart, sleep, activity and workout trends from Apple Health.",
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f2f7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.variable}>
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
      </body>
    </html>
  );
}
