import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { updateAdminReviewStatus } from "../actions";
import Toast from "@/components/ui/toast";
import { toastVariantForMessage } from "@/lib/toast";

export const metadata: Metadata = { title: "Quản lý đánh giá | Quản trị" };

const messages: Record<string, string> = {
  "invalid-review-status": "Trạng thái đánh giá không hợp lệ.",
  "review-status-failed": "Chưa cập nhật được đánh giá. Hãy tải lại trang rồi thử lại.",
  "review-status-updated": "Đã cập nhật trạng thái đánh giá.",
};

const statusLabels: Record<string, string> = {
  pending: "Chờ duyệt",
  published: "Đã đăng",
  hidden: "Đã ẩn",
};

export default async function AdminReviewsPage({ searchParams }: PageProps<"/admin/reviews">) {
  const query = await searchParams;
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const [
    { data: reviews, error },
    { data: stores },
  ] = await Promise.all([
    supabase
      .from("reviews")
      .select("id, store_id, product_name_snapshot, display_name, rating, body, status, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("stores").select("id, name, slug"),
  ]);

  const storeNames = new Map((stores ?? []).map((store) => [store.id, store.name]));
  const reviewRows = reviews ?? [];
  const message = typeof query.message === "string" ? messages[query.message] : undefined;

  return (
    <div className="admin-content">
      <div className="dashboard-kicker">QUẢN LÝ</div>
      <h1 className="admin-page-title">Đánh giá</h1>
      <p className="dashboard-intro">Duyệt đánh giá khách hàng trước khi hiển thị trên website cửa hàng.</p>
      <Toast message={message} variant={typeof query.message === "string" ? toastVariantForMessage(query.message) : "success"} />
      {error && <p className="admin-error" role="alert">Không đọc được đánh giá. Kiểm tra migration đánh giá đã chạy chưa.</p>}

      <div className="admin-review-list">
        {reviewRows.map((review) => {
          const actions = review.status === "published"
            ? [{ label: "Ẩn đánh giá", status: "hidden" }]
            : review.status === "hidden"
              ? [{ label: "Đăng đánh giá", status: "published" }]
              : [
                  { label: "Duyệt và đăng", status: "published" },
                  { label: "Ẩn", status: "hidden" },
                ];
          return (
            <article className="review-admin-row" key={review.id}>
              <div className="review-admin-top">
                <div>
                  <b>{review.product_name_snapshot}</b>
                  <span>{review.display_name} · {storeNames.get(review.store_id) ?? "Cửa hàng"} · {new Date(review.created_at).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</span>
                </div>
                <span className={`status-badge status-${review.status}`}>{statusLabels[review.status] ?? review.status}</span>
              </div>
              <div className="review-admin-stars" aria-label={`${review.rating} trên 5 sao`}>{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</div>
              <p className="review-admin-body">{review.body || "Khách chỉ chấm sao."}</p>
              <div className="review-admin-actions">
                {actions.map((action) => (
                  <form action={updateAdminReviewStatus} key={action.status}>
                    <input type="hidden" name="review_id" value={review.id} />
                    <button className="order-action" type="submit" name="status" value={action.status}>{action.label}</button>
                  </form>
                ))}
              </div>
            </article>
          );
        })}
        {!reviewRows.length && <div className="admin-empty"><span>★</span><b>Chưa có đánh giá nào</b><p>Đánh giá mới sẽ hiện ở đây để bạn duyệt.</p></div>}
      </div>
    </div>
  );
}
