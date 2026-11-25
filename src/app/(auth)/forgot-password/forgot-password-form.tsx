"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { withRecoveryLock } from "@/lib/auth/recovery-lock";
import { AuthIcon } from "../auth-icon";
import { requestPasswordReset } from "./actions";

const acceptedMessage = "Yêu cầu đã được tiếp nhận. Nếu email này có tài khoản, anh hãy kiểm tra hộp thư và thư rác để tìm liên kết đặt lại mật khẩu.";
const unavailableMessage = "Chưa thể gửi yêu cầu lúc này. Anh hãy kiểm tra kết nối và thử lại sau.";

export default function ForgotPasswordForm() {
  const submitting = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    submitting.current = true;
    setNotice("");
    setErrorMessage("");
    setIsSubmitting(true);

    try {
      const { status } = await withRecoveryLock("request", () => requestPasswordReset(email));
      if (status === "accepted") setNotice(acceptedMessage);
      else if (status === "cooldown") setErrorMessage("Anh vừa gửi yêu cầu. Vui lòng chờ một phút trước khi thử lại.");
      else if (status === "invalid-email") setErrorMessage("Anh hãy nhập một địa chỉ email hợp lệ.");
      else setErrorMessage(unavailableMessage);
    } catch {
      setErrorMessage(unavailableMessage);
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  }

  return <>
    <div className="store-auth-recovery-icon"><AuthIcon name="mail" /></div>
    <h1 className="store-auth-recovery-title">Quên mật khẩu?</h1>
    <p className="store-auth-recovery-intro">Nhập email đã đăng ký. Khi nhận được liên kết, anh hãy mở bằng trình duyệt đã gửi yêu cầu.</p>
    <form className="store-auth-recovery-form" method="post" onSubmit={handleSubmit}>
      <label htmlFor="recovery-email">Email đăng ký
        <span className="store-auth-field">
          <AuthIcon name="mail" />
          <input id="recovery-email" name="email" type="email" autoComplete="email" maxLength={254} required placeholder="ban@cuahang.vn" onInvalid={(event) => {
            setNotice("");
            setErrorMessage(event.currentTarget.validity.valueMissing ? "Anh hãy nhập email đăng ký." : "Anh hãy nhập một địa chỉ email hợp lệ.");
          }} onChange={() => setErrorMessage("")} />
        </span>
      </label>
      {errorMessage && <p className="store-auth-message" role="alert">{errorMessage}</p>}
      {notice && <p className="store-auth-message" role="status">{notice}</p>}
      <button className="store-auth-submit" type="submit" disabled={isSubmitting}>
        {isSubmitting && <span className="store-auth-spinner" aria-hidden="true" />}
        {isSubmitting ? "Đang gửi…" : "Gửi liên kết khôi phục"}
      </button>
    </form>
    <p className="store-auth-recovery-footer"><Link className="store-auth-text-button" href="/login">← Quay lại đăng nhập</Link></p>
  </>;
}
