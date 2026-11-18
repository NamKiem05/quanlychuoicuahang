import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getMerchantContext } from "../data";
import { AssignBrand, BrandForm, DeleteBrand, type Brand } from "./brand-forms";
import "./brands.css";

export const metadata: Metadata = { title: "Thương hiệu | Quản lý cửa hàng" };
type Product = { id: string; name: string; brand_id: string | null; status: string };

export default async function BrandsPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const [{ supabase, store, membership }, query] = await Promise.all([getMerchantContext(), searchParams]);
  if (!store) redirect("/dashboard");
  const brandsResult = await supabase.from("store_brands").select("id, name, description, logo_url").eq("store_id", store.id).order("name");
  const products: Product[] = [];
  let productError = false;
  for (let offset = 0; ; offset += 1000) {
    const result = await supabase.from("products").select("id, name, brand_id, status").eq("store_id", store.id).order("id").range(offset, offset + 999);
    if (result.error) { productError = true; break; }
    products.push(...result.data as Product[]);
    if (result.data.length < 1000) break;
  }
  const brands = (brandsResult.data ?? []) as Brand[];
  const owner = membership?.role === "owner";
  const messages: Record<string, string> = { created: "Đã thêm thương hiệu.", updated: "Đã cập nhật thương hiệu.", deleted: "Đã xóa thương hiệu.", assigned: "Đã cập nhật thương hiệu cho sản phẩm." };
  return <main className="admin-content brand-page"><header className="brand-header"><div><div className="dashboard-kicker">QUẢN LÝ CỬA HÀNG / SẢN PHẨM</div><h1>Quản lý thương hiệu</h1><p>Tạo thương hiệu và sắp xếp sản phẩm của {store.name}.</p></div><Link href="/dashboard/menu" className="brand-back">← Sản phẩm</Link></header>
    {query.message && messages[query.message] && <p className="brand-success" role="status">{messages[query.message]}</p>}
    {(brandsResult.error || productError) && <p className="brand-error" role="alert">Chưa tải được dữ liệu thương hiệu hoặc sản phẩm. Hãy kiểm tra migration 202611180018_store_brands.sql và tải lại trang.</p>}
    {!owner && <p className="brand-note">Chỉ chủ cửa hàng có thể thêm, sửa, xóa và gắn thương hiệu.</p>}
    {!brandsResult.error && !productError && <><section className="brand-summary"><div><span>Thương hiệu</span><strong>{brands.length}</strong><small>Trong cửa hàng</small></div><div><span>Sản phẩm có thương hiệu</span><strong>{products.filter((product) => product.brand_id).length}</strong><small>Bao gồm sản phẩm lưu trữ</small></div><div><span>Chưa gắn thương hiệu</span><strong>{products.filter((product) => !product.brand_id).length}</strong><small>Sản phẩm trong cửa hàng</small></div></section>
    {owner && <details className="brand-create"><summary><span>＋</span> Thêm thương hiệu mới</summary><div><BrandForm storeId={store.id} /></div></details>}
    <section className="brand-section"><div className="brand-section-heading"><div><h2>Danh sách thương hiệu</h2><p>Thông tin thương hiệu và các sản phẩm liên quan.</p></div><span>{brands.length} thương hiệu</span></div>
      {brands.length ? <div className="brand-list">{brands.map((brand) => { const members = products.filter((product) => product.brand_id === brand.id); return <article className="brand-card" key={brand.id}><div className="brand-card-head"><span className="brand-logo">{brand.logo_url ? <Image src={brand.logo_url} width={52} height={52} alt="" unoptimized /> : brand.name.charAt(0).toLocaleUpperCase("vi-VN")}</span><div><h3>{brand.name}</h3><p>{brand.description || "Chưa có mô tả"}</p></div><span className="brand-count">{members.length} sản phẩm</span></div><details className="brand-products"><summary>Danh sách sản phẩm <span>{members.length} sản phẩm</span></summary>{members.length ? <ul>{members.map((product) => <li key={product.id}><span>{product.name}{product.status === "archived" && <small> · Đã lưu trữ</small>}</span>{owner && <AssignBrand productId={product.id} brandId={product.brand_id} brands={brands} />}</li>)}</ul> : <p>Chưa có sản phẩm thuộc thương hiệu này.</p>}</details>{owner && <details className="brand-edit"><summary>Chỉnh sửa thương hiệu</summary><BrandForm storeId={store.id} brand={brand} /><DeleteBrand brand={brand} /></details>}</article>; })}</div> : <p className="brand-empty">Chưa có thương hiệu. Hãy thêm thương hiệu đầu tiên cho cửa hàng.</p>}
    </section>
    <section className="brand-section"><div className="brand-section-heading"><div><h2>Sản phẩm chưa gắn thương hiệu</h2><p>Chọn thương hiệu và lưu cho từng sản phẩm.</p></div></div>{products.filter((product) => !product.brand_id).length ? <ul className="brand-unassigned">{products.filter((product) => !product.brand_id).map((product) => <li key={product.id}><span>{product.name}{product.status === "archived" && <small> · Đã lưu trữ</small>}</span>{owner && <AssignBrand productId={product.id} brandId={null} brands={brands} />}</li>)}</ul> : <p className="brand-empty">Không có sản phẩm chưa gắn thương hiệu.</p>}</section></>}
  </main>;
}
