"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const items = [
  { href: "/dashboard", label: "Tổng quan", icon: "▦" },
  { href: "/dashboard/orders", label: "Đơn hàng", icon: "↗" },
  { href: "/dashboard/menu", label: "Thực đơn", icon: "☷" },
  { href: "/dashboard/promotions", label: "Khuyến mãi", icon: "%" },
  { href: "/dashboard/reviews", label: "Đánh giá", icon: "★" },
  { href: "/dashboard/appearance", label: "Giao diện", icon: "◈" },
  { href: "/dashboard/domains", label: "Tên miền", icon: "◎" },
  { href: "/dashboard/store", label: "Cửa hàng", icon: "⌂" },
];

export default function DashboardSidebar({ storeName }: { storeName: string | null }) {
  const pathname = usePathname();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const visibleItems = storeName ? items : items.slice(0, 1);
  const mobileMainItems = storeName ? items.slice(0, 4) : items.slice(0, 1);
  const mobileSettingsItems = storeName ? items.slice(4) : [];
  const settingsIsActive = mobileSettingsItems.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));

  function isActive(href: string) {
    return href === "/dashboard" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  }

  function renderLink(item: (typeof items)[number]) {
    const active = isActive(item.href);
    return (
      <Link className={`admin-sidebar-link${active ? " active" : ""}`} href={item.href} key={item.href} aria-current={active ? "page" : undefined} onClick={() => setSettingsOpen(false)}>
        <span className="admin-sidebar-icon" aria-hidden="true">{item.icon}</span>
        {item.label}
      </Link>
    );
  }

  return (
    <aside className="admin-sidebar">
      <Link className="brand admin-sidebar-brand" href="/">
        <span className="brand-mark">M</span>
        <span className="brand-name">bếp nhà mơ<span>.</span><small className="admin-brand-subtitle">STORE PANEL</small></span>
      </Link>
      <div className="admin-sidebar-caption">QUẢN LÝ CỬA HÀNG</div>
      <nav className="admin-sidebar-nav dashboard-sidebar-nav" aria-label="Menu cửa hàng">
        <div className="sidebar-desktop-links">{visibleItems.map(renderLink)}</div>
        <div className="sidebar-mobile-main">{mobileMainItems.map(renderLink)}</div>
        {storeName && <div className="sidebar-mobile-settings">
          <button className={`admin-sidebar-link sidebar-settings-toggle${settingsIsActive ? " active" : ""}`} type="button" aria-expanded={settingsOpen} aria-controls="dashboard-mobile-settings" onClick={() => setSettingsOpen((open) => !open)}>
            <span className="admin-sidebar-icon" aria-hidden="true">⚙</span>
            Cài đặt
          </button>
          {settingsOpen && <div className="sidebar-mobile-settings-menu" id="dashboard-mobile-settings" aria-label="Các trang cài đặt">
            {mobileSettingsItems.map(renderLink)}
          </div>}
        </div>}
      </nav>
      <div className="admin-sidebar-bottom">
        {storeName && <span className="merchant-store-pill"><span /> {storeName}</span>}
        <Link href="/">← Về trang chủ</Link>
      </div>
    </aside>
  );
}
