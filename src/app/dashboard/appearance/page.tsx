import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Toast from "@/app/toast";
import { toastVariantForMessage } from "@/lib/toast";
import {
  isStoreThemePreset,
  isStorefrontLayoutPreset,
  isStorefrontStyle,
  normalizeHiddenSections,
  normalizeSectionOrder,
  getStoreBannerUrls,
} from "@/lib/store-appearance";
import { getMerchantContext } from "../data";
import { requireMerchantPremium } from "@/lib/merchant-billing";
import AppearanceForm from "./appearance-form";

export const metadata: Metadata = { title: "Giao diện cửa hàng | Quản lý cửa hàng" };

export default async function StoreAppearancePage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const [{ supabase, membership, store }, query] = await Promise.all([getMerchantContext(), searchParams]);
  if (!store || !membership) redirect("/dashboard");
  if (membership.role !== "owner") redirect("/dashboard/store?message=owner-required");
  await requireMerchantPremium(supabase, store.id);

  const [{ data: appearance, error }, styleResult, bannerResult, { data: sampleProduct }] = await Promise.all([supabase
    .from("stores")
    .select("id, name, slug, logo_url, banner_url, theme_preset, storefront_layout, storefront_section_order, storefront_hidden_sections, updated_at")
    .eq("id", store.id)
    .maybeSingle(),
    supabase.from("stores").select("storefront_style").eq("id", store.id).maybeSingle(),
    supabase.from("stores").select("banner_urls").eq("id", store.id).maybeSingle(),
    supabase.from("products").select("name, price_vnd, image_url").eq("store_id", store.id)
      .eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  if (error || !appearance) redirect("/dashboard/store?message=appearance-migration-required");
  const theme = isStoreThemePreset(appearance.theme_preset) ? appearance.theme_preset : "green";
  const layout = isStorefrontLayoutPreset(appearance.storefront_layout) ? appearance.storefront_layout : "classic";
  const messages: Record<string, string> = {
    "invalid-store-appearance": "Ảnh hoặc màu giao diện chưa hợp lệ. Hãy chọn ảnh của cửa hàng và thử lại.",
    "store-appearance-save-failed": "Chưa lưu được giao diện. Hãy kiểm tra cấu hình cơ sở dữ liệu rồi thử lại.",
    "store-appearance-image-cleanup-failed": "Đã lưu giao diện nhưng một ảnh cũ chưa được dọn khỏi kho lưu trữ.",
    "store-appearance-saved": "Đã cập nhật giao diện website cửa hàng.",
    "store-appearance-changed": "Giao diện vừa được cập nhật ở phiên khác. Hãy kiểm tra lại rồi lưu.",
    "store-banner-migration-required": "Cần chạy migration 202611180001_store_banner_slideshow.sql để lưu nhiều ảnh banner.",
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
        key={JSON.stringify([appearance, bannerResult.data])}
        storeId={appearance.id}
        storeName={appearance.name}
        storeSlug={appearance.slug}
        initialVersion={appearance.updated_at}
        initialLogoUrl={appearance.logo_url}
        initialBannerUrls={getStoreBannerUrls(bannerResult.data?.banner_urls, appearance.banner_url)}
        bannerLimit={bannerResult.error ? 1 : 3}
        initialTheme={theme}
        initialStyle={styleResult.error ? null : isStorefrontStyle(styleResult.data?.storefront_style) ? styleResult.data.storefront_style : "original"}
        sampleProduct={sampleProduct ?? null}
        initialLayout={layout}
        initialSectionOrder={normalizeSectionOrder(appearance.storefront_section_order)}
        initialHiddenSections={normalizeHiddenSections(appearance.storefront_hidden_sections)}
      />
    </main>
  );
}
