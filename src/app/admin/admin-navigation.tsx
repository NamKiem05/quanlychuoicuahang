"use client";

import Link from "next/link";
import Image from "next/image";
import SidebarIcon from "@/app/sidebar-icon";
import { usePathname } from "next/navigation";
import { useState, type CSSProperties } from "react";
import { useAdminChatNotifications } from "./admin-chat-notifications";
import styles from "@/app/chat/chat-notifications.module.css";

type MenuItem = { label: string; icon: Parameters<typeof SidebarIcon>[0]["name"]; href?: string; children?: { label: string; href?: string }[] };
const groups: { label: string; items: MenuItem[] }[] = [
  { label: "Tổng quan", items: [{ href: "/admin", label: "Dashboard", icon: "overview" }] },
  { label: "Quản lý kinh doanh", items: [
    { href: "/admin/stores", label: "Quản lý cửa hàng", icon: "store" },
    { href: "/admin/accounts", label: "Quản lý tài khoản", icon: "accounts" },
    { href: "/admin/plans", label: "Gói dịch vụ", icon: "payment" },
    { href: "/admin/subscriptions", label: "Đăng ký dịch vụ", icon: "promotions" },
    { href: "/admin/plan-payments", label: "Thanh toán & giao dịch", icon: "payment" },
    { href: "/admin/invoices", label: "Hóa đơn", icon: "orders" },
    { href: "/admin/orders", label: "Đơn hàng", icon: "orders" },
  ] },
  { label: "Quản lý nền tảng", items: [
    { href: "/admin/domains", label: "Tên miền & Website", icon: "domains" },
    { href: "/admin/themes", label: "Giao diện mẫu", icon: "appearance" },
    { href: "/admin/business-categories", label: "Danh mục ngành hàng", icon: "menu" },
    { label: "Quản lý nội dung", icon: "orders", children: [
      { label: "Quản lý trang giới thiệu" },
      { label: "Quản lý bảng giá" },
      { label: "Quản lý bài viết" },
      { label: "Quản lý FAQ" },
      { label: "Quản lý banner" },
      { label: "Quản lý thông báo" },
      { label: "Quản lý chính sách" },
      { label: "Quản lý điều khoản sử dụng" },
    ] },
  ] },
  { label: "Chăm sóc khách hàng", items: [
    { href: "/admin/tickets", label: "Hỗ trợ khách hàng", icon: "support" },
    { href: "/admin/messages", label: "Live Chat", icon: "support" },
    { href: "/admin/notifications", label: "Thông báo", icon: "overview" },
    { href: "/admin/reviews", label: "Đánh giá", icon: "reviews" },
  ] },
  { label: "Hệ thống", items: [
    { href: "/admin/reports", label: "Báo cáo & thống kê", icon: "overview" },
    { href: "/admin/monitoring", label: "Giám sát hệ thống", icon: "overview" },
    { href: "/admin/security", label: "Bảo mật", icon: "lock" },
    { href: "/admin/backups", label: "Sao lưu & khôi phục", icon: "settings" },
    { label: "Nhân viên & phân quyền", icon: "admins", children: [
      { label: "Quản lý nhân viên", href: "/admin/admins" },
      { label: "Vai trò và phân quyền", href: "/admin/roles" },
    ] },
    { href: "/admin/settings", label: "Cấu hình hệ thống", icon: "settings" },
  ] },
];
const items = groups.flatMap((group) => group.items);

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

export default function AdminNavigation({ supportOnly = false, platformName, logoUrl }: { supportOnly?: boolean; platformName: string; logoUrl: string | null }) {
  const pathname = usePathname();
  const { unreadByStore } = useAdminChatNotifications();
  const unreadMessages = Object.values(unreadByStore).reduce((total, count) => total + count, 0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const visibleGroups = supportOnly ? groups.filter((group) => group.label === "Chăm sóc khách hàng").map((group) => ({ ...group, items: group.items.filter((item) => item.href === "/admin/tickets") })) : groups;
  const visibleItems = visibleGroups.flatMap((group) => group.items);
  const mobileMainItems = supportOnly ? visibleItems : ["/admin", "/admin/stores", "/admin/orders", "/admin/messages"].map((href) => items.find((item) => item.href === href)!);
  const mobileSettingsItems = visibleItems.filter((item) => !mobileMainItems.includes(item));
  const settingsIsActive = mobileSettingsItems.some((item) =>
    (item.href && (pathname === item.href || pathname.startsWith(`${item.href}/`))) ||
    item.children?.some((child) => child.href && (pathname === child.href || pathname.startsWith(`${child.href}/`))),
  );

  function isActive(href: string) {
    return href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  }

  function renderLink(item: MenuItem) {
    if (item.children) {
      const active = item.children.some((child) => child.href && isActive(child.href));
      return <details className="admin-sidebar-submenu" key={`${item.label}:${active}`} open={active || undefined}>
      <summary className={`admin-sidebar-link${active ? " active" : ""}`}><SidebarIcon name={item.icon} /><span>{item.label}</span><span className="admin-sidebar-submenu-arrow" aria-hidden="true">⌄</span></summary>
      <div className="admin-sidebar-submenu-items">{item.children.map((child) => child.href
        ? <Link key={child.label} href={child.href} className={`admin-sidebar-submenu-link${isActive(child.href) ? " active" : ""}`} aria-current={isActive(child.href) ? "page" : undefined} onClick={() => setSettingsOpen(false)}>{child.label}</Link>
        : <span key={child.label} className="admin-sidebar-submenu-link is-unavailable" aria-disabled="true" title="Chức năng chưa được triển khai">{child.label}<small>Sắp có</small></span>)}</div>
    </details>;
    }
    if (!item.href) return <span className="admin-sidebar-link admin-sidebar-unavailable" key={item.label} aria-disabled="true" title="Chức năng chưa được triển khai"><SidebarIcon name={item.icon} />{item.label}<small>Sắp có</small></span>;
    const active = isActive(item.href);
    return (
      <Link className={`admin-sidebar-link${active ? " active" : ""}`} href={item.href} key={item.href} aria-current={active ? "page" : undefined} onClick={() => setSettingsOpen(false)}>
        <SidebarIcon name={item.icon} />
        {item.label}
        {item.href === "/admin/messages" && unreadMessages > 0 && <span className={styles.sidebarBadge} style={unreadBadgeStyle} aria-label={`${unreadMessages} tin nhắn chưa đọc`}>{unreadMessages > 9 ? "9+" : unreadMessages}</span>}
      </Link>
    );
  }

  return (
    <aside className="admin-sidebar">
      <Link className="brand admin-sidebar-brand" href="/" aria-label={`${platformName} - trang giới thiệu`}>
        {logoUrl && <Image src={logoUrl} width={180} height={72} alt="" unoptimized style={{ objectFit: "contain" }} />}
        
      </Link>
      <div className="admin-sidebar-caption">QUẢN TRỊ NỀN TẢNG</div>
      <nav className="admin-sidebar-nav admin-platform-sidebar-nav" aria-label="Menu quản trị">
        <div className="sidebar-desktop-links">{visibleGroups.map((group) => <section className="admin-sidebar-group" key={group.label} aria-label={group.label}><h2>{group.label}</h2>{group.items.map(renderLink)}</section>)}</div>
        <div className="sidebar-mobile-main">{mobileMainItems.map(renderLink)}</div>
        {mobileSettingsItems.length > 0 && <div className="sidebar-mobile-settings">
          <button className={`admin-sidebar-link sidebar-settings-toggle${settingsIsActive ? " active" : ""}`} type="button" aria-expanded={settingsOpen} aria-controls="admin-mobile-settings" onClick={() => setSettingsOpen((open) => !open)}>
            <SidebarIcon name="settings" />
            Cài đặt
          </button>
          {settingsOpen && <div className="sidebar-mobile-settings-menu" id="admin-mobile-settings" aria-label="Các trang cài đặt">
            {mobileSettingsItems.map(renderLink)}
          </div>}
        </div>}
      </nav>
      <div className="admin-sidebar-bottom">
        <span className="admin-role-pill"><span /> {supportOnly ? "NHÂN VIÊN HỖ TRỢ" : "QUẢN TRỊ VIÊN"}</span>
        {!supportOnly && <Link href="/dashboard">↗ Khu vực cửa hàng</Link>}
        <Link href="/">← Về trang chủ</Link>
      </div>
    </aside>
  );
}
