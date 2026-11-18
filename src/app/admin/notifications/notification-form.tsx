"use client";
import { useState } from "react";
import { sendNotification } from "./actions";

type Templates = { maintenance_title: string; maintenance_body: string; payment_title: string; payment_body: string };
export default function NotificationForm({ stores, templates }: { stores: { id: string; name: string }[]; templates: Templates | null }) {
  const [audience, setAudience] = useState("all");
  const [category, setCategory] = useState("general");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  return <form className="platform-notice-form" action={sendNotification}>
    <div className="platform-notice-grid"><label>Đối tượng<select name="audience" value={audience} onChange={(event) => setAudience(event.target.value)}><option value="all">Tất cả cửa hàng</option><option value="store">Một cửa hàng</option><option value="plan">Theo gói dịch vụ</option></select></label>
      {audience === "store" && <label>Cửa hàng<select name="store" required defaultValue=""><option value="" disabled>Chọn cửa hàng</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>}
      {audience === "plan" && <label>Gói dịch vụ<select name="plan" defaultValue="basic"><option value="basic">Cơ bản</option><option value="plus">Nâng cao</option></select></label>}
      <label>Loại thông báo<select name="category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="general">Thông báo chung</option><option value="maintenance">Bảo trì</option><option value="feature">Cập nhật tính năng</option><option value="payment">Thanh toán</option><option value="expiry">Hết hạn dịch vụ</option></select></label></div>
    {templates && (category === "maintenance" || category === "payment") && <button type="button" className="secondary-submit" onClick={() => { setTitle(category === "maintenance" ? templates.maintenance_title : templates.payment_title); setBody(category === "maintenance" ? templates.maintenance_body : templates.payment_body); }}>Dùng nội dung mẫu</button>}
    <label>Tiêu đề<input name="title" required minLength={3} maxLength={160} placeholder="Nhập tiêu đề thông báo" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
    <label>Nội dung<textarea name="body" required maxLength={4000} rows={5} placeholder="Nhập nội dung gửi tới cửa hàng" value={body} onChange={(event) => setBody(event.target.value)} /></label>
    <p>Thông báo sẽ xuất hiện trong dashboard của các cửa hàng được chọn. Danh sách nhận được chốt tại thời điểm gửi.</p>
    <button className="platform-notice-primary" type="submit">Gửi thông báo</button>
  </form>;
}
