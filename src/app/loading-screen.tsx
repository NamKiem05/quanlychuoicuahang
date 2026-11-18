"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import "./loading-screen.css";

export default function LoadingScreen({ contained = false }: { contained?: boolean }) {
  const [logo, setLogo] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function loadLogo() {
      try {
        const saved = sessionStorage.getItem("growdesk_loading_logo");
        if (saved && !cancelled) setLogo(saved);
      } catch { /* Storage may be unavailable in private browsing. */ }
      try {
        const result = await createClient().from("platform_general_settings").select("logo_url").eq("id", true).maybeSingle();
        if (cancelled || result.error) return;
        const url = typeof result.data?.logo_url === "string" ? result.data.logo_url : null;
        setLogo(url);
        try { if (url) sessionStorage.setItem("growdesk_loading_logo", url); else sessionStorage.removeItem("growdesk_loading_logo"); } catch { /* The loader still works without a cache. */ }
      } catch { /* Show the progress indicator even when branding is unavailable. */ }
    }
    void loadLogo();
    return () => { cancelled = true; };
  }, []);
  return <div className={`growdesk-loading${contained ? " growdesk-loading-contained" : ""}`} role="status" aria-live="polite"><div className="growdesk-loading-inner"><div className="growdesk-loading-mark"><span className="growdesk-loading-ring" aria-hidden="true" />{logo && <Image src={logo} alt="" width={112} height={72} unoptimized className="growdesk-loading-logo" />}</div><span className="growdesk-loading-text">Đang tải...</span></div></div>;
}
