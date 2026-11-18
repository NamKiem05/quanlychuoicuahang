"use client";

import Link from "next/link";
import Image from "next/image";
import SidebarIcon from "@/app/sidebar-icon";
import type { MerchandiseMode } from "@/lib/merchandise-mode";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import "./dashboard-sidebar.css";

type MenuItem = { href?: string; label: string; icon: Parameters<typeof SidebarIcon>[0]["name"]; premium?: boolean };
const groups: { label: string; items: MenuItem[] }[] = [
  { label: "Tổng quan", items: [{ href: "/dashboard", label: "Dashboard", icon: "overview" }] },
  { label: "Kinh doanh", items: [
    { href: "/dashboard/menu", label: "Quản lý sản phẩm", icon: "menu" },
    { href: "/dashboard/menu#categories", label: "Danh mục", icon: "overview" },
    { href: "/dashboard/brands", label: "Thương hiệu", icon: "store" },
    { href: "/dashboard/orders", label: "Đơn hàng", icon: "orders" },
    { label: "Khách hàng", icon: "accounts" },
    { label: "Kho hàng", icon: "store" },
    { href: "/dashboard/store#delivery-settings", label: "Vận chuyển", icon: "delivery" },
    { href: "/dashboard/store#payment-settings", label: "Thanh toán", icon: "payment" },
    { label: "Đổi trả & khiếu nại", icon: "orders" },
  ] },
  { label: "Marketing", items: [
    { href: "/dashboard/promotions", label: "Mã giảm giá", icon: "promotions", premium: true },
    { label: "Khuyến mãi", icon: "promotions" },
    { href: "/dashboard/appearance#banner-settings", label: "Banner", icon: "appearance", premium: true },
    { label: "Bài viết & nội dung", icon: "orders" },
    { label: "SEO & Marketing", icon: "overview" },
  ] },
  { label: "Website", items: [
    { href: "/dashboard/appearance", label: "Giao diện", icon: "appearance", premium: true },
    { label: "Trang nội dung", icon: "orders" },
    { label: "Thư viện media", icon: "appearance" },
    { href: "/dashboard/domains", label: "Tên miền", icon: "domains", premium: true },
  ] },
  { label: "Quản lý", items: [
    { href: "/dashboard/staff", label: "Nhân viên & phân quyền", icon: "accounts" },
    { href: "/dashboard/tickets", label: "Yêu cầu hỗ trợ", icon: "support" },
    { label: "Chat khách hàng", icon: "support" },
    { href: "/dashboard/notifications", label: "Thông báo", icon: "overview" },
    { label: "Báo cáo & thống kê", icon: "overview" },
    { href: "/dashboard/reviews", label: "Đánh giá", icon: "reviews" },
  ] },
  { label: "Hệ thống", items: [
    { href: "/dashboard/store", label: "Cấu hình cửa hàng", icon: "settings" },
    { label: "Bảo mật", icon: "lock" },
    { label: "Nhật ký hoạt động", icon: "orders" },
  ] },
];
const items = groups.flatMap((group) => group.items);

export default function DashboardSidebar({ storeName, storeId, initialPendingOrders, premiumAvailable, platformName, logoUrl, brandsEnabled, mode }: {
  mode: MerchandiseMode;
  brandsEnabled: boolean;
  platformName: string;
  logoUrl: string | null;
  storeName: string | null;
  storeId: string | null;
  initialPendingOrders: number | null;
  premiumAvailable: boolean;
}) {
  const pathname = usePathname();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [livePendingOrders, setLivePendingOrders] = useState<number | null>(null);
  const pendingOrders = livePendingOrders ?? initialPendingOrders;

  useEffect(() => {
    if (!storeId) return;
    const supabase = createClient();
    let timer: number | undefined;
    let request = 0;
    let disposed = false;
    const refreshCount = async () => {
      const current = ++request;
      const { count, error } = await supabase.from("orders").select("id", { count: "exact", head: true })
        .eq("store_id", storeId).eq("status", "pending");
      if (!disposed && current === request && !error && count !== null) setLivePendingOrders(count);
    };
    const queueRefresh = () => {
      if (disposed || document.hidden || timer !== undefined) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        void refreshCount();
      }, 250);
    };
    const channel = supabase.channel(`merchant-sidebar-pending-orders:${storeId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `store_id=eq.${storeId}` }, queueRefresh)
      .subscribe((status) => { if (status === "SUBSCRIBED") queueRefresh(); });
    const interval = window.setInterval(queueRefresh, 30_000);
    document.addEventListener("visibilitychange", queueRefresh);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", queueRefresh);
      void supabase.removeChannel(channel);
    };
  }, [storeId]);
  const visibleGroups = (storeName ? groups : groups.slice(0, 1)).map((group) => ({ ...group, items: group.items.filter((item) => brandsEnabled || item.href !== "/dashboard/brands").map((item) => mode === "food" && item.href === "/dashboard/menu" ? { ...item, label: "Quản lý thực đơn" } : item) }));
  const mobileMainItems = storeName ? ["/dashboard", "/dashboard/orders", "/dashboard/menu", "/dashboard/promotions"].map((href) => items.find((item) => item.href === href)!).map((item) => mode === "food" && item.href === "/dashboard/menu" ? { ...item, label: "Món ăn" } : item) : items.slice(0, 1);
  const mobileSettingsItems = storeName ? items.filter((item) => !mobileMainItems.some((main) => main.href === item.href && Boolean(item.href)) && (brandsEnabled || item.href !== "/dashboard/brands")) : [];
  const settingsIsActive = mobileSettingsItems.some((item) => item.href && !item.href.includes("#") && (pathname === item.href || pathname.startsWith(`${item.href}/`)));

  function isActive(href: string) {
    return href === "/dashboard" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  }

  function renderLink(item: MenuItem) {
    if (!item.href) return <span className="admin-sidebar-link merchant-sidebar-unavailable" key={item.label} aria-disabled="true" title="Chức năng chưa được triển khai"><SidebarIcon name={item.icon} />{item.label}<small>Sắp có</small></span>;
    if (item.premium && !premiumAvailable) {
      return (
        <span className="admin-sidebar-link merchant-sidebar-locked" key={item.href} aria-disabled="true" title="Dành cho gói Nâng cao">
          <SidebarIcon name={item.icon} />
          {item.label}
          <span className="sr-only"> (Dành cho gói Nâng cao)</span>
          <span className="merchant-sidebar-lock"><SidebarIcon name="lock" /></span>
        </span>
      );
    }
    const active = !item.href.includes("#") && isActive(item.href);
    const isOrders = item.href === "/dashboard/orders";
    return (
      <Link className={`admin-sidebar-link${active ? " active" : ""}${isOrders ? " merchant-sidebar-orders-link" : ""}`} href={item.href} key={item.href} aria-current={active ? "page" : undefined} onClick={() => setSettingsOpen(false)}>
        <SidebarIcon name={item.icon} />
        {item.label}
        {isOrders && (
          <span className="merchant-sidebar-order-badge" data-has-orders={(pendingOrders ?? 0) > 0}
            aria-label={pendingOrders === null ? "Chưa tải được số đơn chờ xác nhận" : `${pendingOrders} đơn chờ xác nhận`}>
            {pendingOrders === null ? "–" : pendingOrders > 9 ? "9+" : pendingOrders}
          </span>
        )}
      </Link>
    );
  }

  return (
    <aside className="admin-sidebar">
      <Link className="brand admin-sidebar-brand" href="/" aria-label={`${platformName} - trang giới thiệu`}>
        {logoUrl && <Image src={logoUrl} width={180} height={72} alt="" unoptimized style={{ objectFit: "contain" }} />}
        
      </Link>
      <div className="admin-sidebar-caption">QUẢN LÝ CỬA HÀNG</div>
      <nav className="admin-sidebar-nav dashboard-sidebar-nav" aria-label="Menu cửa hàng">
        <div className="sidebar-desktop-links">{visibleGroups.map((group) => <section className="merchant-sidebar-group" key={group.label} aria-label={group.label}><h2>{group.label}</h2>{group.items.map(renderLink)}</section>)}</div>
        <div className="sidebar-mobile-main">{mobileMainItems.map(renderLink)}</div>
        {storeName && <div className="sidebar-mobile-settings">
          <button className={`admin-sidebar-link sidebar-settings-toggle${settingsIsActive ? " active" : ""}`} type="button" aria-expanded={settingsOpen} aria-controls="dashboard-mobile-settings" onClick={() => setSettingsOpen((open) => !open)}>
            <SidebarIcon name="settings" />
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
