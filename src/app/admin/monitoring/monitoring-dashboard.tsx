"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Health = { checkedAt: string; database: { ok: boolean; elapsedMs: number } };
type Snapshot = { health: Health; responseMs: number };
const clock = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "medium", timeZone: "Asia/Ho_Chi_Minh" });

export default function MonitoringDashboard() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [lastFailure, setLastFailure] = useState<string | null>(null);
  const inFlight = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(false);

  const check = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const controller = new AbortController();
    abort.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    setChecking(true);
    const start = performance.now();
    try {
      const response = await fetch("/api/admin/health", { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "Phiên quản trị không còn hợp lệ. Hãy đăng nhập lại." : "API kiểm tra sức khỏe không phản hồi thành công.");
      const health = await response.json() as Health;
      const elapsed = Math.round(performance.now() - start);
      if (!health?.database || typeof health.database.ok !== "boolean" || !Number.isFinite(health.database.elapsedMs) || !Number.isFinite(Date.parse(health.checkedAt))) throw new Error("Phản hồi kiểm tra không hợp lệ.");
      if (mounted.current && abort.current === controller) { setSnapshot({ health, responseMs: elapsed }); setError(""); if (!health.database.ok) setLastFailure(new Date().toISOString()); }
    } catch (cause) {
      if (mounted.current && abort.current === controller) { setError(cause instanceof Error && cause.name !== "AbortError" ? cause.message : "Kiểm tra quá thời gian chờ hoặc không có kết nối."); setLastFailure(new Date().toISOString()); }
    } finally {
      window.clearTimeout(timeout);
      if (abort.current === controller) {
        inFlight.current = false;
        abort.current = null;
        if (mounted.current) setChecking(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const initialCheck = window.setTimeout(() => void check(), 0);
    const interval = window.setInterval(() => { if (!document.hidden) void check(); }, 60000);
    const visible = () => { if (!document.hidden) void check(); };
    document.addEventListener("visibilitychange", visible);
    return () => { mounted.current = false; window.clearTimeout(initialCheck); window.clearInterval(interval); document.removeEventListener("visibilitychange", visible); abort.current?.abort(); abort.current = null; inFlight.current = false; };
  }, [check]);

  const db = !snapshot ? "unknown" : snapshot.health.database.ok ? "ok" : "error";
  const state = error ? "error" : snapshot ? "ok" : "unknown";
  return <main className="admin-content monitoring-page"><header className="monitoring-heading"><span aria-hidden="true">◉</span><div><div className="dashboard-kicker">HỆ THỐNG</div><h1 className="admin-page-title">Giám sát hoạt động</h1><p>Kiểm tra tình trạng ứng dụng tại thời điểm hiện tại.</p></div><button type="button" onClick={() => void check()} disabled={checking}>{checking ? "Đang kiểm tra…" : "↻ Kiểm tra lại"}</button></header>
    <div className="monitoring-note"><strong>Kiểm tra theo phiên đang mở</strong><p>Dữ liệu được làm mới mỗi 60 giây khi trang đang hiển thị. Đây là kết quả kiểm tra tức thời, chưa phải giám sát liên tục hay lịch sử sự cố.</p></div>
    {error && <p className="monitoring-alert" role="alert">{error} {snapshot && "Số liệu cũ chỉ mang tính tham khảo."}</p>}
    <section className="monitoring-cards" aria-label="Trạng thái dịch vụ">
      <article className="monitor-card"><span className="monitor-icon is-blue">⌁</span><div><small>API KIỂM TRA</small><strong>{state === "ok" ? "Phản hồi" : state === "error" ? "Không phản hồi" : "Chưa kiểm tra"}</strong><p>{state === "ok" ? `${snapshot?.responseMs} ms từ trình duyệt` : "Kiểm tra endpoint giám sát"}</p></div><i className={`monitor-dot is-${state}`} aria-hidden="true" /></article>
      <article className="monitor-card"><span className="monitor-icon is-green">▤</span><div><small>DATABASE SUPABASE</small><strong>{error ? "Chưa xác định" : db === "ok" ? "Kết nối được" : db === "error" ? "Không truy vấn được" : "Chưa kiểm tra"}</strong><p>{!error && snapshot ? `${snapshot.health.database.elapsedMs} ms · truy vấn đọc` : "Truy vấn bảng cửa hàng"}</p></div><i className={`monitor-dot is-${error ? "unknown" : db}`} aria-hidden="true" /></article>
      <article className="monitor-card"><span className="monitor-icon is-violet">◷</span><div><small>LẦN KIỂM TRA</small><strong className="monitor-date">{snapshot ? clock.format(new Date(snapshot.health.checkedAt)) : "Chưa có dữ liệu"}</strong><p>Giờ Việt Nam</p></div></article>
      <article className="monitor-card"><span className="monitor-icon is-orange">!</span><div><small>LỖI TRONG PHIÊN</small><strong className="monitor-date">{lastFailure ? clock.format(new Date(lastFailure)) : "Chưa ghi nhận"}</strong><p>Chỉ tính các lần kiểm tra trang này</p></div></article>
    </section>
    <section className="monitoring-panel"><div className="monitoring-panel-heading"><div><h2>Phạm vi kiểm tra</h2><p>Chỉ số và kết nối đã có hoặc cần cấu hình thêm.</p></div></div><div className="monitoring-list">
      <div><span>API kiểm tra sức khỏe</span><b className={`monitor-label is-${state}`}>{state === "ok" ? "Đã kiểm tra" : state === "error" ? "Không phản hồi" : "Chưa kiểm tra"}</b><small>Đo thời gian từ trình duyệt đến API giám sát.</small></div>
      <div><span>Database</span><b className={`monitor-label is-${error ? "unknown" : db}`}>{error ? "Chưa xác định" : db === "ok" ? "Đã kiểm tra" : db === "error" ? "Có lỗi" : "Chưa kiểm tra"}</b><small>Kiểm tra một truy vấn đọc, không đo toàn bộ hiệu năng database.</small></div>
      <div><span>API nghiệp vụ & webhook</span><b className="monitor-label">Chưa giám sát</b><small>Chưa kiểm tra luồng đơn hàng, email hoặc webhook thanh toán.</small></div>
      <div><span>CPU, RAM, ổ cứng và băng thông</span><b className="monitor-label">Chưa kết nối</b><small>Cần dữ liệu từ dịch vụ hosting hoặc máy chủ.</small></div>
      <div><span>Redis, Queue và Cron Job</span><b className="monitor-label">Chưa cấu hình</b><small>Chưa có nguồn dữ liệu giám sát cho các thành phần này.</small></div>
      <div><span>Nhật ký lỗi & cảnh báo</span><b className="monitor-label">Chưa kết nối</b><small>Chưa có lưu trữ lịch sử lỗi hoặc cảnh báo tự động.</small></div>
    </div></section>
  </main>;
}
