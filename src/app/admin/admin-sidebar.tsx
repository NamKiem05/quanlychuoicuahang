"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type CSSProperties } from "react";
import { useAdminChatNotifications } from "./admin-chat-notifications";
import styles from "@/app/chat/chat-notifications.module.css";

const items = [
  { href: "/admin", label: "Tổng quan", icon: "▦" },
  { href: "/admin/stores", label: "Cửa hàng", icon: "⌂" },
  { href: "/admin/accounts", label: "Tài khoản", icon: "♙" },
  { href: "/admin/admins", label: "Quản trị viên", icon: "♜" },
  { href: "/admin/domains", label: "Tên miền", icon: "◎" },
  { href: "/admin/orders", label: "Đơn hàng", icon: "▤" },
  { href: "/admin/messages", label: "Hỗ trợ", icon: "▱" },
  { href: "/admin/reviews", label: "Đánh giá", icon: "★" },
];

const unreadBadgeStyle: CSSProperties = {
  width: 24,
  minWidth: 24,
  height: 24,
  display: "inline-grid",
  placeItems: "center",
  flex: "none",
  marginLeft: "auto",
  padding: 0,
  border: "2px solid #fff",
  borderRadius: "50%",
  background: "#ff304b",
  color: "#fff",
  boxShadow: "0 0 0 1px #d7203c, 0 3px 10px #d7203c55",
  fontSize: 10,
  fontWeight: 800,
  lineHeight: 1,
};

export default function AdminSidebar() {
  const pathname = usePathname();
  const { unreadByStore } = useAdminChatNotifications();
  const unreadMessages = Object.values(unreadByStore).reduce((total, count) => total + count, 0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const mobileMainItems = [items[0], items[1], items[5], items[7]];
  const mobileSettingsItems = [items[2], items[3], items[4], items[6]];
  const settingsIsActive = mobileSettingsItems.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));

  function isActive(href: string) {
    return href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  }

  function renderLink(item: (typeof items)[number]) {
    const active = isActive(item.href);
    return (
      <Link className={`admin-sidebar-link${active ? " active" : ""}`} href={item.href} key={item.href} aria-current={active ? "page" : undefined} onClick={() => setSettingsOpen(false)}>
        <span className="admin-sidebar-icon" aria-hidden="true">{item.icon}</span>
        {item.label}
        {item.href === "/admin/messages" && unreadMessages > 0 && <span className={styles.sidebarBadge} style={unreadBadgeStyle} aria-label={`${unreadMessages} tin nhắn chưa đọc`}>{unreadMessages > 9 ? "9+" : unreadMessages}</span>}
      </Link>
    );
  }

  return (
    <aside className="admin-sidebar">
      <Link className="brand admin-sidebar-brand" href="/">
        <span className="brand-mark">M</span>
        <span className="brand-name">bếp nhà mơ<span>.</span><small className="admin-brand-subtitle">ADMIN PANEL</small></span>
      </Link>
      <div className="admin-sidebar-caption">QUẢN TRỊ NỀN TẢNG</div>
      <nav className="admin-sidebar-nav admin-platform-sidebar-nav" aria-label="Menu quản trị">
        <div className="sidebar-desktop-links">{items.map(renderLink)}</div>
        <div className="sidebar-mobile-main">{mobileMainItems.map(renderLink)}</div>
        <div className="sidebar-mobile-settings">
          <button className={`admin-sidebar-link sidebar-settings-toggle${settingsIsActive ? " active" : ""}`} type="button" aria-expanded={settingsOpen} aria-controls="admin-mobile-settings" onClick={() => setSettingsOpen((open) => !open)}>
            <span className="admin-sidebar-icon" aria-hidden="true">⚙</span>
            Cài đặt
          </button>
          {settingsOpen && <div className="sidebar-mobile-settings-menu" id="admin-mobile-settings" aria-label="Các trang cài đặt">
            {mobileSettingsItems.map(renderLink)}
          </div>}
        </div>
      </nav>
      <div className="admin-sidebar-bottom">
        <span className="admin-role-pill"><span /> QUẢN TRỊ VIÊN</span>
        <Link href="/dashboard">↗ Khu vực cửa hàng</Link>
        <Link href="/">← Về trang chủ</Link>
      </div>
    </aside>
  );
}
