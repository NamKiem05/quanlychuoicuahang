"use server";
import { revalidatePath } from "next/cache";
import { getMerchantContext } from "../data";
import { requireExpectedStore } from "@/lib/active-store";

type Result = { ok: boolean; message: string };
export async function adjustStock(form: FormData): Promise<Result> {
  const ctx = await getMerchantContext();
  if (!ctx.store) return { ok:false, message:"Không tìm thấy cửa hàng." };
  requireExpectedStore(form, ctx.store.id);
  const product = String(form.get("product_id") || ""), variant = String(form.get("variant_id") || "");
  const expected = String(form.get("expected_stock") || ""), next = String(form.get("stock") || ""), reason = String(form.get("reason") || "").trim();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(product) || (variant && !uuid.test(variant)) || !/^\d+$/.test(next) || Number(next) > 2147483647 || (expected && !/^\d+$/.test(expected)) || !reason || reason.length > 250) return { ok:false, message:"Vui lòng kiểm tra số lượng và lý do điều chỉnh." };
  const { error } = await ctx.supabase.rpc("adjust_inventory", { target_store:ctx.store.id, target_product:product, target_variant:variant || null, expected_stock:expected === "" ? null : Number(expected), new_stock:Number(next), reason });
  if (error) return { ok:false, message:error.code === "40001" ? "Tồn kho đã thay đổi. Hãy tải lại trang trước khi điều chỉnh." : "Không thể cập nhật tồn kho. Hãy kiểm tra quyền truy cập hoặc thử lại." };
  revalidatePath("/dashboard/inventory"); revalidatePath("/dashboard/menu"); revalidatePath(`/${ctx.store.slug}`);
  return { ok:true, message:"Đã cập nhật tồn kho." };
}
