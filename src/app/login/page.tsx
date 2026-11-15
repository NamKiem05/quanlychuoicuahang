"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setNotice("");
    setIsSubmitting(true);

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: name.trim() },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      setIsSubmitting(false);
      if (error) {
        setErrorMessage(error.message);
        return;
      }
      if (data.session) {
        router.replace("/dashboard");
        router.refresh();
      } else {
        setNotice("Tài khoản đã tạo. Hãy mở email xác nhận để tiếp tục đăng nhập.");
      }
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setIsSubmitting(false);
    if (error) {
      setErrorMessage("Không đăng nhập được. Hãy kiểm tra email và mật khẩu.");
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <main className="auth-page">
      <a className="brand auth-brand" href="/" aria-label="Trở về cửa hàng">
        <span className="brand-mark">M</span>
        <span className="brand-name">bếp nhà mơ<span>.</span></span>
      </a>
      <section className="auth-card">
        <div className="eyebrow"><span>✳</span> KÊNH DÀNH CHO CHỦ QUÁN</div>
        <h1>{mode === "signin" ? "Chào mừng bạn trở lại" : "Mở gian hàng của bạn"}</h1>
        <p className="auth-intro">Quản lý món ăn và đơn hàng tại một nơi.</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === "signup" && (
            <label>Họ và tên
              <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required maxLength={120} placeholder="Tên của bạn" />
            </label>
          )}
          <label>Email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required placeholder="ban@cuahang.vn" />
          </label>
          <label>Mật khẩu
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "signin" ? "current-password" : "new-password"} required minLength={8} placeholder="Ít nhất 8 ký tự" />
          </label>

          {errorMessage && <p className="auth-message error-message" role="alert">{errorMessage}</p>}
          {notice && <p className="auth-message notice-message" role="status">{notice}</p>}
          <button className="primary-button auth-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Đang xử lý..." : mode === "signin" ? "Đăng nhập" : "Tạo tài khoản"}<span>→</span>
          </button>
        </form>

        <p className="auth-switch">
          {mode === "signin" ? "Chưa có tài khoản?" : "Đã có tài khoản?"}{" "}
          <button type="button" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setErrorMessage(""); setNotice(""); }}>
            {mode === "signin" ? "Đăng ký chủ quán" : "Đăng nhập"}
          </button>
        </p>
        <a className="back-home" href="/">← Quay lại cửa hàng mẫu</a>
      </section>
    </main>
  );
}
