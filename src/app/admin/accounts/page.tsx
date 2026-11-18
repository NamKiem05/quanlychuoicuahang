import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import type { AuthUser } from "@supabase/supabase-js";
import Toast from "@/app/toast";
import { toastVariantForMessage } from "@/lib/toast";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import AccountStatusForm from "./account-status-form";
import "./accounts.css";

export const metadata: Metadata = { title: "Quản lý tài khoản | Quản trị" };

const pageSize = 20;
const messages: Record<string, string> = {
  "invalid-account-action": "Thao tác tài khoản không hợp lệ.",
  "account-self-protected": "Bạn không thể khóa chính tài khoản quản trị của mình.",
  "account-admin-protected": "Tài khoản quản trị nền tảng được bảo vệ, không thể khóa tại đây.",
  "account-update-failed": "Chưa cập nhật được tài khoản. Hãy thử lại.",
  "account-suspended": "Đã khóa tài khoản. Người dùng sẽ không thể đăng nhập cho đến khi được mở khóa.",
  "account-reactivated": "Đã mở khóa tài khoản.",
};

type Profile = { id: string; display_name: string; phone: string | null };

function isSuspended(user: AuthUser) {
  return Boolean(user.banned_until && Date.parse(user.banned_until) > Date.now());
}

function displayName(user: AuthUser, profile?: Profile) {
  const metadata = user.user_metadata ?? {};
  return profile?.display_name || metadata.full_name || metadata.name || metadata.display_name || user.email?.split("@")[0] || user.phone || "Tài khoản mới";
}

function pageHref(page: number, search: string, status: string, ownersOnly: boolean) {
  const params = new URLSearchParams();
  if (search) params.set("q", search);
  if (status) params.set("status", status);
  if (ownersOnly) params.set("role", "owner");
  params.set("page", String(page));
  return "/admin/accounts?" + params.toString();
}

export default async function AdminAccountsPage({ searchParams }: PageProps<"/admin/accounts">) {
  await connection();
  await requirePlatformAdminAccess(await createClient());
  const query = await searchParams;
  const search = (typeof query.q === "string" ? query.q : "")
    .trim()
    .replace(/[<>"'`]/g, "")
    .slice(0, 80)
    .toLocaleLowerCase("vi-VN");
  const filterStatus = typeof query.status === "string" && ["active", "suspended"].includes(query.status) ? query.status : "";
  const ownersOnly = query.role === "owner";
  const requestedPage = typeof query.page === "string" && /^\d+$/.test(query.page) ? Math.min(Number(query.page), 100_000) : 1;
  const message = typeof query.message === "string" ? messages[query.message] : undefined;

  let adminClient: ReturnType<typeof createAdminClient>;
  try {
    adminClient = createAdminClient();
  } catch {
    return (
      <div className="admin-content">
        <div className="dashboard-kicker">QUẢN LÝ NỀN TẢNG</div>
        <h1 className="admin-page-title">Tài khoản</h1>
        <p className="admin-error" role="alert">Chưa cấu hình quyền truy cập quản trị Supabase ở phía máy chủ, nên chưa thể tải danh sách tài khoản.</p>
      </div>
    );
  }

  const { data: adminRows, error: adminRowsError } = await adminClient.from("platform_admins").select("user_id");
  if (adminRowsError) {
    return <div className="admin-content"><h1 className="admin-page-title">Tài khoản</h1><p className="admin-error" role="alert">Không xác định được tài khoản admin nên đã dừng tải danh sách thường.</p></div>;
  }
  const platformAdminIds = new Set((adminRows ?? []).map((row) => row.user_id as string));
  // Dedicated staff without a granted admin role must not appear as merchant accounts.
  let staffScanPage = 1;
  for (;;) {
    const result = await adminClient.auth.admin.listUsers({ page: staffScanPage, perPage: 1000 });
    if (result.error) return <div className="admin-content"><h1 className="admin-page-title">Tài khoản</h1><p className="admin-error" role="alert">Không xác định được danh sách tài khoản nhân viên nên đã dừng tải tài khoản thường.</p></div>;
    for (const user of result.data.users) if (user.app_metadata?.account_kind === "platform_admin") platformAdminIds.add(user.id);
    if (!result.data.nextPage || result.data.nextPage <= staffScanPage) break;
    staffScanPage = result.data.nextPage;
  }
  const ownerIds = new Set<string>();
  let ownersError = false;
  if (ownersOnly) {
    for (let offset = 0; ; offset += 1000) {
      const result = await adminClient.from("store_members").select("user_id").eq("role", "owner").order("user_id").range(offset, offset + 999);
      if (result.error) { ownersError = true; break; }
      for (const member of result.data) ownerIds.add(member.user_id);
      if (result.data.length < 1000) break;
    }
  }
  let authError = false;
  let authUserTotal = 0;
  let totalUsers = 0;
  let totalResults = 0;
  let currentPage = requestedPage;
  let users: AuthUser[] = [];
  let profilesById = new Map<string, Profile>();
  const needsGlobalFilter = Boolean(search || filterStatus || ownersOnly);

  if (needsGlobalFilter) {
    const matchingUsers: AuthUser[] = [];
    let authPage = 1;
    while (true) {
      const result = await adminClient.auth.admin.listUsers({ page: authPage, perPage: 1000 });
      if (result.error) {
        authError = true;
        break;
      }
      const batch = result.data.users;
      authUserTotal = result.data.total || authUserTotal || result.data.users.length;
      totalUsers = Math.max(0, authUserTotal - platformAdminIds.size);
      const ids = batch.map((user) => user.id);
      if (ids.length) {
        const { data: profileRows } = await adminClient.from("profiles").select("id, display_name, phone").in("id", ids);
        for (const profile of (profileRows ?? []) as Profile[]) profilesById.set(profile.id, profile);
      }
      for (const user of batch) {
        if (platformAdminIds.has(user.id) || (ownersOnly && !ownerIds.has(user.id))) continue;
        const profile = profilesById.get(user.id);
        const matchesStatus = !filterStatus || (filterStatus === "suspended") === isSuspended(user);
        const searchText = [user.id, user.email, user.phone, displayName(user, profile), profile?.phone]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("vi-VN");
        if (matchesStatus && (!search || searchText.includes(search))) matchingUsers.push(user);
      }
      if (batch.length < 1000) break;
      authPage += 1;
    }
    totalResults = matchingUsers.length;
    const totalPages = Math.max(1, Math.ceil(totalResults / pageSize));
    currentPage = Math.min(requestedPage, totalPages);
    users = matchingUsers.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  } else {
    const firstPage = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (firstPage.error) {
      authError = true;
    } else {
      authUserTotal = firstPage.data.total || firstPage.data.users.length;
      totalUsers = Math.max(0, authUserTotal - platformAdminIds.size);
      totalResults = totalUsers;
      const totalPages = Math.max(1, Math.ceil(totalResults / pageSize));
      currentPage = Math.min(requestedPage, totalPages);
      const targetCount = currentPage * pageSize;
      const regularUsers: AuthUser[] = [];
      let authPage = 1;
      let batch = firstPage.data.users;
      while (true) {
        regularUsers.push(...batch.filter((user) => !platformAdminIds.has(user.id)));
        if (regularUsers.length >= targetCount || batch.length < 1000) break;
        authPage += 1;
        const nextPage = await adminClient.auth.admin.listUsers({ page: authPage, perPage: 1000 });
        if (nextPage.error) {
          authError = true;
          break;
        }
        batch = nextPage.data.users;
      }
      users = regularUsers.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    }
  }

  const userIds = users.map((user) => user.id);
  let profileRows: Profile[] = [];
  let memberRows: Array<{ user_id: string; role: string; stores: { name: string; slug: string } | null }> = [];
  if (userIds.length) {
    const [{ data: profiles }, { data: members }] = await Promise.all([
      adminClient.from("profiles").select("id, display_name, phone").in("id", userIds),
      adminClient.from("store_members").select("user_id, role, stores(name, slug)").in("user_id", userIds)
        .overrideTypes<typeof memberRows, { merge: false }>(),
    ]);
    profileRows = (profiles ?? []) as Profile[];
    memberRows = members ?? [];
  }
  profilesById = new Map(profileRows.map((profile) => [profile.id, profile]));
  const memberships = memberRows;

  const totalPages = Math.max(1, Math.ceil(totalResults / pageSize));
  const firstItem = totalResults ? (currentPage - 1) * pageSize + 1 : 0;
  const lastItem = Math.min(currentPage * pageSize, totalResults);

  return (
      <div className="admin-content admin-accounts-page accounts-overview">
        <header className="accounts-page-heading"><div><div className="dashboard-kicker">QUẢN LÝ NỀN TẢNG / TÀI KHOẢN</div>
        <h1 className="admin-page-title">Quản lý tài khoản</h1>
        <p className="dashboard-intro">Theo dõi người dùng, cửa hàng và trạng thái truy cập trên nền tảng.</p></div>
        <Link className="accounts-create-button" href="/admin/accounts/new"><span aria-hidden="true">+</span> Tạo tài khoản chủ cửa hàng</Link></header>
        <Toast message={message} variant={typeof query.message === "string" ? toastVariantForMessage(query.message) : "success"} />

        {authError && <p className="admin-error" role="alert">Không tải được đầy đủ tài khoản từ Supabase Auth. Kiểm tra cấu hình server và tải lại trang.</p>}
        {ownersError && <p className="admin-error" role="alert">Không tải được đầy đủ danh sách chủ cửa hàng.</p>}

        <div className="admin-primary-stat-grid admin-accounts-stats">
          <article><span aria-hidden="true">♙</span><div><small>TỔNG TÀI KHOẢN</small><b>{authError ? "—" : totalUsers.toLocaleString("vi-VN")}</b><em>Tài khoản thường trên nền tảng</em></div></article>
          <article className="admin-stat-green"><span aria-hidden="true">✓</span><div><small>TÀI KHOẢN ADMIN</small><b>{adminRows?.length ?? 0}</b><em><Link href="/admin/admins">Quản lý riêng →</Link></em></div></article>
          <article className="admin-stat-orange"><span aria-hidden="true">⌕</span><div><small>KẾT QUẢ ĐANG XEM</small><b>{authError || ownersError ? "—" : totalResults.toLocaleString("vi-VN")}</b><em>{needsGlobalFilter ? "Theo bộ lọc hiện tại" : "Tài khoản khớp"}</em></div></article>
          <article className="admin-stat-purple"><span aria-hidden="true">⏸</span><div><small>ĐÃ KHÓA TRANG NÀY</small><b>{authError || ownersError ? "—" : users.filter(isSuspended).length}</b><em>Trong danh sách đang hiển thị</em></div></article>
        </div>

        <form className="dashboard-form merchant-order-filters admin-order-filters admin-account-filters" method="get">
          <label>Tìm tài khoản<input type="search" name="q" maxLength={80} defaultValue={search} placeholder="Tên, email, số điện thoại hoặc mã người dùng" /></label>
          <label>Trạng thái<select name="status" defaultValue={filterStatus}>
            <option value="">Tất cả trạng thái</option>
            <option value="active">Đang hoạt động</option>
            <option value="suspended">Đã khóa</option>
          </select></label>
          <label>Vai trò<select name="role" defaultValue={ownersOnly ? "owner" : ""}><option value="">Tất cả tài khoản</option><option value="owner">Chủ cửa hàng</option></select></label>
          <div className="merchant-order-filter-actions">
            <button className="secondary-submit" type="submit">Lọc tài khoản</button>
            {(search || filterStatus || ownersOnly) && <Link href="/admin/accounts">Xóa bộ lọc</Link>}
          </div>
        </form>

        <section className="admin-store-list admin-account-results">
          <div className="admin-list-heading"><div><h2>Danh sách tài khoản thường</h2><p>Tài khoản admin được ẩn khỏi đây và quản lý tại mục Quản trị viên.</p></div><span>{totalResults.toLocaleString("vi-VN")} tài khoản</span></div>
          <div className="admin-table-scroll">
            <table className="admin-data-table admin-account-table">
              <thead><tr><th>Tài khoản</th><th>Vai trò</th><th>Cửa hàng</th><th>Đăng nhập gần nhất</th><th>Ngày tạo</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
              <tbody>
                {users.map((user) => {
                  const profile = profilesById.get(user.id);
                  const userMemberships = memberships.filter((membership) => membership.user_id === user.id);
                  const suspended = isSuspended(user);
                  const roleLabels = userMemberships.length
                    ? userMemberships.map((membership) => membership.role === "owner" ? "Chủ cửa hàng" : "Nhân viên")
                    : ["Người mua"];
                  const storeNames = [...new Set(userMemberships.map((membership) => membership.stores?.name).filter((name): name is string => Boolean(name)))];
                  const phone = profile?.phone || user.phone;
                  return (
                    <tr key={user.id}>
                      <td><div className="accounts-person"><span className="accounts-person-avatar" aria-hidden="true">{String(displayName(user, profile)).trim().charAt(0).toLocaleUpperCase("vi-VN") || "?"}</span><div className="admin-account-identity"><Link href={`/admin/accounts/${user.id}`}><b>{displayName(user, profile)}</b></Link><span>{user.email || phone || "Không có email / số điện thoại"}</span><small>{user.id}</small></div></div></td>
                      <td><div className="admin-account-badges">{roleLabels.map((role, index) => <span className="account-role-badge" key={role + index}>{role}</span>)}</div></td>
                      <td>{storeNames.length ? <div className="admin-account-stores">{storeNames.slice(0, 2).map((name) => <span key={name}>{name}</span>)}{storeNames.length > 2 && <small>+{storeNames.length - 2} cửa hàng</small>}</div> : <span className="admin-account-muted">—</span>}</td>
                      <td>{user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : <span className="admin-account-muted">Chưa đăng nhập</span>}</td>
                      <td>{new Date(user.created_at).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</td>
                      <td><span className={"status-badge " + (suspended ? "status-suspended" : "status-active")}>{suspended ? "Đã khóa" : "Hoạt động"}</span></td>
                      <td><div className="admin-account-access"><AccountStatusForm userId={user.id} suspended={suspended} search={search} status={filterStatus} page={currentPage} /></div></td>
                    </tr>
                  );
                })}
                {users.length === 0 && <tr><td className="admin-table-empty" colSpan={7}>{authError ? "Danh sách chưa sẵn sàng." : "Không tìm thấy tài khoản phù hợp."}</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        {totalPages > 1 && <nav className="order-pagination" aria-label="Phân trang tài khoản">
          <p>Hiển thị {firstItem}–{lastItem} trong {totalResults.toLocaleString("vi-VN")} tài khoản</p>
          <div className="order-pagination-controls">
            {currentPage > 1 ? <Link className="order-page-link order-page-step" href={pageHref(currentPage - 1, search, filterStatus, ownersOnly)} rel="prev">← Trước</Link> : <span className="order-page-link order-page-step is-disabled" aria-disabled="true">← Trước</span>}
            <span className="order-page-link is-current" aria-current="page">{currentPage} / {totalPages}</span>
            {currentPage < totalPages ? <Link className="order-page-link order-page-step" href={pageHref(currentPage + 1, search, filterStatus, ownersOnly)} rel="next">Tiếp →</Link> : <span className="order-page-link order-page-step is-disabled" aria-disabled="true">Tiếp →</span>}
          </div>
        </nav>}
      </div>
  );
}
