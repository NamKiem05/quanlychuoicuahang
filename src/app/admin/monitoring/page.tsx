import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import MonitoringDashboard from "./monitoring-dashboard";
import "./monitoring.css";

export const metadata = { title: "Giám sát hệ thống | Quản trị" };
export default async function MonitoringPage() {
  await requirePlatformAdminAccess(await createClient());
  return <MonitoringDashboard />;
}
