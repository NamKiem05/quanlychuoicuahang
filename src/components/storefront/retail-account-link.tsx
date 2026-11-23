"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import SidebarIcon from "@/components/ui/sidebar-icon";
import { createClient } from "@/lib/supabase/client";

export default function RetailAccountLink({ storeSlug, onNavigate }: { storeSlug?: string; onNavigate?: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session?.user));
    });
    return () => subscription.unsubscribe();
  }, [supabase]);
  if (signedIn === null) return <span className="retail-account-loading" aria-label="Đang kiểm tra tài khoản"><SidebarIcon name="accounts" /></span>;
  const label = signedIn ? "Tài khoản" : "Đăng nhập";
  return <Link prefetch={false} href={signedIn ? "/customer/account" : "/login?next=customer-account"} aria-label={label} onClick={() => { if (storeSlug) document.cookie = `growdesk_customer_store=${encodeURIComponent(storeSlug)}; path=/; max-age=2592000; samesite=lax${window.location.protocol === "https:" ? "; secure" : ""}`; onNavigate?.(); }}><SidebarIcon name="accounts" /><span>{label}</span></Link>;
}
