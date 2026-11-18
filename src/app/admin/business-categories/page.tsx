import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { saveBusinessCategory, deleteBusinessCategory } from "./actions";
import { setCategoryModule } from "./module-actions";
import "./business-categories.css";

export const metadata = { title: "Danh mục ngành hàng | Quản trị" };
type Category = { id: string; name: string; slug: string; description: string; created_at: string };
const pageSize = 25;
const dateFormat = new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeZone: "Asia/Ho_Chi_Minh" });
const messages: Record<string, string> = {
  created: "Đã thêm ngành hàng.", updated: "Đã cập nhật ngành hàng.", deleted: "Đã xóa ngành hàng.",
  invalid: "Thông tin chưa hợp lệ. Tên cần có ít nhất hai ký tự và tạo được mã ngành hàng.",
  duplicate: "Tên hoặc mã ngành hàng đã tồn tại. Hãy chọn tên khác.",
  failed: "Chưa thực hiện được thao tác. Kiểm tra cơ sở dữ liệu và thử lại.",
  used: "Không thể xóa ngành hàng đang được cửa hàng sử dụng.",
  "module-updated": "Đã cập nhật module theo ngành hàng.",
  "module-failed": "Không cập nhật được module theo ngành hàng.",
};

function CategoryForm({ category }: { category?: Category }) {
  return <form className="business-category-form" action={saveBusinessCategory}>
    {category && <input type="hidden" name="id" value={category.id} />}
    <label>Tên ngành hàng<input name="name" required minLength={2} maxLength={100} defaultValue={category?.name} placeholder="Ví dụ: Quán cà phê" /></label>
    <label>Mô tả<textarea name="description" rows={2} maxLength={500} defaultValue={category?.description ?? ""} placeholder="Mô tả ngắn về ngành hàng" /></label>
    <p>Mã ngành hàng được tạo tự động từ tên và có thể thay đổi khi sửa tên.</p>
    <button type="submit" className="business-primary">{category ? "Lưu thay đổi" : "Thêm ngành hàng"}</button>
  </form>;
}

export default async function BusinessCategoriesPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; message?: string }> }) {
  const [supabase, query] = await Promise.all([createClient(), searchParams]);
  await requirePlatformAdminAccess(supabase);
  const search = typeof query.q === "string" ? query.q.trim().replace(/[^\p{L}\p{N}\s.-]/gu, "").slice(0, 80) : "";
  const page = typeof query.page === "string" && /^[1-9]\d{0,5}$/.test(query.page) ? Number(query.page) : 1;
  const start = (page - 1) * pageSize;
  let request = supabase.from("business_categories").select("id, name, slug, description, created_at", { count: "exact" }).order("name").order("id").range(start, start + pageSize - 1);
  if (search) request = request.or(`name.ilike.%${search}%,slug.ilike.%${search}%`);
  const result = await request;
  const rows = (result.data ?? []) as Category[];
  const [moduleResult, categoryModuleResult] = await Promise.all([supabase.from("platform_modules").select("code,name,default_enabled").order("name"), supabase.from("business_category_module_settings").select("category_id,module_code,enabled")]);
  const message = query.message ? messages[query.message] : undefined;
  function pageHref(next: number) { const params = new URLSearchParams({ page: String(next) }); if (search) params.set("q", search); return `/admin/business-categories?${params}`; }
  return <main className="admin-content business-categories-page">
    <header className="business-heading"><span aria-hidden="true">▦</span><div><div className="dashboard-kicker">QUẢN LÝ NỀN TẢNG</div><h1 className="admin-page-title">Danh mục ngành hàng</h1><p>Quản lý các ngành hàng của nền tảng.</p></div><a className="business-primary" href="#add-category">+ Thêm ngành hàng</a></header>
    <p className="business-note">Danh mục này dành cho toàn nền tảng và được quản lý riêng với danh mục món của từng cửa hàng. Chủ cửa hàng chọn ngành hàng khi tạo cửa hàng.</p>
    {message && <p className={["created", "updated", "deleted", "module-updated"].includes(query.message ?? "") ? "business-success" : "admin-error"} role="status">{message}</p>}
    {result.error && <p className="admin-error" role="alert">Không tải được danh mục. Cần chạy migration 202611180008_business_categories.sql và kiểm tra quyền quản trị.</p>}
    <form className="business-search" method="get"><label>Tìm ngành hàng<input type="search" name="q" maxLength={80} defaultValue={search} placeholder="Tên hoặc mã ngành hàng..." /></label><button type="submit">Tìm kiếm</button>{search && <Link href="/admin/business-categories">Xóa lọc</Link>}</form>
    <section className="business-list"><div className="business-list-heading"><div><h2>Danh sách ngành hàng</h2><p>{result.error ? "Không tải được dữ liệu" : `${(result.count ?? 0).toLocaleString("vi-VN")} kết quả`}</p></div></div>
      {result.error ? null : rows.length ? rows.map((category) => <article className="business-row" key={category.id}>
        <div className="business-row-icon" aria-hidden="true">▦</div><div className="business-row-content"><div className="business-row-title"><h3>{category.name}</h3><code>{category.slug}</code></div><p>{category.description || "Chưa có mô tả."}</p><small>Ngày tạo {dateFormat.format(new Date(category.created_at))}</small>
          <details className="business-edit"><summary>Module theo ngành hàng</summary>{moduleResult.error || categoryModuleResult.error ? <p role="alert">Chưa tải được cấu hình module. Cần chạy migration 202611180037_category_modules.sql.</p> : moduleResult.data?.map((module) => { const selected = categoryModuleResult.data?.find((item) => item.category_id === category.id && item.module_code === module.code); const enabled = selected?.enabled ?? module.default_enabled; return <form className="category-module-form" action={setCategoryModule} key={module.code}><input type="hidden" name="category_id" value={category.id} /><input type="hidden" name="module" value={module.code} /><input type="hidden" name="enabled" value={String(!enabled)} /><span>{module.name} · {enabled ? "Đang bật" : "Đã tắt"}</span><button type="submit">{enabled ? "Tắt" : "Bật"}</button></form>; })}<p>Áp dụng cho các cửa hàng thuộc ngành này, trừ cửa hàng có cấu hình riêng.</p></details>
          <details className="business-edit"><summary>Chỉnh sửa</summary><CategoryForm category={category} /></details>
          <details className="business-delete"><summary>Xóa ngành hàng</summary><form action={deleteBusinessCategory}><input type="hidden" name="id" value={category.id} /><label><input type="checkbox" name="confirm_delete" value="yes" required /> Xác nhận xóa {category.name}</label><button type="submit">Xác nhận xóa</button></form></details>
        </div>
      </article>) : <div className="business-empty"><span>▦</span><b>{search ? "Không tìm thấy ngành hàng phù hợp" : "Chưa có ngành hàng"}</b><p>Thêm ngành hàng bằng biểu mẫu bên dưới.</p></div>}
      {!result.error && (page > 1 || start + pageSize < (result.count ?? 0)) && <nav className="business-pagination" aria-label="Phân trang ngành hàng">{page > 1 && <Link href={pageHref(page - 1)}>← Trang trước</Link>}<span>Trang {page}</span>{start + pageSize < (result.count ?? 0) && <Link href={pageHref(page + 1)}>Trang sau →</Link>}</nav>}
    </section>
    <section className="business-create" id="add-category"><div><h2>Thêm ngành hàng</h2><p>Tạo một mục mới trong danh mục của nền tảng.</p></div><CategoryForm /></section>
  </main>;
}
