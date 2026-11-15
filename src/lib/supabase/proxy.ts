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
