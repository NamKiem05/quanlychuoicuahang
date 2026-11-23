import { redirect } from "next/navigation";
import { getMerchantContext } from "../data";
import InventoryView, { type InventoryRow, type InventoryEvent } from "./inventory-view";
import "./inventory.css";
export const metadata = { title:"Kho hàng | Quản lý cửa hàng" };
export const instant = false;
export default async function InventoryPage() {
  const { supabase, store } = await getMerchantContext();
  if (!store) redirect("/dashboard");
  const [products, variants, history] = await Promise.all([
    supabase.from("products").select("id,name,stock_quantity,low_stock_threshold,variants_enabled,status").eq("store_id",store.id).order("name"),
    supabase.from("product_variant_drafts").select("id,product_id,attributes,sku,stock_quantity").eq("store_id",store.id).order("created_at"),
    supabase.from("inventory_events").select("id,product_name,variant_attributes,sku,old_stock,new_stock,actor_id,note,created_at").eq("store_id",store.id).order("created_at",{ascending:false}).limit(50),
  ]);
  const rows: InventoryRow[] = [];
  for (const product of products.data || []) {
    if (!product.variants_enabled) rows.push({productId:product.id,variantId:null,name:product.name,attributes:"",sku:null,stock:product.stock_quantity,threshold:product.low_stock_threshold,status:product.status,draftVariant:false});
    for (const variant of (variants.data || []).filter(v => v.product_id === product.id)) rows.push({productId:product.id,variantId:variant.id,name:product.name,attributes:Object.entries(variant.attributes as Record<string,string>).map(([key,value]) => `${key}: ${value}`).join(" · "),sku:variant.sku,stock:variant.stock_quantity,threshold:product.low_stock_threshold,status:product.status,draftVariant:!product.variants_enabled});
  }
  return <InventoryView storeId={store.id} storeName={store.name} rows={rows} history={(history.data || []) as InventoryEvent[]} inventoryError={Boolean(products.error || variants.error)} historyError={Boolean(history.error)} />;
}
