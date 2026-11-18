"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ProfileForm({ name, phone, email }: { name: string; phone: string; email: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const displayName = String(form.get("name") || "").trim();
    const phoneValue = String(form.get("phone") || "").trim();
    if (!displayName || displayName.length > 120 || (phoneValue && !/^[0-9+() .-]{9,16}$/.test(phoneValue))) { setError(true); setMessage("Vui lòng kiểm tra họ tên và số điện thoại."); return; }
    setSaving(true); setMessage("");
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError(true); setMessage("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."); setSaving(false); return; }
    const { data, error: updateError } = await supabase.from("profiles").update({ display_name: displayName, phone: phoneValue || null }).eq("id", user.id).select("id").maybeSingle();
    setSaving(false);
    if (updateError || !data) { setError(true); setMessage("Không thể lưu thông tin. Vui lòng thử lại."); return; }
    setError(false); setMessage("Đã lưu thông tin tài khoản."); router.refresh();
  }
  return <form className="customer-profile-form" onSubmit={save}><label>Họ và tên <span>*</span><input name="name" defaultValue={name} maxLength={120} required autoComplete="name" /></label><label>Số điện thoại<input name="phone" type="tel" defaultValue={phone} pattern="[0-9+() .-]{9,16}" maxLength={16} autoComplete="tel" placeholder="Nhập số điện thoại" /></label><label>Email<input value={email} readOnly aria-describedby="profile-email-help" /><small id="profile-email-help">Email đăng nhập được quản lý riêng.</small></label><div className="customer-profile-actions"><button type="submit" disabled={saving}>{saving ? "Đang lưu…" : "Lưu thay đổi"}</button>{message && <p role={error ? "alert" : "status"} className={error ? "error" : "success"}>{message}</p>}</div></form>;
}
