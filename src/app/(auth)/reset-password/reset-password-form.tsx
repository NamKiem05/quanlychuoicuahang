"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { maximumPasswordBytes, minimumPasswordLength, passwordStrength, validateRecoveryPassword } from "@/lib/auth/password";
import { withRecoveryLock } from "@/lib/auth/recovery-lock";
import { AuthIcon } from "../auth-icon";
import { checkPasswordRecovery, retryRecoverySignOut, updateRecoveryPassword } from "./actions";

type Failure = "invalid" | "expired" | "unavailable" | "service-unavailable";
type PageState = Failure | "checking" | "ready" | "updating" | "updated" | "sign-out-pending";

const failureMessages = {
  invalid: "Liên kết đã được dùng, không hợp lệ hoặc được mở trong trình duyệt khác. Anh hãy gửi yêu cầu mới và mở liên kết trong cùng trình duyệt.",
  expired: "Liên kết hoặc phiên khôi phục đã hết hạn. Anh hãy gửi yêu cầu mới.",
  unavailable: "Chưa thể xác minh phiên khôi phục lúc này. Anh hãy thử xác minh lại.",
  "service-unavailable": "Dịch vụ xác minh phiên của GrowDesk chưa sẵn sàng. Anh hãy thử lại sau hoặc liên hệ hỗ trợ nếu lỗi tiếp diễn.",
};
const uncertainMessage = "Chưa xác nhận được kết quả lưu. Anh có thể thử đăng nhập bằng mật khẩu mới. Nếu cần đổi lại, hãy yêu cầu liên kết mới.";

export default function ResetPasswordForm({ recoveryId, failure }: { recoveryId: string | null; failure: Failure }) {
  const [id] = useState(recoveryId);
  const [pageState, setPageState] = useState<PageState>(id ? "checking" : failure);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [retryingSignOut, setRetryingSignOut] = useState(false);
  const submitting = useRef(false);
  const strength = passwordStrength(password);

  useEffect(() => {
    let cancelled = false;
    async function verify() {
      const { hash, pathname, search } = window.location;
      if (hash) {
        window.history.replaceState(window.history.state, "", pathname + search);
        if (!id && new URLSearchParams(hash.slice(1)).get("error_code") === "otp_expired") {
          setPageState("expired");
        }
      }
      const recovery = id;
      if (!recovery || cancelled) return;
      try {
        const status = await withRecoveryLock("update", () => cancelled ? Promise.resolve("invalid" as const) : checkPasswordRecovery(recovery));
        if (!cancelled) setPageState(status);
      } catch {
        if (!cancelled) setPageState("unavailable");
      }
    }
    void verify();
    return () => { cancelled = true; };
  }, [id]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id || submitting.current || pageState !== "ready") return;
    const validation = validateRecoveryPassword(password, confirmation);
    setErrorMessage(validation ?? "");
    if (validation) return;

    submitting.current = true;
    setPageState("updating");
    try {
      const result = await withRecoveryLock("update", () => updateRecoveryPassword(id, password, confirmation));
      switch (result.status) {
        case "updated":
        case "sign-out-pending":
          setPassword("");
          setConfirmation("");
          setShowPassword(false);
          setPageState(result.status);
          break;
        case "invalid":
        case "service-unavailable":
          setPassword("");
          setConfirmation("");
          setPageState(result.status);
          break;
        default:
          setPageState("ready");
          setErrorMessage(result.status === "validation" ? result.message : result.status === "uncertain"
            ? uncertainMessage
            : "Chưa thể cập nhật mật khẩu. Anh hãy thử lại sau.");
      }
    } catch {
      setPageState("ready");
      setErrorMessage(uncertainMessage);
    } finally {
      submitting.current = false;
    }
  }

  async function retrySignOut() {
    if (!id || submitting.current) return;
    submitting.current = true;
    setRetryingSignOut(true);
    try {
      setPageState(await withRecoveryLock("update", () => retryRecoverySignOut(id)));
    } catch {
      setPageState("sign-out-pending");
    } finally {
      submitting.current = false;
      setRetryingSignOut(false);
    }
  }

  if (pageState === "checking") return <div className="store-auth-recovery-status" role="status">
    <div className="store-auth-recovery-icon"><AuthIcon name="lock" /></div>
    <p>Đang xác minh liên kết khôi phục…</p>
  </div>;

  if (pageState === "invalid" || pageState === "expired" || pageState === "unavailable" || pageState === "service-unavailable") return <>
    <div className="store-auth-recovery-icon"><AuthIcon name="lock" /></div>
    <h1 className="store-auth-recovery-title">{pageState === "unavailable" || pageState === "service-unavailable" ? "Chưa thể xác minh liên kết" : "Hãy yêu cầu liên kết mới"}</h1>
    <p className="store-auth-recovery-intro" role="alert">{failureMessages[pageState]}</p>
    <div className="store-auth-recovery-actions">
      {pageState === "unavailable" && id && <button className="store-auth-submit" type="button" onClick={() => window.location.reload()}>Thử xác minh lại</button>}
      <Link className="store-auth-back" href="/forgot-password">Gửi yêu cầu mới</Link>
      <Link className="store-auth-back" href="/login">Quay lại đăng nhập</Link>
    </div>
  </>;

  if (pageState === "updated" || pageState === "sign-out-pending") return <>
    <div className="store-auth-recovery-icon"><AuthIcon name="check" /></div>
    <h1 className="store-auth-recovery-title">Mật khẩu đã được đổi</h1>
    {pageState === "updated"
      ? <p className="store-auth-recovery-intro" role="status">Supabase đã chấp nhận yêu cầu đăng xuất toàn bộ. Anh có thể đăng nhập bằng mật khẩu mới.</p>
      : <p className="store-auth-message" role="alert">Mật khẩu đã đổi. GrowDesk chưa xác nhận được yêu cầu đăng xuất toàn bộ. Anh có thể thử lại trong phiên khôi phục này.</p>}
    <div className="store-auth-recovery-actions">
      {pageState === "sign-out-pending" && <button className="store-auth-submit" type="button" disabled={retryingSignOut} onClick={() => void retrySignOut()}>
        {retryingSignOut && <span className="store-auth-spinner" aria-hidden="true" />}
        {retryingSignOut ? "Đang gửi yêu cầu…" : "Thử đăng xuất toàn bộ"}
      </button>}
      <Link className={pageState === "updated" ? "store-auth-submit" : "store-auth-back"} href="/login">Đi đến đăng nhập</Link>
    </div>
  </>;

  return <>
    <div className="store-auth-recovery-icon"><AuthIcon name="lock" /></div>
    <h1 className="store-auth-recovery-title">Tạo mật khẩu mới</h1>
    <p id="recovery-password-policy" className="store-auth-recovery-intro">Mật khẩu cần ít nhất {minimumPasswordLength} ký tự và tối đa {maximumPasswordBytes} byte. Sau khi lưu, GrowDesk sẽ yêu cầu đăng xuất trên mọi thiết bị.</p>
    <form className="store-auth-recovery-form" method="post" onSubmit={handleSubmit} noValidate>
      <div className="store-auth-recovery-input">
        <label htmlFor="new-password">Mật khẩu mới</label>
        <div className="store-auth-field">
          <AuthIcon name="lock" />
          <input id="new-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={minimumPasswordLength} maxLength={128} required aria-describedby={strength ? "recovery-password-policy recovery-password-strength" : "recovery-password-policy"} />
          <button className="store-auth-eye" type="button" onClick={() => setShowPassword(!showPassword)} aria-controls="new-password confirm-password" aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}>
            <AuthIcon name={showPassword ? "eye-off" : "eye"} />
          </button>
        </div>
        {strength > 0 && <div className="store-auth-strength">
          <div className="store-auth-meter" data-strength={strength} aria-hidden="true">
            {[1, 2, 3, 4].map((bar) => <span key={bar} data-filled={bar <= strength} />)}
          </div>
          <small id="recovery-password-strength">Độ mạnh mật khẩu · {["Rất yếu", "Yếu", "Khá", "Mạnh"][strength - 1]}</small>
        </div>}
      </div>
      <div className="store-auth-recovery-input">
        <label htmlFor="confirm-password">Nhập lại mật khẩu mới</label>
        <div className="store-auth-field">
          <AuthIcon name="lock" />
          <input id="confirm-password" type={showPassword ? "text" : "password"} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" minLength={minimumPasswordLength} maxLength={128} required />
        </div>
      </div>
      {errorMessage && <p className="store-auth-message" role="alert">{errorMessage}</p>}
      <button className="store-auth-submit" type="submit" disabled={pageState === "updating"}>
        {pageState === "updating" && <span className="store-auth-spinner" aria-hidden="true" />}
        {pageState === "updating" ? "Đang cập nhật…" : "Cập nhật mật khẩu"}
      </button>
    </form>
  </>;
}
