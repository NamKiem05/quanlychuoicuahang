"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { signOut } from "./actions";
import "./account-menu.css";

export default function DashboardAccountMenu({ storeName, email, role }: {
  storeName: string | null;
  email: string | null;
  role: string | null;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const name = storeName || "Tài khoản";
  const roleLabel = role === "owner" ? "Chủ cửa hàng" : role === "staff" ? "Nhân viên" : "Tài khoản cửa hàng";
  const initial = (storeName || email || "G").trim().charAt(0).toLocaleUpperCase("vi-VN");

  useEffect(() => {
    if (!open) return;
    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    }
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [open]);

  return (
    <div className="dashboard-account" ref={root}>
      <button className="dashboard-account-trigger" type="button" ref={trigger} aria-label={`Tài khoản · ${name}`} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
        <span className="dashboard-account-avatar" aria-hidden="true">{initial}</span>
        <span className="dashboard-account-trigger-copy"><b>{name}</b><small>{roleLabel}</small></span>
        <span className="dashboard-account-chevron" aria-hidden="true" />
      </button>
      <div className="dashboard-account-panel" id={panelId} hidden={!open}>
        <div className="dashboard-account-info">
          <strong>{name}</strong>
          {email && <span>{email}</span>}
          <small>{roleLabel}</small>
        </div>
        <Link href="/dashboard/account/profile" onClick={() => setOpen(false)}>Xem thông tin tài khoản <span aria-hidden="true">→</span></Link>
        {storeName && <Link href="/select-store" onClick={() => setOpen(false)}>Chuyển cửa hàng <span aria-hidden="true">→</span></Link>}
        <Link href="/staff-invitations" onClick={() => setOpen(false)}>Lời mời cửa hàng <span aria-hidden="true">→</span></Link>
        <Link href="/dashboard/account" onClick={() => setOpen(false)}>Đổi mật khẩu <span aria-hidden="true">→</span></Link>
        {role === "owner" && <Link href="/merchant-plan" onClick={() => setOpen(false)}>Gói dịch vụ <span aria-hidden="true">→</span></Link>}
        <form action={signOut}><button type="submit">Đăng xuất <span aria-hidden="true">↗</span></button></form>
      </div>
    </div>
  );
}
