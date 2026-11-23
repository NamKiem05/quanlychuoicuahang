import { connection } from "next/server";
import { requirePlatformAdminAccess } from "@/lib/platform-account";
import { createClient } from "@/lib/supabase/server";
import { saveProvider, toggleProvider } from "../actions";
import { ShippingDialog, ShippingForm } from "../forms";
import { shippingReadError, type Provider } from "../model";
import { pageSize, Pagination, readPage, type ShippingQuery } from "../pagination";

const path = "/admin/shipping/providers";
export const instant = false;

function ProviderForm({ provider }: { provider?: Provider }) {
  return <ShippingForm action={saveProvider} label="Lưu nhà cung cấp">
    <input type="hidden" name="mode" value={provider ? "edit" : "create"} />
    <label>Mã nhà cung cấp
      <input name="code" defaultValue={provider?.code} required readOnly={Boolean(provider)} pattern="[a-z][a-z0-9_\-]{1,39}" maxLength={40} />
    </label>
    <label>Tên nhà cung cấp<input name="name" defaultValue={provider?.name} required maxLength={120} /></label>
    <label>URL logo HTTPS<input name="logo_url" type="url" defaultValue={provider?.logo_url ?? ""} maxLength={500} /></label>
  </ShippingForm>;
}

export default async function ProvidersPage({ searchParams }: { searchParams: Promise<ShippingQuery> }) {
  await connection();
  const supabase = await createClient();
  await requirePlatformAdminAccess(supabase);
  const query = await searchParams;
  const page = readPage(query.page);
  const { data, error, count } = await supabase.from("shipping_providers")
    .select("code,name,logo_url,catalog_enabled,integration_enabled", { count: "exact" })
    .order("name").order("code").range((page - 1) * pageSize, page * pageSize - 1);
  const providers: Provider[] = data ?? [];

  return <main className="admin-content">
    <header className="shipping-admin-heading">
      <div>
        <h1 className="admin-page-title">Nhà cung cấp vận chuyển</h1>
        <p className="dashboard-intro">Quản lý danh mục và xem khả năng tích hợp của từng nhà cung cấp.</p>
      </div>
      {!error && <ShippingDialog label="Thêm nhà cung cấp" title="Thêm nhà cung cấp"><ProviderForm /></ShippingDialog>}
    </header>
    {error ? <p className="admin-error" role="alert">{shippingReadError(error.code, "Chưa tải được danh mục nhà cung cấp.")}</p> : <section className="admin-store-list">
      <div className="admin-table-scroll">
        <table className="admin-data-table">
          <thead><tr><th>Nhà cung cấp</th><th>Mã</th><th>Danh mục</th><th>Tích hợp</th><th>Môi trường hỗ trợ</th><th>Thao tác</th></tr></thead>
          <tbody>
            {providers.length === 0 && <tr><td colSpan={6}>Chưa có nhà cung cấp trên trang này.</td></tr>}
            {providers.map((provider) => <tr key={provider.code}>
              <td>
                {/* eslint-disable-next-line @next/next/no-img-element -- Remote logos use browser requests without server fetching. */}
                {provider.logo_url && <img className="shipping-provider-logo" src={provider.logo_url} alt="" loading="lazy" referrerPolicy="no-referrer" />}
                {provider.name}
              </td>
              <td>{provider.code}</td>
              <td>{provider.catalog_enabled ? "Đang hiển thị" : "Đã tắt"}</td>
              <td>{provider.integration_enabled ? "Đang hoạt động" : "Chưa kích hoạt"}</td>
              <td>{provider.code === "ghn" ? "GHN Staging (kiểm tra kết nối)" : "Chưa hỗ trợ"}</td>
              <td><div className="shipping-admin-actions">
                <ShippingDialog label="Chỉnh sửa" title={`Chỉnh sửa ${provider.name}`}><ProviderForm key={`${provider.name}:${provider.logo_url}`} provider={provider} /></ShippingDialog>
                <ShippingForm action={toggleProvider} label={provider.catalog_enabled ? "Tắt danh mục" : "Bật danh mục"}
                  confirm={provider.catalog_enabled ? `Tắt ${provider.name} trong danh mục mới?` : undefined}>
                  <input type="hidden" name="code" value={provider.code} />
                  <input type="hidden" name="enabled" value={String(!provider.catalog_enabled)} />
                </ShippingForm>
              </div></td>
            </tr>)}
          </tbody>
        </table>
      </div>
      <Pagination page={page} total={count ?? 0} path={path} params={{}} />
    </section>}
  </main>;
}
