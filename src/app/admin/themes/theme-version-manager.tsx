import Form from "next/form";
import Link from "next/link";
import type { createClient } from "@/lib/supabase/server";
import ThemeBuilder from "@/components/ui/theme-builder";
import Toast from "@/components/ui/toast";
import { blockCompatible, themeBlocks } from "@/lib/theme-pages";
import { readThemeManifest, themeIdPattern } from "@/lib/theme-studio";
import { compareThemeSnapshots, themeManifestAssetKeys, type VersionDifference } from "@/lib/theme-version-management";
import OverviewRefresh from "./overview-refresh";
import { ThemePager, type Query } from "./theme-admin-sections";
import { ThemeReleaseForm, ThemeRestoreDialog } from "./theme-version-controls";
import "./theme-version-manager.css";

const base = "/admin/themes/versions";
const releaseSize = 20;
const storeSize = 15;
const text = (value: Query[string]) => typeof value === "string" ? value : "";
const id = (value: Query[string]) => themeIdPattern.test(text(value)) ? text(value) : "";
const pageNumber = (value: Query[string]) => /^[1-9][0-9]{0,4}$/.test(text(value)) && Number(value) <= 50001 ? Number(value) : 1;
const dateTime = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });
const date = (value: string) => dateTime.format(new Date(value));
const states = { current: "Bản mới nhất", outdated: "Chưa cập nhật", incompatible: "Không tương thích", inactive: "Đã ngừng sử dụng", failed: "Lần cập nhật gần nhất có lỗi" } as const;
const operations = { restore: "Khôi phục bản nháp", update: "Cập nhật", rollback: "Quay lại phiên bản cũ" } as const;
const eventStates = { success: "Thành công", conflict: "Xung đột revision", incompatible: "Không tương thích", failed: "Thất bại" } as const;
const diffStates = { added: "Thêm", modified: "Sửa", removed: "Xóa", unchanged: "Giữ nguyên" };
const snapshotColumns = "id,version,manifest,name,description,preview_url,primary_family,families,price_vnd,published_at,release_name,release_notes,compatibility_notes,change_type,update_policy,release_no";
type Client = Awaited<ReturnType<typeof createClient>>;
type Release = { id: string; version: string; release_name: string | null; release_notes: string | null; previous_version: string | null;
  compatibility_notes: string | null; change_type: string | null; published_at: string; actor: string; stores: number; eligible: number;
  incompatible: number; latest: boolean; update_policy: "manual" };
type Snapshot = { id: string; version: string; manifest: unknown; name: string; description: string; preview_url: string | null;
  primary_family: string; families: string[]; price_vnd: number; published_at: string; release_name: string | null; release_notes: string | null;
  compatibility_notes: string | null; change_type: string | null; update_policy: "manual"; release_no: number };
type Installation = { store_id: string; store_name: string; version_id: string; version: string; latest_version: string;
  live: boolean; license_revoked: boolean; state: Exclude<keyof typeof states,"failed">; updated_at: string; last_attempt: keyof typeof eventStates | null };
type Event = { id: number; operation: keyof typeof operations; status: keyof typeof eventStates; issue: string | null;
  started_at: string; finished_at: string; store_name: string | null; actor: string | null; source: string | null; target: string };
type Report = { count: number; latest: string | null; current: string | null; stores: number; outdated: number; incompatible: number;
  draft_assets: number; draft_eligible: number; store_count: number; detail: Release | null;
  releases: Release[]; installations: Installation[]; events: Event[] };

export function ThemeVersionsSkeleton() {
  return <div className="version-skeleton" role="status" aria-label="Đang tải phiên bản" />;
}

function snapshotView(snapshot: Snapshot) {
  const manifest = readThemeManifest(snapshot.manifest);
  return manifest ? { manifest, metadata: {
    name: snapshot.name, description: snapshot.description, preview_url: snapshot.preview_url,
    primary_family: snapshot.primary_family, families: [...snapshot.families].sort(), price_vnd: snapshot.price_vnd,
  } } : null;
}

function Differences({ differences }: { differences: VersionDifference[] }) {
  const changed = differences.filter(item => item.state !== "unchanged");
  const unchanged = differences.length - changed.length;
  const format = (value: unknown) => value === undefined ? "—" : JSON.stringify(value, null, 2);
  function rows(items: VersionDifference[]) {
    return <ul className="version-differences">{items.map((item, index) => <li key={index}><details>
      <summary><strong>{diffStates[item.state]}</strong> · {item.area} · {item.label}</summary>
      {item.warning && <p className="version-warning">{item.warning}</p>}
      <div className="version-compare-values"><div><strong>Trước</strong><pre>{format(item.before)}</pre></div><div><strong>Sau</strong><pre>{format(item.after)}</pre></div></div>
    </details></li>)}</ul>;
  }
  return <>
    <p>{changed.length} thay đổi · {unchanged} mục giữ nguyên · {changed.filter(item => item.warning).length} cảnh báo tương thích</p>
    {rows(changed)}
    {unchanged > 0 && <details><summary>Xem {unchanged} mục giữ nguyên</summary>{rows(differences.filter(item => item.state === "unchanged"))}</details>}
  </>;
}

export default async function ThemeVersionManager({ supabase, query }: { supabase: Client; query: Query }) {
  const themeId = id(query.theme);
  const themeTerm = text(query.themeQuery).trim().replace(/[^\p{L}\p{M}\p{N} -]/gu, "").slice(0,80);
  const selector = supabase.from("storefront_template_catalog").select("id,name");
  if (themeTerm) selector.ilike("name", `%${themeTerm}%`);
  const [themes, selected] = await Promise.all([
    selector.order("name").order("id").limit(25),
    themeId ? supabase.from("storefront_template_catalog").select("id,name,description,preview_url,primary_family,compatible_families,price_vnd,draft,draft_revision,lifecycle")
      .eq("id",themeId).maybeSingle() : null,
  ]);
  const theme = selected?.data;
  const options = themes.data ?? [];
  return <div className="version-manager">
    <header className="theme-section-heading"><p>Phát hành snapshot, so sánh và theo dõi phiên bản đang cài.</p><OverviewRefresh /></header>
    {query.message === "published" && <Toast message="Đã phát hành snapshot mới." />}
    {query.message === "restored" && <Toast message="Đã khôi phục nội dung vào bản nháp." />}
    <section className="themes-create version-panel version-selector" aria-label="Chọn giao diện">
      <Form action={base} className="themes-filters">
        {themeId && <input type="hidden" name="theme" value={themeId} />}
        <label>Tìm giao diện<input name="themeQuery" maxLength={80} defaultValue={themeTerm} /></label><button type="submit">Tìm</button>
      </Form>
      <Form action={base} className="themes-filters">
        <label>Giao diện<select name="theme" required defaultValue={theme?.id ?? ""}>
          <option value="" disabled>Chọn giao diện</option>
          {theme && !options.some(option => option.id === theme.id) && <option value={theme.id}>{theme.name}</option>}
          {options.map(option => <option value={option.id} key={option.id}>{option.name}</option>)}
        </select></label><button type="submit">Mở giao diện</button>
      </Form>
    </section>
    {themes.error || selected?.error ? <p className="theme-feedback is-error" role="alert">Chưa tải được giao diện.</p>
      : !theme ? <p className="themes-empty">{query.theme ? "Không tìm thấy giao diện." : "Chọn giao diện để xem lịch sử phiên bản."}</p>
      : <VersionData supabase={supabase} query={query} theme={theme} />}
  </div>;
}

type Theme = { id: string; name: string; description: string; preview_url: string | null; primary_family: string; compatible_families: string[];
  price_vnd: number; draft: unknown; draft_revision: number; lifecycle: string };

async function VersionData({ supabase, query, theme }: { supabase: Client; query: Query; theme: Theme }) {
  const releasePage = pageNumber(query.page);
  const storePage = pageNumber(query.storePage);
  const installVersion = id(query.installed);
  const state = Object.hasOwn(states, text(query.state)) ? text(query.state) : "";
  const previewId = id(query.preview), beforeId = id(query.compare), afterId = id(query.with);
  const ids = [...new Set([previewId,beforeId,afterId].filter(Boolean))];
  const [lookup, snapshots, latest, policy] = await Promise.all([
    supabase.rpc("admin_theme_version_report", { theme: theme.id, release_offset: (releasePage-1)*releaseSize,
      store_offset: (storePage-1)*storeSize, state_filter: state, installed_version: installVersion || null, detail_version: previewId || null }),
    ids.length ? supabase.from("storefront_theme_versions").select(snapshotColumns).eq("theme_id",theme.id).in("id",ids) : null,
    query.publish === "1" ? supabase.from("storefront_theme_versions").select(snapshotColumns).eq("theme_id",theme.id)
      .order("release_no",{ascending:false}).limit(1).maybeSingle() : null,
    query.publish === "1" ? supabase.from("storefront_theme_policy").select("max_custom_pages").maybeSingle() : null,
  ]);
  const report = lookup.data as Report | null;
  if (lookup.error || !report || snapshots?.error || latest?.error || policy?.error) return <p className="theme-feedback is-error" role="alert">Chưa tải được lịch sử phiên bản.</p>;
  const byId = new Map((snapshots?.data as Snapshot[] | undefined)?.map(snapshot => [snapshot.id,snapshot]));
  const preview = byId.get(previewId);
  const draft = readThemeManifest(theme.draft);
  const target = { theme: theme.id, revision: theme.draft_revision };
  const baseline = latest?.data ? snapshotView(latest.data as Snapshot) : null;
  const draftMetadata = { name: theme.name, description: theme.description, preview_url: theme.preview_url, primary_family: theme.primary_family,
    families: [...theme.compatible_families,theme.primary_family].sort(), price_vnd: theme.price_vnd };
  const draftDiff = draft && baseline ? compareThemeSnapshots(baseline, { manifest: draft, metadata: draftMetadata }) : [];
  const blockers = [
    !draft ? "Manifest bản nháp chưa hợp lệ." : "",
    report.draft_assets ? `Thiếu ${report.draft_assets} ảnh trong Storage.` : "",
    draft && policy?.data && (draft.pages?.filter(page => page.kind === "custom").length ?? 0)>policy.data.max_custom_pages ? "Đã vượt giới hạn trang tùy chỉnh." : "",
    draft?.pages?.some(page => page.blocks.some(block => !draftMetadata.families.some(family => blockCompatible(block.kind,family))))
      ? "Có component không tương thích với ngành hàng của giao diện." : "",
  ].filter(Boolean);
  const filters = { theme: theme.id, page: String(releasePage), ...(previewId ? { preview: previewId } : {}),
    ...(beforeId ? { compare: beforeId } : {}), ...(afterId ? { with: afterId } : {}), ...(installVersion ? { installed: installVersion } : {}),
    ...(state ? { state } : {}), ...(storePage > 1 ? { storePage: String(storePage) } : {}) };
  const href = (extra: Record<string,string>, hash = "") => `${base}?${new URLSearchParams({ ...filters, ...extra })}${hash}`;
  const a = byId.get(beforeId), b = byId.get(afterId);
  const left = a && snapshotView(a), right = b && snapshotView(b);
  const compareOptions = new Map<string,string>(report.releases.map(release => [release.id,release.version]));
  for (const snapshot of byId.values()) compareOptions.set(snapshot.id,snapshot.version);
  return <>
    <div className="theme-studio-tools"><h2>{theme.name}</h2>
      <Link className="theme-primary" href={href({ publish: "1" },"#version-publish")}>Phát hành phiên bản mới</Link>
      <Link href={`/admin/themes/studio?edit=${theme.id}`}>Mở Theme Studio</Link>
    </div>
    <div className="theme-metrics">{Object.entries({
      "Revision bản nháp": theme.draft_revision, "Phổ biến nhất đang cài": report.current ?? "—", "Mới nhất": report.latest ?? "—",
      "Đã phát hành": report.count, "Cửa hàng đang dùng": report.stores, "Chưa cập nhật": report.outdated, "Không tương thích": report.incompatible,
    }).map(([label,value]) => <article className="theme-card theme-card-body" key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>
    {query.publish === "1" && <section className="themes-create version-panel" id="version-publish">
      <h2>Phát hành · {theme.name}</h2><p>Bản nháp revision {theme.draft_revision} · Chính sách cập nhật thủ công.</p>
      {theme.lifecycle === "archived" && <p>Giao diện đang lưu trữ. Snapshot mới vẫn giữ trạng thái phân phối hiện tại.</p>}
      {blockers.length ? <ul className="version-warning">{blockers.map(item => <li key={item}>{item}</li>)}</ul> : <>
        <p>Bản nháp hợp lệ. Máy chủ sẽ kiểm tra lại schema, tài nguyên và revision khi xác nhận.</p>
        {draft && <details><summary>Xem bản nháp</summary><ThemeBuilder initial={draft} readOnly pagePreview family={theme.primary_family} /></details>}
        {draftDiff.length > 0 && <details><summary>Kiểm tra thay đổi so với bản mới nhất</summary><Differences differences={draftDiff} /></details>}
        <ThemeReleaseForm key={theme.draft_revision} {...target} latest={report.latest} eligible={report.draft_eligible}
          changes={draftDiff.filter(item => item.state !== "unchanged").map(({ area, label, state, warning }) => ({ area,label,state,warning }))} />
      </>}
    </section>}
    <section className="themes-create version-panel">
      <h2>Lịch sử phát hành</h2>
      {!report.releases.length ? <p className="themes-empty">Chưa có phiên bản trên trang này.</p> : <div className="version-scroll" tabIndex={0} aria-label="Lịch sử phát hành">
        <table className="version-table"><thead><tr>{["Phiên bản", "Phát hành", "Trạng thái", "Đang dùng", "Có thể cập nhật", "Thao tác"].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
          <tbody>{report.releases.map(release => <tr key={release.id}>
            <th scope="row">v{release.version}<small>{release.release_name ?? "Chưa ghi tên phát hành"}</small>
              {release.release_notes && <small className="version-excerpt">{release.release_notes}</small>}</th>
            <td>{date(release.published_at)}<small>{release.actor}</small></td>
            <td>{release.latest ? "Đã phát hành · Mới nhất" : "Đã phát hành · Có bản mới hơn"}</td>
            <td>{release.stores}</td><td>{release.eligible} theo ngành<small>{release.incompatible} không tương thích ngành</small></td>
            <td><div className="theme-studio-tools">
              <Link href={href({ preview: release.id },"#version-preview")}>Chi tiết</Link>
              <Link href={href({ compare: release.id },"#version-compare")}>Chọn để so sánh</Link>
              <Link href={href({ installed: release.id, storePage: "1" },"#version-installations")}>Cửa hàng</Link>
            </div></td>
          </tr>)}</tbody>
        </table>
      </div>}
      <ThemePager base={base} query={filters} count={report.count} size={releaseSize} />
    </section>
    {query.preview && !preview && <p className="theme-feedback is-error" role="alert">Phiên bản không thuộc giao diện này hoặc không còn khả dụng.</p>}
    {preview && <VersionPreview preview={preview} report={report} target={target} />}
    {report.count > 1 && <section className="themes-create version-panel" id="version-compare">
      <h2>So sánh hai phiên bản</h2>
      <Form action={base} className="themes-filters">
        <input type="hidden" name="theme" value={theme.id} /><input type="hidden" name="page" value={releasePage} />
        {previewId && <input type="hidden" name="preview" value={previewId} />}
        <label>Phiên bản trước<select name="compare" required defaultValue={beforeId}><option value="">Chọn phiên bản</option>
          {[...compareOptions].map(([id,version]) => <option key={id} value={id}>v{version}</option>)}</select></label>
        <label>Phiên bản sau<select name="with" required defaultValue={afterId}><option value="">Chọn phiên bản</option>
          {[...compareOptions].map(([id,version]) => <option key={id} value={id}>v{version}</option>)}</select></label>
        <button type="submit">So sánh</button>
      </Form>
      {beforeId && afterId && (!left || !right || beforeId===afterId ? <p role="alert">Chọn hai snapshot hợp lệ và khác nhau của cùng một giao diện.</p> :
        <Differences differences={compareThemeSnapshots(left,right)} />)}
    </section>}
    <section className="themes-create version-panel" id="version-installations">
      <h2>Phiên bản đang cài</h2>
      <Form action={base} className="themes-filters">
        <input type="hidden" name="theme" value={theme.id} /><input type="hidden" name="page" value={releasePage} />
        {installVersion && <input type="hidden" name="installed" value={installVersion} />}
        <label>Trạng thái<select name="state" defaultValue={state}><option value="">Tất cả</option>
          {Object.entries(states).map(([key,label]) => <option key={key} value={key}>{label}</option>)}
        </select></label><button type="submit">Lọc cửa hàng</button>
        {installVersion && <Link href={href({ installed: "", storePage: "1" },"#version-installations")}>Xóa lọc phiên bản</Link>}
      </Form>
      {report.installations.length ? <div className="version-scroll" tabIndex={0} aria-label="Danh sách cửa hàng"><table className="version-table">
        <thead><tr>{["Cửa hàng / Giao diện","Giấy phép","Bản đang cài","Bản mới nhất","Tình trạng","Cập nhật gần nhất"].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{report.installations.map(item => <tr key={item.store_id}><th scope="row">{item.store_name}<small>{theme.name}</small></th>
          <td>{item.license_revoked ? "Đã thu hồi" : "Còn hiệu lực"}</td><td>v{item.version}</td><td>v{item.latest_version}</td>
          <td>{states[item.state]}<small>{item.live ? "Đang hiển thị" : "Chưa hiển thị"}{item.last_attempt && ` · ${eventStates[item.last_attempt]}`}</small></td>
          <td>{date(item.updated_at)}</td></tr>)}</tbody>
      </table></div> : <p className="themes-empty">Không có lượt cài phù hợp.</p>}
      {(storePage>1 || storePage*storeSize<report.store_count) && <nav className="theme-studio-tools" aria-label="Phân trang cửa hàng">
        {storePage>1 && <Link href={href({ storePage: String(storePage-1) },"#version-installations")}>Trang trước</Link>}
        <span>Trang {storePage}</span>
        {storePage*storeSize<report.store_count && <Link href={href({ storePage: String(storePage+1) },"#version-installations")}>Trang sau</Link>}
      </nav>}
    </section>
    <section className="themes-create version-panel"><h2>Hoạt động phiên bản gần đây</h2>
      {report.events.length ? <ul>{report.events.map(event => <li key={event.id}>
        <strong>{operations[event.operation]} · {eventStates[event.status]}</strong>
        <p>{event.store_name ?? "Bản nháp nền tảng"} · {event.source ? `v${event.source} → ` : ""}v{event.target} · {event.actor ?? "Chưa ghi tên"}</p>
        <small>{date(event.started_at)} – {date(event.finished_at)}{event.issue && ` · ${event.issue}`}</small>
      </li>)}</ul> : <p className="themes-empty">Chưa có hoạt động cập nhật hoặc khôi phục.</p>}
    </section>
  </>;
}

function VersionPreview({ preview, report, target }: { preview: Snapshot; report: Report; target: { theme: string; revision: number } }) {
  const snapshot = snapshotView(preview);
  const release = report.detail;
  const assets = snapshot ? themeManifestAssetKeys(snapshot.manifest) : [];
  return <section className="themes-create version-panel" id="version-preview">
    <header className="theme-section-heading"><h2>v{preview.version} · {preview.release_name ?? preview.name}</h2>
      <Link href={`${base}?theme=${target.theme}&installed=${preview.id}#version-installations`}>Cửa hàng dùng phiên bản</Link></header>
    <p>{date(preview.published_at)} · {release?.actor ?? "Đã ghi nhận trong lịch sử"} · {preview.version === report.latest ? "Bản mới nhất" : "Có bản mới hơn"} · Cập nhật thủ công{preview.change_type && ` · ${preview.change_type}`}</p>
    {release && <p>Phiên bản trước {release.previous_version ?? "—"} · {release.stores} cửa hàng đang dùng · {release.eligible} có thể cập nhật theo ngành · {release.incompatible} không tương thích ngành</p>}
    <h3>Ghi chú phát hành</h3><p className="version-notes">{preview.release_notes || "Chưa có ghi chú."}</p>
    <h3>Ghi chú tương thích</h3><p className="version-notes">{preview.compatibility_notes || "Chưa có ghi chú."}</p>
    {snapshot ? <>
      <p>Schema v{snapshot.manifest.schemaVersion ?? 1} · {snapshot.manifest.pages?.length ?? 0} trang · {assets.length} ảnh nội dung.</p>
      <ThemeBuilder key={preview.id} initial={snapshot.manifest} readOnly pagePreview family={preview.primary_family} />
      <details><summary>Trang, component và thiết kế toàn cục</summary>
        <ul>{snapshot.manifest.pages?.map(page => <li key={page.id}>{page.title || page.slug} · {page.blocks.map(block => themeBlocks[block.kind].label).join(", ") || "Chưa có component"}</li>)}</ul>
        <pre className="theme-manifest">{JSON.stringify(snapshot.manifest,null,2)}</pre>
      </details>
      {assets.length > 0 && <details><summary>Tham chiếu tài nguyên</summary><ul>{assets.map(asset => <li key={asset}><code>{asset}</code></li>)}</ul></details>}
      <ThemeRestoreDialog key={preview.id + target.revision} {...target} release={preview.id} version={preview.version} />
    </> : <p role="alert">Snapshot không qua kiểm tra schema nên chưa thể xem trước.</p>}
  </section>;
}
