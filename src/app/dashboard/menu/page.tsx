import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createCategory } from "../actions";
import { dashboardMessages, formatPrice, getMerchantContext } from "../data";
import ProductForm from "./product-form";

export const metadata: Metadata = { title: "Thực đơn | Quản lý cửa hàng" };

export default async function MerchantMenuPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const [{ supabase, store }, query] = await Promise.all([getMerchantContext(), searchParams]);
  if (!store) redirect("/dashboard");

  const [{ data: categories }, { data: products }] = await Promise.all([
    supabase.from("categories").select("id, name, slug, sort_order").eq("store_id", store.id).order("sort_order"),
    supabase.from("products").select("id, name, slug, description, price_vnd, status, category_id, image_url, stock_quantity, created_at").eq("store_id", store.id).order("created_at", { ascending: false }),
  ]);
  const message = query.message ? dashboardMessages[query.message] : undefined;

  return (
    <main className="admin-content">
      <div className="dashboard-kicker">SẢN PHẨM VÀ DANH MỤC</div>
      <h1 className="admin-page-title">Thực đơn</h1>
      <p className="dashboard-intro">Quản lý danh mục và các món đang hiển thị trên website {store.name}.</p>
      {message && <p className="dashboard-message" role="status">{message}</p>}

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
          <p>{products?.length ?? 0} món · Có thể sửa và đổi trạng thái hiển thị</p>
        </div>
        <div className="product-admin-list">
          {products?.map((product) => (
            <article className="product-editor" key={product.id}>
              <div className="product-editor-heading">
                <div><b>{product.name}</b><span>{formatPrice(product.price_vnd)}</span></div>
                <span className={"status-badge status-" + product.status}>{product.status === "active" ? "Đang bán" : product.status === "draft" ? "Bản nháp" : "Đã ẩn"}</span>
              </div>
              <ProductForm
                storeId={store.id}
                categories={categories ?? []}
                product={{
                  id: product.id,
                  name: product.name,
                  price_vnd: product.price_vnd,
                  category_id: product.category_id,
                  status: product.status,
                  image_url: product.image_url,
                  description: product.description,
                }}
              />
            </article>
          ))}
          {!products?.length && <div className="empty-row">Chưa có món nào. Thêm món đầu tiên ở biểu mẫu bên trên.</div>}
        </div>
      </section>
    </main>
  );
}
