import type { Metadata } from "next";
import TrackOrderForm from "./track-order-form";

export const metadata: Metadata = { title: "Tra cứu đơn hàng | Gần Đây" };

export default function TrackOrderPage() {
  return (
    <main className="tracking-page">
      <header className="dashboard-header">
        <a className="brand" href="/">
          <span className="brand-mark">G</span>
          <span className="brand-name">gần đây<span>.</span></span>
        </a>
        <a className="signout-button" href="/">Tìm cửa hàng</a>
      </header>
      <TrackOrderForm />
    </main>
  );
}
