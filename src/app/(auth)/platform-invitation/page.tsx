"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { acceptInvitation } from "./actions";
import "./style.css";
export default function PlatformInvitationPage() {
  const [state, action, pending] = useActionState(acceptInvitation, null);
  const [branding, setBranding] = useState<{ platform_name: string; logo_url: string | null }>({ platform_name: "GrowDesk", logo_url: null });
  useEffect(() => { let cancelled = false; void createClient().from("platform_general_settings").select("platform_name, logo_url").eq("id", true).maybeSingle().then(({ data }) => { if (!cancelled && data) setBranding(data); }); return () => { cancelled = true; }; }, []);
  const tokenInput = useRef<HTMLInputElement>(null);
  useEffect(() => { const token = window.location.hash.slice(1); if (token && tokenInput.current) { tokenInput.current.value = token; tokenInput.current.defaultValue = token; window.history.replaceState(null, "", window.location.pathname + window.location.search); } }, []);
  return <main className="platform-invite-page"><div className="platform-invite-card">{branding.logo_url && <Image src={branding.logo_url} width={180} height={72} alt={`Logo ${branding.platform_name}`} unoptimized style={{ objectFit: "contain" }} />}<p className="platform-invite-eyebrow">ĐỘI NGŨ NỀN TẢNG</p><h1>Chấp nhận lời mời</h1><p>Tạo tài khoản nhân viên bằng cách điền tên và tự đặt mật khẩu. Quản trị viên sẽ phân quyền cho bạn sau khi hoàn tất.</p>{state?.ok ? <div className="platform-invite-result" role="status">{state.message}<p><Link href="/login">Đi đến đăng nhập →</Link></p></div> : <form action={action}><input type="hidden" name="token" ref={tokenInput} /><label>Họ và tên<input name="name" minLength={2} maxLength={120} autoComplete="name" required /></label><label>Mật khẩu<input name="password" type="password" minLength={12} autoComplete="new-password" required /></label><label>Xác nhận mật khẩu<input name="confirm_password" type="password" minLength={12} autoComplete="new-password" required /></label>{state && <div className="platform-invite-error" role="alert">{state.message}</div>}<button disabled={pending}>{pending ? "Đang xử lý..." : "Chấp nhận và tạo tài khoản"}</button></form>}</div></main>;
}
