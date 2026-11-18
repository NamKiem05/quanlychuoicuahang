"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getMerchantContext } from "../data";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { requireExpectedStore } from "@/lib/active-store";

async function ownerContext(formData: FormData) {
  const context = await getMerchantContext();
  if (!context.store || context.membership?.role !== "owner") return null;
  requireExpectedStore(formData, context.store.id);
  return { supabase: context.supabase, store: context.store };
}

function validLogo(url: string, storeId: string) {
  const prefix = `${getSupabaseEnv().url.replace(/\/$/, "")}/storage/v1/object/public/product-images/${storeId}/`;
  return url.startsWith(prefix) && /^brand-[0-9a-f-]{36}\.(jpg|png|webp)$/.test(url.slice(prefix.length));
}

export async function saveBrand(id: string | null, _previous: string | null, formData: FormData): Promise<string | null> {
  const context = await ownerContext(formData);
  if (!context) return "Chỉ chủ cửa hàng có thể quản lý thương hiệu.";
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const logo = String(formData.get("image_url") ?? "").trim();
  if (!name || name.length > 100 || description.length > 2000) return "Hãy nhập tên hợp lệ và mô tả tối đa 2.000 ký tự.";
  if (logo && !validLogo(logo, context.store.id)) return "Logo không hợp lệ. Hãy tải ảnh từ thiết bị của bạn.";
  const fields = { name, description, logo_url: logo || null };
  const query = id ? context.supabase.from("store_brands").update(fields).eq("store_id", context.store.id).eq("id", id) : context.supabase.from("store_brands").insert({ store_id: context.store.id, ...fields });
  const { data, error } = await query.select("id").maybeSingle();
  if (error?.code === "23505") return "Tên thương hiệu đã tồn tại trong cửa hàng.";
  if (error || !data) return "Chưa lưu được thương hiệu. Hãy kiểm tra cơ sở dữ liệu và thử lại.";
  revalidatePath("/dashboard/brands");
  redirect(`/dashboard/brands?message=${id ? "updated" : "created"}`);
}

export async function deleteBrand(id: string, _previous: string | null, formData: FormData): Promise<string | null> {
  void _previous;
  const context = await ownerContext(formData);
  if (!context) return "Chỉ chủ cửa hàng có thể xóa thương hiệu.";
  const { data, error } = await context.supabase.from("store_brands").delete().eq("store_id", context.store.id).eq("id", id).select("id").maybeSingle();
  if (error?.code === "23503") return "Thương hiệu vẫn còn sản phẩm. Hãy chuyển hoặc bỏ thương hiệu của các sản phẩm trước khi xóa.";
  if (error || !data) return "Chưa xóa được thương hiệu. Vui lòng thử lại.";
  revalidatePath("/dashboard/brands");
  redirect("/dashboard/brands?message=deleted");
}

export async function assignBrand(_previous: string | null, formData: FormData): Promise<string | null> {
  const context = await ownerContext(formData);
  if (!context) return "Chỉ chủ cửa hàng có thể cập nhật thương hiệu sản phẩm.";
  const productId = String(formData.get("product_id") ?? "");
  const brandId = String(formData.get("brand_id") ?? "");
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(productId) || (brandId && !uuid.test(brandId))) return "Sản phẩm hoặc thương hiệu không hợp lệ.";
  const { data, error } = await context.supabase.from("products").update({ brand_id: brandId || null }).eq("store_id", context.store.id).eq("id", productId).select("id").maybeSingle();
  if (error || !data) return "Chưa cập nhật được thương hiệu sản phẩm. Vui lòng thử lại.";
  revalidatePath("/dashboard/brands");
  revalidatePath("/dashboard/menu");
  redirect("/dashboard/brands?message=assigned");
}
