import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { defaultPlatformSettings } from "@/lib/platform-settings";
import "./globals.css";

async function platformMetadata(): Promise<Metadata> {
  "use cache";
  cacheLife("minutes");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  let current = defaultPlatformSettings;
  if (url && key) {
    try {
      const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      const result = await supabase.from("platform_general_settings").select("platform_name, description, favicon_url").eq("id", true).maybeSingle();
      if (!result.error && result.data) current = { ...current, ...result.data };
    } catch { /* Use default branding if the settings are unavailable. */ }
  }
  return { title: current.platform_name, description: current.description || defaultPlatformSettings.description, icons: { icon: current.favicon_url || "/default-favicon.ico" } };
}

export async function generateMetadata(): Promise<Metadata> {
  return platformMetadata();
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
