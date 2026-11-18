import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { updateAdminStoreProfile } from "../../../actions";
import { assignStoreCategory } from "../../category-actions";
import "../store-detail.css";

export default async function EditStore({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<{ message?: string }> }) {
  const { storeId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(storeId)) notFound();
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const [{ data: store, error }, categories, query] = await Promise.all([supabase.from("stores").select("id, name, slug, phone, address, description, business_category_id").eq("id", storeId).maybeSingle(), supabase.from("business_categories").select("id,name").order("name"), searchParams]);
  if (error) return <main className="admin-content"><p className="admin-error">Không tải được cửa hàng.</p><Link href="/admin/stores">← Danh sách cửa hàng</Link></main>;
  if (!store) notFound();
  return <main className="admin-content store-detail"><Link className="store-detail-back" href={`/admin/stores/${store.id}`}>← Chi tiết cửa hàng</Link>
    <section className="store-detail-card store-manage-card"><div className="store-detail-card-heading"><div><h1>Chỉnh sửa cửa hàng</h1><p>Cập nhật thông tin hiển thị cho khách hàng.</p></div></div>
      {query.message && <p className={query.message === "category-updated" ? "store-category-success" : "admin-error"} role={query.message === "category-updated" ? "status" : "alert"}>{query.message === "category-updated" ? "Đã cập nhật ngành hàng." : query.message === "category-invalid" ? "Hãy chọn ngành hàng hợp lệ." : query.message === "category-failed" ? "Chưa cập nhật được ngành hàng. Kiểm tra migration 202611180041." : query.message === "invalid" ? "Thông tin chưa hợp lệ. Hãy kiểm tra các trường." : "Chưa lưu được thông tin cửa hàng."}</p>}
      <form className="dashboard-form store-manage-form" action={updateAdminStoreProfile}>
        <input type="hidden" name="store_id" value={store.id} />
        <label>Tên cửa hàng<input name="name" defaultValue={store.name} required minLength={2} maxLength={120} /></label>
        <label>Đường dẫn cửa hàng<input value={`/${store.slug}`} readOnly /><span className="dashboard-help">Đường dẫn không được thay đổi tại đây.</span></label>
        <label>Số điện thoại<input type="tel" name="phone" defaultValue={store.phone ?? ""} maxLength={30} /></label>
        <label>Địa chỉ<input name="address" defaultValue={store.address ?? ""} maxLength={255} /></label>
        <label>Giới thiệu<textarea name="description" defaultValue={store.description ?? ""} maxLength={2000} rows={4} /></label>
        <div className="store-manage-buttons"><button className="secondary-submit" type="submit">Lưu thay đổi</button><Link href={`/admin/stores/${store.id}`}>Hủy</Link></div>
      </form>
    </section>
    <section className="store-detail-card store-manage-card store-category-card"><div className="store-detail-card-heading"><div><h2>Ngành hàng</h2><p>Chọn ngành để cửa hàng hiển thị giao diện phù hợp. Các cấu hình module riêng vẫn được giữ.</p></div></div>{categories.error ? <p role="alert">Chưa tải được danh mục ngành hàng.</p> : <form className="dashboard-form store-manage-form" action={assignStoreCategory}><input type="hidden" name="store_id" value={store.id} /><label>Ngành hàng<select name="category_id" required defaultValue={store.business_category_id ?? ""}><option value="" disabled>Chọn ngành hàng</option>{categories.data?.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><button className="secondary-submit" type="submit" disabled={!categories.data?.length}>Lưu ngành hàng</button></form>}</section>
  </main>;
}
