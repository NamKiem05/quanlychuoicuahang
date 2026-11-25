import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { getMerchantContext } from "../data";
import AccountSelection, { type ShippingConfiguration } from "./account-selection";

export default async function AccountConfiguration() {
  const { store, membership, userId } = await getMerchantContext();
  if (!store || membership?.role !== "owner") return null;

  let configuration: ShippingConfiguration | null = null;
  try {
    const { data, error } = await createAdminClient().rpc("get_store_shipping_configuration", {
      target_store: store.id,
      actor: userId,
    });
    if (!error && data && Array.isArray(data.accounts)) configuration = data;
  } catch {
    // Keep the existing GHN configuration usable if the new RPC is unavailable.
  }

  return configuration ? <AccountSelection key={store.id} storeId={store.id} configuration={configuration} />
    : <section className="shipping-card"><h2>Lựa chọn tài khoản GHN Staging</h2>
      <p className="shipping-error" role="alert">Chưa tải được danh sách tài khoản vận chuyển. Vui lòng thử lại sau.</p>
    </section>;
}
