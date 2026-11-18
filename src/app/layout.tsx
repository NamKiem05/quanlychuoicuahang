import type { Metadata } from "next";
import { connection } from "next/server";
import { defaultPlatformSettings, getPlatformSettings } from "@/lib/platform-settings";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const { settings } = await getPlatformSettings();
  const current = settings ?? defaultPlatformSettings;
  return { title: current.platform_name, description: current.description || defaultPlatformSettings.description, icons: { icon: current.favicon_url || "/default-favicon.ico" } };
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
