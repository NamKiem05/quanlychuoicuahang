import Link from "next/link";
import { connection } from "next/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { checkAccount, saveAccount, toggleAccount } from "../actions";
import { ShippingDialog, ShippingForm } from "../forms";
import { accountMetadata, checkErrors, connectionLabels, environments, shippingReadError, type Account } from "../model";
import { pageSize, Pagination, readPage, type ShippingQuery } from "../pagination";

const path = "/admin/shipping/accounts";
export const instant = false;
const dateFormat = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh",
});

function formatDate(value: string | null) {
  return value ? dateFormat.format(new Date(value)) : "—";
}

type ProviderOption = { code: string; name: string; catalog_enabled: boolean };
type AccountRow = Account & { stores?: { name: string } | null };
type CheckRow = {
  id: string;
  started_at: string;
  finished_at: string | null;
  result: keyof typeof connectionLabels;
  error_code: string | null;
};

function AccountForm({ providers, account }: { providers: ProviderOption[]; account?: Account }) {
  return <ShippingForm action={saveAccount} label="Lưu tài khoản"
    confirm={account ? "Thay Shop ID hoặc token sẽ yêu cầu xác minh lại. Lưu thay đổi?" : undefined}>
    {account ? <input type="hidden" name="id" value={account.id} /> : <>
      <label>Nhà cung cấp<select name="provider_code" required>
        <option value="">Chọn nhà cung cấp</option>
        {providers.map((provider) => <option key={provider.code} value={provider.code}>{provider.name}</option>)}
      </select></label>
      <label>Môi trường<select name="environment" defaultValue="sandbox">
        {Object.entries(environments).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
    </>}
    <label>Tên tài khoản<input name="name" defaultValue={account?.name} required maxLength={120} /></label>
    <label>Shop ID<input name="external_shop_id" defaultValue={account?.external_shop_id} required maxLength={80} /></label>
    {(!account || (account.provider_code === "ghn" && account.environment === "sandbox")) &&
      <label>Token GHN Staging
        <input name="token" type="password" autoComplete="new-password" maxLength={512} />
        <small>{account ? "Để trống để giữ token nếu Shop ID không đổi." : "Chỉ nhập khi đăng ký tài khoản GHN Staging."}</small>
      </label>}
  </ShippingForm>;
}

async function loadLegacyAccounts(page: number) {
  try {
    return await createAdminClient().from("store_ghn_connections")
      .select("store_id,shop_id,shop_name,checked_at,stores!inner(name)", { count: "exact" })
      .order("checked_at", { ascending: false }).order("store_id").range((page - 1) * pageSize, page * pageSize - 1);
  } catch {
    return null;
  }
}

function storeName(store: { name: string } | { name: string }[] | null) {
  return Array.isArray(store) ? store[0]?.name : store?.name;
}

async function LegacyAccounts({ page }: { page: number }) {
  const result = await loadLegacyAccounts(page);
  if (result?.error || !result?.data) {
    return <p className="admin-error" role="alert">Chưa tải được danh sách kết nối GHN hiện tại.</p>;
  }
  return <section className="admin-store-list">
    <div className="admin-table-scroll">
      <table className="admin-data-table">
        <thead><tr><th>Tài khoản</th><th>Cửa hàng</th><th>Nhà cung cấp</th><th>Shop ID</th><th>Môi trường</th><th>Trạng thái</th><th>Kiểm tra gần nhất</th></tr></thead>
        <tbody>
          {result.data.length === 0 && <tr><td colSpan={7}>Chưa có kết nối GHN hiện tại trên trang này.</td></tr>}
          {result.data.map((item) => <tr key={item.store_id}>
            <td>{item.shop_name}</td><td>{storeName(item.stores) ?? item.store_id}</td>
            <td>GHN</td><td>{item.shop_id}</td><td>{environments.sandbox}</td>
            <td>Đã kết nối</td><td>{formatDate(item.checked_at)}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <Pagination page={page} total={result.count ?? 0} path={path} params={{ scope: "legacy" }} />
  </section>;
}

async function History({ id, page }: { id: string; page: number }) {
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const { data, error, count } = await supabase.from("shipping_account_checks")
    .select("id,started_at,finished_at,result,error_code", { count: "exact" })
    .eq("account_id", id).order("started_at", { ascending: false }).order("id")
    .range((page - 1) * pageSize, page * pageSize - 1);
  const rows: CheckRow[] = data ?? [];

  return <section className="admin-store-list" aria-labelledby="shipping-history">
    <header className="admin-list-heading"><h2 id="shipping-history">Lịch sử kiểm tra kết nối</h2><Link href={path}>Đóng lịch sử</Link></header>
    {error ? <p className="admin-error" role="alert">Chưa tải được lịch sử kiểm tra.</p> : <>
      <div className="admin-table-scroll">
        <table className="admin-data-table">
          <thead><tr><th>Bắt đầu</th><th>Kết thúc</th><th>Kết quả</th><th>Chi tiết</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={4}>Chưa có lượt kiểm tra trên trang này.</td></tr>}
            {rows.map((row) => <tr key={row.id}>
              <td>{formatDate(row.started_at)}</td><td>{formatDate(row.finished_at)}</td>
              <td>{connectionLabels[row.result]}</td><td>{row.error_code ? checkErrors[row.error_code] : "—"}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
      <Pagination page={page} total={count ?? 0} path={path} params={{ history: id }} />
    </>}
  </section>;
}

export default async function AccountsPage({ searchParams }: { searchParams: Promise<ShippingQuery> }) {
  await connection();
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const query = await searchParams;
  const history = typeof query.history === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(query.history) ? query.history : null;
  const scope = query.scope === "shop" || query.scope === "legacy" ? query.scope : "platform";
  const page = readPage(query.page);
  const [providers, accounts] = await Promise.all([
    supabase.from("shipping_providers").select("code,name,catalog_enabled").order("name"),
    scope === "legacy" || history ? null : supabase.from("shipping_provider_accounts")
      .select(`${accountMetadata},stores(name)`, { count: "exact" })
      .eq("scope", scope).order("created_at", { ascending: false }).order("id")
      .range((page - 1) * pageSize, page * pageSize - 1),
  ]);
  const rows: AccountRow[] = accounts?.data?.map((row) => ({
    ...row, stores: Array.isArray(row.stores) ? row.stores[0] ?? null : row.stores,
  })) ?? [];
  const providerList: ProviderOption[] = providers.data ?? [];
  const providerByCode = new Map(providerList.map((provider) => [provider.code, provider]));
  const providerError = providers.error && shippingReadError(providers.error.code, "Chưa tải được danh mục nhà cung cấp.");
  const accountError = accounts?.error && shippingReadError(accounts.error.code, "Chưa tải được danh sách tài khoản.");

  return <main className="admin-content">
    <header className="shipping-admin-heading">
      <div><h1 className="admin-page-title">Tài khoản vận chuyển</h1>
        <p className="dashboard-intro">Quản lý tài khoản GrowDesk và xem kết nối của cửa hàng.</p></div>
      {scope === "platform" && !history && !providerError && !accountError && <ShippingDialog label="Thêm tài khoản GrowDesk" title="Thêm tài khoản GrowDesk">
        <AccountForm providers={providerList} />
      </ShippingDialog>}
    </header>
    <nav className="shipping-admin-actions" aria-label="Phạm vi tài khoản">
      <Link className="secondary-submit" href={path} aria-current={scope === "platform" ? "page" : undefined}>GrowDesk</Link>
      <Link className="secondary-submit" href={`${path}?scope=shop`} aria-current={scope === "shop" ? "page" : undefined}>Cửa hàng</Link>
      <Link className="secondary-submit" href={`${path}?scope=legacy`} aria-current={scope === "legacy" ? "page" : undefined}>GHN hiện tại</Link>
    </nav>
    {providerError && <p className="admin-error" role="alert">{providerError}</p>}
    {history ? <History id={history} page={page} /> : scope === "legacy" ? <LegacyAccounts page={page} />
      : accountError ? (accountError !== providerError && <p className="admin-error" role="alert">{accountError}</p>)
      : <section className="admin-store-list">
        <div className="admin-table-scroll">
          <table className="admin-data-table">
            <thead><tr><th>Tài khoản</th><th>Nhà cung cấp</th><th>Shop ID</th><th>Môi trường</th><th>Trạng thái</th><th>Ngày tạo</th><th>Kiểm tra gần nhất</th>{scope === "platform" && <th>Thao tác</th>}</tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={scope === "platform" ? 8 : 7}>Chưa có tài khoản trên trang này.</td></tr>}
              {rows.map((account) => {
                const provider = providerByCode.get(account.provider_code);
                const canEnable = account.provider_code === "ghn" && account.environment === "sandbox"
                  && provider?.catalog_enabled && account.connection_status === "verified";
                return <tr key={account.id}>
                  <td><b>{account.name}</b>{account.store_id && <div>{account.stores?.name ?? account.store_id}</div>}</td>
                  <td>{provider?.name ?? account.provider_code}</td><td>{account.external_shop_id}</td>
                  <td>{environments[account.environment]}</td>
                  <td>{connectionLabels[account.connection_status]} · {account.enabled ? "Đã bật" : "Đã tắt"}</td>
                  <td>{formatDate(account.created_at)}</td><td>{formatDate(account.last_checked_at)}</td>
                  {scope === "platform" && <td><div className="shipping-admin-actions">
                    <ShippingDialog label="Chỉnh sửa" title={`Chỉnh sửa ${account.name}`}>
                      <AccountForm key={`${account.name}:${account.external_shop_id}`} providers={providerList} account={account} />
                    </ShippingDialog>
                    <ShippingForm action={checkAccount} label="Kiểm tra"><input type="hidden" name="id" value={account.id} /></ShippingForm>
                    {(account.enabled || canEnable) && <ShippingForm action={toggleAccount} label={account.enabled ? "Tắt" : "Bật"}
                      confirm={account.enabled ? "Tắt tài khoản GrowDesk này?" : undefined}>
                      <input type="hidden" name="id" value={account.id} />
                      <input type="hidden" name="enabled" value={String(!account.enabled)} />
                    </ShippingForm>}
                    <Link href={`${path}?history=${account.id}`}>Lịch sử</Link>
                  </div></td>}
                </tr>;
              })}
            </tbody>
          </table>
        </div>
        <Pagination page={page} total={accounts?.count ?? 0} path={path} params={{ scope }} />
      </section>}
  </main>;
}
