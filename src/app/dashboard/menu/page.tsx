import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createCategory } from "../actions";
import { dashboardMessages, formatPrice, getMerchantContext } from "../data";
import ProductForm from "./product-form";
import ProductAdminList from "./product-admin-list";
import Toast from "@/app/toast";
import { toastVariantForMessage } from "@/lib/toast";

export const metadata: Metadata = { title: "Thực đơn | Quản lý cửa hàng" };

export default async function MerchantMenuPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const [{ supabase, store }, query] = await Promise.all([getMerchantContext(), searchParams]);
  if (!store) redirect("/dashboard");

  const [{ data: categories }, { data: products }] = await Promise.all([
    supabase.from("categories").select("id, name, slug, sort_order").eq("store_id", store.id).order("sort_order"),
    supabase.from("products").select("id, name, slug, description, price_vnd, status, category_id, image_url, stock_quantity, created_at").eq("store_id", store.id).order("created_at", { ascending: false }),
  ]);
  const productIds = (products ?? []).map((product) => product.id);
  const { data: optionGroupRows } = productIds.length
    ? await supabase.from("product_option_groups").select("id, product_id, name, selection_mode, min_selections, max_selections, sort_order").in("product_id", productIds).order("sort_order")
    : { data: [] };
  const optionGroupIds = (optionGroupRows ?? []).map((group) => group.id);
  const { data: optionRows } = optionGroupIds.length
    ? await supabase.from("product_options").select("id, group_id, name, price_adjustment_vnd, sort_order").in("group_id", optionGroupIds).order("sort_order")
    : { data: [] };
  const optionsByGroupId = new Map<string, { id: string; name: string; price_adjustment_vnd: number }[]>();
  for (const option of optionRows ?? []) {
    const groupOptions = optionsByGroupId.get(option.group_id) ?? [];
    groupOptions.push({ id: option.id, name: option.name, price_adjustment_vnd: Number(option.price_adjustment_vnd) });
    optionsByGroupId.set(option.group_id, groupOptions);
  }
  const optionGroupsByProductId = new Map<string, {
    id: string;
    name: string;
    selection_mode: "single" | "multiple";
    min_selections: number;
    max_selections: number;
    options: { id: string; name: string; price_adjustment_vnd: number }[];
  }[]>();
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
  const message = query.message ? dashboardMessages[query.message] : undefined;

  return (
    <main className="admin-content">
      <div className="dashboard-kicker">SẢN PHẨM VÀ DANH MỤC</div>
      <h1 className="admin-page-title">Thực đơn</h1>
      <p className="dashboard-intro">Quản lý danh mục và các món đang hiển thị trên website {store.name}.</p>
      <Toast message={message} variant={query.message ? toastVariantForMessage(query.message) : "success"} />

      <div className="dashboard-columns merchant-menu-forms">
        <section className="dashboard-card">
          <div className="dashboard-card-heading">
            <div><span className="card-number">01</span><h2>Danh mục</h2></div>
            <p>Nhóm món để khách dễ tìm.</p>
          </div>
          <form className="dashboard-form compact-form" action={createCategory}>
            <label>Tên danh mục<input name="name" required maxLength={100} placeholder="Ví dụ: Món chính" /></label>
            <button className="secondary-submit" type="submit">+ Thêm danh mục</button>
          </form>
          <ul className="category-admin-list">
            {categories?.map((category) => <li key={category.id}><span>{category.name}</span><small>/{category.slug}</small></li>)}
            {!categories?.length && <li className="empty-row">Chưa có danh mục.</li>}
          </ul>
        </section>

        <section className="dashboard-card">
          <div className="dashboard-card-heading">
            <div><span className="card-number">02</span><h2>Thêm món ăn</h2></div>
            <p>Nhập món mới vào thực đơn.</p>
          </div>
          <ProductForm storeId={store.id} categories={categories ?? []} />
        </section>
      </div>

      <section className="dashboard-card product-admin-card merchant-page-card">
        <div className="dashboard-card-heading">
          <div><span className="card-number">03</span><h2>Danh sách món</h2></div>
          <p>{products?.length ?? 0} món · Chọn một món để chỉnh sửa hoặc quản lý</p>
        </div>
        <ProductAdminList
          storeId={store.id}
          categories={(categories ?? []).map((category) => ({ id: category.id, name: category.name }))}
          products={(products ?? []).map((product) => ({
            id: product.id,
            name: product.name,
            price_vnd: product.price_vnd,
            category_id: product.category_id,
            status: product.status,
            image_url: product.image_url,
            description: product.description,
            stock_quantity: product.stock_quantity,
            optionGroups: optionGroupsByProductId.get(product.id) ?? [],
          }))}
        />
      </section>
    </main>
  );
}
