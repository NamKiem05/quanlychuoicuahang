import type { ReactNode } from "react";
import { signOut } from "./actions";
import DashboardSidebar from "./dashboard-sidebar";
import OrderNotificationBell from "./order-notification-bell";
import { getMerchantContext } from "./data";
import StoreAdminChat from "@/app/chat/store-admin-chat";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const { store } = await getMerchantContext();
  const storeInitial = store?.name.trim().charAt(0).toLocaleUpperCase("vi-VN") || "C";

  return (
    <div className="admin-app-shell admin-platform-shell merchant-dashboard-shell">
      <DashboardSidebar storeName={store?.name ?? null} />
      <div className="admin-workspace">
        <header className="admin-topbar merchant-topbar">
          <form className="admin-topbar-search merchant-topbar-search" action="/dashboard/orders" role="search">
            <span aria-hidden="true">⌕</span>
            <input aria-label="Tìm kiếm đơn hàng" type="search" name="q" placeholder="Tìm kiếm đơn hàng, khách hàng..." />
            <kbd>Enter</kbd>
          </form>
          <div className="merchant-topbar-actions">
            {store && <OrderNotificationBell storeId={store.id} storeName={store.name} />}
            <div className="admin-topbar-profile merchant-topbar-profile">
              <span className="admin-topbar-avatar merchant-profile-avatar" aria-hidden="true">{storeInitial}</span>
              <span className="merchant-profile-copy"><b>{store?.name ?? "Chủ cửa hàng"}</b><small>Quản lý cửa hàng</small></span>
            </div>
            <form action={signOut}><button className="merchant-signout-button" type="submit">Đăng xuất <span aria-hidden="true">↗</span></button></form>
          </div>
        </header>
        <div className="admin-page-content">{children}</div>
      </div>
      {store && <StoreAdminChat mode="merchant" theme="admin" storeId={store.id} storeName={store.name} />}
    </div>
  );
}
