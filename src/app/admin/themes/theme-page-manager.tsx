import SidebarIcon from "@/components/ui/sidebar-icon";
import Form from "next/form";
import Link from "next/link";
import ThemeBuilder from "@/components/ui/theme-builder";
import Toast from "@/components/ui/toast";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { createClient } from "@/lib/supabase/server";
import {
  blockCompatible, canBeThemeHome, contentPageTemplates, findThemeHome, themeBlocks,
  themePageInNavigation, themePageKinds, themePageTemplate, type ThemePage,
} from "@/lib/theme-pages";
import { readThemeManifest, themeIdPattern } from "@/lib/theme-studio";
import OverviewRefresh from "./overview-refresh";
import type { Query } from "./theme-admin-sections";
import { ThemePageCommand, ThemePageFields } from "./theme-page-forms";
import "./theme-page-manager.css";

const base = "/admin/themes/pages";
const messages = {
  create: "Đã tạo trang trong bản nháp.", edit: "Đã lưu cài đặt trang.", copy: "Đã nhân bản trang ở trạng thái ẩn.",
  delete: "Đã xóa trang khỏi bản nháp.", home: "Đã đổi trang chủ trong bản nháp.",
  toggle: "Đã cập nhật hiển thị trong bản nháp.", up: "Đã cập nhật thứ tự trang.", down: "Đã cập nhật thứ tự trang.",
};
const date = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });
const dateLabel = (time?: string) => time && !isNaN(Date.parse(time)) ? date.format(new Date(time)) : "Chưa ghi nhận";
const text = (value: unknown) => typeof value === "string" ? value : "";
const url = (theme: string, extra: Record<string, string> = {}) => base + "?" + new URLSearchParams({ edit: theme, ...extra });
const studioUrl = (theme: string, page: string) => "/admin/themes/studio?" + new URLSearchParams({ edit: theme, page });
const pagePath = (page: ThemePage, homeId?: string) => page.id === homeId ? "/" : `/pages/${page.slug}`;
const templateName = (page: ThemePage) => page.kind === "custom"
  ? contentPageTemplates[themePageTemplate(page) as keyof typeof contentPageTemplates] : themePageKinds[page.kind];

export function ThemePageManagerSkeleton() {
  return <main className="admin-content themes-page page-manager" role="status" aria-label="Đang tải Quản lý trang">
    <div className="theme-metrics">{Array.from({ length: 5 }, (_, i) => <div className="page-manager-skeleton" key={i} />)}</div>
    <div className="page-manager-skeleton page-manager-skeleton-list" />
  </main>;
}

export default async function ThemePageManager({ query }: { query: Query }) {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const id = text(query.edit);
  const validId = themeIdPattern.test(id);
  const themeTerm = text(query.themeQuery).trim().replace(/[^\p{L}\p{M}\p{N} -]/gu, "").slice(0, 80);
  const menu = supabase.from("storefront_template_catalog").select("id,name,lifecycle");
  if (themeTerm) menu.ilike("name", `%${themeTerm}%`);
  const [themeList, selected, policy] = await Promise.all([
    menu.order("name").order("id").limit(25),
    validId ? supabase.from("storefront_template_catalog").select("id,name,lifecycle,draft,draft_revision,primary_family").eq("id", id).maybeSingle() : null,
    validId ? supabase.from("storefront_theme_policy").select("disabled_components,deprecated_components,max_custom_pages").maybeSingle() : null,
  ]);
  const themes = themeList.data ?? [];
  const theme = id ? selected?.data : undefined;
  const manifest = theme ? readThemeManifest(theme.draft) : null;
  const target = theme ? { theme: theme.id, revision: theme.draft_revision } : null;
  const pages = manifest?.pages ?? [];
  const home = findThemeHome(pages);
  const notice = text(query.message);
  const selectedPage = pages.find(page => page.id === query.page);
  const settingPage = pages.find(page => page.id === query.settings);
  const previewPage = pages.find(page => page.id === query.preview);
  const term = text(query.q).trim().slice(0, 100);
  const kindFilter = text(query.kind);
  const visibility = text(query.visibility);
  const filtered = pages.filter(page =>
    (!term || `${page.title} ${page.slug}`.toLocaleLowerCase("vi").includes(term.toLocaleLowerCase("vi"))) &&
    (!Object.hasOwn(themePageKinds, kindFilter) || page.kind === kindFilter) &&
    (visibility === "visible" ? page.visible : visibility === "hidden" ? !page.visible : true));
  const visiblePages = pages.filter(page => page.visible).length;
  const count = { "Tổng số trang": pages.length, "Đang hiển thị": visiblePages, "Đang ẩn": pages.length - visiblePages,
    "Trang hệ thống": pages.filter(page => page.kind !== "custom").length, "Trang trong bản nháp": pages.length };
  const loadError = themeList.error || selected?.error || policy?.error || (validId && theme && !policy?.data);
  const unableToAdd = pages.length >= 16;
  const kindsUnavailable = pages.filter(page => page.kind !== "custom").map(page => page.kind);
  if (pages.filter(page => page.kind === "custom").length >= (policy?.data?.max_custom_pages ?? 16)) kindsUnavailable.push("custom");
  return <main className="admin-content themes-page page-manager">
    <header className="themes-heading"><span className="theme-heading-icon"><SidebarIcon name="orders" /></span>
      <div><h1 className="admin-page-title">Quản lý trang</h1><p>Quản lý URL, template và thứ tự menu trong bản nháp của từng giao diện.</p></div>
      <OverviewRefresh />
      {theme && manifest && !unableToAdd && <Link className="theme-primary" href={url(id, { create: "1" })}>Tạo trang mới</Link>}
    </header>
    {Object.hasOwn(messages, notice) && <Toast key={notice} message={messages[notice as keyof typeof messages]} />}
    <section className="themes-create page-manager-section" aria-label="Chọn giao diện">
      <Form action={base} className="themes-filters">
        {id && <input name="edit" value={id} type="hidden" />}
        <label>Tìm giao diện<input name="themeQuery" maxLength={80} defaultValue={themeTerm} /></label><button type="submit">Tìm</button>
      </Form>
      <Form action={base} className="themes-filters">
        {themeTerm && <input name="themeQuery" value={themeTerm} type="hidden" />}
        <label>Giao diện <select name="edit" required defaultValue={theme?.id ?? ""}>
          <option value="" disabled>Chọn giao diện</option>
          {theme && !themes.some(item => item.id === theme.id) && <option value={theme.id}>{theme.name}</option>}
          {themes.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select></label><button type="submit" disabled={!themes.length && !theme}>Mở giao diện</button>
      </Form>
      {themes.length === 25 && <p>Dùng ô tìm kiếm để mở thêm giao diện.</p>}
    </section>
    {loadError ? <p role="alert" className="theme-feedback is-error">Chưa tải được dữ liệu trang. Hãy làm mới và thử lại.</p> :
      id && (!validId || !theme) ? <p role="alert" className="theme-feedback is-error">Không tìm thấy giao diện đã chọn.</p> :
      !theme || !target ? <p className="themes-empty">Chọn một giao diện để xem danh sách trang.</p> :
      !manifest ? <p role="alert" className="theme-feedback is-error">Manifest bản nháp chưa hợp lệ.</p> : <>
        <div className="theme-metrics">{Object.entries(count).map(([label, value]) => <article key={label} className="theme-card theme-card-body">
          <span title={label === "Trang trong bản nháp" ? "Trang dùng chung trạng thái bản nháp của giao diện." : undefined}>{label}</span><strong>{value}</strong>
        </article>)}</div>
        {query.create === "1" && <section className="themes-create page-manager-section">
          <header className="theme-section-heading"><h2>Tạo trang · {theme.name}</h2><Link href={url(id)}>Đóng</Link></header>
          {unableToAdd || kindsUnavailable.length === Object.keys(themePageKinds).length ? <p>Giao diện đã đạt giới hạn số trang được phép tạo.</p> :
            <ThemePageFields key={`create-${id}-${target.revision}`} target={target} unavailable={kindsUnavailable}
              disabledComponents={[...(policy?.data?.disabled_components ?? []), ...(policy?.data?.deprecated_components ?? [])]} />}
        </section>}
        {settingPage && <section className="themes-create page-manager-section">
          <header className="theme-section-heading"><h2>Cài đặt · {settingPage.title || themePageKinds[settingPage.kind]}</h2><Link href={url(id)}>Đóng</Link></header>
          <ThemePageFields key={`${settingPage.id}-${target.revision}`} target={target} page={settingPage} unavailable={[]} />
        </section>}
        {((query.settings && !settingPage) || (query.preview && !previewPage)) &&
          <p role="alert" className="theme-feedback is-error">Trang không còn tồn tại trong bản nháp này.</p>}
        <section className="themes-create page-manager-section">
          <header className="theme-section-heading"><h2>{theme.name} · {pages.length} trang</h2><Link href={`/admin/themes/versions?theme=${id}`}>Quản lý phiên bản</Link></header>
          {!home && <p>Trang chủ hiện dùng bố cục mặc định của giao diện.</p>}
          {selectedPage && <p>Trang vừa cập nhật <Link href={studioUrl(id, selectedPage.id)}>{selectedPage.title || themePageKinds[selectedPage.kind]} · Mở Theme Studio</Link></p>}
          <Form action={base} className="themes-filters">
            <input name="edit" value={id} type="hidden" />
            <label>Tìm trang<input name="q" maxLength={100} defaultValue={term} /></label>
            <label>Loại trang<select name="kind" defaultValue={kindFilter}><option value="">Tất cả</option>
              {Object.entries(themePageKinds).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
            </select></label>
            <label>Hiển thị<select name="visibility" defaultValue={visibility}>
              <option value="">Tất cả</option><option value="visible">Đang hiển thị</option><option value="hidden">Đang ẩn</option>
            </select></label><button type="submit">Lọc</button>
          </Form>
          {!filtered.length ? <p className="themes-empty">{pages.length ? "Không có trang phù hợp bộ lọc." : "Giao diện chưa có trang trong bản nháp."}</p> :
            <div className="page-manager-scroll" tabIndex={0} aria-label="Danh sách trang">
              <table className="page-manager-table"><thead><tr>
                {["Trang / URL", "Template", "Hiển thị", "Thời gian", "Thao tác"].map(label => <th key={label} scope="col">{label}</th>)}
              </tr></thead><tbody>{filtered.map(page => {
                const title = page.title || themePageKinds[page.kind];
                const isHome = page.id === home?.id;
                const path = pagePath(page, home?.id);
                const canCopy = !page.blocks.some(block =>
                  policy?.data?.disabled_components.includes(block.kind) || policy?.data?.deprecated_components.includes(block.kind));
                return <tr key={page.id}>
                  <th scope="row">{title}<small>{themePageKinds[page.kind]} · {page.slug}</small><code>{path}</code>
                    <small title="Nếu cửa hàng dùng đường dẫn theo slug, thêm slug cửa hàng trước URL này.">URL tương đối của cửa hàng</small>
                  </th>
                  <td>{templateName(page)}<small>{page.kind === "custom" ? "Tùy chỉnh" : "Hệ thống"}{isHome ? " · Trang chủ" : ""}</small></td>
                  <td>{page.visible ? "Đang hiển thị" : "Đang ẩn"}<small>{isHome || themePageInNavigation(page) ? "Có trong menu" : "Ngoài menu"}</small></td>
                  <td><small>Tạo {dateLabel(page.meta?.createdAt)}</small><small>Cập nhật {dateLabel(page.meta?.updatedAt)}</small></td>
                  <td><div className="page-manager-links">
                    <Link href={studioUrl(id, page.id)}>Chỉnh sửa trong Studio</Link>
                    <Link href={url(id, { settings: page.id })}>Cài đặt</Link>
                    <Link href={url(id, { preview: page.id }) + "#page-manager-preview"}>Xem trước</Link>
                  </div><details><summary>Thao tác khác</summary>
                    <div className="page-manager-links">
                      {page.visible && !isHome && canBeThemeHome(page.kind) && <ThemePageCommand target={target} page={page} operation="home" label="Đặt làm trang chủ" url={path} />}
                      {!unableToAdd && !kindsUnavailable.includes("custom") && (canCopy ?
                        <ThemePageCommand target={target} page={page} operation="copy" label="Nhân bản" /> :
                        <span title="Bản sao sẽ tạo instance mới.">Có component đang ngừng thêm mới nên chưa thể nhân bản.</span>)}
                      {page.kind === "custom" && !isHome && <>
                        <ThemePageCommand target={target} page={page} operation="toggle" label={page.visible ? "Ẩn trang" : "Hiện trang"} />
                        <ThemePageCommand target={target} page={page} operation="delete" label="Xóa trang" url={path} />
                      </>}
                      {pages.indexOf(page) > 0 && <ThemePageCommand target={target} page={page} operation="up" label="Lên" />}
                      {pages.indexOf(page) < pages.length - 1 && <ThemePageCommand target={target} page={page} operation="down" label="Xuống" />}
                    </div>
                    {(isHome || page.kind !== "custom") && <p>{page.kind !== "custom" ? "Route hệ thống không thể ẩn hoặc xóa." : "Chọn trang chủ thay thế trước khi ẩn hoặc xóa trang tùy chỉnh này."}</p>}
                  </details></td>
                </tr>;
              })}</tbody></table>
            </div>}
        </section>
        {previewPage && <section id="page-manager-preview" className="themes-create page-manager-section">
          <header className="theme-section-heading"><h2>Xem trước · {previewPage.title || themePageKinds[previewPage.kind]}</h2><Link href={url(id)}>Đóng</Link></header>
          <p>Template {templateName(previewPage)} · {previewPage.blocks.length} component</p>
          {!!previewPage.blocks.length && <ul className="page-manager-links">
            {previewPage.blocks.map(block => <li key={block.id}>
              <Link href={`/admin/themes/components?family=${theme.primary_family}&preview=${block.kind}`}>{block.title || themeBlocks[block.kind].label}</Link>
              {policy?.data?.disabled_components.includes(block.kind) && " · Đã bị chặn"}
              {policy?.data?.deprecated_components.includes(block.kind) && " · Ngừng khuyến nghị"}
              {!blockCompatible(block.kind, theme.primary_family) && " · Chưa tương thích ngành hàng"}
              {block.hidden && " · Đang ẩn"}
            </li>)}
          </ul>}
          <ThemeBuilder key={`${previewPage.id}-${target.revision}`} initial={{ ...manifest, pages: [previewPage] }}
            readOnly pagePreview family={theme.primary_family} />
        </section>}
      </>}
  </main>;
}
