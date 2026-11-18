import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import StorefrontClient, {
  type StorefrontCategory,
  type StorefrontProductOptionGroup,
  type StorefrontProduct,
  type StorefrontReview,
} from "@/app/storefront-client";
import { createClient } from "@/lib/supabase/server";
import type { OrderHours } from "@/lib/store-order-hours";
import {
  isStoreThemePreset,
  isStorefrontLayoutPreset,
  isStorefrontStyle,
  normalizeHiddenSections,
  normalizeSectionOrder,
  getStoreBannerUrls,
} from "@/lib/store-appearance";

type StorePageProps = { params: Promise<{ storeSlug: string }> };

export const instant = false;

export async function generateMetadata({ params }: StorePageProps): Promise<Metadata> {
  await connection();
  const { storeSlug } = await params;
  const supabase = await createClient();
  const { data: store } = await supabase
    .from("stores")
    .select("name, description")
    .eq("slug", storeSlug)
    .eq("status", "active")
    .maybeSingle();

  if (!store) return { title: "Không tìm thấy cửa hàng" };
  return {
    title: `${store.name} | Thực đơn trực tuyến`,
    description: store.description || `Xem thực đơn và đặt món từ ${store.name}.`,
  };
}

export default async function StorePage({ params }: StorePageProps) {
  await connection();
  const { storeSlug } = await params;
  const supabase = await createClient();

  const { data: store, error: storeError } = await supabase
    .from("stores")
    .select("id, name, slug, description, phone, address, logo_url, banner_url, theme_preset, storefront_layout, storefront_section_order, storefront_hidden_sections, accepts_orders, delivery_enabled, delivery_radius_m, delivery_fee_vnd")
    .eq("slug", storeSlug)
    .eq("status", "active")
    .maybeSingle();

  if (storeError || !store) notFound();

  const [
    categoryResult,
    { data: productRows },
    { data: reviewRows },
    { data: paymentSettings },
    { data: schedule },
    { data: styleSettings },
    { data: planAllowsOrders },
    { data: bannerSettings },
    { data: merchandiseMode },
    { data: variantRows },
  ] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name, image_url")
      .eq("store_id", store.id)
      .eq("is_active", true)
      .order("sort_order"),
    supabase
      .from("products")
      .select("id, name, description, price_vnd, category_id, image_url, stock_quantity")
      .eq("store_id", store.id)
      .eq("status", "active")
      .order("created_at", { ascending: false }),
    supabase
      .from("reviews")
      .select("id, product_id, product_name_snapshot, display_name, rating, body, created_at")
      .eq("store_id", store.id)
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("store_payment_methods")
      .select("bank_code, bank_name, account_number, account_name")
      .eq("store_id", store.id)
      .eq("is_enabled", true)
      .maybeSingle(),
    supabase.from("stores").select("order_hours").eq("id", store.id).maybeSingle(),
    supabase.from("stores").select("storefront_style").eq("id", store.id).maybeSingle(),
    supabase.rpc("merchant_plan_allows_orders", { target_store: store.id }),
    supabase.from("stores").select("banner_urls").eq("id", store.id).maybeSingle(),
    supabase.rpc("get_public_store_merchandise_mode", { target_store: store.id }),
    supabase.rpc("get_public_product_variants", { target_store: store.id }),
  ]);
  const { data: categoryRows } = categoryResult.error?.code === "42703" || categoryResult.error?.code === "PGRST204"
    ? await supabase.from("categories").select("id, name").eq("store_id", store.id).eq("is_active", true).order("sort_order")
    : categoryResult;

  const productIds = (productRows ?? []).map((product) => product.id);
  const { data: optionGroupRows } = productIds.length
    ? await supabase.from("product_option_groups").select("id, product_id, name, selection_mode, min_selections, max_selections, sort_order").in("product_id", productIds).order("sort_order")
    : { data: [] };
  const optionGroupIds = (optionGroupRows ?? []).map((group) => group.id);
  const { data: optionRows } = optionGroupIds.length
    ? await supabase.from("product_options").select("id, group_id, name, price_adjustment_vnd, sort_order").in("group_id", optionGroupIds).order("sort_order")
    : { data: [] };
  const optionsByGroupId = new Map<string, StorefrontProductOptionGroup["options"]>();
  for (const option of optionRows ?? []) {
    const groupOptions = optionsByGroupId.get(option.group_id) ?? [];
    groupOptions.push({ id: option.id, name: option.name, price_adjustment_vnd: Number(option.price_adjustment_vnd) });
    optionsByGroupId.set(option.group_id, groupOptions);
  }
  const optionGroupsByProductId = new Map<string, StorefrontProductOptionGroup[]>();
  for (const group of optionGroupRows ?? []) {
    const productGroups = optionGroupsByProductId.get(group.product_id) ?? [];
    productGroups.push({
      id: group.id,
      name: group.name,
      selection_mode: group.selection_mode === "multiple" ? "multiple" : "single",
      min_selections: group.min_selections,
      max_selections: group.max_selections,
      options: optionsByGroupId.get(group.id) ?? [],
    });
    optionGroupsByProductId.set(group.product_id, productGroups);
  }

  const categories: StorefrontCategory[] = (categoryRows ?? []).map((category) => ({
    id: category.id,
    name: category.name,
    image: "image_url" in category && typeof category.image_url === "string" ? category.image_url : null,
  }));
  const categoryNameById = new Map(categories.map((category) => [category.id, category.name]));
  const products: StorefrontProduct[] = (productRows ?? []).map((product) => ({
    id: product.id,
    name: product.name,
    description: product.description,
    price: (variantRows ?? []).some((variant: { product_id: string }) => variant.product_id === product.id)
      ? Math.min(...(variantRows ?? []).filter((variant: { product_id: string }) => variant.product_id === product.id).map((variant: { price_vnd: number }) => Number(variant.price_vnd)))
      : Number(product.price_vnd),
    category: product.category_id
      ? categoryNameById.get(product.category_id) ?? "Chưa phân loại"
      : "Chưa phân loại",
    label: "",
    image: product.image_url ?? "",
    stock_quantity: product.stock_quantity,
    optionGroups: optionGroupsByProductId.get(product.id) ?? [],
    variants: (variantRows ?? []).filter((variant: { product_id: string }) => variant.product_id === product.id).map((variant: { id: string; attributes: Record<string, string>; price_vnd: number; stock_quantity: number }) => ({ id: variant.id, attributes: variant.attributes, price: Number(variant.price_vnd), stock: variant.stock_quantity })),
  }));
  const reviews: StorefrontReview[] = (reviewRows ?? []).map((review) => ({
    id: review.id,
    productId: review.product_id,
    productName: review.product_name_snapshot,
    displayName: review.display_name,
    rating: review.rating,
    body: review.body,
    createdAt: review.created_at,
  }));

  return (
    <StorefrontClient
      store={{
        ...store,
        banner_urls: getStoreBannerUrls(bannerSettings?.banner_urls, store.banner_url),
        accepts_orders: store.accepts_orders && planAllowsOrders !== false,
        theme_preset: isStoreThemePreset(store.theme_preset) ? store.theme_preset : "green",
        storefront_layout: isStorefrontLayoutPreset(store.storefront_layout) ? store.storefront_layout : "classic",
        storefront_section_order: normalizeSectionOrder(store.storefront_section_order),
        storefront_hidden_sections: normalizeHiddenSections(store.storefront_hidden_sections),
        delivery_radius_m: Number(store.delivery_radius_m),
        delivery_fee_vnd: Number(store.delivery_fee_vnd),
        bankTransfer: paymentSettings ?? null,
        orderHours: (schedule?.order_hours ?? null) as OrderHours | null,
        storefront_style: isStorefrontStyle(styleSettings?.storefront_style) ? styleSettings.storefront_style : "original",
      }}
      merchandiseMode={merchandiseMode === "retail" ? "retail" : "general"}
      categories={categories}
      products={products}
      reviews={reviews}
      initialTimestamp={new Date().getTime()}
    />
  );
}
