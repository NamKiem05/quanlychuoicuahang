"use client";

import { useActionState } from "react";
import { dimensionFields, type PackagingProfile } from "@/lib/shipping/packaging";
import { saveGhnPackaging } from "./actions";

function PackagingForm({ storeId, packaging }: { storeId: string; packaging?: PackagingProfile }) {
  const [result, action, pending] = useActionState(saveGhnPackaging, { ok: false, message: "" });
  return (
      <form action={action}>
        <input type="hidden" name="__active_store_id" value={storeId} />
        {packaging && <input type="hidden" name="packaging_id" value={packaging.id} />}
        <div className="shipping-fields">
          <label>Tên bao bì<input name="name" required maxLength={80} defaultValue={packaging?.name} placeholder="Ví dụ: Hộp lớn" /></label>
          <label>Loại bao bì<select name="kind" defaultValue={packaging?.kind ?? "box"}><option value="box">Hộp</option><option value="bag">Túi</option></select></label>
          <label>Quy tắc đóng gói<select name="packing_rule" defaultValue={packaging?.packing_rule ?? "stack"}><option value="stack">Xếp chồng theo chiều cao</option><option value="single">Một sản phẩm mỗi kiện</option></select></label>
          {dimensionFields.map(([key, label, max]) => (
            <label key={key}>{key === "weight_g" ? "Khối lượng vỏ (g)" : label}
              <input name={key} type="number" min={key === "weight_g" ? 0 : 1} max={key === "weight_g" ? max - 1 : max} step={1} required defaultValue={packaging?.[key]} />
            </label>
          ))}
        </div>
        <div className="shipping-actions shipping-packaging-actions">
          <button className="shipping-primary" type="submit" disabled={pending}>{pending ? "Đang xử lý…" : packaging ? "Lưu thay đổi" : "Thêm bao bì"}</button>
          {packaging && <button type="submit" name="intent" value="delete" formNoValidate disabled={pending} onClick={(event) => {
            if (!window.confirm(`Xóa bao bì “${packaging.name}”?`)) event.preventDefault();
          }}>Xóa bao bì</button>}
        </div>
        {result.message && <p role={result.ok ? "status" : "alert"} className={result.ok ? "shipping-success" : "shipping-error"}>{result.message}</p>}
      </form>
  );
}

export default function PackagingProfiles({ storeId, profiles }: { storeId: string; profiles: PackagingProfile[] }) {
  return (
    <section className="shipping-card">
      <h2>Đóng gói đơn GHN</h2>
      <p>GrowDesk dùng bao bì nhỏ nhất chứa vừa giỏ hàng để báo phí một kiện. Nhập kích thước bao bì sau khi đóng và khối lượng vỏ.</p>
      <div className="shipping-packaging-profiles">
        {profiles.map((profile) => (
          <details key={profile.id}>
            <summary>{profile.name} · {profile.length_cm} × {profile.width_cm} × {profile.height_cm} cm</summary>
            <PackagingForm storeId={storeId} packaging={profile} />
          </details>
        ))}
        <details open={profiles.length === 0}>
          <summary>Thêm hộp hoặc túi</summary>
          <PackagingForm storeId={storeId} />
        </details>
      </div>
    </section>
  );
}
