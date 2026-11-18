import type { ReactNode } from "react";
import { defaultPlatformSettings, getPlatformSettings } from "@/lib/platform-settings";
import DashboardAccountMenu from "./account-menu";
import DashboardSidebar from "./dashboard-sidebar";
import OrderNotificationBell from "./order-notification-bell";
import { getMerchantContext } from "./data";
import StoreAdminChat from "@/app/chat/store-admin-chat";
import { hasMerchantPremium } from "@/lib/merchant-billing";
import PlatformNoticeLink from "./platform-notice-link";
import "@/app/platform-notifications.css";
import ActiveStoreFormGuard from "./active-store-form-guard";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const { supabase, store, email, membership } = await getMerchantContext();
  const { settings } = await getPlatformSettings();
  const branding = settings ?? defaultPlatformSettings;
  const [{ count: pendingOrderCount }, premiumAvailable] = store
    ? await Promise.all([
      supabase.from("orders").select("id", { count: "exact", head: true }).eq("store_id", store.id).eq("status", "pending"),
      hasMerchantPremium(supabase, store.id),
    ])
    : [{ count: null }, false];

  return (
    <div className="admin-app-shell admin-platform-shell merchant-dashboard-shell">
      {store && <ActiveStoreFormGuard key={store.id} storeId={store.id} />}
      <DashboardSidebar platformName={branding.platform_name} logoUrl={branding.logo_url} key={store?.id} storeName={store?.name ?? null} storeId={store?.id ?? null} initialPendingOrders={pendingOrderCount} premiumAvailable={premiumAvailable} />
      <div className="admin-workspace">
        <header className="admin-topbar merchant-topbar">
          <form className="admin-topbar-search merchant-topbar-search" action="/dashboard/orders" role="search">
            <span aria-hidden="true">⌕</span>
            <input aria-label="Tìm kiếm đơn hàng" type="search" name="q" placeholder="Tìm kiếm đơn hàng, khách hàng..." />
            <kbd>Enter</kbd>
          </form>
          <div className="merchant-topbar-actions">
            {store && <OrderNotificationBell storeId={store.id} storeName={store.name} />}
            {store && <PlatformNoticeLink storeId={store.id} />}
            <DashboardAccountMenu storeName={store?.name ?? null} email={email} role={membership?.role ?? null} />
          </div>
        </header>
        <div className="admin-page-content">{children}</div>
      </div>
      {store && <StoreAdminChat mode="merchant" theme="admin" storeId={store.id} storeName={store.name} />}
    </div>
  );
}
