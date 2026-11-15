import type { Metadata } from "next";
import { notFound } from "next/navigation";
import StorefrontClient, {
  type StorefrontCategory,
  type StorefrontProduct,
  type StorefrontReview,
} from "@/app/storefront-client";
import { createClient } from "@/lib/supabase/server";

type StorePageProps = PageProps<"/[storeSlug]">;

export async function generateMetadata({ params }: StorePageProps): Promise<Metadata> {
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
  const { storeSlug } = await params;
  const supabase = await createClient();

  const { data: store, error: storeError } = await supabase
    .from("stores")
    .select("id, name, slug, description, phone, address, logo_url, banner_url, accepts_orders, delivery_enabled, delivery_radius_m, delivery_fee_vnd")
    .eq("slug", storeSlug)
    .eq("status", "active")
    .maybeSingle();

  if (storeError || !store) notFound();

  const [
    { data: categoryRows },
    { data: productRows },
    { data: reviewRows },
    { data: paymentSettings },
  ] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name")
      .eq("store_id", store.id)
      .eq("is_active", true)
      .order("sort_order"),
    supabase
      .from("products")
      .select("id, name, description, price_vnd, category_id, image_url")
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
  ]);

  const categories: StorefrontCategory[] = (categoryRows ?? []).map((category) => ({
    id: category.id,
    name: category.name,
  }));
  const categoryNameById = new Map(categories.map((category) => [category.id, category.name]));
  const products: StorefrontProduct[] = (productRows ?? []).map((product) => ({
    id: product.id,
    name: product.name,
    description: product.description,
    price: Number(product.price_vnd),
    category: product.category_id
      ? categoryNameById.get(product.category_id) ?? "Chưa phân loại"
      : "Chưa phân loại",
    label: "",
    image: product.image_url ?? "",
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
        delivery_radius_m: Number(store.delivery_radius_m),
        delivery_fee_vnd: Number(store.delivery_fee_vnd),
        bankTransfer: paymentSettings ?? null,
      }}
      categories={categories}
      products={products}
      reviews={reviews}
    />
  );
}
