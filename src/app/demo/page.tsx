"use client";

import Link from "next/link";
import { useState } from "react";
import "./demo.css";

type OrderStatus = "pending" | "preparing" | "ready" | "completed" | "cancelled";
type DemoOrder = { id: number; dish: string; total: number; status: OrderStatus };

const sampleOrders: DemoOrder[] = [
  { id: 2048, dish: "Phở bò · 2 phần", total: 110000, status: "pending" },
  { id: 2047, dish: "Cơm gà · 1 phần", total: 49000, status: "preparing" },
  { id: 2046, dish: "Bún thịt nướng · 2 phần", total: 96000, status: "completed" },
];
const statuses: Record<OrderStatus, string> = {
  pending: "Chờ xác nhận", preparing: "Đang chuẩn bị", ready: "Sẵn sàng", completed: "Hoàn tất", cancelled: "Đã hủy",
};
const nextSteps = {
  pending: { status: "preparing", label: "Nhận đơn" },
  preparing: { status: "ready", label: "Đánh dấu sẵn sàng" },
  ready: { status: "completed", label: "Hoàn tất đơn" },
} as const;
const currency = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" });

export default function MerchantDemoPage() {
  const [orders, setOrders] = useState(sampleOrders);
  const [message, setMessage] = useState("");
  const pending = orders.filter((order) => order.status === "pending").length;
  const completed = orders.filter((order) => order.status === "completed");

  function changeStatus(id: number, status: OrderStatus) {
    setOrders((current) => current.map((order) => order.id === id ? { ...order, status } : order));
    setMessage(`Đơn #DH-${id}: ${statuses[status]}.`);
  }

  function addOrder() {
    setOrders((current) => [{ id: current[0].id + 1, dish: "Cơm gà · 2 phần", total: 98000, status: "pending" }, ...current]);
    setMessage("Đã thêm một đơn mẫu.");
  }

  return (
    <div className="admin-app-shell admin-platform-shell merchant-dashboard-shell merchant-demo">
      <aside className="admin-sidebar">
        <Link className="brand admin-sidebar-brand" href="/">
          <span className="brand-mark">M</span>
          <span className="brand-name">bếp nhà mơ<span>.</span><small className="admin-brand-subtitle">STORE PANEL</small></span>
        </Link>
        <div className="admin-sidebar-caption">QUẢN LÝ CỬA HÀNG</div>
        <nav className="admin-sidebar-nav dashboard-sidebar-nav" aria-label="Menu dashboard mẫu">
          <a className="admin-sidebar-link active" href="#demo-overview"><span className="admin-sidebar-icon" aria-hidden="true">▦</span>Tổng quan</a>
          <a className="admin-sidebar-link" href="#demo-orders"><span className="admin-sidebar-icon" aria-hidden="true">↗</span>Đơn hàng</a>
        </nav>
        <div className="admin-sidebar-bottom"><Link href="/">← Về trang giới thiệu</Link></div>
      </aside>
      <div className="admin-workspace">
        <header className="admin-topbar merchant-topbar merchant-demo-header">
          <Link href="/">← Trang giới thiệu</Link>
          <Link className="merchant-demo-primary" href="/login?mode=signup">Tạo gian hàng</Link>
        </header>
        <div className="admin-page-content">
          <main className="admin-content merchant-dashboard" id="demo-overview">
            <div className="admin-page-heading merchant-dashboard-heading">
              <span className="admin-page-heading-icon" aria-hidden="true">▦</span>
              <div className="merchant-dashboard-heading-copy">
                <div className="dashboard-kicker">TỔNG QUAN CỬA HÀNG</div>
                <h1 className="admin-page-title">Xin chào, Bếp Nhà Mơ</h1>
                <p className="dashboard-intro">Bạn đang dùng dashboard mẫu. Các thao tác chỉ thay đổi dữ liệu demo.</p>
              </div>
              <a className="merchant-heading-action" href="#demo-orders">Quản lý đơn hàng <span aria-hidden="true">→</span></a>
            </div>
            <section className="merchant-store-banner">
              <div className="merchant-store-banner-copy">
                <span className="merchant-banner-label">GIAN HÀNG MẪU</span>
                <b>Bếp Nhà Mơ</b>
              </div>
              <div className="merchant-store-banner-actions"><span className="status-badge status-active">Đang hoạt động</span></div>
              <span className="merchant-store-banner-art" aria-hidden="true">✳</span>
            </section>
            <div className="admin-stat-grid merchant-stat-grid">
              <article className="merchant-stat-card merchant-stat-products"><span className="merchant-stat-icon" aria-hidden="true">☷</span><div><small>ĐƠN ĐÃ HOÀN TẤT</small><b>{completed.length}</b><span>Đơn mẫu đã xử lý</span></div></article>
              <article className="merchant-stat-card merchant-stat-orders"><span className="merchant-stat-icon" aria-hidden="true">↗</span><div><small>ĐƠN CHỜ XÁC NHẬN</small><b>{pending}</b><span>Đơn mới cần xử lý</span></div></article>
              <article className="merchant-stat-card merchant-stat-reviews"><span className="merchant-stat-icon" aria-hidden="true">₫</span><div><small>DOANH THU MẪU</small><b>{currency.format(completed.reduce((sum, order) => sum + order.total, 0))}</b><span>Từ đơn đã hoàn tất</span></div></article>
            </div>
            <section className="merchant-demo-orders" id="demo-orders" aria-labelledby="demo-orders-title">
              <div className="merchant-demo-orders-heading">
                <h2 id="demo-orders-title">Đơn hàng</h2>
                <div>
                  <button type="button" onClick={() => { setOrders(sampleOrders); setMessage("Đã đặt lại dữ liệu mẫu."); }}>Đặt lại</button>
                  <button className="merchant-demo-primary" type="button" onClick={addOrder}>Thêm đơn mẫu</button>
                </div>
              </div>
              <p className="merchant-demo-status" role="status">{message}</p>
              <ul>
                {orders.map((order) => {
                  const next = order.status in nextSteps ? nextSteps[order.status as keyof typeof nextSteps] : null;
                  return (
                    <li key={order.id}>
                      <div><strong>#DH-{order.id}</strong><span>{order.dish} · {currency.format(order.total)}</span></div>
                      <span className="merchant-demo-badge" data-status={order.status}>{statuses[order.status]}</span>
                      {next && <button type="button" onClick={() => changeStatus(order.id, next.status)} aria-label={`${next.label} #DH-${order.id}`}>{next.label}</button>}
                      {order.status === "pending" && <button type="button" onClick={() => changeStatus(order.id, "cancelled")} aria-label={`Hủy đơn #DH-${order.id}`}>Hủy đơn</button>}
                    </li>
                  );
                })}
              </ul>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}
