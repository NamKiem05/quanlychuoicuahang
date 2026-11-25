import { createClient } from "@/lib/supabase/server";
import { liveSessionStatus } from "@/lib/platform-account";

export async function GET() {
  const headers = { "Cache-Control": "no-store, private" };
  try {
    const supabase = await createClient();
    const { data: auth, error: authError } = await supabase.auth.getClaims();
    if (authError || !auth?.claims?.sub) return Response.json({ error: "unauthorized" }, { status: 401, headers });
    const session = await liveSessionStatus(supabase);
    if (session === "expired") return Response.json({ error: "session_expired" }, { status: 401, headers });
    if (session !== "active") return Response.json({ error: "unavailable" }, { status: 503, headers });
    const { data: isAdmin, error: roleError } = await supabase.rpc("is_platform_admin");
    if (roleError) return Response.json({ error: "unavailable" }, { status: 503, headers });
    if (isAdmin !== true) return Response.json({ error: "forbidden" }, { status: 403, headers });
    const started = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const { error } = await supabase.from("stores").select("id").limit(1).abortSignal(controller.signal);
      return Response.json({ checkedAt: new Date().toISOString(), database: { ok: !error, elapsedMs: Math.round(performance.now() - started) } }, { headers });
    } finally { clearTimeout(timer); }
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503, headers });
  }
}
