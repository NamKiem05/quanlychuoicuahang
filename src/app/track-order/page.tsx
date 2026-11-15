import type { Metadata } from "next";
import Link from "next/link";
import TrackOrderForm from "./track-order-form";

export const metadata: Metadata = { title: "Tra cứu đơn hàng | Gần Đây" };

export default function TrackOrderPage() {
  return (
    <main className="tracking-page">
      <header className="dashboard-header">
        <Link className="brand" href="/">
          <span className="brand-mark">G</span>
          <span className="brand-name">gần đây<span>.</span></span>
        </Link>
        <Link className="signout-button" href="/">Trang giới thiệu</Link>
      </header>
      <TrackOrderForm />
    </main>
  );
}
