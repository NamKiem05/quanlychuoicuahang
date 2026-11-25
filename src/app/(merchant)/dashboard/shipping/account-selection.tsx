"use client";

import { useActionState, useState } from "react";
import Toast from "@/components/ui/toast";
import { saveShippingAccountSelection } from "./actions";

const statusLabels = {
  available: "Đủ điều kiện",
  not_checked: "Chưa xác minh",
  failed: "Xác minh thất bại",
  disabled: "Đã vô hiệu hóa",
  revoked: "Đã thu hồi",
  unavailable: "Không khả dụng",
};

type Account = {
  id: string;
  name: string;
  scope: "shop" | "platform";
  provider: string;
  shopId: string;
  verification: "verified" | "failed" | "not_checked";
  enabled: boolean;
  status: keyof typeof statusLabels;
};

export type ShippingConfiguration = {
  revision: string | null;
  selectedVersionId: string | null;
  accounts: Account[];
};

const scopeLabels = { shop: "Cửa hàng", platform: "Nền tảng" };

export default function AccountSelection({ storeId, configuration }: {
  storeId: string;
  configuration: ShippingConfiguration;
}) {
  const { accounts, selectedVersionId, revision } = configuration;
  const selected = accounts.find((account) => account.id === selectedVersionId);
  const available = accounts.filter((account) => account.status === "available" && account.id !== selectedVersionId);
  const [choice, setChoice] = useState("");
  const target = available.find((account) => account.id === choice);
  const [result, action, pending] = useActionState(saveShippingAccountSelection, { ok: false, message: "" });

  return <section className="shipping-card">
    <div className="shipping-card-heading">
      <div><h2>Lựa chọn tài khoản GHN Staging</h2><p>Tài khoản thuộc cửa hàng hoặc được GrowDesk cấp cho cửa hàng này.</p></div>
      <span className="shipping-status">{!selectedVersionId ? "Chưa cấu hình" : selected ? statusLabels[selected.status] : "Không khả dụng"}</span>
    </div>
    {selected && <p>Đã chọn <strong>{selected.name}</strong> · {scopeLabels[selected.scope]} · Shop ID {selected.shopId}</p>}
    <p className="shipping-note">Lựa chọn được lưu riêng. Checkout và vận đơn hiện vẫn dùng kết nối GHN ở bên dưới.</p>
    {accounts.length > 0 && <ul className="shipping-account-list">
      {accounts.map((account) => <li key={account.id}>
        <div><strong>{account.name}</strong><span>{account.provider} · {scopeLabels[account.scope]} · Shop ID {account.shopId}</span>
          <span>{account.verification === "verified" ? "Đã xác minh" : statusLabels[account.verification]} · {account.enabled ? "Đã bật" : "Đã tắt"}</span></div>
        <div><span className={`shipping-status${account.status === "available" ? " connected" : ""}`}>{statusLabels[account.status]}</span>
          {account.id === selectedVersionId && <span>Đã chọn</span>}</div>
      </li>)}
    </ul>}
    {available.length === 0 ? <p>{selected?.status === "available" ? "Chưa có tài khoản khác đủ điều kiện." : "Chưa có tài khoản đủ điều kiện để chọn."}</p> : <form action={action} onSubmit={(event) => {
      if (!target || (selectedVersionId && !window.confirm(`Đổi lựa chọn sang “${target.name}”?`))) event.preventDefault();
    }}>
      <input type="hidden" name="__active_store_id" value={storeId} />
      <input type="hidden" name="revision" value={revision ?? ""} />
      <fieldset className="shipping-selection-fields" disabled={pending}>
        <label htmlFor="shipping-version">Tài khoản muốn chọn</label>
        <select id="shipping-version" name="version_id" value={target?.id ?? ""} onChange={(event) => setChoice(event.target.value)} required>
          <option value="">Chọn tài khoản</option>
          {available.map((account) => (
            <option key={account.id} value={account.id}>{account.name} · {scopeLabels[account.scope]} · {account.shopId}</option>
          ))}
        </select>
        {target && <p>Chính sách sử dụng <strong>{scopeLabels[target.scope]}</strong></p>}
        <button className="shipping-primary" type="submit" disabled={!target || pending}>{pending ? "Đang lưu…" : "Lưu lựa chọn"}</button>
      </fieldset>
    </form>}
    {result.ok && <Toast message={result.message} variant="success" />}
    {result.message && <p className={result.ok ? "shipping-success" : "shipping-error"} role={result.ok ? "status" : "alert"}>{result.message}</p>}
  </section>;
}
