"use client";

import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { findMerchantPlan } from "@/lib/merchant-plans";
import "./login.css";
import LoadingScreen from "@/components/ui/loading-screen";

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
  const callbackError = params.get("message");
  const accessError = params.get("message") === "account-access-failed";
  const invitationNext = params.get("next") === "staff-invitations";
  const customerOrdersNext = params.get("next") === "customer-orders";
  const customerAccountNext = params.get("next") === "customer-account";
  const storeParam = params.get("store") ?? "";
  const returnStore = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(storeParam) && storeParam.length <= 80 ? storeParam : null;
  return <LoginForm key={`${mode}:${plan?.id ?? ""}:${invitationNext}:${customerOrdersNext}:${customerAccountNext}:${returnStore ?? ""}`} initialMode={mode} plan={plan} callbackError={callbackError} accessError={accessError} invitationNext={invitationNext} customerOrdersNext={customerOrdersNext} customerAccountNext={customerAccountNext} returnStore={returnStore} />;
}

function LoginForm({ initialMode, plan, callbackError, accessError, invitationNext, customerOrdersNext, customerAccountNext, returnStore }: { initialMode: "signin" | "signup"; plan: ReturnType<typeof findMerchantPlan>; callbackError: string | null; accessError: boolean; invitationNext: boolean; customerOrdersNext: boolean; customerAccountNext: boolean; returnStore: string | null }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [mode, setMode] = useState(initialMode);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark" | undefined>();
  const [errorMessage, setErrorMessage] = useState(callbackError === "oauth-failed" ? "Chưa đăng nhập được bằng Google hoặc Facebook. Hãy thử lại." : callbackError === "verification-failed" ? "Liên kết xác nhận không hợp lệ hoặc đã hết hạn. Hãy thử đăng nhập lại." : accessError ? "Chưa xác định được quyền truy cập. Hãy thử đăng nhập lại hoặc liên hệ hỗ trợ." : "");
  const [notice, setNotice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [oauthProvider, setOauthProvider] = useState<"google" | "facebook" | null>(null);
  const isBusy = isSubmitting || oauthProvider !== null;
  const [branding, setBranding] = useState<{ platform_name: string; logo_url: string | null }>({ platform_name: "GrowDesk", logo_url: null });
  useEffect(() => { let cancelled = false; void supabase.from("platform_general_settings").select("platform_name, logo_url").eq("id", true).maybeSingle().then(({ data }) => { if (!cancelled && data) setBranding(data); }); return () => { cancelled = true; }; }, [supabase]);
  const [signupEnabled, setSignupEnabled] = useState<boolean | null>(null);
  useEffect(() => { let cancelled = false; void supabase.from("platform_operations_settings").select("public_signup_enabled").eq("id", true).maybeSingle().then(({ data }) => { if (!cancelled && data) setSignupEnabled(data.public_signup_enabled === true); }); return () => { cancelled = true; }; }, [supabase]);

  function callbackUrl() {
    const url = new URL("/auth/callback", window.location.origin);
    if (returnStore) url.searchParams.set("store", returnStore);
    else if (invitationNext) url.searchParams.set("next", "staff-invitations");
    else if (customerOrdersNext) url.searchParams.set("next", "customer-orders");
    else if (customerAccountNext) url.searchParams.set("next", "customer-account");
    return url;
  }

  async function signInWithProvider(provider: "google" | "facebook") {
    if (isBusy) return;
    setOauthProvider(provider);
    setErrorMessage("");
    setNotice("");
    try {
      const redirectTo = callbackUrl();
      redirectTo.searchParams.set("flow", "oauth");
      const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: redirectTo.href } });
      if (!error) return;
    } catch {
      // Show the same message for network and provider failures.
    }
    setOauthProvider(null);
    setErrorMessage(`Chưa kết nối được với ${provider === "google" ? "Google" : "Facebook"}. Hãy thử lại.`);
  }

  async function resendConfirmation() {
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) { setErrorMessage("Hãy nhập email hợp lệ để yêu cầu xác minh."); return; }
    setIsSubmitting(true); setErrorMessage(""); setNotice("");
    try {
      const { error } = await supabase.auth.resend({ type: "signup", email: address, options: { emailRedirectTo: callbackUrl().href } });
      if (error) setErrorMessage("Chưa gửi được yêu cầu xác minh. Hãy kiểm tra cấu hình email và thử lại sau.");
      else setNotice("Nếu tài khoản cần xác minh, email hướng dẫn sẽ được gửi đến địa chỉ đã nhập.");
    } catch { setErrorMessage("Chưa gửi được yêu cầu xác minh. Vui lòng thử lại sau."); }
    finally { setIsSubmitting(false); }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isBusy) return;
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
          emailRedirectTo: callbackUrl().href,
        },
      });

      setIsSubmitting(false);
      if (error) {
        setErrorMessage(error.message);
        return;
      }
      if (data.session) {
        router.replace(returnStore ? `/${returnStore}?checkout=1` : customerOrdersNext ? "/customer/orders" : customerAccountNext ? "/customer/account" : invitationNext ? "/staff-invitations" : "/dashboard");
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
    if (returnStore || customerOrdersNext || customerAccountNext) {
      router.replace(returnStore ? `/${returnStore}?checkout=1` : customerAccountNext ? "/customer/account" : "/customer/orders");
      router.refresh();
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

  function changeMode(nextMode: "signin" | "signup") {
    if (mode === nextMode || isBusy) return;
    setMode(nextMode);
    setShowPassword(false);
    setConfirmation("");
    setErrorMessage("");
    setNotice("");
  }

  function toggleTheme() {
    const dark = theme ? theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    setTheme(dark ? "light" : "dark");
  }

  const signingUp = mode === "signup";
  const strength = password ? Math.max(1, [
    password.length >= 8, /[a-z]/.test(password) && /[A-Z]/.test(password),
    /\d/.test(password), /[^\w]|_/.test(password) && password.length >= 8,
  ].filter(Boolean).length) : 0;

  return (
    <main className="store-auth" data-theme={theme}>
      <div className="store-auth-panel">
        <aside className="store-auth-brand-panel">
          <Link className="store-auth-brand" href="/" aria-label={`Trở về trang giới thiệu ${branding.platform_name}`}>
            {branding.logo_url
              ? <Image src={branding.logo_url} width={104} height={36} alt="" unoptimized />
              : <span className="store-auth-brand-mark"><AuthIcon name="box" /></span>}
            <span>{branding.platform_name}</span>
          </Link>
          <div className="store-auth-brand-copy">
            <p>Website bán hàng của riêng bạn.</p>
            <span>Quản lý sản phẩm, theo dõi đơn hàng và vận hành cửa hàng tại một nơi.</span>
            <svg className="store-auth-network" viewBox="0 0 470 240" aria-hidden="true">
              <defs>
                <linearGradient id="store-auth-network-gradient" x2="1" y2="1">
                  <stop offset="0" stopColor="#4b63ff" />
                  <stop offset="1" stopColor="#2fd3f0" />
                </linearGradient>
              </defs>
              <path className="store-auth-network-links" d="M70 50 235 120 110 190 70 50M235 25V120L390 45 400 180 235 120" />
              <circle className="store-auth-network-halo" cx="235" cy="120" r="30" />
              <circle cx="235" cy="120" r="20" fill="url(#store-auth-network-gradient)" />
              <g className="store-auth-network-nodes">
                <circle cx="70" cy="50" r="9" /><circle cx="110" cy="190" r="9" />
                <circle cx="390" cy="45" r="9" /><circle cx="400" cy="180" r="9" />
                <circle cx="235" cy="25" r="9" />
              </g>
              <text x="70" y="79" textAnchor="middle">Sản phẩm</text>
              <text x="110" y="220" textAnchor="middle">Đơn hàng</text>
              <text x="390" y="73" textAnchor="middle">Khách hàng</text>
              <text x="400" y="210" textAnchor="middle">Vận chuyển</text>
              <text x="250" y="29">Cửa hàng</text>
            </svg>
          </div>
        </aside>
        <section className="store-auth-content" data-mode={mode} aria-labelledby="store-auth-title">
          <button type="button" className="store-auth-theme" onClick={toggleTheme} aria-label="Đổi giao diện sáng hoặc tối">
            <span className="store-auth-theme-sun"><AuthIcon name="sun" /></span>
            <span className="store-auth-theme-moon"><AuthIcon name="moon" /></span>
          </button>
          <div className="store-auth-card">
            <div className="store-auth-modes" role="group" aria-label="Chọn đăng nhập hoặc đăng ký">
              <button type="button" aria-pressed={!signingUp} disabled={isBusy} onClick={() => changeMode("signin")}>Đăng nhập</button>
              <button type="button" aria-pressed={signingUp} disabled={isBusy} onClick={() => changeMode("signup")}>Đăng ký</button>
            </div>
            <h1 id="store-auth-title">{!signingUp ? "Chào mừng bạn trở lại" : returnStore || customerOrdersNext || customerAccountNext ? "Tạo tài khoản mua hàng" : "Tạo tài khoản chủ cửa hàng"}</h1>
            <p className="store-auth-intro">{returnStore ? "Đăng nhập hoặc đăng ký để tiếp tục đặt hàng." : customerOrdersNext ? "Đăng nhập để xem đơn hàng của bạn." : customerAccountNext ? "Đăng nhập để xem thông tin tài khoản." : !signingUp ? "Đăng nhập để vào khu vực quản lý cửa hàng." : plan ? `Tạo tài khoản để đăng ký ${plan.name.toLocaleLowerCase("vi-VN")}.` : "Tạo tài khoản để thiết lập gian hàng."}</p>

            <form className="store-auth-form" onSubmit={handleSubmit}>
              {signingUp && <>
                <label>Họ và tên
                  <span className="store-auth-field"><AuthIcon name="person" />
                    <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required maxLength={120} placeholder="Nguyễn Văn An" />
                  </span>
                </label>
                <label>Số điện thoại
                  <span className="store-auth-field"><AuthIcon name="phone" />
                    <input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" required maxLength={30} placeholder="Ví dụ 090 123 4567" />
                  </span>
                </label>
              </>}
              <label>Email
                <span className="store-auth-field"><AuthIcon name="mail" />
                  <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required placeholder="ban@cuahang.vn" />
                </span>
              </label>
              <div>
                <label htmlFor="store-auth-password">Mật khẩu</label>
                <div className="store-auth-field">
                  <AuthIcon name="lock" />
                  <input id="store-auth-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={signingUp ? "new-password" : "current-password"} required minLength={8} placeholder={signingUp ? "Ít nhất 8 ký tự" : "Nhập mật khẩu"} aria-describedby={signingUp && strength ? "store-auth-strength" : undefined} />
                  <button className="store-auth-eye" type="button" onClick={() => setShowPassword(!showPassword)} aria-controls={signingUp ? "store-auth-password store-auth-confirmation" : "store-auth-password"} aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}>
                    <AuthIcon name={showPassword ? "eye-off" : "eye"} />
                  </button>
                </div>
                {signingUp && <>
                  <div className="store-auth-meter" data-strength={strength} aria-hidden="true">
                    {[1, 2, 3, 4].map((bar) => <span key={bar} data-filled={bar <= strength} />)}
                  </div>
                  {strength > 0 && <small id="store-auth-strength">Độ mạnh mật khẩu · {["Rất yếu", "Yếu", "Khá", "Mạnh"][strength - 1]}</small>}
                </>}
              </div>
              {signingUp && <label>Xác nhận mật khẩu
                <span className="store-auth-field"><AuthIcon name="shield" />
                  <input id="store-auth-confirmation" type={showPassword ? "text" : "password"} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" required minLength={8} placeholder="Nhập lại mật khẩu" />
                </span>
              </label>}
              {signingUp && signupEnabled === false && <p className="store-auth-message" role="status">Đăng ký tài khoản mới đang tạm dừng.</p>}
              {errorMessage && <p className="store-auth-message" role="alert">{errorMessage}</p>}
              {notice && <p className="store-auth-message" role="status">{notice}</p>}
              {!signingUp && <button type="button" className="store-auth-text-button store-auth-resend" disabled={isBusy} onClick={() => void resendConfirmation()}>Gửi lại email xác minh</button>}
              <button className="store-auth-submit" type="submit" disabled={isBusy || (signingUp && signupEnabled === false)}>
                {isSubmitting && <span className="store-auth-spinner" aria-hidden="true" />}
                {isSubmitting ? "Đang xử lý…" : signingUp ? "Tạo tài khoản" : "Đăng nhập"}
              </button>
            </form>
            {!signingUp && <>
              <div className="store-auth-oauth-divider">Hoặc đăng nhập với</div>
              <div className="store-auth-social">
                {(["google", "facebook"] as const).map((provider) => (
                  <button key={provider} type="button" disabled={isBusy} onClick={() => void signInWithProvider(provider)}>
                    <span className={`store-auth-social-mark store-auth-social-${provider}`} aria-hidden="true">{provider === "google" ? "G" : "f"}</span>
                    {oauthProvider === provider ? "Đang chuyển hướng…" : provider === "google" ? "Google" : "Facebook"}
                  </button>
                ))}
              </div>
            </>}
            <p className="store-auth-footer">
              {signingUp ? "Đã có tài khoản? " : "Chưa có tài khoản? "}
              <button type="button" className="store-auth-text-button" disabled={isBusy} onClick={() => changeMode(signingUp ? "signin" : "signup")}>{signingUp ? "Đăng nhập" : "Tạo tài khoản"}</button>
            </p>
            <Link className="store-auth-back" href="/">← Về trang giới thiệu</Link>
          </div>
        </section>
      </div>
    </main>
  );
}

function AuthIcon({ name }: { name: "box" | "person" | "phone" | "mail" | "lock" | "eye" | "eye-off" | "shield" | "sun" | "moon" }) {
  const paths = {
    box: <path d="M12 2 3 7v10l9 5 9-5V7zM12 22V12M3 7l9 5 9-5" />,
    person: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    phone: <path d="M8 3H5a2 2 0 0 0-2 2c0 8.8 7.2 16 16 16a2 2 0 0 0 2-2v-3l-5-2-2 2a12 12 0 0 1-6-6l2-2-2-5Z" />,
    mail: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 8 8 6 8-6" /></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
    "eye-off": <path d="m3 3 18 18M10 5a11 11 0 0 1 2 0c6.4 0 10 7 10 7a19 19 0 0 1-3 4M6 6a20 20 0 0 0-4 6s3.6 7 10 7a10 10 0 0 0 5-1" />,
    shield: <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6zM9 12l2 2 4-4" />,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1" /></>,
    moon: <path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z" />,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
