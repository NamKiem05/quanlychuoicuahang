import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createPromotion, updatePromotionActive } from "../actions";
import { dashboardMessages, formatPrice, getMerchantContext } from "../data";
import Toast from "@/components/ui/toast";
import { toastVariantForMessage } from "@/lib/toast";
import { requireMerchantPremium } from "@/lib/merchant-billing";

export const metadata: Metadata = { title: "Khuyến mãi | Quản lý cửa hàng" };

function vietnamToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function formatDate(value: string | null) {
  return value ? value.split("-").reverse().join("/") : "Không giới hạn";
}

export default async function MerchantPromotionsPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const [{ supabase, store }, query] = await Promise.all([getMerchantContext(), searchParams]);
  if (!store) redirect("/dashboard");
  await requireMerchantPremium(supabase, store.id);

  const { data: promotions } = await supabase
    .from("store_promotions")
    .select("id, code, discount_type, discount_value, minimum_subtotal_vnd, starts_on, ends_on, usage_limit, usage_count, is_active, created_at")
    .eq("store_id", store.id)
    .order("created_at", { ascending: false });
  const message = query.message ? dashboardMessages[query.message] : undefined;
  const today = vietnamToday();

  return (
    <main className="admin-content">
      <div className="dashboard-kicker">ƯU ĐÃI CHO KHÁCH HÀNG</div>
      <h1 className="admin-page-title">Khuyến mãi</h1>
      <p className="dashboard-intro">Tạo mã giảm giá cho khách đặt hàng tại {store.name}. Mã và số tiền giảm được máy chủ xác thực khi tạo đơn; mã đã tạo có thể bật hoặc tắt.</p>
      <Toast message={message} variant={query.message ? toastVariantForMessage(query.message) : "success"} />

      <section className="dashboard-card promotion-create-card">
        <div className="dashboard-card-heading">
          <div><span className="card-number">01</span><h2>Tạo mã mới</h2></div>
          <p>Mã gồm 3–24 ký tự chữ, số hoặc dấu gạch ngang.</p>
        </div>
        <form action={createPromotion} className="dashboard-form promotion-create-form">
          <label>Mã khuyến mãi<input name="code" required minLength={3} maxLength={24} pattern="[A-Za-z0-9][A-Za-z0-9-]{2,23}" placeholder="Ví dụ: ANNGON20" /></label>
          <label>Hình thức giảm<select name="discount_type" defaultValue="percent"><option value="percent">Theo phần trăm</option><option value="fixed">Số tiền cố định</option></select></label>
          <label>Mức giảm<input name="discount_value" type="number" min="1" max="1000000000" step="1" required placeholder="Ví dụ: 20" /></label>
          <label>Đơn tối thiểu (₫)<input name="minimum_subtotal_vnd" type="number" min="0" max="1000000000000" step="1000" defaultValue="0" required /></label>
          <label>Bắt đầu từ<input name="starts_on" type="date" /></label>
          <label>Ngày hết hạn<input name="ends_on" type="date" /></label>
          <label>Giới hạn lượt dùng<input name="usage_limit" type="number" min="1" max="1000000" step="1" placeholder="Để trống nếu không giới hạn" /></label>
          <p className="promotion-form-help">Ngày bắt đầu để trống nghĩa là bắt đầu từ hôm nay. Mức giảm phần trăm tối đa là 100% và chỉ áp dụng trên tiền sản phẩm, không trừ phí giao hàng.</p>
          <button className="secondary-submit" type="submit">+ Tạo mã khuyến mãi</button>
        </form>
      </section>

      <section className="dashboard-card promotion-list-card merchant-page-card">
        <div className="dashboard-card-heading">
          <div><span className="card-number">02</span><h2>Mã của cửa hàng</h2></div>
          <p>{promotions?.length ?? 0} mã</p>
        </div>
        <div className="promotion-list">
          {promotions?.map((promotion) => {
            const exhausted = promotion.usage_limit !== null && promotion.usage_count >= promotion.usage_limit;
            const scheduled = promotion.starts_on > today;
            const expired = promotion.ends_on !== null && promotion.ends_on < today;
            const statusLabel = !promotion.is_active
              ? "Đã tắt"
              : exhausted
                ? "Hết lượt"
                : expired
                  ? "Hết hạn"
                  : scheduled
                    ? "Sắp bắt đầu"
                    : "Đang hoạt động";
            return (
              <article className="promotion-admin-row" key={promotion.id}>
                <div className="promotion-admin-main">
                  <div className="promotion-code-heading"><b>{promotion.code}</b><span className={`status-badge ${promotion.is_active && !exhausted && !expired ? "status-active" : "status-draft"}`}>{statusLabel}</span></div>
                  <p>{promotion.discount_type === "percent" ? `Giảm ${promotion.discount_value}%` : `Giảm ${formatPrice(Number(promotion.discount_value))}`}</p>
                  <small>Đơn tối thiểu {formatPrice(Number(promotion.minimum_subtotal_vnd))} · Dùng {promotion.usage_count}/{promotion.usage_limit ?? "∞"} lượt</small>
                  <small>Áp dụng từ {formatDate(promotion.starts_on)} đến {formatDate(promotion.ends_on)}</small>
                </div>
                <form action={updatePromotionActive}>
                  <input type="hidden" name="promotion_id" value={promotion.id} />
                  <input type="hidden" name="next_active" value={String(!promotion.is_active)} />
                  <button className="order-action" type="submit">{promotion.is_active ? "Tắt mã" : "Bật lại"}</button>
                </form>
              </article>
            );
          })}
          {!promotions?.length && <div className="empty-row">Chưa có mã giảm giá nào.</div>}
        </div>
      </section>
    </main>
  );
}
