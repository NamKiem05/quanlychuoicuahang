import Link from "next/link";
import SidebarIcon from "@/components/ui/sidebar-icon";
import ThemeCover from "@/components/ui/theme-cover";
import Toast from "@/components/ui/toast";
import ThemeBuilder from "@/components/ui/theme-builder";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { defaultThemeManifest, readThemeManifest, themeFamilies, themeIdPattern } from "@/lib/theme-studio";
import { autosaveThemeDraft, manageTheme, updateThemeAdmin } from "./actions";
import "./themes.css";

const messages: Record<string, string> = {
  saved: "Đã lưu bản nháp.", published: "Đã phát hành phiên bản.", archived: "Đã ngừng phân phối mẫu.",
  failed: "Chưa thực hiện được. Kiểm tra dữ liệu hoặc migration.", invalid: "Dữ liệu chưa hợp lệ.",
  conflict: "Bản nháp vừa được thay đổi. Hãy kiểm tra phiên bản mới rồi lưu lại.", license: "Đã cập nhật giấy phép.",
};
const money = (amount: number) => amount ? `${amount.toLocaleString("vi-VN")} ₫` : "Miễn phí";

export default async function ThemesCatalog({ searchParams, mode = "catalog" }: { searchParams: Promise<Record<string, string | undefined>>; mode?: "catalog" | "studio" | "pages" | "marketplace" }) {
  const [supabase, query] = await Promise.all([createClient(), searchParams]);
  await requirePlatformAdminAccess(supabase);
  const base = mode === "catalog" ? "/admin/themes" : "/admin/themes/" + mode;
  const id = query.edit && themeIdPattern.test(query.edit) ? query.edit : null;
  const copy = query.copy && themeIdPattern.test(query.copy) ? query.copy : null;
  const text = typeof query.q === "string" ? query.q.trim().replace(/[^\p{L}\p{M}\p{N} -]/gu, "").slice(0, 80) : "";
  const status = ["draft", "published", "archived"].includes(query.status ?? "") ? query.status : undefined;
  const family = typeof query.family === "string" && Object.hasOwn(themeFamilies, query.family) ? query.family : null;
  const price = query.price === "free" || query.price === "paid" ? query.price : null;
  const page = typeof query.page === "string" && /^\d{1,5}$/.test(query.page) ? Math.max(1, Number(query.page)) : 1;
  const list = supabase.from(mode === "marketplace" ? "admin_theme_marketplace_view" : "storefront_template_catalog").select("id,name,theme_slug,primary_family,lifecycle,price_vnd,created_at,created_by,preview_url,is_enabled,updated_at", { count: "exact" });
  if (text) list.ilike("name", `%${text}%`);
  if (mode === "marketplace") list.eq("lifecycle", "published");
  if (status && mode !== "marketplace") list.eq("lifecycle", status);
  if (family) list.eq("primary_family", family);
  if (price === "free") list.eq("price_vnd", 0);
  if (price === "paid") list.gt("price_vnd", 0);
  const selected = id ?? copy;
  const [catalog, draft, releases, policy, orders] = await Promise.all([
    list.order("created_at", { ascending: query.order === "oldest" }).order("id").range((page - 1) * 20, page * 20 - 1),
    selected ? supabase.from("storefront_template_catalog").select("id,name,theme_slug,description,primary_family,compatible_families,price_vnd,preview_url,draft,draft_revision,lifecycle").eq("id", selected).maybeSingle() : null,
    id ? supabase.from("storefront_theme_versions").select("id,version,published_at").eq("theme_id", id).order("release_no", { ascending: false }).limit(20) : null,
    supabase.from("storefront_theme_policy").select("disabled_components,max_custom_pages").maybeSingle(),
    mode === "marketplace" ? supabase.from("storefront_theme_purchases").select("id,transfer_code,amount_vnd,confirmed_at").order("created_at", { ascending: false }).limit(8) : null,
  ]);
  const row = draft?.data;
  const overview = catalog.data?.length ? await supabase.rpc("admin_theme_overview", { themes: catalog.data.map(item => item.id) }) : null;
  const statistics = new Map<string, { version: string | null; purchases: number; active_stores: number }>();
  for (const item of overview?.data ?? []) statistics.set(item.id, item);
  const distribution = mode === "marketplace" && catalog.data?.length ? await supabase.rpc("admin_theme_distribution_stats", { themes: catalog.data.map(item => item.id) }) : null;
  const claims = new Map<string, number>((distribution?.data ?? []).map((item: {id:string;claims:number}) => [item.id,item.claims]));
  const showStudio = query.create === "1" || Boolean(selected);
  const pagination = new URLSearchParams();
  if (text) pagination.set("q", text);
  if (status) pagination.set("status", status);
  if (family) pagination.set("family", family);
  if (price) pagination.set("price", price);
  if (query.order === "oldest") pagination.set("order", "oldest");
  function pageHref(next: number) { const params = new URLSearchParams(pagination); params.set("page", String(next)); return base + "?" + params; }
  return <main className="admin-content themes-page">
    <header className="themes-heading"><span className="theme-heading-icon"><SidebarIcon name="appearance" /></span><div><h1 className="admin-page-title">{{catalog:"Kho giao diện",studio:"Theme Studio",pages:"Quản lý trang",marketplace:"Marketplace"}[mode]}</h1><p>Quản lý bản nháp và phiên bản giao diện cửa hàng.</p></div><Link className="theme-primary" href="/admin/themes/studio?create=1"><span aria-hidden="true">+</span> Tạo giao diện</Link></header>
    {typeof query.message === "string" && Object.hasOwn(messages, query.message) && <Toast message={messages[query.message]} variant={["failed", "invalid", "conflict"].includes(query.message) ? "error" : "success"} />}
    {showStudio && mode !== "marketplace" && <section className="themes-create theme-workspace">
      <header className="theme-section-heading"><h2>{id ? row?.name ?? "Giao diện" : copy ? "Nhân bản giao diện" : "Tạo giao diện"}</h2><Link href="/admin/themes">Về danh sách</Link></header>
      {selected && !row ? <p role="alert">Không tìm thấy giao diện hoặc chưa cài migration.</p> : <>
        <form action={manageTheme} className="theme-form" key={`${selected ?? "new"}:${row?.draft_revision ?? 0}`}>
          <input type="hidden" name="view" value={mode} /><input type="hidden" name="theme" value={id ?? ""} /><input type="hidden" name="revision" data-theme-revision defaultValue={id ? row?.draft_revision : 0} />
          <details className="theme-metadata" open={!id}><summary>Thông tin giao diện</summary><div className="theme-form-grid">
            <label>Tên<input name="title" defaultValue={copy && row ? `${row.name.slice(0, 90)} – bản sao` : row?.name} required minLength={2} maxLength={100} /></label>
            <label>Mã định danh<input name="slug" defaultValue={copy ? "" : row?.theme_slug} required maxLength={80} pattern="[a-z0-9]+(-[a-z0-9]+)*" /></label>
            <label>Ngành chính<select name="family" defaultValue={row?.primary_family ?? "general"}>{Object.entries(themeFamilies).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>
            <label>Giá bán một lần (VND)<input name="price" type="number" min={0} max={100000000} step={1} required defaultValue={row?.price_vnd ?? 0} /></label>
          </div>
          <fieldset className="theme-checks"><legend>Ngành tương thích thêm</legend>{Object.entries(themeFamilies).map(([key, value]) => <label key={key}><input name="compatibility" type="checkbox" value={key} defaultChecked={row?.compatible_families.includes(key)} /> {value}</label>)}</fieldset>
          <label>Mô tả<textarea name="summary" maxLength={1000} defaultValue={row?.description} /></label>
          <label>Ảnh xem trước (HTTPS)<input name="image" type="url" maxLength={2048} defaultValue={row?.preview_url ?? ""} /></label></details>
          <ThemeBuilder initial={readThemeManifest(row?.draft) ?? defaultThemeManifest} family={row?.primary_family} disabledComponents={policy.data?.disabled_components} maxCustomPages={policy.data?.max_custom_pages} autosave={id && row ? { id, revision: row.draft_revision, save: autosaveThemeDraft } : undefined} />
          <button className="theme-primary" name="operation" value="save">Lưu bản nháp</button>
        </form>
        {id && row && <div className="theme-release-tools">
          <form action={manageTheme} className="theme-form"><input type="hidden" name="theme" value={id} /><input type="hidden" name="revision" data-theme-revision defaultValue={row.draft_revision} />
            <label>Phiên bản bản nháp đã lưu<input name="version" placeholder="1.0.0" required pattern="[0-9]{1,4}[.][0-9]{1,4}[.][0-9]{1,4}" /></label>
            <button className="theme-primary" name="operation" value="publish">Phát hành</button>
          </form>
          {row.lifecycle !== "archived" && <form action={manageTheme} className="theme-form"><input type="hidden" name="theme" value={id} /><input type="hidden" name="revision" value={row.draft_revision} />
            <label><input type="checkbox" name="confirm" value="yes" required /> Xác nhận ngừng phân phối</label>
            <button name="operation" value="archive">Ngừng phân phối</button>
          </form>}
        </div>}
        {releases?.data?.length ? <p>Phiên bản đã phát hành · {releases.data.map(release => release.version).join(", ")}</p> : null}
      </>}
    </section>}
    <section className="theme-catalog" aria-label="Danh mục giao diện">
    <header className="theme-section-heading"><h2>Danh mục giao diện</h2>{catalog.count != null && <span>{catalog.count.toLocaleString("vi-VN")} giao diện</span>}</header>
    <form method="get" className="themes-filters">
      <label>Tìm tên<input name="q" defaultValue={text} /></label>
      {mode !== "marketplace" && <label>Trạng thái<select name="status" defaultValue={status}><option value="">Tất cả</option><option value="draft">Bản nháp</option><option value="published">Đã phát hành</option><option value="archived">Ngừng phân phối</option></select></label>}
      <label>Ngành hàng<select name="family" defaultValue={family ?? ""}><option value="">Tất cả</option>{Object.entries(themeFamilies).map(([key,value]) => <option key={key} value={key}>{value}</option>)}</select></label>
      <label>Giá<select name="price" defaultValue={price ?? ""}><option value="">Tất cả</option><option value="free">Miễn phí</option><option value="paid">Trả phí</option></select></label>
      <label>Sắp xếp<select name="order" defaultValue={query.order}><option value="">Mới nhất</option><option value="oldest">Cũ nhất</option></select></label><button>Tìm</button>
    </form>
    {catalog.error ? <p role="alert">Chưa tải được danh mục. Kiểm tra migration Theme Studio.</p> : <>
      <div className="themes-grid">{catalog.data?.map(item => {
        const stats = statistics.get(item.id);
        return <article className="theme-card" key={item.id}>
          <ThemeCover image={item.preview_url} family={item.primary_family} />
          <div className="theme-card-body"><div className="theme-card-heading"><h2>{item.name}</h2><span className="theme-badge" data-status={item.lifecycle}>{item.lifecycle === "published" ? "Đã phát hành" : item.lifecycle === "archived" ? "Ngừng phân phối" : "Bản nháp"}</span></div>
            <p>{themeFamilies[item.primary_family as keyof typeof themeFamilies]} · {money(item.price_vnd)}{stats?.version ? ` · v${stats.version}` : ""}</p>
            {stats && <p>{stats.purchases} lượt mua · {stats.active_stores} cửa hàng đang dùng</p>}
            {mode === "marketplace" && <p>{item.is_enabled ? "Hiển thị trên Marketplace" : "Đã gỡ khỏi Marketplace"}{claims.has(item.id) ? ` · ${claims.get(item.id)} lượt nhận miễn phí` : ""}</p>}
            <small>Cập nhật {new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(item.updated_at))}</small>
            <div className="theme-card-actions"><Link className="theme-primary" href={(mode === "pages" ? "/admin/themes/pages" : "/admin/themes/studio") + "?edit=" + item.id}>{mode === "pages" ? "Quản lý trang" : "Chỉnh sửa"}</Link><Link className="theme-secondary" href={"/admin/themes/studio?copy=" + item.id}>Nhân bản</Link></div>
            <Link href={"/admin/themes/versions?theme=" + item.id}>Chi tiết phiên bản</Link>
            {item.lifecycle === "published" && <form action={updateThemeAdmin} className="theme-form"><input type="hidden" name="theme" value={item.id} /><input type="hidden" name="view" value={mode} /><button className="theme-secondary" name="command" value={item.is_enabled ? "hide" : "show"}>{item.is_enabled ? "Gỡ khỏi Marketplace" : "Đưa lên Marketplace"}</button></form>}
            {item.lifecycle === "draft" && <details className="theme-delete"><summary>Xóa bản nháp</summary><form action={updateThemeAdmin}><input type="hidden" name="theme" value={item.id} /><label><input type="checkbox" name="confirm" value="yes" required /> Xác nhận xóa</label><button name="command" value="delete">Xóa bản nháp</button></form></details>}
          </div>
        </article>;
      })}</div>
      {!catalog.data?.length && <p>Chưa có giao diện phù hợp.</p>}
      <nav className="theme-studio-tools" aria-label="Phân trang">{page > 1 && <Link href={pageHref(page-1)}>Trang trước</Link>}{page*20 < (catalog.count ?? 0) && <Link href={pageHref(page+1)}>Trang sau</Link>}</nav>
    </>}
    </section>
    {mode === "marketplace" && <section className="themes-create">
      <header className="theme-section-heading"><h2>Đơn mua gần đây</h2><Link href="/admin/themes/licenses">Mở đối soát</Link></header>
      {orders?.error ? <p role="alert">Chưa tải được đơn mua.</p> : orders?.data?.length ? <ul>{orders.data.map(order => <li key={order.id}>{order.transfer_code} · {money(order.amount_vnd)} · {order.confirmed_at ? "Đã xác nhận" : "Chờ đối soát"}</li>)}</ul> : <p>Chưa có đơn mua.</p>}
    </section>}
  </main>;
}
