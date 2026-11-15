import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function getMerchantContext() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub;

  if (!userId) redirect("/login");

  const { data: membership } = await supabase
    .from("store_members")
    .select("store_id, role")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const { data: store } = membership
    ? await supabase
        .from("stores")
        .select("id, name, slug, status, phone, address, accepts_orders, delivery_enabled, delivery_radius_m, delivery_fee_vnd")
        .eq("id", membership.store_id)
        .maybeSingle()
    : { data: null };

  return { supabase, userId, membership, store };
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
  "invalid-store": "Hãy nhập tên cửa hàng và địa chỉ trang hợp lệ.",
  "invalid-store-profile": "Hãy nhập tên cửa hàng từ 2 đến 120 ký tự và đường dẫn hợp lệ.",
  "store-slug-taken": "Đường dẫn này đã được cửa hàng khác sử dụng. Hãy chọn đường dẫn khác.",
  "store-profile-update-failed": "Chưa lưu được thông tin cửa hàng. Hãy kiểm tra đường dẫn rồi thử lại.",
  "store-profile-updated": "Đã lưu thông tin cửa hàng.",
  "invalid-store-order-setting": "Trạng thái nhận đơn không hợp lệ.",
  "store-order-setting-failed": "Chưa thay đổi được trạng thái nhận đơn. Hãy tải lại trang rồi thử lại.",
  "store-orders-enabled": "Cửa hàng đã mở nhận đơn trở lại.",
  "store-orders-paused": "Cửa hàng đã tạm ngưng nhận đơn.",
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
  "invalid-product": "Hãy nhập tên món và giá tiền hợp lệ.",
  "invalid-product-image": "Ảnh không hợp lệ. Hãy chọn ảnh JPG, PNG hoặc WebP tối đa 5 MB.",
  "product-create-failed": "Chưa thêm được món. Có thể tên món đã tồn tại.",
  "product-created": "Đã thêm món vào danh sách.",
  "invalid-product-update": "Thông tin món chưa hợp lệ. Kiểm tra tên, giá, mô tả và trạng thái.",
  "product-update-failed": "Chưa lưu được món. Tên đường dẫn có thể đã được dùng.",
  "product-updated": "Đã lưu thay đổi món ăn.",
  "product-updated-image-cleanup-failed": "Đã lưu món nhưng chưa dọn được ảnh cũ khỏi kho. Bạn có thể tiếp tục sử dụng món như bình thường.",
  "invalid-order-status": "Trạng thái đơn hàng không hợp lệ.",
  "order-status-failed": "Chưa cập nhật được đơn. Có thể trạng thái đã đổi ở nơi khác.",
  "order-status-updated": "Đã cập nhật trạng thái đơn hàng.",
  "order-status-updated-email-failed": "Đã cập nhật đơn hàng nhưng chưa gửi được email cho khách. Hãy kiểm tra email của đơn và cấu hình Gmail.",
  "payment-confirmation-failed": "Chưa xác nhận được khoản chuyển. Có thể đơn đã đổi trạng thái hoặc không còn chờ thanh toán.",
  "payment-confirmed": "Đã xác nhận cửa hàng nhận được tiền cho đơn hàng.",
  "payment-confirmed-email-failed": "Đã xác nhận thanh toán nhưng chưa gửi được email cho khách. Hãy kiểm tra email của đơn và cấu hình Gmail.",
  "invalid-review-status": "Trạng thái đánh giá không hợp lệ.",
  "review-status-failed": "Chưa cập nhật được đánh giá. Hãy tải lại trang rồi thử lại.",
  "review-status-updated": "Đã cập nhật trạng thái đánh giá.",
  "verification-failed": "Liên kết xác nhận không hợp lệ hoặc đã hết hạn. Hãy thử đăng nhập lại.",
};
