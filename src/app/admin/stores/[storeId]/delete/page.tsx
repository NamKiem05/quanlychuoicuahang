import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { deleteAdminStore } from "../../../actions";
import "../store-detail.css";

export default async function DeleteStore({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<{ message?: string }> }) {
  const { storeId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(storeId)) notFound();
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const [{ data: store, error }, query] = await Promise.all([supabase.from("stores").select("id, name, slug").eq("id", storeId).maybeSingle(), searchParams]);
  if (error) return <main className="admin-content"><p className="admin-error">Không tải được cửa hàng.</p><Link href="/admin/stores">← Danh sách cửa hàng</Link></main>;
  if (!store) notFound();
  const errors: Record<string, string> = { "has-records": "Không thể xóa cửa hàng đã có đơn hàng, đánh giá hoặc dữ liệu liên quan cần lưu giữ.", confirmation: "Tên xác nhận không khớp.", failed: "Chưa xóa được cửa hàng. Kiểm tra migration quản lý cửa hàng và dữ liệu liên quan." };
  return <main className="admin-content store-detail"><Link className="store-detail-back" href={`/admin/stores/${store.id}`}>← Chi tiết cửa hàng</Link>
    <section className="store-detail-card store-manage-card"><div className="store-detail-card-heading"><div><h1>Xóa cửa hàng</h1><p>Xác nhận thao tác với {store.name} (/{store.slug}).</p></div></div>
      <p className="store-delete-notice">Thao tác này xóa cửa hàng cùng dữ liệu phụ thuộc và không thể hoàn tác. Cửa hàng có đơn hàng hoặc đánh giá sẽ không thể xóa. Ảnh đã tải lên kho lưu trữ không tự động bị xóa.</p>
      {query.message && <p className="admin-error" role="alert">{errors[query.message] ?? errors.failed}</p>}
      <form className="dashboard-form store-manage-form" action={deleteAdminStore}><input type="hidden" name="store_id" value={store.id} />
        <label>Nhập chính xác tên cửa hàng để xác nhận<input name="confirmation_name" required autoComplete="off" /></label>
        <div className="store-manage-buttons"><button className="store-delete-button" type="submit">Xác nhận xóa cửa hàng</button><Link href={`/admin/stores/${store.id}`}>Hủy</Link></div>
      </form>
    </section>
  </main>;
}
