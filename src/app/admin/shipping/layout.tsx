import type { ReactNode } from "react";
import "../../(merchant)/dashboard/menu/create-catalog-dialogs.css";
import "./shipping-admin.css";

export default function ShippingAdminLayout({ children }: { children: ReactNode }) {
  return <div className="admin-shipping">{children}</div>;
}
