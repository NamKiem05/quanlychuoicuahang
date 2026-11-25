import Link from "next/link";
import { themeFamilies } from "@/lib/theme-studio";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { saveBusinessCategory, deleteBusinessCategory } from "./actions";
import { setCategoryModule } from "./module-actions";
import "./business-categories.css";
import { merchandiseModeLabels, type MerchandiseMode } from "@/lib/merchandise-mode";
import SidebarIcon from "@/components/ui/sidebar-icon";

export const metadata = { title: "Danh mục ngành hàng | Quản trị" };
type Category = { id: string; name: string; slug: string; description: string; created_at: string; merchandise_mode: MerchandiseMode; theme_family: keyof typeof themeFamilies };
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
    <label>Loại nghiệp vụ<select name="merchandise_mode" defaultValue={category?.merchandise_mode ?? "general"}><option value="general">Dùng chung</option><option value="food">Đồ ăn và thức uống (F&B)</option><option value="retail">Bán lẻ</option></select></label><label>Nhóm giao diện<select name="theme_family" defaultValue={category?.theme_family ?? "general"}>{Object.entries(themeFamilies).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><p>Quyết định cách hiển thị biểu mẫu sản phẩm cho cửa hàng thuộc ngành này.</p>
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
  let request = supabase.from("business_categories").select("id, name, slug, description, created_at, merchandise_mode, theme_family", { count: "exact" }).order("name").order("id").range(start, start + pageSize - 1);
  if (search) request = request.or(`name.ilike.%${search}%,slug.ilike.%${search}%`);
  const result = await request;
  const rows = (result.data ?? []) as Category[];
  const [moduleResult, categoryModuleResult] = await Promise.all([supabase.from("platform_modules").select("code,name,default_enabled").order("name"), supabase.from("business_category_module_settings").select("category_id,module_code,enabled")]);
  const message = query.message ? messages[query.message] : undefined;
  function pageHref(next: number) { const params = new URLSearchParams({ page: String(next) }); if (search) params.set("q", search); return `/admin/business-categories?${params}`; }
  return <main className="admin-content business-categories-page">
    <header className="business-heading"><span className="business-heading-icon"><SidebarIcon name="overview" /></span><div><h1 className="admin-page-title">Danh mục ngành hàng</h1><p>Cấu hình loại nghiệp vụ và module mặc định cho các ngành hàng của GrowDesk.</p></div><a className="business-primary" href="#add-category">+ Thêm ngành hàng</a></header>
    {message && <p className={["created", "updated", "deleted", "module-updated"].includes(query.message ?? "") ? "business-success" : "admin-error"} role="status">{message}</p>}
    {result.error && <p className="admin-error" role="alert">Không tải được danh mục. Cần chạy migration 202611180008_business_categories.sql và kiểm tra quyền quản trị.</p>}
    <div className="business-workspace">
    <section className="business-list" aria-labelledby="business-list-title">
      <div className="business-list-heading"><h2 id="business-list-title">Danh sách ngành hàng</h2>{!result.error && <span>{(result.count ?? 0).toLocaleString("vi-VN")} {search ? "kết quả" : "ngành hàng"}</span>}</div>
      <form className="business-search" method="get"><label><span className="sr-only">Tìm ngành hàng</span><SidebarIcon name="search" /><input type="search" name="q" maxLength={80} defaultValue={search} placeholder="Tên hoặc mã ngành hàng…" /></label><button type="submit">Tìm kiếm</button>{search && <Link href="/admin/business-categories">Xóa lọc</Link>}</form>
      {result.error ? null : rows.length ? rows.map((category) => <article className="business-row" key={category.id}>
        <div className="business-row-icon"><SidebarIcon name={category.merchandise_mode === "food" ? "menu" : category.merchandise_mode === "retail" ? "store" : "overview"} /></div><div className="business-row-content"><div className="business-row-title"><h3>{category.name}</h3><span className="business-mode" data-mode={category.merchandise_mode}>{merchandiseModeLabels[category.merchandise_mode] ?? "Dùng chung"}</span></div><div className="business-row-meta"><code>{category.slug}</code><time dateTime={category.created_at}>Ngày tạo {dateFormat.format(new Date(category.created_at))}</time></div>{category.description && <p>{category.description}</p>}
          <details className="business-edit"><summary>Module theo ngành hàng</summary>{moduleResult.error || categoryModuleResult.error ? <p role="alert">Chưa tải được cấu hình module. Cần chạy migration 202611180037_category_modules.sql.</p> : moduleResult.data?.map((module) => { const selected = categoryModuleResult.data?.find((item) => item.category_id === category.id && item.module_code === module.code); const enabled = selected?.enabled ?? module.default_enabled; return <form className="category-module-form" action={setCategoryModule} key={module.code}><input type="hidden" name="category_id" value={category.id} /><input type="hidden" name="module" value={module.code} /><input type="hidden" name="enabled" value={String(!enabled)} /><span>{module.name} · {enabled ? "Đang bật" : "Đã tắt"}</span><button type="submit">{enabled ? "Tắt" : "Bật"}</button></form>; })}<p>Áp dụng cho các cửa hàng thuộc ngành này, trừ cửa hàng có cấu hình riêng.</p></details>
          <details className="business-edit"><summary>Chỉnh sửa</summary><CategoryForm category={category} /></details>
          <details className="business-delete"><summary>Xóa ngành hàng</summary><form action={deleteBusinessCategory}><input type="hidden" name="id" value={category.id} /><label><input type="checkbox" name="confirm_delete" value="yes" required /> Xác nhận xóa {category.name}</label><button type="submit">Xác nhận xóa</button></form></details>
        </div>
      </article>) : <div className="business-empty"><SidebarIcon name={search ? "search" : "overview"} /><b>{search ? "Không tìm thấy ngành hàng phù hợp" : "Chưa có ngành hàng"}</b>{search ? <Link href="/admin/business-categories">Xóa tìm kiếm</Link> : <a href="#add-category">Thêm ngành hàng đầu tiên</a>}</div>}
      {!result.error && (page > 1 || start + pageSize < (result.count ?? 0)) && <nav className="business-pagination" aria-label="Phân trang ngành hàng">{page > 1 && <Link href={pageHref(page - 1)}>← Trang trước</Link>}<span>Trang {page}</span>{start + pageSize < (result.count ?? 0) && <Link href={pageHref(page + 1)}>Trang sau →</Link>}</nav>}
    </section>
    <section className="business-create" id="add-category" aria-labelledby="business-create-title"><h2 id="business-create-title">Thêm ngành hàng</h2><p>Chủ cửa hàng chọn ngành hàng này khi tạo cửa hàng.</p><CategoryForm /></section>
    </div>
  </main>;
}
