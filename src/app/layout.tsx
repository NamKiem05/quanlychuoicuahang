import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { defaultPlatformSettings, getPlatformSettings } from "@/lib/platform-settings";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const { settings } = await getPlatformSettings();
  const current = settings ?? defaultPlatformSettings;
  return { title: current.platform_name, description: current.description || defaultPlatformSettings.description, icons: { icon: current.favicon_url || "/default-favicon.ico" } };
}

async function RequestMarker() {
  await connection();
  return null;
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className="h-full antialiased">
      <body className="min-h-full flex flex-col"><Suspense fallback={null}><RequestMarker /></Suspense>{children}</body>
    </html>
  );
}
