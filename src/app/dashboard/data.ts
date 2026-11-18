import { redirect } from "next/navigation";
import { requireMerchantAccount } from "@/lib/platform-account";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/active-store";

export async function getMerchantContext() {
  await connection();
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub;

  if (!userId) redirect("/login");
  await requireMerchantAccount(supabase);

  const membership = await getActiveMembership(supabase, userId);

  const storeResult = membership
    ? await supabase
        .from("stores")
        .select("id, name, slug, status, phone, address, accepts_orders, delivery_enabled, delivery_radius_m, delivery_fee_vnd")
        .eq("id", membership.store_id)
        .maybeSingle()
    : { data: null, error: null };
  if (storeResult.error || (membership && !storeResult.data)) throw new Error("Không tải được cửa hàng đã chọn.");
  const store = storeResult.data;

  const email = typeof authData.claims.email === "string" ? authData.claims.email : null;
  return { supabase, userId, email, membership, store, requestedPlan: authData.claims.user_metadata?.requested_plan };
}

export function formatPrice(price: number) {
  return `${price.toLocaleString("vi-VN")}₫`;
}

export const orderStatusLabels: Record<string, string> = {
  pending: "Chờ xác nhận",
  confirmed: "Đã xác nhận",
  preparing: "Đang chuẩn bị",
  ready: "Sẵn sàng nhận / giao",
  out_for_delivery: "Đang giao",
  completed: "Hoàn tất",
  cancelled: "Đã hủy",
  rejected: "Đã từ chối",
};

export const reviewStatusLabels: Record<string, string> = {
  pending: "Chờ duyệt",
  published: "Đã đăng",
  hidden: "Đã ẩn",
};

export const dashboardMessages: Record<string, string> = {
  "store-changed": "Cửa hàng đang làm việc đã thay đổi. Hãy kiểm tra lại thông tin trước khi thực hiện thao tác.",
  "invalid-store": "Hãy nhập tên cửa hàng và địa chỉ trang hợp lệ.",
  "invalid-store-profile": "Hãy nhập tên cửa hàng từ 2 đến 120 ký tự và đường dẫn hợp lệ.",
  "store-slug-taken": "Đường dẫn này đã được cửa hàng khác sử dụng. Hãy chọn đường dẫn khác.",
  "store-profile-update-failed": "Chưa lưu được thông tin cửa hàng. Hãy kiểm tra đường dẫn rồi thử lại.",
  "store-profile-updated": "Đã lưu thông tin cửa hàng.",
  "appearance-migration-required": "Cần chạy migration 017 và 018 trong Supabase trước khi tùy chỉnh giao diện cửa hàng.",
  "invalid-store-order-setting": "Trạng thái nhận đơn không hợp lệ.",
  "store-order-setting-failed": "Chưa thay đổi được trạng thái nhận đơn. Hãy tải lại trang rồi thử lại.",
  "store-orders-enabled": "Cửa hàng đã mở nhận đơn trở lại.",
  "store-orders-paused": "Cửa hàng đã tạm ngưng nhận đơn.",
  "invalid-store-order-hours": "Giờ mở và giờ đóng phải hợp lệ và khác nhau.",
  "store-order-hours-failed": "Chưa lưu được lịch nhận đơn. Vui lòng thử lại.",
  "store-order-hours-updated": "Đã lưu lịch nhận đơn.",
  "invalid-order-ready-estimate": "Chọn thời gian chuẩn bị là 15, 30 hoặc 45 phút.",
  "order-ready-estimate-failed": "Chưa cập nhật được giờ dự kiến. Hãy kiểm tra trạng thái đơn rồi thử lại.",
  "order-ready-estimate-updated": "Đã cập nhật giờ dự kiến sẵn sàng.",
  "invalid-payment-settings": "Thông tin ngân hàng chưa hợp lệ. Hãy kiểm tra ngân hàng, số tài khoản, tên chủ tài khoản và trạng thái.",
  "payment-settings-failed": "Chưa lưu được phương thức thanh toán. Hãy thử lại.",
  "payment-settings-updated": "Đã lưu phương thức thanh toán QR.",
  "invalid-delivery-settings": "Bán kính giao hàng phải từ 0,5 đến 20 km và phí giao hàng không được âm.",
  "delivery-location-required": "Hãy lưu tọa độ cửa hàng trước khi bật giao hàng.",
  "delivery-settings-failed": "Chưa lưu được cài đặt giao hàng. Hãy thử lại.",
  "delivery-settings-updated": "Đã lưu cài đặt giao hàng.",
  "invalid-location": "Hãy chọn vị trí cửa hàng trên bản đồ rồi lưu.",
  "location-update-failed": "Chưa cập nhật được vị trí cửa hàng.",
  "location-updated": "Đã lưu tọa độ cửa hàng.",
  "owner-required": "Chỉ chủ cửa hàng mới có thể thay đổi vị trí.",
  "store-create-failed": "Chưa tạo được cửa hàng. Tên địa chỉ có thể đã được dùng.",
  "membership-create-failed": "Cửa hàng đã tạo nhưng chưa gắn được tài khoản chủ quán. Hãy thử tải lại.",
  "store-created": "Đã tạo gian hàng ở trạng thái bản nháp.",
  "invalid-category": "Hãy nhập tên danh mục hợp lệ.",
  "category-create-failed": "Chưa tạo được danh mục. Kiểm tra tên có bị trùng không.",
  "category-created": "Đã thêm danh mục.",
  "invalid-reserved-store-slug": "Đường dẫn này dành riêng cho hệ thống. Hãy chọn đường dẫn khác.",
  "category-updated": "Đã cập nhật danh mục.",
  "category-deleted": "Đã xóa danh mục.",
  "category-image-cleanup-failed": "Đã cập nhật danh mục. Ảnh cũ chưa được dọn khỏi kho.",
  "category-delete-image-cleanup-failed": "Đã xóa danh mục. Ảnh cũ chưa được dọn khỏi kho.",
  "invalid-promotion": "Thông tin mã khuyến mãi chưa hợp lệ. Hãy kiểm tra mã, mức giảm, ngày áp dụng và giới hạn lượt dùng.",
  "promotion-create-failed": "Chưa tạo được mã. Mã này có thể đã tồn tại trong cửa hàng.",
  "promotion-created": "Đã tạo mã khuyến mãi.",
  "promotion-update-failed": "Chưa cập nhật được mã khuyến mãi. Hãy tải lại trang rồi thử lại.",
  "promotion-updated": "Đã cập nhật trạng thái mã khuyến mãi.",
  "invalid-product": "Hãy nhập tên món, giá và số lượng tồn kho hợp lệ. Để trống số lượng nếu không giới hạn.",
  "invalid-product-image": "Ảnh không hợp lệ. Hãy chọn ảnh JPG, PNG hoặc WebP tối đa 5 MB.",
  "product-create-failed": "Chưa thêm được món. Có thể tên món đã tồn tại.",
  "product-created": "Đã thêm món vào danh sách.",
  "invalid-product-update": "Thông tin món chưa hợp lệ. Kiểm tra tên, giá, số lượng tồn kho, mô tả và trạng thái.",
  "product-update-failed": "Chưa lưu được món. Tên đường dẫn có thể đã được dùng.",
  "product-updated": "Đã lưu thay đổi món ăn.",
  "invalid-product-options": "Hãy nhập tên nhóm và ít nhất 2 lựa chọn theo định dạng Tên|Giá cộng thêm.",
  "product-options-save-failed": "Chưa lưu được nhóm tùy chọn. Hãy kiểm tra dữ liệu hoặc chạy migration 016.",
  "product-options-saved": "Đã lưu nhóm tùy chọn món.",
  "product-options-limit": "Mỗi món chỉ có thể có tối đa 40 nhóm tùy chọn.",
  "product-options-delete-failed": "Chưa xóa được nhóm tùy chọn. Hãy tải lại trang rồi thử lại.",
  "product-options-deleted": "Đã xóa nhóm tùy chọn món.",
  "product-updated-image-cleanup-failed": "Đã lưu món nhưng chưa dọn được ảnh cũ khỏi kho. Bạn có thể tiếp tục sử dụng món như bình thường.",
  "product-hidden": "Đã ẩn món khỏi cửa hàng.",
  "product-shown": "Món đã được hiển thị trên cửa hàng.",
  "product-visibility-failed": "Chưa đổi được trạng thái hiển thị món. Hãy tải lại trang rồi thử lại.",
  "product-delete-failed": "Chưa xóa được món. Hãy tải lại trang rồi thử lại.",
  "product-deleted": "Đã xóa món khỏi thực đơn.",
  "product-deleted-image-cleanup-failed": "Đã xóa món nhưng chưa dọn được ảnh khỏi kho lưu trữ.",
  "invalid-order-status": "Trạng thái đơn hàng không hợp lệ.",
  "order-status-failed": "Chưa cập nhật được đơn. Có thể trạng thái đã đổi ở nơi khác.",
  "order-status-updated": "Đã cập nhật trạng thái. Email thông báo được xử lý sau nếu khách có địa chỉ email.",
  "order-notice-sent": "Đã gửi email thông báo trạng thái đơn cho khách hàng.",
  "order-notice-failed": "Chưa gửi được thông báo. Hãy kiểm tra email khách hàng, trạng thái đơn và cấu hình gửi email.",
  "order-status-updated-email-failed": "Đã cập nhật đơn hàng nhưng chưa gửi được email cho khách. Hãy kiểm tra email của đơn và cấu hình Gmail.",
  "cancellation-decision-failed": "Chưa xử lý được yêu cầu hủy. Có thể đơn đã được cập nhật ở nơi khác.",
  "cancellation-request-approved": "Đã chấp nhận yêu cầu hủy và gửi email cho khách.",
  "cancellation-request-approved-email-failed": "Đã hủy đơn nhưng chưa gửi được email cho khách. Hãy kiểm tra email của đơn và cấu hình Gmail.",
  "cancellation-request-declined": "Đã từ chối yêu cầu hủy và gửi email cho khách.",
  "cancellation-request-declined-email-failed": "Đã từ chối yêu cầu hủy nhưng chưa gửi được email cho khách.",
  "payment-confirmation-failed": "Chưa xác nhận được khoản chuyển. Có thể đơn đã đổi trạng thái hoặc không còn chờ thanh toán.",
  "payment-confirmed": "Đã xác nhận thanh toán và gửi email cho khách.",
  "payment-confirmed-email-failed": "Đã xác nhận thanh toán nhưng chưa gửi được email cho khách. Hãy kiểm tra email của đơn và cấu hình Gmail.",
  "order-refund-failed": "Chưa ghi nhận được hoàn tiền. Hãy kiểm tra trạng thái đơn và quyền chủ cửa hàng.",
  "order-refund-recorded": "Đã ghi nhận hoàn tiền cho đơn hàng.",
  "invalid-review-status": "Trạng thái đánh giá không hợp lệ.",
  "review-status-failed": "Chưa cập nhật được đánh giá. Hãy tải lại trang rồi thử lại.",
  "review-status-updated": "Đã cập nhật trạng thái đánh giá.",
  "verification-failed": "Liên kết xác nhận không hợp lệ hoặc đã hết hạn. Hãy thử đăng nhập lại.",
};
