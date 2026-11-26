import Link from "next/link";
import type { createClient } from "@/lib/supabase/server";
import { manageThemeLicense, setThemeSupportPriority, updateThemeAdmin } from "./actions";

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

export async function ThemePolicy({ supabase }: Input) {
  const { data, error } = await supabase.from("storefront_theme_policy").select("marketplace_open,max_custom_pages").maybeSingle();
  if (error || !data) return <p role="alert">Chưa tải được cấu hình theme.</p>;
  return <form action={updateThemeAdmin} className="theme-form themes-create">
    <label><input type="checkbox" name="marketplace_open" defaultChecked={data.marketplace_open} /> Cho phép nhận và mua theme mới</label>
    <label>Số trang tùy chỉnh tối đa<input name="max_custom_pages" type="number" min="0" max="16" defaultValue={data.max_custom_pages} required /></label>
    <p>Giới hạn trang áp dụng khi phát hành phiên bản mới.</p>
    <Link href="/admin/themes/components">Quản lý trạng thái component</Link>
    <Link href="/admin/business-categories">Quản lý ngành hàng</Link>
    <button className="theme-primary" name="command" value="policy">Lưu cấu hình</button>
  </form>;
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
