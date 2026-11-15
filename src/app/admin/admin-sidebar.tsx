"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/admin", label: "Tổng quan", icon: "▦" },
  { href: "/admin/stores", label: "Cửa hàng", icon: "⌂" },
  { href: "/admin/orders", label: "Đơn hàng", icon: "▤" },
  { href: "/admin/reviews", label: "Đánh giá", icon: "★" },
];

export default function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="admin-sidebar">
      <Link className="brand admin-sidebar-brand" href="/">
        <span className="brand-mark">M</span>
        <span className="brand-name">bếp nhà mơ<span>.</span></span>
      </Link>
      <div className="admin-sidebar-caption">QUẢN TRỊ NỀN TẢNG</div>
      <nav className="admin-sidebar-nav" aria-label="Menu quản trị">
        {items.map((item) => {
          const isActive = item.href === "/admin"
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
        <span className="admin-role-pill"><span /> QUẢN TRỊ VIÊN</span>
        <Link href="/dashboard">↗ Khu vực cửa hàng</Link>
        <Link href="/">← Về trang chủ</Link>
      </div>
    </aside>
  );
}
