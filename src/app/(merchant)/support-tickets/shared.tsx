import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createTicket, replyTicket, updateTicket, rateTicket, uploadTicketAttachment } from "./actions";
import "./tickets.css";

type Client = Awaited<ReturnType<typeof createClient>>;
type Store = { id: string; name: string };
type Admin = { id: string; name: string };
export const categories: Record<string, string> = { account: "Tài khoản", billing: "Thanh toán & gói", website: "Website & tên miền", orders: "Đơn hàng", other: "Khác" };
export const statuses: Record<string, string> = { open: "Mới", in_progress: "Đang xử lý", resolved: "Đã giải quyết", closed: "Đã đóng" };
const dates = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });
function date(value: string | null) { return value ? dates.format(new Date(value)) : "—"; }
function duration(start: string, end: string | null) {
  if (!end) return "Chưa hoàn tất";
  const minutes = Math.max(0, Math.floor((Date.parse(end) - Date.parse(start)) / 60000));
  return `${Math.floor(minutes / 60)} giờ ${minutes % 60} phút`;
}

export async function TicketList({ supabase, admin, stores, storeId, message, page }: { supabase: Client; admin: boolean; stores: Store[]; storeId?: string; message?: string; page: number }) {
  const base = admin ? "/admin/tickets" : "/dashboard/tickets";
  const start = (page - 1) * 25;
  let request = supabase.from("support_tickets").select("id, store_id, subject, category, status, created_at, updated_at, resolved_at", { count: "exact" }).order("created_at", { ascending: false }).order("id").range(start, start + 24);
  if (!admin && storeId) request = request.eq("store_id", storeId);
  const result = !admin && !storeId ? null : await request;
  const storeNames = new Map(stores.map((store) => [store.id, store.name]));
  return <main className="admin-content tickets-page"><header className="tickets-heading"><span aria-hidden="true">✉</span><div><div className="dashboard-kicker">HỖ TRỢ</div><h1 className="admin-page-title">Yêu cầu hỗ trợ</h1><p>Theo dõi và trao đổi theo từng yêu cầu.</p></div><a className="ticket-primary" href="#new-ticket">+ Tạo yêu cầu</a></header>
    {message && <p className="admin-error" role="alert">Không tạo được yêu cầu. Kiểm tra thông tin và cơ sở dữ liệu.</p>}
    {result?.error && <p className="admin-error" role="alert">Chưa tải được ticket. Cần chạy migration 202611180009_support_tickets.sql.</p>}
    {!admin && !storeId && <p className="tickets-note">Bạn cần có cửa hàng trước khi gửi yêu cầu hỗ trợ.</p>}
    <section className="tickets-panel"><div className="tickets-panel-heading"><div><h2>Danh sách yêu cầu</h2><p>{result && !result.error ? `${(result.count ?? 0).toLocaleString("vi-VN")} yêu cầu` : "Danh sách hỗ trợ"}</p></div></div>
      {result && !result.error && (result.data?.length ? <div className="tickets-table-wrap"><table><thead><tr><th>Yêu cầu</th>{admin && <th>Cửa hàng</th>}<th>Phân loại</th><th>Trạng thái</th><th>Ngày tạo</th><th /></tr></thead><tbody>{result.data.map((ticket) => <tr key={ticket.id}><td><Link className="ticket-subject" href={`${base}/${ticket.id}`}>{ticket.subject}</Link><small>#{ticket.id.slice(0,8).toUpperCase()}</small></td>{admin && <td>{storeNames.get(ticket.store_id) ?? "Không tải được"}</td>}<td>{categories[ticket.category]}</td><td><span className={`ticket-status is-${ticket.status}`}>{statuses[ticket.status]}</span></td><td>{date(ticket.created_at)}</td><td><Link href={`${base}/${ticket.id}`}>Chi tiết →</Link></td></tr>)}</tbody></table></div> : <p className="tickets-empty">Chưa có yêu cầu hỗ trợ.</p>)}
      {result && !result.error && (page > 1 || start + 25 < (result.count ?? 0)) && <nav className="ticket-pagination">{page > 1 && <Link href={`${base}?page=${page - 1}`}>← Trước</Link>}<span>Trang {page}</span>{start + 25 < (result.count ?? 0) && <Link href={`${base}?page=${page + 1}`}>Tiếp →</Link>}</nav>}
    </section>
    {(admin || storeId) && <section id="new-ticket" className="tickets-panel tickets-create"><h2>Tạo yêu cầu hỗ trợ</h2><p>Mô tả vấn đề để đội ngũ hỗ trợ có thể kiểm tra.</p><form className="ticket-form" action={createTicket}><input type="hidden" name="context" value={admin ? "admin" : "merchant"} />{admin ? <label>Cửa hàng<select name="store_id" required defaultValue=""><option value="" disabled>Chọn cửa hàng</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label> : <input type="hidden" name="store_id" value={storeId} />}<label>Tiêu đề<input name="subject" required minLength={3} maxLength={160} /></label><label>Phân loại<select name="category" defaultValue="other">{Object.entries(categories).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>Nội dung<textarea name="body" required maxLength={4000} rows={4} /></label><button className="ticket-primary" type="submit">Gửi yêu cầu</button></form></section>}
  </main>;
}

export async function TicketDetail({ supabase, admin, id, admins, owner, message, showStoreLink = false }: { supabase: Client; admin: boolean; id: string; admins: Admin[]; owner: boolean; message?: string; showStoreLink?: boolean }) {
  const base = admin ? "/admin/tickets" : "/dashboard/tickets";
  const [ticket, thread, attachments] = await Promise.all([supabase.from("support_tickets").select("id, store_id, subject, category, status, assigned_to, rating, rating_note, created_at, first_response_at, resolved_at").eq("id", id).maybeSingle(), supabase.from("support_ticket_messages").select("id, author_role, body, created_at").eq("ticket_id", id).order("created_at").order("id"), supabase.from("support_ticket_attachments").select("id, object_path, original_name, created_at").eq("ticket_id", id).order("created_at")]);
  if (ticket.error || thread.error || attachments.error) return <main className="admin-content"><p className="admin-error">Không tải được yêu cầu, tin nhắn hoặc tệp đính kèm.</p><Link href={base}>← Danh sách yêu cầu</Link></main>;
  if (!ticket.data) return <main className="admin-content"><p>Không tìm thấy yêu cầu hoặc bạn không có quyền truy cập.</p><Link href={base}>← Danh sách yêu cầu</Link></main>;
  const t = ticket.data;
  const files = await Promise.all((attachments.data ?? []).map(async (attachment) => {
    const signed = await supabase.storage.from("support-ticket-files").createSignedUrl(attachment.object_path, 300, { download: attachment.original_name });
    return { ...attachment, url: signed.data?.signedUrl ?? null };
  }));
  return <main className="admin-content tickets-page"><Link className="ticket-back" href={base}>← Danh sách yêu cầu</Link>
    {message && <p className={["updated", "rated", "file-added"].includes(message) ? "ticket-success" : "admin-error"} role="status">{message === "updated" ? "Đã cập nhật yêu cầu." : message === "rated" ? "Đã lưu đánh giá." : message === "file-added" ? "Đã thêm tệp đính kèm." : message === "file-invalid" ? "Chọn ảnh JPEG, PNG, WebP, PDF hoặc tệp văn bản tối đa 5 MB." : message === "file-failed" ? "Không tải được tệp. Hãy kiểm tra quyền, trạng thái ticket và cấu hình kho lưu trữ." : "Không thực hiện được thao tác. Hãy kiểm tra quyền và trạng thái yêu cầu."}</p>}
    <header className="ticket-detail-heading"><div><small>YÊU CẦU #{t.id.slice(0,8).toUpperCase()}</small><h1>{t.subject}</h1><p>{categories[t.category]} · Tạo {date(t.created_at)}{showStoreLink && <> · <Link href={`/admin/stores/${t.store_id}`}>Hồ sơ cửa hàng</Link></>}</p></div><span className={`ticket-status is-${t.status}`}>{statuses[t.status]}</span></header>
    <div className="ticket-detail-grid"><section className="tickets-panel ticket-conversation"><h2>Trao đổi</h2><div className="ticket-thread">{thread.data?.map((item) => <article key={item.id} className={`ticket-message is-${item.author_role}`}><div><b>{item.author_role === "admin" ? "Quản trị viên" : "Cửa hàng"}</b><time dateTime={item.created_at}>{date(item.created_at)}</time></div><p>{item.body}</p></article>)}</div>
      {t.status !== "resolved" && t.status !== "closed" ? <form className="ticket-form" action={replyTicket}><input type="hidden" name="ticket_id" value={t.id} /><input type="hidden" name="context" value={admin ? "admin" : "merchant"} /><label>Trả lời<textarea name="body" required maxLength={4000} rows={3} /></label><button className="ticket-primary" type="submit">Gửi trả lời</button></form> : <p className="ticket-muted">Yêu cầu đã kết thúc. Liên hệ quản trị viên nếu cần mở lại.</p>}
    </section><aside className="ticket-side"><section className="tickets-panel ticket-details"><h2>Thông tin xử lý</h2><dl>{admin && <div><dt>Người phụ trách</dt><dd>{t.assigned_to ? admins.find((a) => a.id === t.assigned_to)?.name ?? "Không còn quyền admin" : "Chưa phân công"}</dd></div>}<div><dt>Phản hồi đầu tiên</dt><dd>{date(t.first_response_at)}</dd></div><div><dt>Thời gian giải quyết</dt><dd>{duration(t.created_at, t.resolved_at)}</dd></div><div><dt>Ngày giải quyết</dt><dd>{date(t.resolved_at)}</dd></div><div><dt>Đánh giá</dt><dd>{t.rating ? `${t.rating}/5 sao` : "Chưa có"}</dd></div></dl>{t.rating_note && <p className="ticket-muted">{t.rating_note}</p>}</section>
      {admin ? <section className="tickets-panel ticket-details"><h2>Quản lý yêu cầu</h2><form className="ticket-form" action={updateTicket}><input type="hidden" name="ticket_id" value={t.id} /><label>Trạng thái<select name="status" defaultValue={t.status}>{Object.entries(statuses).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>Phân loại<select name="category" defaultValue={t.category}>{Object.entries(categories).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>Người phụ trách<select name="assigned_to" defaultValue={t.assigned_to ?? ""}><option value="">Chưa phân công</option>{t.assigned_to && !admins.some((a) => a.id === t.assigned_to) && <option value={t.assigned_to}>Tài khoản không còn quyền admin</option>}{admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><button className="ticket-primary" type="submit">Lưu thay đổi</button></form></section> : owner && ["resolved", "closed"].includes(t.status) && <section className="tickets-panel ticket-details"><h2>Đánh giá hỗ trợ</h2><form className="ticket-form" action={rateTicket}><input type="hidden" name="ticket_id" value={t.id} /><label>Mức độ hài lòng<select name="stars" defaultValue={String(t.rating ?? 5)}>{[5,4,3,2,1].map((n) => <option key={n} value={n}>{n} sao</option>)}</select></label><label>Nhận xét<textarea name="note" maxLength={500} rows={2} defaultValue={t.rating_note ?? ""} /></label><button className="ticket-primary" type="submit">Gửi đánh giá</button></form></section>}
    </aside></div>
    <section className="tickets-panel ticket-details"><h2>Tệp đính kèm</h2><p className="ticket-muted">Ảnh JPEG, PNG, WebP, PDF hoặc tệp văn bản; tối đa 5 MB mỗi tệp. Liên kết tải có hiệu lực trong 5 phút.</p>
      {files.length ? <ul className="ticket-files">{files.map((file) => <li key={file.id}>{file.url ? <a href={file.url}>{file.original_name} ↓</a> : <span>{file.original_name} · Chưa tải được liên kết</span>}<small>{date(file.created_at)}</small></li>)}</ul> : <p className="ticket-muted">Chưa có tệp đính kèm.</p>}
      {!['resolved', 'closed'].includes(t.status) && <form className="ticket-form" action={uploadTicketAttachment}><input type="hidden" name="ticket_id" value={t.id} /><input type="hidden" name="context" value={admin ? "admin" : "merchant"} /><label>Chọn tệp<input type="file" name="file" accept="image/jpeg,image/png,image/webp,application/pdf,text/plain" required /></label><button className="ticket-primary" type="submit">Thêm tệp</button></form>}
    </section>
  </main>;
}
