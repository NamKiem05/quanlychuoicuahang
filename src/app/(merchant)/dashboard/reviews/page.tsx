import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { updateReviewStatus } from "../actions";
import { dashboardMessages, getMerchantContext, reviewStatusLabels } from "../data";
import Toast from "@/components/ui/toast";
import { toastVariantForMessage } from "@/lib/toast";

export const metadata: Metadata = { title: "Đánh giá | Quản lý cửa hàng" };

export default async function MerchantReviewsPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const [{ supabase, store }, query] = await Promise.all([getMerchantContext(), searchParams]);
  if (!store) redirect("/dashboard");

  const { data: reviews } = await supabase.from("reviews")
    .select("id, order_item_id, display_name, rating, body, status, created_at")
    .eq("store_id", store.id).order("created_at", { ascending: false }).limit(100);
  const { data: reviewItems } = reviews?.length
    ? await supabase.from("order_items").select("id, product_name_snapshot").eq("store_id", store.id).in("id", reviews.map((review) => review.order_item_id))
    : { data: [] };
  const message = query.message ? dashboardMessages[query.message] : undefined;

  return (
    <main className="admin-content">
      <div className="dashboard-kicker">PHẢN HỒI KHÁCH HÀNG</div>
      <h1 className="admin-page-title">Đánh giá</h1>
      <p className="dashboard-intro">Duyệt đánh giá và theo dõi phản hồi về sản phẩm của cửa hàng.</p>
      <Toast message={message} variant={query.message ? toastVariantForMessage(query.message) : "success"} />
      <section className="dashboard-card review-admin-card merchant-page-card">
        <div className="dashboard-card-heading">
          <div><span className="card-number">★</span><h2>Đánh giá của khách</h2></div>
          <p>{reviews?.length ?? 0} đánh giá gần đây</p>
        </div>
        <div className="review-admin-list">
          {reviews?.map((review) => {
            const reviewItem = reviewItems?.find((item) => item.id === review.order_item_id);
            const actions = review.status === "published"
              ? [{ label: "Ẩn đánh giá", status: "hidden" }]
              : review.status === "hidden"
                ? [{ label: "Đăng đánh giá", status: "published" }]
                : [{ label: "Duyệt và đăng", status: "published" }, { label: "Ẩn", status: "hidden" }];
            return (
              <article className="review-admin-row" key={review.id}>
                <div className="review-admin-top">
                  <div><b>{reviewItem?.product_name_snapshot ?? "Sản phẩm đã đặt"}</b><span>{review.display_name} · {new Date(review.created_at).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</span></div>
                  <span className={"status-badge status-" + review.status}>{reviewStatusLabels[review.status] ?? review.status}</span>
                </div>
                <div className="review-admin-stars" aria-label={review.rating + " trên 5 sao"}>{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</div>
                <p className="review-admin-body">{review.body || "Khách chỉ chấm sao."}</p>
                <div className="review-admin-actions">
                  {actions.map((action) => (
                    <form action={updateReviewStatus} key={action.status}>
                      <input type="hidden" name="review_id" value={review.id} />
                      <button className="order-action" type="submit" name="status" value={action.status}>{action.label}</button>
                    </form>
                  ))}
                </div>
              </article>
            );
          })}
          {!reviews?.length && <div className="empty-row">Chưa có đánh giá. Đánh giá từ đơn đã hoàn tất sẽ xuất hiện tại đây.</div>}
        </div>
      </section>
    </main>
  );
}
