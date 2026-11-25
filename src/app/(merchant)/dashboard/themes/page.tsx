import Link from "next/link";
import SidebarIcon from "@/components/ui/sidebar-icon";
import ThemeCover from "@/components/ui/theme-cover";
import { redirect } from "next/navigation";
import BankTransferQr from "@/components/retail/bank-transfer-qr";
import ThemeBuilder from "@/components/ui/theme-builder";
import { getPlatformBankAccount } from "@/lib/merchant-billing";
import { readThemeManifest, themeFamilies, type ThemeProduct } from "@/lib/theme-studio";
import { getMerchantContext } from "../data";
import { autosaveStoreTheme, manageStoreTheme } from "./actions";
import "../../../admin/themes/themes.css";

const messages: Record<string,string> = {
  invalid: "Thông tin chưa hợp lệ hoặc cửa hàng đã thay đổi.", failed: "Chưa thực hiện được. Hãy kiểm tra trạng thái giao diện và giấy phép.",
  conflict: "Bản nháp hoặc giao diện đang dùng đã thay đổi. Hãy thử lại.", pending: "Đã tạo đơn chờ chuyển khoản.",
  claimed: "Giao diện đã có trong thư viện. Anh có thể kích hoạt.", saved: "Đã lưu bản nháp riêng của cửa hàng.",
  updated: "Đã cập nhật giao diện đang hiển thị.",
};
const money = (amount:number) => `${amount.toLocaleString("vi-VN")} ₫`;

export default async function Marketplace({ searchParams }: { searchParams: Promise<Record<string,string | undefined>> }) {
  const [{supabase,store,membership},query] = await Promise.all([getMerchantContext(),searchParams]);
  if (!store || membership?.role !== "owner") redirect("/dashboard");
  const [list,state,orders] = await Promise.all([
    supabase.rpc("list_store_themes",{shop:store.id}),
    supabase.from("storefront_store_theme").select("theme_id,version_id,draft,published,revision").eq("store_id",store.id).eq("is_active",true).maybeSingle(),
    supabase.from("storefront_theme_purchases").select("id,transfer_code,amount_vnd,created_at,confirmed_at").eq("store_id",store.id).order("created_at", { ascending: false }).limit(30),
  ]);
  const items = (list.data ?? []) as ThemeProduct[];
  const existing = state.data;
  const versions = existing ? await supabase.rpc("list_licensed_theme_versions", { shop: store.id, theme: existing.theme_id }) : null;
  const availableVersions = (versions?.data ?? []) as { id: string; version: string }[];
  const active = items.find(item => item.id === existing?.theme_id && item.licensed);
  const draft = readThemeManifest(existing?.draft) ?? readThemeManifest(existing?.published) ?? readThemeManifest(active?.manifest);
  const bank = getPlatformBankAccount();
  const filtered = items.filter(item => (!query.family || item.primary_family === query.family)
    && (query.price !== "free" || item.price_vnd === 0) && (query.price !== "paid" || item.price_vnd > 0));
  if (query.order === "price") filtered.sort((a,b) => a.price_vnd-b.price_vnd);
  if (query.order === "popular") filtered.sort((a,b) => b.purchases-a.purchases);
  return <main className="admin-content themes-page">
    <header className="themes-heading"><span className="theme-heading-icon"><SidebarIcon name="appearance" /></span><div><h1 className="admin-page-title">Thư viện giao diện</h1><p>Giao diện phù hợp với ngành hàng của {store.name}.</p></div><Link className="theme-primary" href={`/${store.slug}`}>Xem website <span aria-hidden="true">↗</span></Link></header>
    {typeof query.message === "string" && Object.hasOwn(messages,query.message) && <p role="status" className={["failed", "invalid", "conflict"].includes(query.message) ? "theme-feedback is-error" : "theme-feedback"}>{messages[query.message]}</p>}
    {(list.error || state.error) && <p role="alert">Chưa tải được thư viện. Kiểm tra migration Theme Studio.</p>}
    <section className="theme-catalog" aria-label="Danh mục giao diện">
    <header className="theme-section-heading"><h2>Giao diện phù hợp</h2>{!list.error && <span>{filtered.length.toLocaleString("vi-VN")} giao diện</span>}</header>
    <form className="themes-filters" method="get">
      <label>Ngành hàng<select name="family" defaultValue={query.family}><option value="">Tất cả</option>{Object.entries(themeFamilies).map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>Giá<select name="price" defaultValue={query.price}><option value="">Tất cả</option><option value="free">Miễn phí</option><option value="paid">Trả phí</option></select></label>
      <label>Sắp xếp<select name="order" defaultValue={query.order}><option value="">Mới nhất</option><option value="price">Giá thấp trước</option><option value="popular">Nhiều lượt mua</option></select></label><button>Tìm</button>
    </form>
    {filtered.length ? <div className="themes-grid">{filtered.map(item => <article className="theme-card" key={item.id}>
      <ThemeCover image={item.preview_url} family={item.primary_family} />
      <div className="theme-card-body"><div className="theme-card-heading"><h2>{item.name}</h2><span className="theme-badge" data-status={item.price_vnd ? "premium" : "published"}>{item.price_vnd ? money(item.price_vnd) : "Miễn phí"}</span></div><p>{themeFamilies[item.primary_family]} · v{item.version}</p><p>{item.description}</p>
        <Link className="theme-secondary" href={`/dashboard/themes/preview?theme=${item.id}`}>Xem demo <span aria-hidden="true">→</span></Link>
        {item.purchase_id && item.purchase_amount && item.transfer_code ? <details className="theme-edit"><summary>Chờ thanh toán · {item.transfer_code}</summary>
          <p>Chuyển đúng số tiền và nội dung. Giấy phép được cấp sau khi Admin đối chiếu sao kê.</p>
          {bank ? <BankTransferQr details={{ ...bank, amount:item.purchase_amount, reference:item.transfer_code }} /> : <p>Thông tin tài khoản thanh toán hiện chưa sẵn sàng.</p>}
        </details> : <form action={manageStoreTheme} className="theme-studio-tools">
          <input type="hidden" name="store" value={store.id} /><input type="hidden" name="theme" value={item.id} /><input type="hidden" name="release" value={item.release_id} />
          {active?.id === item.id ? <span>Đang sử dụng</span>
            : <button className="theme-primary" disabled={!item.licensed && item.price_vnd > 0 && !bank} name="operation" value={item.licensed ? "activate" : "claim"}>{item.licensed ? "Kích hoạt" : item.price_vnd ? "Tạo đơn mua" : "Thêm vào thư viện"}</button>}
        </form>}
      </div>
    </article>)}</div> : !list.error && <p className="themes-empty">Chưa có giao diện tương thích với bộ lọc này.</p>}
    </section>
    {existing && <section className="themes-create"><h2>Phiên bản và kích hoạt</h2>
      {availableVersions.length > 0 && <form action={manageStoreTheme} className="theme-form">
        <input type="hidden" name="store" value={store.id} /><input type="hidden" name="theme" value={existing.theme_id} /><input type="hidden" name="revision" value={existing.revision} />
        <label>Phiên bản<select name="release" defaultValue={existing.version_id}>{availableVersions.map(release => <option key={release.id} value={release.id}>{release.version}{release.id === existing.version_id ? " · Đang dùng" : ""}</option>)}</select></label>
        <button className="theme-primary" name="operation" value="version">Áp dụng phiên bản</button>
      </form>}
      <form action={manageStoreTheme} className="theme-form">
        <input type="hidden" name="store" value={store.id} /><input type="hidden" name="theme" value={existing.theme_id} /><input type="hidden" name="revision" value={existing.revision} />
        <label><input type="checkbox" name="confirm" value="yes" required /> Xác nhận trở về giao diện cửa hàng trước đây</label>
        <button name="operation" value="deactivate">Ngừng kích hoạt</button>
      </form>
    </section>}
    {active && existing && draft && <section className="themes-create"><h2>Tùy chỉnh {active.name}</h2>
      <form action={manageStoreTheme} key={`${active.id}:${existing.revision}`} className="theme-form">
        <input type="hidden" name="store" value={store.id} /><input type="hidden" name="theme" value={active.id} /><input type="hidden" name="revision" data-theme-revision defaultValue={existing.revision} />
        <ThemeBuilder initial={draft} family={active.primary_family} autosave={{ id: active.id, revision: existing.revision, save: autosaveStoreTheme.bind(null, store.id) }} />
        <button className="theme-primary" name="operation" value="draft">Lưu bản nháp</button>
      </form>
      <form action={manageStoreTheme} className="theme-form">
        <input type="hidden" name="store" value={store.id} /><input type="hidden" name="theme" value={active.id} /><input type="hidden" name="revision" data-theme-revision defaultValue={existing.revision} />
        <button className="theme-primary" name="operation" value="publish" data-theme-publish disabled={!existing.draft}>Đăng bản nháp lên website</button>
      </form>
      <form action={manageStoreTheme} className="theme-form">
        <input type="hidden" name="store" value={store.id} /><input type="hidden" name="theme" value={active.id} /><input type="hidden" name="revision" data-theme-revision defaultValue={existing.revision} />
        <label><input type="checkbox" name="confirm" value="yes" required /> Xác nhận đặt lại theo phiên bản gốc</label><button name="operation" value="reset">Đặt lại</button>
      </form>
      <Link href="/dashboard/appearance">Quản lý logo và ảnh bìa</Link>
    </section>}
    {orders.data?.length ? <details className="themes-create"><summary>Lịch sử mua giao diện · 30 đơn gần nhất</summary>
      <ul>{orders.data.map(order => <li key={order.id}>{order.transfer_code} · {money(order.amount_vnd)} · {order.confirmed_at ? "Đã xác nhận" : "Chờ đối soát"}</li>)}</ul>
    </details> : null}
  </main>;
}
