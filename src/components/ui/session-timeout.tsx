"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import "./session-timeout.css";

const warningMs = 5 * 60_000;
const activityThrottleMs = 30_000;

export default function SessionTimeout() {
  const [seconds, setSeconds] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let active = true;
    let deadline: number | null = null;
    let lastSignal = -Infinity;
    let lastRead = -Infinity;
    let pending = false;

    async function check(recordActivity: boolean) {
      if (!active || pending) return;
      pending = true;
      lastRead = performance.now();
      if (recordActivity) lastSignal = lastRead;
      try {
        const result = await supabase.rpc("growdesk_session_status", { record_activity: recordActivity });
        if (!active) return;
        if (result.error?.code === "PT401" || result.data?.status === "expired") {
          active = false;
          try { await supabase.auth.signOut({ scope: "local" }); }
          finally { window.location.replace("/login?message=session-expired"); }
          return;
        }
        if (result.error || result.data?.status !== "active") {
          setError(true);
          return;
        }
        const remaining = result.data.remainingMs;
        deadline = typeof remaining === "number" ? performance.now() + remaining : null;
        setError(false);
        setSeconds(deadline === null ? null : Math.max(0, Math.ceil((deadline - performance.now()) / 1000)));
      } catch {
        if (active) setError(true);
      } finally {
        pending = false;
        if (active) setBusy(false);
      }
    }

    function onActivity(event: Event) {
      if (event.isTrusted && !document.hidden && performance.now() - lastSignal >= activityThrottleMs) void check(true);
    }

    function onVisibility() {
      if (!document.hidden) void check(false);
    }

    function onContinue() {
      if (!pending) { setBusy(true); void check(true); }
    }

    document.addEventListener("pointerdown", onActivity);
    document.addEventListener("keydown", onActivity);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("growdesk-continue-session", onContinue);
    void check(false);
    const timer = window.setInterval(() => {
      if (!active || deadline === null) return;
      const remaining = deadline - performance.now();
      setSeconds(Math.max(0, Math.ceil(remaining / 1000)));
      if (remaining <= 0 && performance.now() - lastRead >= 5_000) void check(false);
    }, 1000);

    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("pointerdown", onActivity);
      document.removeEventListener("keydown", onActivity);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("growdesk-continue-session", onContinue);
    };
  }, []);

  if (!error && (seconds === null || seconds > warningMs / 1000)) return null;
  return <aside className="growdesk-session-warning" aria-label="Thời hạn phiên">
    <p role="status">{error ? "Chưa kiểm tra được thời hạn phiên. Vui lòng thử lại." : "Phiên đăng nhập của bạn sắp hết hạn do không hoạt động. Vui lòng tiếp tục phiên làm việc để tránh bị đăng xuất."}</p>
    {seconds !== null && <strong>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</strong>}
    <button type="button" disabled={busy} onClick={() => {
      window.dispatchEvent(new Event("growdesk-continue-session"));
    }}>{busy ? "Đang kiểm tra…" : "Tiếp tục phiên"}</button>
  </aside>;
}
