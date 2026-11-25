export const themeAdminMenu = [
  { slug: "overview", label: "Tổng quan", icon: "overview" },
  { slug: "", label: "Kho giao diện", icon: "appearance" },
  { slug: "studio", label: "Theme Studio", icon: "settings" },
  { slug: "pages", label: "Quản lý trang", icon: "orders" },
  { slug: "components", label: "Thư viện Component", icon: "menu" },
  { slug: "versions", label: "Quản lý phiên bản", icon: "orders" },
  { slug: "marketplace", label: "Marketplace", icon: "store" },
  { slug: "licenses", label: "Quản lý License", icon: "lock" },
  { slug: "support", label: "Hỗ trợ giao diện", icon: "support" },
  { slug: "settings", label: "Cấu hình Theme", icon: "settings" },
] as const;
export function themeAdminPath(slug: string) { return slug ? `/admin/themes/${slug}` : "/admin/themes"; }
