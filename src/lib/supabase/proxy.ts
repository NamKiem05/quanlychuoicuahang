import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv, hasSupabaseEnv } from "./env";

function getRequestHostname(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const rawHost = forwardedHost || request.headers.get("host") || request.nextUrl.host;
  try {
    return new URL(`http://${rawHost}`).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
}

async function resolveStoreSlug(request: NextRequest, supabase: Awaited<ReturnType<typeof createServerClient>>) {
  const hostname = getRequestHostname(request);
  if (!hostname || hostname === "localhost" || hostname.includes(":")) return null;

  const platformDomain = process.env.NEXT_PUBLIC_PLATFORM_DOMAIN?.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  if (platformDomain && hostname.endsWith(`.${platformDomain}`)) {
    const slug = hostname.slice(0, -(platformDomain.length + 1));
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug) || slug === "www") return null;
    const { data: store } = await supabase
      .from("stores")
      .select("slug")
      .eq("slug", slug)
      .eq("status", "active")
      .maybeSingle();
    return store?.slug ?? null;
  }

  const { data, error } = await supabase.rpc("resolve_custom_store_hostname", {
    requested_hostname: hostname,
  });
  return error || typeof data !== "string" ? null : data;
}

export async function updateSession(request: NextRequest) {
  if (!hasSupabaseEnv()) {
    return NextResponse.next({ request });
  }

  const { url, publishableKey } = getSupabaseEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );

        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([name, value]) =>
          response.headers.set(name, value),
        );
      },
    },
  });

  const path = request.nextUrl.pathname;
  const exempt = ["/admin", "/login", "/auth", "/api/webhooks", "/_next"].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  if (!exempt) {
    let operations: { maintenance_enabled: boolean; maintenance_message: string } | null = null;
    try { const result = await supabase.from("platform_operations_settings").select("maintenance_enabled, maintenance_message").eq("id", true).abortSignal(AbortSignal.timeout(2500)).maybeSingle(); operations = result.data; } catch { /* Preserve access when configuration is unavailable. */ }
    if (operations?.maintenance_enabled === true) {
      const headers = { "Cache-Control": "no-store", "Retry-After": "300" };
      if (path.startsWith("/api/") || !["GET", "HEAD"].includes(request.method)) return NextResponse.json({ error: "maintenance", message: operations.maintenance_message }, { status: 503, headers });
      const message = String(operations.maintenance_message).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
      const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hệ thống đang bảo trì</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box;background:#f3f6fb;color:#203654;font-family:system-ui,sans-serif}.card{max-width:520px;padding:40px;border:1px solid #e2ebf5;border-radius:18px;background:white;box-shadow:0 12px 40px #263f6015}h1{font-size:26px}p{line-height:1.7;color:#657b97;white-space:pre-wrap}</style></head><body><main class="card"><h1>Hệ thống đang bảo trì</h1><p>${message}</p></main></body></html>`;
      return new NextResponse(html, { status: 503, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
    }
  }

  await supabase.auth.getClaims();
  if (request.nextUrl.pathname === "/") {
    const storeSlug = await resolveStoreSlug(request, supabase);
    if (storeSlug) {
      const destination = request.nextUrl.clone();
      destination.pathname = `/store-host/${storeSlug}`;
      const rewriteResponse = NextResponse.rewrite(destination, { request });
      response.cookies.getAll().forEach((cookie) => rewriteResponse.cookies.set(cookie));
      return rewriteResponse;
    }
  }
  return response;
}
