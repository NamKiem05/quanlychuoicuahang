import type { ReactNode } from "react";
import { signOut } from "./actions";
import DashboardSidebar from "./dashboard-sidebar";
import OrderNotificationBell from "./order-notification-bell";
import { getMerchantContext } from "./data";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const { store } = await getMerchantContext();

  return (
    <div className="admin-app-shell">
      <DashboardSidebar storeName={store?.name ?? null} />
      <div className="admin-workspace">
        <header className="admin-topbar">
          <span>{store ? `QUẢN LÝ CỬA HÀNG · ${store.name}` : "KHU VỰC CHỦ CỬA HÀNG"}</span>
          {store && <OrderNotificationBell storeId={store.id} storeName={store.name} />}
          <form action={signOut}><button className="merchant-signout-button" type="submit">Đăng xuất ↗</button></form>
        </header>
        <div className="admin-page-content">{children}</div>
      </div>
    </div>
  );
}
