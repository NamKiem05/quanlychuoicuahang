import Link from "next/link";
import { themeFamilies, themeIdPattern } from "@/lib/theme-studio";
import { themeBlocks, blockCompatible, type BlockKind } from "@/lib/theme-pages";
import type { createClient } from "@/lib/supabase/server";
import { manageThemeLicense, restoreThemeDraft, setThemeSupportPriority, updateThemeAdmin } from "./actions";
import { readThemeManifest, defaultThemeManifest } from "@/lib/theme-studio";
import ThemeBuilder from "@/components/ui/theme-builder";

export type Query = Record<string, string | string[] | undefined>;
type Client = Awaited<ReturnType<typeof createClient>>;
type Input = { supabase: Client; query: Query };
const vnd = new Intl.NumberFormat("vi-VN",{style:"currency",currency:"VND"});
const date = new Intl.DateTimeFormat("vi-VN",{dateStyle:"short",timeStyle:"short",timeZone:"Asia/Ho_Chi_Minh"});
const day = (value:string) => date.format(new Date(value));
const string = (value: unknown) => typeof value === "string" ? value : "";
const term = (query:Query) => string(query.q).trim().slice(0,80);
const pageNumber = (query:Query) => /^[1-9][0-9]{0,5}$/.test(string(query.page)) ? Number(query.page) : 1;
const empty = (message: string) => <p className="themes-empty">{message}</p>;

export function ThemePager({ base, query, count, size=20 }: { base:string; query:Query; count:number; size?:number }) {
  const page = pageNumber(query);
  function href(next:number) {
    const params = new URLSearchParams();
    for (const [key,value] of Object.entries(query)) if (typeof value === "string" && key !== "message") params.set(key,value);
    params.set("page",String(next));
    return base+"?"+params;
  }
  return page > 1 || count > size ? <nav aria-label="Phân trang" className="theme-studio-tools">
    {page>1 && <Link className="theme-secondary" href={href(page-1)}>Trang trước</Link>}<span>Trang {page}</span>
    {page*size<count && <Link className="theme-secondary" href={href(page+1)}>Trang sau</Link>}
  </nav> : null;
}

type Metrics = {
  total:number; draft:number; published:number; selling:number; stores:number; licenses:number; orders:number; revenue:number;
  monthly:{month:string;amount:number}[] | null; families:{family:keyof typeof themeFamilies;count:number}[] | null;
  popular:{name:string;count:number}[] | null; releases:{name:string;version:string;published_at:string}[] | null;
  orders_recent:{transfer_code:string;amount_vnd:number;confirmed_at:string|null;created_at:string}[] | null;
  activity:{event_at:string;kind:string;name:string}[] | null;
};
export async function ThemeOverview({supabase}:Input) {
  const {data,error} = await supabase.rpc("admin_theme_dashboard");
  if (error || !data) return <p role="alert">Chưa tải được thống kê. Kiểm tra migration quản lý giao diện.</p>;
  const stats = data as Metrics;
  const labels = { total:"Tổng số theme",draft:"Bản nháp",published:"Đã phát hành",selling:"Theme đang bán",stores:"Cửa hàng đang dùng",licenses:"License đã cấp",orders:"Đơn mua",revenue:"Doanh thu đã xác nhận" } as const;
  const peak = Math.max(1,...(stats.monthly ?? []).map(point => point.amount));
  const activityLabels: Record<string,string> = { published:"Phát hành",granted:"Cấp giấy phép",revoked:"Thu hồi giấy phép",confirmed:"Xác nhận chuyển khoản" };
  return <>
    <div className="theme-metrics">{Object.entries(labels).map(([id,label]) => <article className="theme-card theme-card-body" key={id}><span>{label}</span><strong>{id==="revenue" ? vnd.format(stats.revenue) : stats[id as keyof typeof labels].toLocaleString("vi-VN")}</strong></article>)}</div>
    <div className="theme-admin-grid">
      <section className="themes-create"><h2>Doanh thu 12 tháng gần đây</h2>{stats.monthly?.length ? <ul className="theme-revenue">{stats.monthly.map(item => <li key={item.month}><span>{item.month}</span><meter min={0} max={peak} value={item.amount} aria-label={item.month} /><strong>{vnd.format(item.amount)}</strong></li>)}</ul> : empty("Chưa có doanh thu được xác nhận.")}</section>
      <section className="themes-create"><h2>Ngành hàng</h2>{stats.families?.length ? <ul>{stats.families.map(row => <li key={row.family}>{themeFamilies[row.family]} · {row.count} theme</li>)}</ul> : empty("Chưa có dữ liệu ngành hàng.")}</section>
      <section className="themes-create"><h2>Được sử dụng nhiều nhất</h2>{stats.popular?.length ? <ol>{stats.popular.map((row,index) => <li key={index}>{row.name} · {row.count} cửa hàng</li>)}</ol> : empty("Chưa có cửa hàng kích hoạt theme.")}</section>
      <section className="themes-create"><h2>Phát hành gần đây</h2>{stats.releases?.length ? <ul>{stats.releases.map((row,index) => <li key={index}>{row.name} · {row.version} · {day(row.published_at)}</li>)}</ul> : empty("Chưa có phiên bản phát hành.")}</section>
      <section className="themes-create"><h2>Đơn mua gần đây</h2>{stats.orders_recent?.length ? <ul>{stats.orders_recent.map(row => <li key={row.transfer_code}>{row.transfer_code} · {vnd.format(row.amount_vnd)} · {row.confirmed_at ? "Đã xác nhận" : "Chờ đối soát"}</li>)}</ul> : empty("Chưa có đơn mua.")}</section>
      <section className="themes-create"><h2>Hoạt động gần đây</h2>{stats.activity?.length ? <ul>{stats.activity.map((row,index) => <li key={index}>{activityLabels[row.kind]} · {row.name} · {day(row.event_at)}</li>)}</ul> : empty("Chưa có hoạt động.")}</section>
    </div>
  </>;
}

export async function ThemePolicy({supabase,query,components=false}:Input & {components?:boolean}) {
  const {data,error} = await supabase.from("storefront_theme_policy").select("marketplace_open,max_custom_pages,disabled_components").maybeSingle();
  if (error || !data) return <p role="alert">Chưa tải được cấu hình theme.</p>;
  const blocked: string[] = data.disabled_components;
  const family=string(query.family);
  const group=string(query.group);
  const entries=(Object.keys(themeBlocks) as BlockKind[]).filter(id => !components || (
    (!family || blockCompatible(id,family)) && (!group || themeBlocks[id].source===group)
    && themeBlocks[id].label.toLowerCase().includes(term(query).toLowerCase())));
  const preview=string(query.preview);
  const previewKind=Object.hasOwn(themeBlocks,preview) ? preview as BlockKind : null;
  return <>
    {components && <form className="themes-filters">
      <label>Tìm component<input name="q" defaultValue={term(query)} /></label>
      <label>Ngành hàng<select name="family" defaultValue={family}><option value="">Tất cả</option>{Object.entries(themeFamilies).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label>Nguồn dữ liệu<select name="group" defaultValue={group}><option value="">Tất cả</option><option value="catalog">Sản phẩm</option><option value="categories">Danh mục</option><option value="store">Cửa hàng</option><option value="reviews">Đánh giá</option><option value="text">Nội dung</option></select></label>
      <button>Tìm</button>
    </form>}
    <form action={updateThemeAdmin} className="theme-form themes-create">
      {!components && <>
        <label><input type="checkbox" name="marketplace_open" defaultChecked={data.marketplace_open} /> Cho phép nhận và mua theme mới</label>
        <label>Số trang tùy chỉnh tối đa<input name="max_custom_pages" type="number" min={0} max={16} defaultValue={data.max_custom_pages} required /></label>
        <p>Chính sách component và số trang áp dụng khi phát hành phiên bản mới.</p>
        <Link href="/admin/business-categories">Quản lý ngành hàng</Link>
        <p>Phiên bản dùng dạng major.minor.patch. Giấy phép gắn với cửa hàng; cập nhật phiên bản do chủ cửa hàng chọn.</p>
      </>}
      <div className="themes-grid">{entries.map(id => <div className="theme-card theme-card-body" key={id}>
        <h3>{themeBlocks[id].label}</h3><p>{themeBlocks[id].families?.map(key => themeFamilies[key]).join(", ") ?? "Dùng chung"}</p>
        <label><input name="disabled" type="checkbox" defaultChecked={blocked.includes(id)} value={id} /> Chặn trong phiên bản mới</label>
        {components && <Link href={"/admin/themes/components?preview="+id}>Xem trước</Link>}
      </div>)}</div>
      {blocked.filter(id=>!entries.includes(id as BlockKind)).map(id=><input key={id} type="hidden" name="disabled" value={id} />)}
      {!entries.length && empty("Không tìm thấy component phù hợp.")}
      <button className="theme-primary" name="command" value={components ? "components" : "policy"}>Lưu cấu hình</button>
    </form>
    {components && previewKind && <section className="themes-create"><h2>{themeBlocks[previewKind].label}</h2><p>Xem trước cấu trúc và nguồn dữ liệu.</p>
      <ThemeBuilder readOnly initial={{...defaultThemeManifest,schemaVersion:2,pages:[{id:"10000000-0000-4000-8000-000000000001",kind:"home",slug:"home",title:"Trang chủ",description:"",visible:true,blocks:[{id:"10000000-0000-4000-8000-000000000002",kind:previewKind,title:themeBlocks[previewKind].label,copy:"",limit:6,hidden:false}]}]}} />
    </section>}
  </>;
}

export async function ThemeVersions({supabase,query}:Input) {
  const theme=string(query.theme);
  const page=pageNumber(query);
  const request=supabase.from("storefront_theme_versions").select("id,theme_id,name,version,primary_family,published_at,manifest",{count:"exact"});
  if (themeIdPattern.test(theme)) request.eq("theme_id",theme);
  const [result,themeRow,usage] = await Promise.all([
    request.order("release_no",{ascending:false}).range((page-1)*20,page*20-1),
    themeIdPattern.test(theme) ? supabase.from("storefront_template_catalog").select("id,name,draft_revision").eq("id",theme).maybeSingle() : null,
    themeIdPattern.test(theme) ? supabase.rpc("admin_theme_version_usage",{theme}) : null,
  ]);
  if (result.error) return <p role="alert">Chưa tải được lịch sử phiên bản.</p>;
  const rows=result.data ?? [];
  const themeRecord = themeRow?.data;
  const comparison=rows.find(row => row.id===string(query.compare));
  const usageMap = new Map<string, number>((usage?.data ?? []).map((item:{id:string;count:number}) => [item.id,item.count]));
  return <>
    <div className="theme-studio-tools">{themeRow?.data && <Link className="theme-primary" href={"/admin/themes/studio?edit="+theme}>Mở Theme Studio</Link>}<Link href="/admin/themes">Chọn theme từ kho giao diện</Link>{theme && <Link href="/admin/themes/versions">Xem mọi theme</Link>}</div>
    {!rows.length && empty("Chưa có phiên bản phù hợp.")}
    {rows.map(row => {
      const manifest=readThemeManifest(row.manifest);
      const baseline=comparison && comparison.theme_id===row.theme_id && comparison.id!==row.id ? readThemeManifest(comparison.manifest) : null;
      const changed=baseline && manifest ? (Object.keys(manifest) as (keyof typeof manifest)[]).filter(key=>JSON.stringify(manifest[key])!==JSON.stringify(baseline[key])) : null;
      return <details className="themes-create" key={row.id} open={row.id===query.preview || row.id===query.compare}><summary>{row.name} · v{row.version} · {day(row.published_at)}</summary>
        <p>{manifest ? "Manifest tương thích" : "Manifest không tương thích"}{usageMap.has(row.id) ? " · "+usageMap.get(row.id)+" cửa hàng đang dùng" : ""}</p>
        {changed && <p>So với v{comparison?.version} · {changed.length ? changed.join(", ") : "Không có thay đổi cấu hình"}</p>}
        <Link href={"/admin/themes/versions?"+new URLSearchParams({...(theme ? {theme}:{}),page:String(page),compare:row.id})}>Chọn làm mốc so sánh</Link>
        {manifest && <p><Link href={"/admin/themes/versions?"+new URLSearchParams({...(theme ? {theme}:{}),page:String(page),preview:row.id})}>Xem trước phiên bản</Link></p>}
        {manifest && row.id===query.preview && <ThemeBuilder initial={manifest} readOnly />}
        {manifest && <details><summary>Xem cấu hình</summary><pre className="theme-manifest">{JSON.stringify(manifest,null,2)}</pre></details>}
        {themeRecord && themeRecord.id===row.theme_id && manifest && <form action={restoreThemeDraft} className="theme-form">
          <input type="hidden" name="theme" value={theme} /><input type="hidden" name="release" value={row.id} /><input type="hidden" name="revision" value={themeRecord.draft_revision} />
          <label><input type="checkbox" name="confirm" value="yes" required /> Xác nhận thay nội dung bản nháp bằng phiên bản này</label><button className="theme-secondary">Khôi phục vào bản nháp</button>
        </form>}
      </details>;
    })}
    <ThemePager base="/admin/themes/versions" query={query} count={result.count??0} />
  </>;
}
type License = {
  store_id:string; theme_id:string; store_name:string; theme_name:string; owner_name:string; version:string;
  granted_at:string; granted_by:string|null; grant_reason:string|null; revoked_at:string|null; revoked_by:string|null;
  revocation_reason:string|null; purchase_id:string|null; in_use:boolean;
};
export async function ThemeLicenses({supabase,query}:Input) {
  const state=["active","revoked"].includes(string(query.status)) ? string(query.status) : "";
  const showAllOrders = query.orders === "all";
  const orderPage = pageNumber({ page: query.orderPage });
  const orderQuery = supabase.from("storefront_theme_purchases").select("id,theme_id,store_id,amount_vnd,transfer_code,confirmed_at,created_at", { count:"exact" });
  if (!showAllOrders) orderQuery.is("confirmed_at",null);
  const [licenses,orders] = await Promise.all([
    supabase.rpc("admin_list_theme_licenses",{term:term(query),state,offset_at:(pageNumber(query)-1)*20}),
    orderQuery.order("created_at",{ascending:false}).order("id").range((orderPage-1)*20,orderPage*20-1),
  ]);
  const result=licenses.data as { count:number; rows:License[] } | null;
  const orderHref = (next:number, all=showAllOrders) => "/admin/themes/licenses?"+new URLSearchParams({
    ...(term(query) ? { q:term(query) } : {}), ...(state ? { status:state } : {}),
    ...(pageNumber(query)>1 ? { page:String(pageNumber(query)) } : {}), ...(all ? { orders:"all" } : {}),
    ...(next>1 ? { orderPage:String(next) } : {}),
  })+"#theme-orders";
  return <>
    <form className="themes-filters">
      <label>Tìm cửa hàng, chủ hoặc theme<input name="q" maxLength={80} defaultValue={term(query)} /></label>
      <label>Trạng thái<select name="status" defaultValue={state}><option value="">Tất cả</option><option value="active">Đang hiệu lực</option><option value="revoked">Đã thu hồi</option></select></label><button>Tìm</button>
    </form>
    {licenses.error ? <p role="alert">Chưa tải được danh sách giấy phép.</p> : !result?.rows.length ? empty("Không có giấy phép phù hợp.") : result.rows.map(row => <details className="themes-create" key={row.store_id+row.theme_id}>
      <summary>{row.store_name} · {row.theme_name} · {row.revoked_at ? "Đã thu hồi" : "Đang hiệu lực"}</summary>
      <p>{row.owner_name || "Chưa có tên người đứng tài khoản"} · v{row.version} · {row.purchase_id ? "Mua trả phí" : "Miễn phí"}{row.in_use ? " · Đang được sử dụng" : ""}</p>
      <p>Cấp {day(row.granted_at)}{row.granted_by ? " · Admin "+row.granted_by : ""}{row.grant_reason ? " · "+row.grant_reason : ""}</p>
      <small>Mã cửa hàng {row.store_id} · Mã theme {row.theme_id}{row.purchase_id ? " · Đơn "+row.purchase_id : ""}</small>
      {row.revoked_at ? <p>Thu hồi {day(row.revoked_at)} · {row.revoked_by} · {row.revocation_reason}</p> :
        <form action={manageThemeLicense} className="theme-form">
          <input type="hidden" name="store" value={row.store_id} /><input type="hidden" name="theme" value={row.theme_id} />
          <label>Lý do thu hồi<textarea name="reason" required minLength={5} maxLength={500} /></label>
          <button className="theme-secondary" name="command" value="revoke">Xác nhận thu hồi</button>
        </form>}
    </details>)}
    <ThemePager base="/admin/themes/licenses" query={query} count={result?.count??0} />
    <section className="themes-create"><h2>Cấp giấy phép miễn phí</h2>
      <form action={manageThemeLicense} className="theme-form">
        <label>Mã cửa hàng<input name="store" required /></label><label>Mã theme miễn phí<input name="theme" required /></label>
        <label>Lý do cấp<textarea name="reason" required minLength={5} maxLength={500} /></label><button className="theme-primary" name="command" value="grant">Xác nhận cấp</button>
      </form>
    </section>
    <section className="themes-create" id="theme-orders"><header className="theme-section-heading"><h2>{showAllOrders ? "Tất cả đơn mua" : "Đơn chờ đối soát"}</h2><Link href={orderHref(1,!showAllOrders)}>{showAllOrders ? "Chỉ xem đơn chờ" : "Xem mọi đơn"}</Link></header>
      {orders.error ? <p role="alert">Chưa tải được đơn mua.</p> : !orders.data?.length ? empty("Chưa có đơn mua.") : orders.data.map(order => <details className="theme-edit" key={order.id}>
        <summary>{order.transfer_code} · {vnd.format(order.amount_vnd)} · {order.confirmed_at ? "Đã xác nhận" : "Chờ đối soát"}</summary>
        <p>Cửa hàng {order.store_id} · Theme {order.theme_id} · {day(order.created_at)}</p>
        {!order.confirmed_at && <form action={manageThemeLicense} className="theme-form">
          <input type="hidden" name="purchase" value={order.id} /><label>Số tiền đã đối chiếu<input type="number" min={1} name="amount" required /></label>
          <label>Mã giao dịch ngân hàng<input name="reference" minLength={3} maxLength={120} required /></label>
          <button className="theme-primary">Xác nhận đã nhận tiền</button>
        </form>}
      </details>)}
      {!orders.error && (orderPage>1 || orderPage*20<(orders.count??0)) && <nav className="theme-studio-tools" aria-label="Phân trang đơn mua">
        {orderPage>1 && <Link href={orderHref(orderPage-1)}>Trang trước</Link>}<span>Trang {orderPage}</span>
        {orderPage*20<(orders.count??0) && <Link href={orderHref(orderPage+1)}>Trang sau</Link>}
      </nav>}
    </section>
  </>;
}

const statuses={open:"Mới tiếp nhận",in_progress:"Đang xử lý",resolved:"Đã giải quyết",closed:"Đã đóng"} as const;
const levels={low:"Thấp",normal:"Bình thường",high:"Cao"} as const;
export async function ThemeSupport({supabase,query}:Input) {
  const status=string(query.status);
  const priority=string(query.priority);
  const q=term(query).replace(/[^\p{L}\p{N} .-]/gu,"");
  const page=pageNumber(query);
  const request=supabase.from("support_tickets").select("id,subject,status,priority,assigned_to,created_at,store_id",{count:"exact"}).eq("category","website");
  if (Object.hasOwn(statuses,status)) request.eq("status",status);
  if (Object.hasOwn(levels,priority)) request.eq("priority",priority);
  if (q) request.ilike("subject", "%"+q+"%");
  const result=await request.order("created_at",{ascending:false}).order("id").range((page-1)*20,page*20-1);
  return <>
    <p>Hàng đợi Website dùng chung với hệ thống hỗ trợ GrowDesk. Mở chi tiết để phản hồi, phân công hoặc đổi trạng thái.</p>
    <form className="themes-filters">
      <label>Tiêu đề<input name="q" defaultValue={q} maxLength={80} /></label>
      <label>Trạng thái<select name="status" defaultValue={status}><option value="">Tất cả</option>{Object.entries(statuses).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
      <label>Ưu tiên<select name="priority" defaultValue={priority}><option value="">Tất cả</option>{Object.entries(levels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><button>Tìm</button>
    </form>
    {result.error ? <p role="alert">Chưa tải được yêu cầu hỗ trợ.</p> : !result.data?.length ? empty("Không có yêu cầu phù hợp.") : result.data.map(ticket => <article className="themes-create" key={ticket.id}>
      <div className="theme-section-heading"><Link href={"/admin/tickets/"+ticket.id}>{ticket.subject}</Link><span>{statuses[ticket.status as keyof typeof statuses]} · {day(ticket.created_at)}</span></div>
      <form action={setThemeSupportPriority} className="theme-form">
        <input type="hidden" name="ticket" value={ticket.id} /><label>Ưu tiên<select name="level" defaultValue={ticket.priority}>{Object.entries(levels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><button className="theme-secondary">Lưu ưu tiên</button>
      </form>
    </article>)}
    <ThemePager base="/admin/themes/support" query={query} count={result.count??0} />
  </>;
}
