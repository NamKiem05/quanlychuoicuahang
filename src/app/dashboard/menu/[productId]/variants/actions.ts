"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getMerchantContext } from "@/app/dashboard/data";
import { readDimensions } from "@/lib/shipping/packaging";
import { requireExpectedStore } from "@/lib/active-store";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function context(form: FormData) {
  const ctx = await getMerchantContext();
  if (!ctx.store) redirect("/dashboard");
  requireExpectedStore(form, ctx.store.id);
  const product = String(form.get("product_id") ?? "");
  if (!uuid.test(product)) redirect("/dashboard/menu");
  const found = await ctx.supabase.from("products").select("id").eq("store_id", ctx.store.id).eq("id", product).maybeSingle();
  if (found.error || !found.data) redirect("/dashboard/menu");
  return { ...ctx, store: ctx.store, product };
}
function number(form: FormData, name: string, max: number) {
  const text = String(form.get(name) ?? "");
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text); return Number.isSafeInteger(value) && value <= max ? value : null;
}
function finish(product: string, message: string): never { revalidatePath(`/dashboard/menu/${product}/variants`); redirect(`/dashboard/menu/${product}/variants?message=${message}`); }
export async function createVariants(form: FormData) {
  const ctx = await context(form);
  const raw = String(form.get("attributes") ?? "").trim();
  const price = number(form, "price", 1000000000), stock = number(form, "stock", 10000000);
  const dimensions = readDimensions(form);
  if (dimensions === false) finish(ctx.product, "invalid-shipping");
  if (!raw || raw.length > 2000 || price === null || stock === null) finish(ctx.product, "invalid");
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length || lines.length > 4) finish(ctx.product, "invalid");
  let combinations: Record<string, string>[] = [{}];
  const seen = new Set<string>();
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon < 1) finish(ctx.product, "invalid");
    const name = line.slice(0, colon).trim(), values = line.slice(colon + 1).split(",").map((v) => v.trim());
    const key = name.toLocaleLowerCase("vi-VN");
    if (!name || name.length > 80 || seen.has(key) || !values.length || values.length > 20 || values.some((v) => !v || v.length > 80) || new Set(values.map((v) => v.toLocaleLowerCase("vi-VN"))).size !== values.length) finish(ctx.product, "invalid");
    seen.add(key);
    if (combinations.length * values.length > 80) finish(ctx.product, "too-many");
    combinations = combinations.flatMap((item) => values.map((value) => ({ ...item, [name]: value })));
  }
  const result = await ctx.supabase.from("product_variant_drafts").insert(combinations.map((attributes) => ({ store_id: ctx.store.id, product_id: ctx.product, attributes, price_vnd: price, stock_quantity: stock, ...(dimensions ? { shipping_dimensions: dimensions } : {}) })));
  if (result.error) finish(ctx.product, result.error.code === "23505" ? "duplicate" : "failed");
  finish(ctx.product, "created");
}
export async function updateVariant(form: FormData) {
  const ctx = await context(form), id = String(form.get("variant_id") ?? ""), sku = String(form.get("sku") ?? "").trim();
  const price = number(form, "price", 1000000000), stock = number(form, "stock", 10000000);
  const dimensions = readDimensions(form);
  if (dimensions === false) finish(ctx.product, "invalid-shipping");
  const costText = String(form.get("cost") ?? "").trim();
  const cost = costText === "" ? null : number(form, "cost", 1000000000);
  if (!uuid.test(id) || sku.length > 100 || price === null || stock === null || (costText !== "" && cost === null)) finish(ctx.product, "invalid");
  const result = await ctx.supabase.from("product_variant_drafts").update({ sku: sku || null, price_vnd: price, cost_vnd: cost, stock_quantity: stock, ...(form.has("weight_g") ? { shipping_dimensions: dimensions } : {}), updated_at: new Date().toISOString() }).eq("id", id).eq("product_id", ctx.product).eq("store_id", ctx.store.id).select("id").maybeSingle();
  if (result.error || !result.data) finish(ctx.product, result.error?.code === "23505" ? "sku-duplicate" : "failed");
  finish(ctx.product, "updated");
}
export async function deleteVariant(form: FormData) {
  const ctx = await context(form), id = String(form.get("variant_id") ?? "");
  if (!uuid.test(id)) finish(ctx.product, "invalid");
  const result = await ctx.supabase.from("product_variant_drafts").delete().eq("id", id).eq("product_id", ctx.product).eq("store_id", ctx.store.id).select("id").maybeSingle();
  if (result.error || !result.data) finish(ctx.product, "failed");
  finish(ctx.product, "deleted");
}
