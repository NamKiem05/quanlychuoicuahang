import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import "./themes.css";

export default async function ThemeLayout({ children }: { children: ReactNode }) {
  await requirePlatformAdminAccess(await createClient());
  return children;
}
