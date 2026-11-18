import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { savePlanDraft, changePlanDraft } from "./actions";
import "./plans.css";

type Plan = { id: string; name: string; description: string; price_vnd: number; billing_months: number; trial_days: number; product_limit: number | null; order_limit: number | null; staff_limit: number | null; storage_mb: number | null; website_limit: number | null; status: "draft" | "retired"; features: { promotions?: boolean; custom_domains?: boolean; appearance?: boolean } };
const money = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" });
const limitFields = [["product_limit", "Sản phẩm"], ["order_limit", "Đơn hàng"], ["staff_limit", "Nhân viên"], ["storage_mb", "Dung lượng (MB)"], ["website_limit", "Website"]] as const;

function PlanForm({ plan }: { plan?: Plan }) {
  return <form className="plan-form" action={savePlanDraft}>
    {plan && <input type="hidden" name="id" value={plan.id} />}
    <div className="plan-form-grid"><label>Tên gói<input name="name" required minLength={2} maxLength={100} defaultValue={plan?.name} placeholder="Ví dụ: Gói phát triển" /></label>
      <label>Giá (₫)<input type="number" name="price_vnd" min="0" max="2147483647" required defaultValue={plan?.price_vnd ?? 0} /></label>
      <label>Chu kỳ thanh toán (tháng)<input type="number" name="billing_months" min="1" max="36" required defaultValue={plan?.billing_months ?? 1} /></label>
      <label>Dùng thử (ngày)<input type="number" name="trial_days" min="0" max="365" required defaultValue={plan?.trial_days ?? 0} /></label>
    </div>
    <label>Mô tả<textarea name="description" maxLength={1000} rows={2} defaultValue={plan?.description} placeholder="Mô tả ngắn về gói dịch vụ" /></label>
    <h4>Giới hạn dự kiến</h4><p>Để trống nếu không giới hạn. Đơn hàng và dung lượng cần quy định kỳ tính trước khi áp dụng.</p>
    <div className="plan-form-grid">{limitFields.map(([key, label]) => <label key={key}>{label}<input type="number" name={key} min="0" max="10000000" defaultValue={plan?.[key] ?? ""} placeholder="Không giới hạn" /></label>)}</div>
    <h4>Tính năng dự kiến</h4><div className="plan-feature-checks"><label><input type="checkbox" name="feature_promotions" defaultChecked={plan?.features?.promotions} /> Mã khuyến mãi</label><label><input type="checkbox" name="feature_domains" defaultChecked={plan?.features?.custom_domains} /> Tên miền riêng</label><label><input type="checkbox" name="feature_appearance" defaultChecked={plan?.features?.appearance} /> Chỉnh sửa giao diện</label></div>
    <button className="plan-primary-button" type="submit">{plan ? "Lưu thay đổi" : "Tạo bản nháp"}</button>
  </form>;
}

export default async function AdminPlans({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const [result, query] = await Promise.all([supabase.from("service_plan_drafts").select("id, name, description, price_vnd, billing_months, trial_days, product_limit, order_limit, staff_limit, storage_mb, website_limit, status, features").order("created_at", { ascending: false }), searchParams]);
  const plans = (result.data ?? []) as Plan[];
  const notices: Record<string, string> = { saved: "Đã lưu bản nháp gói.", changed: "Đã cập nhật bản nháp.", invalid: "Thông tin chưa hợp lệ. Hãy kiểm tra lại.", failed: "Không lưu được bản nháp. Hãy kiểm tra cơ sở dữ liệu." };
  return <main className="admin-content plans-page">
    <header className="plans-heading"><span aria-hidden="true">◇</span><div><div className="dashboard-kicker">QUẢN LÝ KINH DOANH</div><h1 className="admin-page-title">Gói dịch vụ</h1><p>Thiết kế cấu hình gói và theo dõi các phương án dịch vụ.</p></div></header>
    <div className="plans-notice"><strong>Cấu hình bản nháp</strong><p>Gói tại đây chưa được bán và chưa áp dụng giá, thời gian dùng thử, giới hạn hay quyền tính năng. Hai gói Cơ bản và Nâng cao hiện vẫn vận hành theo cấu hình thanh toán hiện có.</p></div>
    {query.message && <p className={query.message === "saved" || query.message === "changed" ? "plans-success" : "admin-error"} role="status">{notices[query.message]}</p>}
    {result.error && <p className="admin-error" role="alert">Chưa tải được bản nháp. Cần chạy migration 202611180005_service_plan_drafts.sql.</p>}
    <section className="plans-live"><div><h2>Gói đang cung cấp</h2><p>Cấu hình hiện tại của hệ thống thanh toán</p></div><div className="plans-live-list"><span>Cơ bản <b>49.000 ₫ / tháng</b></span><span>Nâng cao <b>99.000 ₫ / tháng</b></span></div></section>
    <div className="plans-section-heading"><div><h2>Bản nháp gói</h2><p>{plans.length} cấu hình · Không ảnh hưởng gói đang sử dụng</p></div><a href="#new-plan" className="plan-primary-button">+ Tạo gói</a></div>
    {plans.length ? <div className="plans-grid">{plans.map((plan) => <article className="plan-card" key={plan.id}>
      <header><div><span className="plan-card-icon">◇</span><h3>{plan.name}</h3></div><span className={`plan-status is-${plan.status}`}>{plan.status === "draft" ? "Bản nháp" : "Đã ngừng"}</span></header>
      <p>{plan.description || "Chưa có mô tả."}</p><strong className="plan-price">{money.format(plan.price_vnd)} <small>/ {plan.billing_months} tháng</small></strong>
      <p>Dùng thử {plan.trial_days} ngày</p><ul>{limitFields.map(([key, label]) => <li key={key}><span>{label}</span><b>{plan[key] === null ? "Không giới hạn" : Number(plan[key]).toLocaleString("vi-VN")}</b></li>)}</ul>
      <details className="plan-edit"><summary>Chỉnh sửa cấu hình</summary><PlanForm plan={plan} /></details>
      <div className="plan-card-actions"><form action={changePlanDraft}><input type="hidden" name="id" value={plan.id} /><button name="operation" value={plan.status === "draft" ? "retire" : "restore"} type="submit">{plan.status === "draft" ? "Ngừng bản nháp" : "Khôi phục"}</button></form><details><summary className="plan-delete">Xóa bản nháp</summary><form action={changePlanDraft}><input type="hidden" name="id" value={plan.id} /><label><input type="checkbox" name="confirm_delete" value="yes" required /> Xác nhận xóa bản nháp</label><button className="plan-delete" name="operation" value="delete" type="submit">Xác nhận xóa</button></form></details></div>
    </article>)}</div> : <div className="plans-empty">Chưa có bản nháp nào. Tạo một gói để bắt đầu thiết kế.</div>}
    <section className="plans-create" id="new-plan"><div><h2>Tạo gói dịch vụ</h2><p>Thiết lập cấu hình dự kiến cho gói mới.</p></div><PlanForm /></section>
  </main>;
}
