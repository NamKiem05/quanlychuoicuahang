export const environments = {
  simulation: "Mô phỏng nội bộ",
  sandbox: "Thử nghiệm (GHN Staging)",
  production: "Production",
} as const;

export const connectionLabels = {
  not_configured: "Chưa cấu hình",
  verified: "Đã xác minh",
  failed: "Kiểm tra thất bại",
  running: "Đang kiểm tra",
  superseded: "Cấu hình đã thay đổi",
} as const;

export const checkErrors: Record<string, string> = {
  CHECK_DISABLED: "Chưa cho phép máy chủ gọi GHN Staging.",
  UNSUPPORTED: "Môi trường hoặc nhà cung cấp chưa hỗ trợ kiểm tra.",
  PROVIDER_DISABLED: "Nhà cung cấp đang tắt trong danh mục.",
  TOKEN_MISSING: "Chưa nhập token.",
  KEY_UNAVAILABLE: "Máy chủ thiếu phiên bản khóa mã hóa cần thiết.",
  INVALID_TOKEN: "Thông tin xác thực không hợp lệ hoặc không giải mã được.",
  SHOP_ACCESS_DENIED: "Token không có quyền truy cập Shop ID.",
  SHOP_NOT_FOUND: "Không tìm thấy Shop ID đang hoạt động.",
  PROVIDER_UNAVAILABLE: "GHN Staging chưa phản hồi hợp lệ.",
  PROVIDER_TIMEOUT: "GHN Staging phản hồi quá thời hạn. Hãy thử kiểm tra lại.",
  CHECK_EXPIRED: "Lần kiểm tra trước đã quá thời hạn.",
  CONFIG_CHANGED: "Cấu hình đã thay đổi trong lúc kiểm tra.",
};

export type ActionResult = { ok: boolean; message: string };

export type Provider = {
  code: string;
  name: string;
  logo_url: string | null;
  catalog_enabled: boolean;
  integration_enabled: boolean;
};

export type Account = {
  id: string;
  provider_code: string;
  scope: "platform" | "shop";
  store_id: string | null;
  name: string;
  environment: keyof typeof environments;
  external_shop_id: string;
  enabled: boolean;
  last_checked_at: string | null;
  connection_status: "not_configured" | "verified" | "failed";
  created_at: string;
};

export const accountMetadata = "id,provider_code,scope,store_id,name,environment,external_shop_id,enabled,last_checked_at,connection_status,created_at";

export function shippingReadError(code: string, fallback: string) {
  if (code === "42P01" || code === "PGRST205") {
    return "Supabase chưa nhận diện được bảng vận chuyển. Hãy kiểm tra đúng project và lịch sử migration Hybrid Shipping.";
  }
  if (code === "42501") {
    return "Phiên quản trị chưa có quyền đọc dữ liệu vận chuyển. Hãy kiểm tra quyền trên Supabase.";
  }
  return fallback;
}
