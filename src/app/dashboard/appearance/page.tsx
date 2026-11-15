import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Toast from "@/app/toast";
import { toastVariantForMessage } from "@/lib/toast";
import {
  isStoreThemePreset,
  isStorefrontLayoutPreset,
  normalizeHiddenSections,
  normalizeSectionOrder,
} from "@/lib/store-appearance";
import { getMerchantContext } from "../data";
import AppearanceForm from "./appearance-form";

export const metadata: Metadata = { title: "Giao diện cửa hàng | Quản lý cửa hàng" };

export default async function StoreAppearancePage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const [{ supabase, membership, store }, query] = await Promise.all([getMerchantContext(), searchParams]);
  if (!store || !membership) redirect("/dashboard");
  if (membership.role !== "owner") redirect("/dashboard/store?message=owner-required");

  const { data: appearance, error } = await supabase
    .from("stores")
    .select("id, name, slug, logo_url, banner_url, theme_preset, storefront_layout, storefront_section_order, storefront_hidden_sections")
    .eq("id", store.id)
    .maybeSingle();

  if (error || !appearance) redirect("/dashboard/store?message=appearance-migration-required");
  const theme = isStoreThemePreset(appearance.theme_preset) ? appearance.theme_preset : "green";
  const layout = isStorefrontLayoutPreset(appearance.storefront_layout) ? appearance.storefront_layout : "classic";
  const messages: Record<string, string> = {
    "invalid-store-appearance": "Ảnh hoặc màu giao diện chưa hợp lệ. Hãy chọn ảnh của cửa hàng và thử lại.",
    "store-appearance-save-failed": "Chưa lưu được giao diện. Hãy kiểm tra migration 017 và 018 đã chạy trên Supabase rồi thử lại.",
    "store-appearance-image-cleanup-failed": "Đã lưu giao diện nhưng một ảnh cũ chưa được dọn khỏi kho lưu trữ.",
    "store-appearance-saved": "Đã cập nhật giao diện website cửa hàng.",
  };
  const message = query.message ? messages[query.message] : undefined;

  return (
    <main className="admin-content merchant-dashboard appearance-page">
      <div className="merchant-dashboard-heading">
        <div>
          <div className="dashboard-kicker"><span className="dashboard-live-dot" /> THƯƠNG HIỆU CỬA HÀNG</div>
          <h1 className="admin-page-title">Tùy chỉnh giao diện</h1>
          <p className="dashboard-intro">Thêm ảnh và màu sắc để website mang dấu ấn riêng của {appearance.name}.</p>
        </div>
        <a className="merchant-heading-action" href={`/${appearance.slug}`} target="_blank" rel="noreferrer">Xem website <span>↗</span></a>
      </div>
      <Toast message={message} variant={query.message ? toastVariantForMessage(query.message) : "success"} />
      <AppearanceForm
        storeId={appearance.id}
        storeName={appearance.name}
        storeSlug={appearance.slug}
        initialLogoUrl={appearance.logo_url}
        initialBannerUrl={appearance.banner_url}
        initialTheme={theme}
        initialLayout={layout}
        initialSectionOrder={normalizeSectionOrder(appearance.storefront_section_order)}
        initialHiddenSections={normalizeHiddenSections(appearance.storefront_hidden_sections)}
      />
    </main>
  );
}
