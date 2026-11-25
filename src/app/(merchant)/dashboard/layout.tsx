import SessionTimeout from "@/components/ui/session-timeout";
import { Suspense, type ReactNode } from "react";
import LoadingScreen from "@/components/ui/loading-screen";
import { defaultPlatformSettings, getPlatformSettings } from "@/lib/platform-settings";
import DashboardAccountMenu from "./account-menu";
import DashboardSidebar from "./dashboard-sidebar";
import OrderNotificationBell from "./order-notification-bell";
import { getMerchantContext } from "./data";
import StoreAdminChat from "@/components/chat/store-admin-chat";
import { hasMerchantPremium } from "@/lib/merchant-billing";
import PlatformNoticeLink from "./platform-notice-link";
import "@/components/admin/platform-notifications.css";
import ActiveStoreFormGuard from "./active-store-form-guard";
import { isMerchandiseMode } from "@/lib/merchandise-mode";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const [{ supabase, store, email, membership }, { settings }] = await Promise.all([getMerchantContext(), getPlatformSettings()]);
  const branding = settings ?? defaultPlatformSettings;
  const [modeResult, brandsModule, orderCount, premiumAvailable] = store
    ? await Promise.all([
      supabase.rpc("get_store_merchandise_mode", { target_store: store.id }),
      supabase.rpc("store_module_enabled", { target_store: store.id, target_module: "brands" }),
      supabase.from("orders").select("id", { count: "exact", head: true }).eq("store_id", store.id).eq("status", "pending"),
      hasMerchantPremium(supabase, store.id),
    ])
    : [{ data: "general" }, { data: false, error: null }, { count: null }, false];
  const mode = isMerchandiseMode(modeResult.data) ? modeResult.data : "general";
  const pendingOrderCount = orderCount.count;

  return (
    <div className="admin-app-shell admin-platform-shell merchant-dashboard-shell">
      {store && <ActiveStoreFormGuard key={store.id} storeId={store.id} />}
      <DashboardSidebar mode={mode} brandsEnabled={!brandsModule.error && brandsModule.data === true} platformName={branding.platform_name} logoUrl={branding.logo_url} key={store?.id} storeName={store?.name ?? null} storeId={store?.id ?? null} initialPendingOrders={pendingOrderCount} premiumAvailable={premiumAvailable} />
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
        <div className="admin-page-content"><SessionTimeout /><Suspense fallback={<LoadingScreen contained />}>{children}</Suspense></div>
      </div>
      {store && <StoreAdminChat mode="merchant" theme="admin" storeId={store.id} storeName={store.name} />}
    </div>
  );
}
