import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import Toast from "@/components/ui/toast";
import { ThemeBlockContent } from "@/components/storefront/theme-sections";
import { themeComponentPreviewData } from "@/components/ui/theme-component-preview-data";
import type { createClient } from "@/lib/supabase/server";
import {
  componentFields, componentGroups, componentReleases, componentSources, componentStatus, componentStatuses,
  createThemeBlock, fieldsForComponent, filterThemeComponents, themeBlocks, type BlockKind, type ComponentStatus,
} from "@/lib/theme-pages";
import { themeFamilies } from "@/lib/theme-studio";
import OverviewRefresh from "./overview-refresh";
import { ThemePager, type Query } from "./theme-admin-sections";
import { ComponentPreview, ComponentStatusDialog } from "./component-library-controls";
import "./component-library.css";

const base = "/admin/themes/components";
const kinds = Object.keys(themeBlocks) as BlockKind[];
const orders = { updated: "Mới đổi trạng thái", name_asc: "Tên A–Z", name_desc: "Tên Z–A", usage: "Được sử dụng nhiều nhất" };
const devices = { yes: "Có", no: "Không" };
const compatibility = { compatible: "Tương thích", incompatible: "Chưa tương thích", all: "Tất cả" };
const versions = Object.fromEntries([...new Set(kinds.map(kind => componentReleases(kind)[0].version))].map(version => [version, version]));
const date = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });
const labelDate = (timestamp?: string) => timestamp && Number.isFinite(Date.parse(timestamp)) ? date.format(new Date(timestamp)) : "Chưa ghi nhận";
const valid = (options: Record<string, string>, value: Query[string]) => typeof value === "string" && Object.hasOwn(options, value) ? value : "";
const number = (value: Query[string]) => typeof value === "string" && /^[1-9]\d{0,4}$/.test(value) ? Number(value) : 1;
type Usage = { themes: number; pages: number; releases: number };
type Report = { summaries: Partial<Record<BlockKind, Usage>>; count: number;
  references: { theme_id: string; name: string; release_id: string | null; version: string | null; published_at: string | null;
    version_page: number | null }[] };
type Client = Awaited<ReturnType<typeof createClient>>;

export function ComponentLibrary({ supabase, query }: { supabase: Client; query: Query }) {
  return <section className="component-library">
    <header className="theme-section-heading">
      <p>Quản lý component có renderer trong GrowDesk và xem nơi component đang được tham chiếu.</p>
      <OverviewRefresh />
    </header>
    {query.message === "saved" && <Toast message="Đã cập nhật trạng thái component." />}
    <Suspense key={JSON.stringify(query)} fallback={<div className="component-library-skeleton" role="status" aria-label="Đang tải thư viện" />}>
      <LibraryData supabase={supabase} query={query} />
    </Suspense>
  </section>;
}

async function LibraryData({ supabase, query }: { supabase: Client; query: Query }) {
  const preview = typeof query.preview === "string" && Object.hasOwn(themeBlocks, query.preview) ? query.preview as BlockKind : undefined;
  const refsPage = number(query.refsPage);
  const [policy, usage] = await Promise.all([
    supabase.from("storefront_theme_policy").select("disabled_components,deprecated_components,component_status_updated_at").maybeSingle(),
    supabase.rpc("admin_theme_component_usage", { component: preview ?? null, row_offset: (refsPage - 1) * 12 }),
  ]);
  const report = usage.data as Report | null;
  if (policy.error || !policy.data || usage.error || !report) return <p className="theme-feedback is-error" role="alert">
    Chưa tải được thư viện component. Hãy làm mới hoặc kiểm tra migration.
  </p>;
  const rules = policy.data;
  const totals = { themes: 0, pages: 0, releases: 0 };
  const entries = kinds.map(kind => ({
    kind, status: componentStatus(kind, rules.disabled_components, rules.deprecated_components),
    ...(report.summaries[kind] ?? totals), updatedAt: rules.component_status_updated_at[kind] as string | undefined,
  }));
  const filters = {
    term: typeof query.q === "string" ? query.q.trim().slice(0, 100) : "", group: valid(componentGroups, query.group),
    source: valid(componentSources, query.source), family: valid(themeFamilies, query.family), status: valid(componentStatuses, query.status),
    version: valid(versions, query.version), responsive: valid(devices, query.responsive), compatibility: valid(compatibility, query.compatibility) || "compatible",
    order: valid(orders, query.order) || "name_asc",
  };
  const matches = filterThemeComponents(entries, filters);
  const size = 6;
  const page = number(query.page);
  const filterQuery = { q: filters.term, group: filters.group, source: filters.source, family: filters.family, status: filters.status,
    version: filters.version, responsive: filters.responsive, compatibility: filters.compatibility, order: filters.order, page: String(page) };
  const params = new URLSearchParams(filterQuery);
  const linkTo = (kind: BlockKind) => `${base}?${new URLSearchParams({ ...filterQuery, preview: kind })}#component-detail`;
  const selected = entries.find(entry => entry.kind === preview);
  const cards = { "Tổng component": entries.length, "Đang hoạt động": entries.filter(item => item.status === "active").length,
    "Vô hiệu hóa": entries.filter(item => item.status === "disabled").length,
    "Ngừng khuyến nghị": entries.filter(item => item.status === "deprecated").length,
    "Có tham chiếu": entries.filter(item => item.themes > 0).length };
  const options = (items: Record<string, string>) => Object.entries(items).map(([key, label]) => <option key={key} value={key}>{label}</option>);
  return <>
    <div className="theme-metrics">{Object.entries(cards).map(([label, value]) =>
      <article className="theme-card theme-card-body" key={label}><span title={label === "Có tham chiếu" ? "Có mặt trong bản nháp hoặc ít nhất một snapshot đã phát hành." : undefined}>{label}</span><strong>{value}</strong></article>)}</div>
    <Form action={base} className="themes-filters">
      <label>Tìm component<input name="q" maxLength={100} defaultValue={filters.term} /></label>
      <label>Nhóm<select name="group" defaultValue={filters.group}><option value="">Tất cả</option>{options(componentGroups)}</select></label>
      <label>Nguồn dữ liệu<select name="source" defaultValue={filters.source}><option value="">Tất cả</option>{options(componentSources)}</select></label>
      <label>Trạng thái<select name="status" defaultValue={filters.status}><option value="">Tất cả</option>{options(componentStatuses)}</select></label>
      <label>Phiên bản<select name="version" defaultValue={filters.version}><option value="">Tất cả</option>{options(versions)}</select></label>
      <label>Responsive<select name="responsive" defaultValue={filters.responsive}><option value="">Tất cả</option>{options(devices)}</select></label>
      <label>Ngành hàng<select name="family" defaultValue={filters.family}><option value="">Tất cả</option>{options(themeFamilies)}</select></label>
      <label>Tương thích theo ngành<select name="compatibility" defaultValue={filters.compatibility}>{options(compatibility)}</select></label>
      <label>Sắp xếp<select name="order" defaultValue={filters.order}>{options(orders)}</select></label>
      <button type="submit">Áp dụng</button><Link href={base}>Xóa bộ lọc</Link>
    </Form>
    {query.preview && !selected && <p className="theme-feedback is-error" role="alert">Không tìm thấy component trong registry.</p>}
    <div className="themes-grid">
      {matches.slice((page-1)*size,page*size).map(item => {
        const definition = themeBlocks[item.kind];
        return <article key={item.kind} className="theme-card theme-card-body component-card">
          <div className="component-thumbnail" aria-hidden="true">
            <ThemeBlockContent block={{ ...createThemeBlock(item.kind, item.kind), limit: 2 }} data={themeComponentPreviewData} />
          </div>
          <div className="theme-card-heading"><h2><Link href={linkTo(item.kind)}>{definition.label}</Link></h2>
            <span className="theme-badge" data-status={item.status}>{componentStatuses[item.status]}</span></div>
          <code>{item.kind}</code><p>{definition.description}</p>
          <small>{componentGroups[definition.group]} · v{componentReleases(item.kind)[0].version}</small>
          <small>{item.themes} theme · {item.pages} trang · {item.releases} phiên bản có tham chiếu</small>
          <small>Đổi trạng thái {labelDate(item.updatedAt)}</small>
        </article>;
      })}
    </div>
    {matches.length <= (page-1)*size && <p className="themes-empty">Không có component phù hợp trên trang này.</p>}
    <ThemePager base={base} query={filterQuery} count={matches.length} size={size} />
    {selected && <ComponentDetails key={selected.kind + selected.status} item={selected} report={report}
      filterQuery={filterQuery} closeHref={base + "?" + params} refsPage={refsPage} />}
  </>;
}

function ComponentDetails({ item, report, filterQuery, closeHref, refsPage }: {
  item: { kind: BlockKind; status: ComponentStatus; updatedAt?: string } & Usage;
  report: Report; filterQuery: Record<string, string>; closeHref: string; refsPage: number;
}) {
  const definition = themeBlocks[item.kind];
  const releases = componentReleases(item.kind);
  const refsHref = (page: number) => `${base}?${new URLSearchParams({ ...filterQuery, preview: item.kind, refsPage: String(page) })}#component-references`;
  return <section id="component-detail" className="themes-create component-detail">
    <header className="theme-section-heading"><h2>{definition.label} · v{releases[0].version}</h2><Link href={closeHref}>Đóng chi tiết</Link></header>
    <p>{definition.description}</p>
    <dl className="component-facts">
      <div><dt>Key</dt><dd><code>{item.kind}</code></dd></div>
      <div><dt>Nhóm</dt><dd>{componentGroups[definition.group]}</dd></div>
      <div><dt>Renderer</dt><dd>{definition.renderer}</dd></div>
      <div><dt>Schema theme</dt><dd>v{definition.schema}</dd></div>
      <div><dt>Responsive</dt><dd>Desktop, Tablet, Mobile</dd></div>
      <div><dt>Ngành hàng</dt><dd>{definition.families?.map(family => themeFamilies[family]).join(", ") ?? "Dùng chung"}</dd></div>
      <div><dt>Trạng thái</dt><dd>{componentStatuses[item.status]} · {labelDate(item.updatedAt)}</dd></div>
    </dl>
    <ComponentStatusDialog kind={item.kind} status={item.status} />
    {item.status === "deprecated" && <p>Instance hiện tại tiếp tục render. Có thể chọn một component đang hoạt động làm phương án thay thế trong Studio.</p>}
    <h3>Schema cấu hình</h3>
    <div className="component-table-scroll"><table className="component-table">
      <thead><tr>{["Thuộc tính", "Kiểu", "Bắt buộc", "Mặc định", "Giới hạn"].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
      <tbody>{fieldsForComponent(item.kind).map(key => {
        const field = componentFields[key];
        return <tr key={key}><th scope="row">{field.label} <code>{key}</code></th><td>{field.type}</td>
          <td>{field.required ? "Có" : "Không"}</td><td><code>{JSON.stringify(field.default)}</code></td>
          <td>{"max" in field ? `${field.min}–${field.max}` : key === "image" ? "Khóa ảnh platform-assets" : "true / false"}</td></tr>;
      })}</tbody>
    </table></div>
    <h3>Preview</h3><ComponentPreview kind={item.kind} />
    <h3>Lịch sử phiên bản component</h3><ul>{releases.map(release => <li key={release.version}><strong>v{release.version}</strong> · {release.note}</li>)}</ul>
    <h3 id="component-references">Đang được tham chiếu</h3>
    <p>{item.themes} theme · {item.pages} trang · {item.releases} snapshot phát hành. Số theme và trang gộp bản nháp với snapshot, đếm một lần mỗi đối tượng.</p>
    {report.references.length ? <ul>{report.references.map(ref => <li key={ref.theme_id + (ref.release_id ?? "draft")}>
      <Link href={ref.release_id ? `/admin/themes/versions?theme=${ref.theme_id}&page=${ref.version_page ?? 1}&preview=${ref.release_id}` : `/admin/themes/studio?edit=${ref.theme_id}`}>
        {ref.name} · {ref.version ? `v${ref.version}` : "Bản nháp"}
      </Link>{ref.published_at && ` · ${labelDate(ref.published_at)}`}
    </li>)}</ul> : <p className="themes-empty">Chưa có tham chiếu trên trang này.</p>}
    {(refsPage > 1 || report.count > 12) && <nav className="theme-studio-tools" aria-label="Phân trang tham chiếu">
      {refsPage > 1 && <Link href={refsHref(refsPage-1)}>Trang trước</Link>}<span>Trang {refsPage}</span>
      {refsPage*12 < report.count && <Link href={refsHref(refsPage+1)}>Trang sau</Link>}
    </nav>}
  </section>;
}
