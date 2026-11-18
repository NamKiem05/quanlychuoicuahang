"use client";

import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { findMerchantPlan } from "@/lib/merchant-plans";
import "./login.css";
import LoadingScreen from "@/app/loading-screen";

export default function LoginPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <LoginFromUrl />
    </Suspense>
  );
}

function LoginFromUrl() {
  const params = useSearchParams();
  const mode = params.get("mode") === "signup" ? "signup" : "signin";
  const plan = findMerchantPlan(params.get("plan"));
  const callbackError = params.get("message") === "verification-failed";
  const accessError = params.get("message") === "account-access-failed";
  const invitationNext = params.get("next") === "staff-invitations";
  return <LoginForm key={`${mode}:${plan?.id ?? ""}:${invitationNext}`} initialMode={mode} plan={plan} callbackError={callbackError} accessError={accessError} invitationNext={invitationNext} />;
}

function LoginForm({ initialMode, plan, callbackError, accessError, invitationNext }: { initialMode: "signin" | "signup"; plan: ReturnType<typeof findMerchantPlan>; callbackError: boolean; accessError: boolean; invitationNext: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [mode, setMode] = useState(initialMode);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState(callbackError ? "Liên kết xác nhận không hợp lệ hoặc đã hết hạn. Hãy thử đăng nhập lại." : accessError ? "Chưa xác định được quyền truy cập. Hãy thử đăng nhập lại hoặc liên hệ hỗ trợ." : "");
  const [notice, setNotice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [branding, setBranding] = useState<{ platform_name: string; logo_url: string | null }>({ platform_name: "GrowDesk", logo_url: null });
  useEffect(() => { let cancelled = false; void supabase.from("platform_general_settings").select("platform_name, logo_url").eq("id", true).maybeSingle().then(({ data }) => { if (!cancelled && data) setBranding(data); }); return () => { cancelled = true; }; }, [supabase]);
  const [signupEnabled, setSignupEnabled] = useState<boolean | null>(null);
  useEffect(() => { let cancelled = false; void supabase.from("platform_operations_settings").select("public_signup_enabled").eq("id", true).maybeSingle().then(({ data }) => { if (!cancelled && data) setSignupEnabled(data.public_signup_enabled === true); }); return () => { cancelled = true; }; }, [supabase]);

  async function resendConfirmation() {
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) { setErrorMessage("Hãy nhập email hợp lệ để yêu cầu xác minh."); return; }
    setIsSubmitting(true); setErrorMessage(""); setNotice("");
    try {
      const { error } = await supabase.auth.resend({ type: "signup", email: address, options: { emailRedirectTo: `${window.location.origin}/auth/callback${invitationNext ? "?next=staff-invitations" : ""}` } });
      if (error) setErrorMessage("Chưa gửi được yêu cầu xác minh. Hãy kiểm tra cấu hình email và thử lại sau.");
      else setNotice("Nếu tài khoản cần xác minh, email hướng dẫn sẽ được gửi đến địa chỉ đã nhập.");
    } catch { setErrorMessage("Chưa gửi được yêu cầu xác minh. Vui lòng thử lại sau."); }
    finally { setIsSubmitting(false); }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setNotice("");
    if (mode === "signup") {
      const setting = await supabase.from("platform_operations_settings").select("public_signup_enabled").eq("id", true).maybeSingle();
      if (setting.data?.public_signup_enabled === false) { setSignupEnabled(false); setErrorMessage("Đăng ký tài khoản mới đang tạm dừng."); return; }
      const normalizedPhone = phone.trim().replace(/[\s().-]/g, "");
      if (!/^\+?\d{8,15}$/.test(normalizedPhone)) {
        setErrorMessage("Nhập số điện thoại hợp lệ, gồm 8 đến 15 chữ số.");
        return;
      }
      if (password !== confirmation) {
        setErrorMessage("Mật khẩu xác nhận chưa khớp.");
        return;
      }
      setIsSubmitting(true);
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: name.trim(), phone: normalizedPhone, requested_plan: plan?.id },
          emailRedirectTo: `${window.location.origin}/auth/callback${invitationNext ? "?next=staff-invitations" : ""}`,
        },
      });

      setIsSubmitting(false);
      if (error) {
        setErrorMessage(error.message);
        return;
      }
      if (data.session) {
        router.replace(invitationNext ? "/staff-invitations" : "/dashboard");
        router.refresh();
      } else {
        setNotice("Tài khoản đã tạo. Hãy mở email xác nhận để tiếp tục đăng nhập.");
      }
      return;
    }

    setIsSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setIsSubmitting(false);
    if (error) {
      setErrorMessage(error.status === 429 || error.code === "over_request_rate_limit" ? "Có quá nhiều yêu cầu đăng nhập. Vui lòng đợi một lúc rồi thử lại." : "Không đăng nhập được. Hãy kiểm tra email và mật khẩu.");
      return;
    }
    const { data: accountAccess, error: accessError } = await supabase.rpc("platform_account_access");
    if (accessError || !["admin", "admin_inactive", "merchant"].includes(accountAccess)) { setErrorMessage("Chưa xác định được quyền truy cập. Hãy thử lại hoặc liên hệ hỗ trợ."); return; }
    if (accountAccess === "merchant") {
      if (invitationNext) { router.replace("/staff-invitations"); router.refresh(); return; }
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) { setErrorMessage("Phiên đăng nhập không hợp lệ. Hãy thử lại."); return; }
      const memberships = await supabase.from("store_members").select("store_id").eq("user_id", auth.user.id).limit(2);
      if (memberships.error) { setErrorMessage("Chưa tải được quyền cửa hàng. Hãy thử lại."); return; }
      router.replace((memberships.data?.length ?? 0) > 1 ? "/select-store" : "/dashboard");
    } else router.replace("/admin");
    router.refresh();
  }

  return (
    <main className="store-auth">
      <div className="store-auth-panel">
        <aside className="store-auth-brand-panel">
          <Link className="store-auth-brand" href="/" aria-label={`Trở về trang giới thiệu ${branding.platform_name}`}>
            {branding.logo_url && <Image src={branding.logo_url} width={180} height={72} alt="" unoptimized style={{ objectFit: "contain" }} />}
            
          </Link>
          <div className="store-auth-brand-copy">
            <p>Website bán hàng của riêng bạn.</p>
            <span>Quản lý sản phẩm và đơn hàng tại một nơi.</span>
          </div>
        </aside>
        <section className="store-auth-content" data-mode={mode} aria-labelledby="store-auth-title">
          <div className="store-auth-modes" role="group" aria-label="Chọn đăng nhập hoặc đăng ký">
            {([{ value: "signin", label: "Đăng nhập" }, { value: "signup", label: "Đăng ký" }] as const).map(({ value, label }) => (
              <button key={value} type="button" aria-pressed={mode === value} disabled={isSubmitting} onClick={() => {
                if (mode === value) return;
                setMode(value);
                setShowPassword(false);
                setConfirmation("");
                setErrorMessage("");
                setNotice("");
              }}>{label}</button>
            ))}
          </div>
          <div className="store-auth-heading" key={mode}>
            <h1 id="store-auth-title">{mode === "signin" ? "Chào mừng bạn trở lại" : "Tạo tài khoản chủ cửa hàng"}</h1>
            <p className="store-auth-intro">{mode === "signin" ? "Đăng nhập để vào khu vực quản lý cửa hàng." : plan ? `Tạo tài khoản để đăng ký ${plan.name.toLocaleLowerCase("vi-VN")}.` : "Tạo tài khoản để thiết lập gian hàng."}</p>
          </div>
          {mode === "signup" && signupEnabled === false && <p className="store-auth-message" role="status">Đăng ký tài khoản mới đang tạm dừng.</p>}

          <form className="store-auth-form" onSubmit={handleSubmit}>
            <div className="store-auth-name" inert={mode !== "signup"}>
              <div>
                <label>Họ và tên
                  <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" disabled={mode !== "signup"} required maxLength={120} placeholder="Tên của bạn" />
                </label>
                <label>Số điện thoại
                  <input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" disabled={mode !== "signup"} required maxLength={30} placeholder="Ví dụ 090 123 4567" />
                </label>
              </div>
            </div>
            <label>Email
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required placeholder="ban@cuahang.vn" />
            </label>
            <div className="store-auth-password">
              <label htmlFor="store-auth-password">Mật khẩu</label>
              <div>
                <input id="store-auth-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "signin" ? "current-password" : "new-password"} required minLength={8} placeholder={mode === "signup" ? "Ít nhất 8 ký tự" : "Nhập mật khẩu"} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} aria-controls="store-auth-password">{showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}</button>
              </div>
            </div>

            {mode === "signup" && (
              <label>Xác nhận mật khẩu
                <input type={showPassword ? "text" : "password"} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" required minLength={8} placeholder="Nhập lại mật khẩu" />
              </label>
            )}
            {errorMessage && <p className="store-auth-message" role="alert">{errorMessage}</p>}
            {notice && <p className="store-auth-message" role="status">{notice}</p>}
            {mode === "signin" && <button type="button" className="store-auth-resend" disabled={isSubmitting} onClick={() => void resendConfirmation()}>Gửi lại email xác minh</button>}
            <button className="store-auth-submit" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Đang xử lý..." : mode === "signin" ? "Đăng nhập" : "Tạo tài khoản"}<span aria-hidden="true">→</span>
            </button>
          </form>

          <Link className="store-auth-back" href="/">← Về trang giới thiệu</Link>
        </section>
      </div>
    </main>
  );
}
