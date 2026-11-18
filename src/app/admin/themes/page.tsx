import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { storefrontStyles } from "@/lib/store-appearance";
import { saveTemplate, deleteTemplate } from "./actions";
import "./themes.css";

type Template = { id: string; name: string; description: string; category: string; base_style: string; required_plan: string; preview_url: string | null; is_enabled: boolean; is_featured: boolean };
function TemplateForm({ template }: { template?: Template }) {
  return <form className="theme-form" action={saveTemplate}>{template && <input type="hidden" name="id" value={template.id} />}
    <div className="theme-form-grid"><label>Tên mẫu<input name="name" minLength={2} maxLength={100} required defaultValue={template?.name} placeholder="Ví dụ: Quán hiện đại" /></label>
      <label>Phân loại<input name="category" maxLength={80} defaultValue={template?.category} placeholder="Ví dụ: Nhà hàng" /></label>
      <label>Kiểu giao diện cơ sở<select name="base_style" defaultValue={template?.base_style ?? "original"}>{storefrontStyles.map((style) => <option key={style.id} value={style.id}>{style.label}</option>)}</select></label>
      <label>Gói dự kiến<select name="required_plan" defaultValue={template?.required_plan ?? "plus"}><option value="basic">Cơ bản</option><option value="plus">Nâng cao</option></select></label>
    </div>
    <label>Mô tả<textarea name="description" rows={2} maxLength={1000} defaultValue={template?.description} /></label>
    <label>Đường dẫn ảnh xem trước (HTTPS)<input name="preview_url" type="url" maxLength={2048} defaultValue={template?.preview_url ?? ""} placeholder="https://..." /><small>Dùng ảnh đã lưu trên một địa chỉ HTTPS. Để trống nếu chưa có ảnh.</small></label>
    <div className="theme-checks"><label><input type="checkbox" name="is_enabled" defaultChecked={template?.is_enabled ?? false} /> Bật trong danh mục</label><label><input type="checkbox" name="is_featured" defaultChecked={template?.is_featured ?? false} /> Mẫu nổi bật</label></div>
    <button type="submit" className="theme-primary">{template ? "Lưu thay đổi" : "Tạo mẫu"}</button>
  </form>;
}

export default async function ThemesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; message?: string }> }) {
  const [supabase, query] = await Promise.all([createClient(), searchParams]);
  await requirePlatformAdminAccess(supabase);
  const search = typeof query.q === "string" ? query.q.trim().replace(/[^\p{L}\p{N}\s.-]/gu, "").slice(0, 80) : "";
  const status = query.status === "enabled" || query.status === "disabled" ? query.status : "";
  let request = supabase.from("storefront_template_catalog").select("id, name, description, category, base_style, required_plan, preview_url, is_enabled, is_featured").order("is_featured", { ascending: false }).order("created_at", { ascending: false });
  if (search) request = request.or(`name.ilike.%${search}%,category.ilike.%${search}%`);
  if (status) request = request.eq("is_enabled", status === "enabled");
  const result = await request;
  const templates = (result.data ?? []) as Template[];
  const messages: Record<string, string> = { saved: "Đã lưu mẫu trong danh mục.", deleted: "Đã xóa mẫu khỏi danh mục.", invalid: "Thông tin chưa hợp lệ. Ảnh xem trước cần dùng HTTPS.", failed: "Chưa lưu được mẫu. Kiểm tra quyền và cơ sở dữ liệu." };
  return <main className="admin-content themes-page"><header className="themes-heading"><span aria-hidden="true">◈</span><div><div className="dashboard-kicker">QUẢN LÝ NỀN TẢNG</div><h1 className="admin-page-title">Giao diện mẫu</h1><p>Quản lý danh mục mẫu giao diện cho cửa hàng.</p></div><a className="theme-primary" href="#create-template">+ Tạo mẫu</a></header>
    <div className="themes-note"><strong>Danh mục quản trị</strong><p>Mẫu dùng một trong bốn kiểu giao diện có sẵn. Bật/tắt, nổi bật và gói dự kiến hiện chỉ được lưu tại đây; chưa điều khiển danh sách hoặc quyền chọn của cửa hàng.</p></div>
    {query.message && <p className={query.message === "saved" || query.message === "deleted" ? "themes-success" : "admin-error"} role="status">{messages[query.message]}</p>}
    {result.error && <p className="admin-error" role="alert">Chưa tải được danh mục. Cần chạy migration 202611180007_storefront_template_catalog.sql.</p>}
    <form className="themes-filters" method="get"><label>Tìm mẫu hoặc phân loại<input name="q" type="search" defaultValue={search} maxLength={80} placeholder="Tên mẫu, phân loại..." /></label><label>Trạng thái<select name="status" defaultValue={status}><option value="">Tất cả</option><option value="enabled">Đang bật</option><option value="disabled">Đang tắt</option></select></label><button type="submit">Tìm kiếm</button>{(search || status) && <Link href="/admin/themes">Xóa lọc</Link>}</form>
    <div className="themes-list-heading"><div><h2>Danh sách mẫu</h2><p>{result.error ? "Chưa tải được" : `${templates.length} mẫu đang hiển thị`}</p></div></div>
    {templates.length ? <div className="themes-grid">{templates.map((template) => <article className="theme-card" key={template.id}>
      <div className={`theme-preview is-${template.base_style}`}>{template.preview_url ? <Image src={template.preview_url} alt={`Ảnh xem trước ${template.name}`} width={640} height={360} unoptimized /> : <div className="theme-placeholder"><span>◈</span><b>Xem trước giao diện</b><small>{storefrontStyles.find((style) => style.id === template.base_style)?.label}</small></div>}</div>
      <div className="theme-card-body"><div className="theme-card-title"><h3>{template.name}</h3><span className={template.is_enabled ? "is-enabled" : ""}>{template.is_enabled ? "Đang bật" : "Đã tắt"}</span></div>
        <p>{template.description || "Chưa có mô tả."}</p><div className="theme-tags"><span>{template.category || "Chưa phân loại"}</span><span>{template.required_plan === "plus" ? "Gói Nâng cao" : "Gói Cơ bản"}</span>{template.is_featured && <span>★ Nổi bật</span>}</div>
        <details className="theme-edit"><summary>Chỉnh sửa mẫu</summary><TemplateForm template={template} /></details>
        <details className="theme-delete"><summary>Xóa mẫu</summary><form action={deleteTemplate}><input type="hidden" name="id" value={template.id} /><label><input type="checkbox" name="confirm_delete" value="yes" required /> Xác nhận xóa khỏi danh mục</label><button type="submit">Xác nhận xóa</button></form></details>
      </div>
    </article>)}</div> : !result.error && <p className="themes-empty">Chưa có mẫu phù hợp.</p>}
    <section className="themes-create" id="create-template"><h2>Tạo giao diện mẫu</h2><p>Chọn kiểu cơ sở và bổ sung thông tin cho danh mục.</p><TemplateForm /></section>
  </main>;
}
