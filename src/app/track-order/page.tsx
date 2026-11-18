import type { Metadata } from "next";
import Link from "next/link";
import TrackOrderForm from "./track-order-form";
import "./track-order.css";

export const metadata: Metadata = { title: "Tra cứu đơn hàng | Gần Đây" };

export default function TrackOrderPage() {
  return (
    <main className="tracking-page">
      <header className="tracking-topbar">
        <div>
          <Link className="tracking-brand" href="/" aria-label="Gần Đây · Trang giới thiệu">
            <span aria-hidden="true">G</span><strong>gần đây.</strong>
          </Link>
          <Link className="tracking-home-link" href="/">← Trang giới thiệu</Link>
        </div>
      </header>
      <TrackOrderForm />
    </main>
  );
}
