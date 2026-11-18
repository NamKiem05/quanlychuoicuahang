import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { updateAdminStoreProfile } from "../../../actions";
import "../store-detail.css";

export default async function EditStore({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<{ message?: string }> }) {
  const { storeId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(storeId)) notFound();
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const [{ data: store, error }, query] = await Promise.all([supabase.from("stores").select("id, name, slug, phone, address, description").eq("id", storeId).maybeSingle(), searchParams]);
  if (error) return <main className="admin-content"><p className="admin-error">Không tải được cửa hàng.</p><Link href="/admin/stores">← Danh sách cửa hàng</Link></main>;
  if (!store) notFound();
  return <main className="admin-content store-detail"><Link className="store-detail-back" href={`/admin/stores/${store.id}`}>← Chi tiết cửa hàng</Link>
    <section className="store-detail-card store-manage-card"><div className="store-detail-card-heading"><div><h1>Chỉnh sửa cửa hàng</h1><p>Cập nhật thông tin hiển thị cho khách hàng.</p></div></div>
      {query.message && <p className="admin-error" role="alert">{query.message === "invalid" ? "Thông tin chưa hợp lệ. Hãy kiểm tra các trường." : "Chưa lưu được thông tin cửa hàng."}</p>}
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
  </main>;
}
