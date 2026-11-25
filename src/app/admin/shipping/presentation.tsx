import Link from "next/link";
import type { ReactNode } from "react";
import SidebarIcon from "@/components/ui/sidebar-icon";

export function ShippingHeading({ section, title, description, children }: {
  section: "providers" | "accounts";
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return <>
    <header className="shipping-admin-heading">
      <div className="shipping-heading-copy">
        <span className="shipping-heading-icon"><SidebarIcon name="delivery" /></span>
        <div>
          <h1 className="admin-page-title">{title}</h1>
          <p className="dashboard-intro">{description}</p>
        </div>
      </div>
      {children && <div className="shipping-heading-action">{children}</div>}
    </header>
    <nav className="shipping-section-nav" aria-label="Quản lý vận chuyển">
      <Link href="/admin/shipping/providers" aria-current={section === "providers" ? "page" : undefined}>Nhà cung cấp</Link>
      <Link href="/admin/shipping/accounts" aria-current={section === "accounts" ? "page" : undefined}>Tài khoản vận chuyển</Link>
    </nav>
  </>;
}

export function ShippingStatus({ tone, children }: {
  tone: "positive" | "neutral" | "negative" | "pending";
  children: ReactNode;
}) {
  return <span className="shipping-status-pill" data-tone={tone}>{children}</span>;
}
