import SidebarIcon from "@/components/ui/sidebar-icon";
import Form from "next/form";
import Link from "next/link";
import ThemeBuilder from "@/components/ui/theme-builder";
import ThemeCover from "@/components/ui/theme-cover";
import Toast from "@/components/ui/toast";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { createClient } from "@/lib/supabase/server";
import { libraryDistribution, libraryLifecycle, librarySorts, themeLibraryFilters } from "@/lib/theme-library";
import { themeBlocks } from "@/lib/theme-pages";
import { readThemeManifest, themeFamilies, themeIdPattern } from "@/lib/theme-studio";
import OverviewRefresh from "./overview-refresh";
import { ThemePager, type Query } from "./theme-admin-sections";
import { LibraryConfirm, LibraryMetadataForm } from "./theme-library-forms";
import ThemeCreationWizard from "./theme-creation-wizard";
import { initialThemeVersion, type ThemeCreationSource } from "@/lib/theme-creation";
import { themeManifestAssetKeys } from "@/lib/theme-version-management";
import "./theme-library.css";

const base = "/admin/themes";
const messages = {
  created: "Đã tạo bản nháp.", saved: "Đã lưu thông tin giao diện.", copied: "Đã tạo bản sao ở trạng thái bản nháp.",
  archive: "Đã lưu trữ giao diện.", hide: "Đã ẩn giao diện khỏi Marketplace.", show: "Đã bật niêm yết giao diện.",
  deleted: "Đã xóa bản nháp.",
} as const;
const statsLabels = {
  total: "Tổng giao diện", draft: "Bản nháp", published: "Đã phát hành", listed: "Đang phân phối",
  paused: "Đang tạm ngừng", archived: "Đã lưu trữ",
} as const;
const dateTime = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });
const number = new Intl.NumberFormat("vi-VN").format;
const money = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format;
const displayDate = (date: string | null) => date ? dateTime.format(new Date(date)) : "—";
const themeLink = (id: string) => `${base}?theme=${id}`;

type Row = {
  id: string; name: string; theme_slug: string; description: string; category: string; primary_family: keyof typeof themeFamilies;
  creator: string | null; created_by: string | null; created_at: string; updated_at: string;
  lifecycle: keyof typeof libraryLifecycle; distribution: keyof typeof libraryDistribution; is_enabled: boolean;
  draft_revision: number; thumbnail_url: string | null; preview_url: string | null;
  version: string | null; published_at: string | null; published_price: number | null; published_preview: string | null;
  installations: number; active_stores: number; compatible_families: string[];
};
type Detail = Row & {
  draft: unknown; published_manifest: unknown; published_family: keyof typeof themeFamilies | null;
  licenses: number; orders: number; has_release: boolean;
  releases: { id: string; version: string; published_at: string }[];
};
type Result = {
  count: number; rows: Row[]; stats: Record<keyof typeof statsLabels, number>;
  categories: string[]; creators: { id: string; label: string }[];
};
type Client = Awaited<ReturnType<typeof createClient>>;
const creatorLabel = (row: Row) => row.creator ?? (row.created_by ? `Tài khoản ${row.created_by.slice(0, 8)}` : "Chưa ghi nhận");

export function ThemeLibrarySkeleton() {
  return <div role="status" aria-label="Đang tải Kho giao diện" className="theme-library">
    <div className="theme-metrics">{Object.keys(statsLabels).map(key => <div key={key} className="theme-library-skeleton" />)}</div>
    <div className="theme-library-skeleton theme-library-skeleton-table" />
  </div>;
}

export default async function ThemeLibrary({ searchParams }: { searchParams: Promise<Query> }) {
  const [supabase, query] = await Promise.all([createClient(), searchParams]);
  await requirePlatformAdminAccess(supabase);
  const id = query.theme ?? query.edit ?? query.copy;
  const message = typeof query.message === "string" && Object.hasOwn(messages, query.message) ? messages[query.message as keyof typeof messages] : "";
  return <main className="admin-content themes-page theme-library">
    <header className="themes-heading">
      <span className="theme-heading-icon"><SidebarIcon name="appearance" /></span>
      <div><h1 className="admin-page-title">Kho giao diện</h1><p>Quản lý metadata, phiên bản, phân phối và mức sử dụng giao diện GrowDesk.</p></div>
      <OverviewRefresh />
      <Link className="theme-primary" href={`${base}?create=1`}>+ Tạo giao diện mới</Link>
    </header>
    {message && <Toast key={message} message={message} variant="success" />}
    {id !== undefined ? typeof id === "string" && themeIdPattern.test(id)
      ? <ThemeDetail supabase={supabase} id={id} query={query} />
      : <p role="alert" className="theme-feedback is-error">Mã giao diện không hợp lệ. <Link href={base}>Về danh sách</Link></p>
      : query.create === "1" ? <ThemeCreationPanel supabase={supabase} /> : <ThemeLibraryList supabase={supabase} query={query} />}
  </main>;
}

async function ThemeCreationPanel({ supabase, source }: { supabase: Client; source?: ThemeCreationSource }) {
  const { data, error } = await supabase.from("business_categories").select("id,name,theme_family").order("name");
  return error ? <p role="alert" className="theme-feedback is-error">Chưa tải được danh mục. Hãy làm mới trang.</p> :
    <ThemeCreationWizard key={source?.id ?? "blank"} categories={data ?? []} source={source} />;
}

async function ThemeLibraryList({ supabase, query }: { supabase: Client; query: Query }) {
  const filters = themeLibraryFilters(query, themeFamilies, themeIdPattern);
  const response = await supabase.rpc("admin_list_theme_library", {
    term: filters.q || null, release_state: filters.status || null, marketplace_state: filters.distribution || null,
    family: filters.family || null, theme_category: filters.category || null, creator_id: filters.creator || null,
    date_field: filters.dateField, first_day: filters.valid ? filters.from || null : null,
    last_day: filters.valid ? filters.to || null : null, sort_by: filters.order, page_offset: (filters.page - 1) * 20,
  });
  const result = response.data as Result | null;
  if (response.error || !result) return <p role="alert" className="theme-feedback is-error">Chưa tải được Kho giao diện. Hãy làm mới hoặc kiểm tra migration.</p>;
  const pager = { q: filters.q, status: filters.status, distribution: filters.distribution, family: filters.family,
    category: filters.category, creator: filters.creator, dateField: filters.dateField, from: filters.from, to: filters.to,
    order: filters.order, page: String(filters.page) };
  const options = (items: Record<string, string>) => Object.entries(items).map(([key, label]) => <option key={key} value={key}>{label}</option>);
  return <>
    <div className="theme-metrics">{Object.entries(statsLabels).map(([key, label]) =>
      <article className="theme-card theme-card-body" key={key}>
        <span title={key === "paused" ? "Giao diện đã phát hành bị ẩn hoặc bị tạm dừng do Marketplace đang đóng." : undefined}>{label}</span>
        <strong>{number(result.stats[key as keyof typeof statsLabels])}</strong>
      </article>)}</div>
    <section className="themes-create theme-library-panel">
      <header className="theme-section-heading"><h2>Danh sách giao diện</h2><span>{number(result.stats.total)} giao diện trong kho</span></header>
      <Form action={base} className="themes-filters">
        <label>Tên, mã hoặc người tạo<input name="q" maxLength={100} defaultValue={filters.q} /></label>
        <label>Phát hành<select name="status" defaultValue={filters.status}><option value="">Tất cả</option>{options(libraryLifecycle)}</select></label>
        <label>Marketplace<select name="distribution" defaultValue={filters.distribution}><option value="">Tất cả</option>{options(libraryDistribution)}</select></label>
        <label>Ngành hàng<select name="family" defaultValue={filters.family}><option value="">Tất cả</option>{options(themeFamilies)}</select></label>
        <label>Danh mục<input name="category" list="theme-library-categories" maxLength={80} defaultValue={filters.category} /></label>
        <datalist id="theme-library-categories">{result.categories.map(category => <option value={category} key={category} />)}</datalist>
        <label>Mã người tạo<input name="creator" list="theme-library-creators" maxLength={36} defaultValue={filters.creator} /></label>
        <datalist id="theme-library-creators">{result.creators.map(creator => <option value={creator.id} label={creator.label} key={creator.id} />)}</datalist>
        <label>Lọc ngày theo<select name="dateField" defaultValue={filters.dateField}><option value="created">Ngày tạo</option><option value="updated">Ngày cập nhật</option></select></label>
        <label>Từ ngày<input name="from" type="date" min="1900-01-01" defaultValue={filters.from} /></label>
        <label>Đến ngày<input name="to" type="date" min="1900-01-01" defaultValue={filters.to} /></label>
        <label>Sắp xếp<select name="order" defaultValue={filters.order}>{options(librarySorts)}</select></label>
        <button type="submit">Áp dụng</button><Link href={base}>Xóa bộ lọc</Link>
      </Form>
      {!filters.valid ? <p role="alert" className="theme-feedback is-error">Khoảng ngày chưa hợp lệ. Kiểm tra ngày bắt đầu và kết thúc.</p> : <>
        <p className="theme-library-count">{number(result.count)} kết quả</p>
        {result.rows.length === 0 ? <p className="themes-empty">{result.stats.total ? "Không có giao diện phù hợp trên trang này." : "Kho chưa có giao diện. Anh có thể tạo bản nháp đầu tiên."}</p> :
          <div className="theme-library-scroll" tabIndex={0} aria-label="Danh sách giao diện">
            <table className="theme-library-table">
              <thead><tr>{["Giao diện", "Ngành hàng / Danh mục", "Người tạo", "Phiên bản", "Phát hành", "Marketplace", "Cửa hàng đang dùng", "Ngày tạo / Cập nhật"].map(label =>
                <th key={label} scope="col">{label}</th>)}</tr></thead>
              <tbody>{result.rows.map(row => <tr key={row.id}>
                <th scope="row"><div className="theme-library-name"><ThemeCover image={row.thumbnail_url ?? row.preview_url} family={row.primary_family} />
                  <div><Link href={themeLink(row.id)}>{row.name}</Link><small>{row.theme_slug}</small>
                    {row.description && <span className="theme-library-summary" title={row.description}>{row.description}</span>}</div>
                </div></th>
                <td>{themeFamilies[row.primary_family]}<small>{row.category || "Chưa phân loại"}</small></td>
                <td>{creatorLabel(row)}</td><td>{row.version ?? "—"}</td>
                <td><span className="theme-badge" data-status={row.lifecycle}>{libraryLifecycle[row.lifecycle]}</span></td>
                <td>{libraryDistribution[row.distribution]}</td><td>{number(row.active_stores)}</td>
                <td>{displayDate(row.created_at)}<small>{displayDate(row.updated_at)}</small></td>
              </tr>)}</tbody>
            </table>
          </div>}
        <ThemePager base={base} query={pager} count={result.count} />
      </>}
    </section>
  </>;
}

async function ThemeDetail({ supabase, id, query }: { supabase: Client; id: string; query: Query }) {
  const { data, error } = await supabase.rpc("admin_get_theme_library", { theme: id });
  if (error || !data) return <p role="alert" className="theme-feedback is-error">
    {error ? "Chưa tải được chi tiết giao diện." : "Không tìm thấy giao diện."} <Link href={base}>Về danh sách</Link>
  </p>;
  const item = data as Detail;
  if (query.copy === id) {
    return <ThemeCreationPanel supabase={supabase} source={{ ...item, image: item.thumbnail_url ?? item.preview_url,
      families: [item.primary_family, ...item.compatible_families] }} />;
  }
  if (query.edit === id) return <section className="themes-create"><header className="theme-section-heading">
    <h2>Chỉnh sửa {item.name}</h2><Link href={themeLink(id)}>Về chi tiết</Link>
  </header><LibraryMetadataForm key={id + item.draft_revision} item={item} /></section>;
  const draft = readThemeManifest(item.draft);
  const published = readThemeManifest(item.published_manifest);
  const view = query.preview === "published" ? "published" : "draft";
  const manifest = view === "published" ? published : draft;
  const components = [...new Set(draft?.pages?.flatMap(page => page.blocks.map(block => block.kind)))];
  const deleteBlocked = item.has_release || item.licenses > 0 || item.installations > 0 || item.orders > 0;
  return <>
    <section className="themes-create theme-library-panel">
      <header className="theme-section-heading"><h2>{item.name}</h2><Link href={base}>Về danh sách</Link></header>
      <div className="theme-library-detail">
        <div><ThemeCover image={item.thumbnail_url ?? item.preview_url} family={item.primary_family} />
          <div className="theme-studio-tools">
            {item.thumbnail_url && <Link href={item.thumbnail_url} target="_blank" rel="noreferrer">Mở thumbnail</Link>}
            {item.preview_url && <Link href={item.preview_url} target="_blank" rel="noreferrer">Mở ảnh xem trước</Link>}
            {item.published_preview && item.published_preview !== item.preview_url &&
              <Link href={item.published_preview} target="_blank" rel="noreferrer">Mở ảnh bản phát hành</Link>}
          </div>
        </div>
        <dl className="theme-library-facts">
          <div><dt>Mã giao diện</dt><dd>{item.theme_slug}<small>{id}</small></dd></div>
          <div><dt>Mô tả</dt><dd>{item.description || "Chưa có mô tả"}</dd></div>
          <div><dt>Ngành hàng</dt><dd>{themeFamilies[item.primary_family]}</dd></div>
          <div><dt>Danh mục</dt><dd>{item.category || "Chưa phân loại"}</dd></div>
          <div><dt>Người tạo</dt><dd>{creatorLabel(item)}</dd></div>
          <div><dt>Ngày tạo</dt><dd>{displayDate(item.created_at)}</dd></div>
          <div><dt>Cập nhật</dt><dd>{displayDate(item.updated_at)}</dd></div>
          <div><dt>Phát hành</dt><dd>{libraryLifecycle[item.lifecycle]}{item.version && ` · v${item.version}`}<small>{displayDate(item.published_at)}</small></dd></div>
          {!item.version && <div><dt>Phiên bản phát hành đề xuất</dt><dd>{initialThemeVersion}</dd></div>}
          <div><dt>Schema bản nháp</dt><dd>{draft ? `v${draft.schemaVersion ?? 1}` : "Cần kiểm tra cấu hình"}</dd></div>
          {draft && <div><dt>Thiết kế bản nháp</dt><dd>{draft.pages?.length ?? 0} trang · {draft.pages?.reduce((count,page) => count + page.blocks.length,0) ?? 0} component
            <small>{themeManifestAssetKeys(draft).length + new Set([item.thumbnail_url,item.preview_url].filter(Boolean)).size} tham chiếu ảnh</small></dd></div>}
          <div><dt>Marketplace</dt><dd>{libraryDistribution[item.distribution]}
            {item.published_price !== null && <small>{item.published_price ? `Giá bản phát hành ${money(item.published_price)}` : "Bản phát hành miễn phí"}</small>}</dd></div>
          <div><dt>Lượt cài</dt><dd>{number(item.installations)}</dd></div>
          <div><dt>Cửa hàng đang dùng</dt><dd>{number(item.active_stores)}</dd></div>
          <div><dt>Giấy phép / Đơn mua</dt><dd>{number(item.licenses)} / {number(item.orders)}</dd></div>
        </dl>
      </div>
      <div className="theme-studio-tools">
        <Link className="theme-primary" href={`${base}/studio?edit=${id}`}>Mở Theme Studio</Link>
        <Link className="theme-secondary" href={`${base}?edit=${id}`}>Chỉnh sửa thông tin</Link>
        <Link className="theme-secondary" href={`${base}?copy=${id}`}>Nhân bản</Link>
        {item.lifecycle === "published" && <LibraryConfirm item={item} command={item.is_enabled ? "hide" : "show"} />}
        {item.lifecycle !== "archived" && <LibraryConfirm item={item} command="archive" />}
        {item.lifecycle === "draft" && !deleteBlocked && <LibraryConfirm item={item} command="delete" />}
      </div>
      {(item.lifecycle !== "draft" || deleteBlocked) && <p className="theme-library-count">
        {deleteBlocked ? "Không thể xóa vì giao diện đã phát hành hoặc còn giấy phép, lượt cài hay đơn mua." : "Chỉ có thể xóa giao diện ở trạng thái bản nháp."}
      </p>}
      <nav className="theme-studio-tools" aria-label="Quản lý giao diện liên quan">
        <Link href={`${base}/pages?edit=${id}`}>Quản lý trang</Link>
        <Link href={`${base}/components?family=${item.primary_family}`}>Thư viện Component</Link>
        <Link href={`${base}/versions?theme=${id}`}>Quản lý phiên bản</Link>
        {item.lifecycle === "published" && <Link href={`${base}/marketplace?theme=${id}`}>Marketplace</Link>}
        <Link href={`${base}/licenses?q=${id}`}>Quản lý License</Link>
      </nav>
      {components.length > 0 && <ul className="theme-library-components" aria-label="Component trong bản nháp">
        {components.map(kind => <li key={kind}><Link href={`${base}/components?family=${item.primary_family}&preview=${kind}`}>{themeBlocks[kind].label}</Link></li>)}
      </ul>}
    </section>
    <section className="themes-create theme-library-panel">
      <header className="theme-section-heading"><h2>Xem trước giao diện</h2><nav className="theme-studio-tools" aria-label="Nguồn xem trước">
        <Link href={themeLink(id) + "#theme-library-preview"} aria-current={view === "draft" ? "page" : undefined}>Bản nháp</Link>
        {published && <Link href={themeLink(id) + "&preview=published#theme-library-preview"} aria-current={view === "published" ? "page" : undefined}>Bản phát hành mới nhất</Link>}
      </nav></header>
      <div id="theme-library-preview">{manifest ? <ThemeBuilder key={`${id}:${view}:${item.draft_revision}:${item.version}`}
        initial={manifest} family={view === "published" ? item.published_family ?? undefined : item.primary_family} readOnly structureOnly /> :
        <p className="themes-empty">Chưa có cấu hình hợp lệ để xem trước.</p>}</div>
    </section>
    <section className="themes-create theme-library-panel">
      <header className="theme-section-heading"><h2>Lịch sử phiên bản</h2><Link href={`${base}/versions?theme=${id}`}>Xem mọi phiên bản</Link></header>
      {item.releases.length ? <ul>{item.releases.map(release => <li key={release.id}>
        <Link href={`${base}/versions?theme=${id}&preview=${release.id}`}>v{release.version}</Link> · {displayDate(release.published_at)}
      </li>)}</ul> : <p className="themes-empty">Giao diện chưa có phiên bản phát hành.</p>}
    </section>
  </>;
}
