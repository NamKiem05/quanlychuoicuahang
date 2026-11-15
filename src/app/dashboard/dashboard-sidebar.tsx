"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/dashboard", label: "Tổng quan", icon: "▦" },
  { href: "/dashboard/orders", label: "Đơn hàng", icon: "↗" },
  { href: "/dashboard/menu", label: "Thực đơn", icon: "☷" },
  { href: "/dashboard/reviews", label: "Đánh giá", icon: "★" },
  { href: "/dashboard/store", label: "Cửa hàng", icon: "⌂" },
];

export default function DashboardSidebar({ storeName }: { storeName: string | null }) {
  const pathname = usePathname();
  const visibleItems = storeName ? items : items.slice(0, 1);

  return (
    <aside className="admin-sidebar">
      <Link className="brand admin-sidebar-brand" href="/">
        <span className="brand-mark">M</span>
        <span className="brand-name">bếp nhà mơ<span>.</span></span>
      </Link>
      <div className="admin-sidebar-caption">QUẢN LÝ CỬA HÀNG</div>
      <nav className="admin-sidebar-nav" aria-label="Menu cửa hàng">
        {visibleItems.map((item) => {
          const isActive = item.href === "/dashboard"
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link className={`admin-sidebar-link${isActive ? " active" : ""}`} href={item.href} key={item.href} aria-current={isActive ? "page" : undefined}>
              <span className="admin-sidebar-icon" aria-hidden="true">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="admin-sidebar-bottom">
        {storeName && <span className="merchant-store-pill"><span /> {storeName}</span>}
        <Link href="/">← Về trang chủ</Link>
      </div>
    </aside>
  );
}
