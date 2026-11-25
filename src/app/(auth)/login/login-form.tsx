"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { findMerchantPlan } from "@/lib/merchant-plans";
import { loginDestination, resolveLoginDestination } from "@/lib/auth/login-destination";
import { minimumPasswordLength, passwordStrength } from "@/lib/auth/password";
import { AuthIcon } from "../auth-icon";
import "./login.css";

export default function LoginFormFromUrl() {
  const params = useSearchParams();
  const mode = params.get("mode") === "signup" ? "signup" : "signin";
  const plan = findMerchantPlan(params.get("plan"));
  const callbackError = params.get("message");
  const accessError = callbackError === "account-access-failed";
  const destination = loginDestination(params);
  const { store: returnStore = null, next } = destination;
  const invitationNext = next === "staff-invitations";
  const customerOrdersNext = next === "customer-orders";
  const customerAccountNext = next === "customer-account";
  return <LoginForm key={`${mode}:${plan?.id ?? ""}:${invitationNext}:${customerOrdersNext}:${customerAccountNext}:${returnStore ?? ""}`} destination={destination} initialMode={mode} plan={plan} callbackError={callbackError} accessError={accessError} invitationNext={invitationNext} customerOrdersNext={customerOrdersNext} customerAccountNext={customerAccountNext} returnStore={returnStore} />;
}

function LoginForm({ destination, initialMode, plan, callbackError, accessError, invitationNext, customerOrdersNext, customerAccountNext, returnStore }: { destination: ReturnType<typeof loginDestination>; initialMode: "signin" | "signup"; plan: ReturnType<typeof findMerchantPlan>; callbackError: string | null; accessError: boolean; invitationNext: boolean; customerOrdersNext: boolean; customerAccountNext: boolean; returnStore: string | null }) {
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
  const [errorMessage, setErrorMessage] = useState(callbackError === "session-expired" ? "Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại." : callbackError === "oauth-failed" ? "Chưa đăng nhập được bằng Google hoặc Facebook. Hãy thử lại." : callbackError === "verification-failed" ? "Liên kết xác nhận không hợp lệ hoặc đã hết hạn. Hãy thử đăng nhập lại." : callbackError === "signout-failed" ? "Chưa xác nhận được việc đăng xuất. Anh có thể quay lại và thử lại." : accessError ? "Chưa xác định được quyền truy cập. Hãy thử đăng nhập lại hoặc liên hệ hỗ trợ." : "");
  const [notice, setNotice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [oauthProvider, setOauthProvider] = useState<"google" | "facebook" | null>(null);
  const inFlight = useRef(false);
  const isBusy = isSubmitting || oauthProvider !== null;
  useEffect(() => {
    function restoreForm(event: PageTransitionEvent) {
      if (!event.persisted) return;
      inFlight.current = false;
      setOauthProvider(null);
      setIsSubmitting(false);
    }
    window.addEventListener("pageshow", restoreForm);
    return () => window.removeEventListener("pageshow", restoreForm);
  }, []);
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
    if (inFlight.current) return;
    inFlight.current = true;
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
    inFlight.current = false;
    setOauthProvider(null);
    setErrorMessage(`Chưa kết nối được với ${provider === "google" ? "Google" : "Facebook"}. Hãy thử lại.`);
  }

  async function resendConfirmation() {
    if (inFlight.current) return;
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) { setErrorMessage("Hãy nhập email hợp lệ để yêu cầu xác minh."); return; }
    inFlight.current = true;
    setIsSubmitting(true); setErrorMessage(""); setNotice("");
    try {
      const { error } = await supabase.auth.resend({ type: "signup", email: address, options: { emailRedirectTo: callbackUrl().href } });
      if (error && (error.status === 0 || [502, 503, 504].includes(error.status ?? 0))) {
        setErrorMessage("Dịch vụ xác minh tạm thời không phản hồi. Anh hãy thử lại sau.");
      }
      else setNotice("Nếu tài khoản cần xác minh, email hướng dẫn sẽ được gửi đến địa chỉ đã nhập.");
    } catch { setErrorMessage("Chưa gửi được yêu cầu xác minh. Vui lòng thử lại sau."); }
    finally { inFlight.current = false; setIsSubmitting(false); }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const address = email.trim();
    setErrorMessage("");
    setNotice("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || address.length > 254 || !password) {
      setErrorMessage("Hãy nhập email hợp lệ và mật khẩu.");
      return;
    }

    inFlight.current = true;
    setIsSubmitting(true);
    let navigating = false;
    try {
      let userId: string;
      if (mode === "signup") {
        const setting = await supabase.from("platform_operations_settings").select("public_signup_enabled").eq("id", true).maybeSingle();
        if (setting.data?.public_signup_enabled === false) {
          setSignupEnabled(false);
          setErrorMessage("Đăng ký tài khoản mới đang tạm dừng.");
          return;
        }
        const normalizedPhone = phone.trim().replace(/[\s().-]/g, "");
        if (!/^\+?\d{8,15}$/.test(normalizedPhone)) {
          setErrorMessage("Nhập số điện thoại hợp lệ, gồm 8 đến 15 chữ số.");
          return;
        }
        if (password.length < minimumPasswordLength || password !== confirmation) {
          setErrorMessage("Hãy nhập mật khẩu ít nhất 8 ký tự và xác nhận đúng mật khẩu.");
          return;
        }

        const { data, error } = await supabase.auth.signUp({
          email: address, password,
          options: {
            data: { display_name: name.trim(), phone: normalizedPhone, requested_plan: plan?.id },
            emailRedirectTo: callbackUrl().href,
          },
        });
        if (error && error.code !== "user_already_exists" && error.code !== "email_exists") {
          setErrorMessage(error.code === "weak_password" ? "Mật khẩu chưa đáp ứng chính sách bảo mật." : "Chưa thể hoàn tất đăng ký. Anh hãy thử lại sau.");
          return;
        }
        if (!data.session) {
          setNotice("Nếu đăng ký cần xác minh, anh sẽ nhận được hướng dẫn qua email.");
          return;
        }
        userId = data.session.user.id;
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email: address, password });
        if (error) {
          setErrorMessage(error.status === 429 || error.code === "over_request_rate_limit"
            ? "Có quá nhiều yêu cầu đăng nhập. Anh hãy chờ rồi thử lại."
            : error.status === 0 || (error.status ?? 0) >= 500
              ? "Dịch vụ đăng nhập tạm thời không phản hồi. Anh hãy thử lại."
              : "Không đăng nhập được. Hãy kiểm tra thông tin hoặc email xác minh.");
          return;
        }
        userId = data.user.id;
      }

      const path = await resolveLoginDestination(supabase, userId, destination);
      if (!path) {
        setErrorMessage("Chưa xác định được quyền truy cập. Hãy thử lại hoặc liên hệ hỗ trợ.");
        return;
      }
      router.replace(path);
      router.refresh();
      navigating = true;
    } catch {
      setErrorMessage("Không thể hoàn tất yêu cầu. Anh hãy kiểm tra kết nối và thử lại.");
    } finally {
      if (!navigating) {
        inFlight.current = false;
        setIsSubmitting(false);
      }
    }
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
  const strength = passwordStrength(password);

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

            <form className="store-auth-form" method="post" onSubmit={handleSubmit} aria-busy={isBusy}>
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
                  <input type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required placeholder="ban@cuahang.vn" />
                </span>
              </label>
              <div>
                <label htmlFor="store-auth-password">Mật khẩu</label>
                <div className="store-auth-field">
                  <AuthIcon name="lock" />
                  <input id="store-auth-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={signingUp ? "new-password" : "current-password"} required minLength={signingUp ? minimumPasswordLength : undefined} placeholder={signingUp ? "Ít nhất 8 ký tự" : "Nhập mật khẩu"} aria-describedby={signingUp && strength ? "store-auth-strength" : undefined} />
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
              {!signingUp && <Link className="store-auth-text-button store-auth-resend" href="/forgot-password">Quên mật khẩu?</Link>}
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
