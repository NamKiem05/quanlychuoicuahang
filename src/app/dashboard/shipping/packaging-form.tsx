"use client";

import { useActionState } from "react";
import { dimensionFields, type Packaging } from "@/lib/shipping/packaging";
import { saveGhnPackaging } from "./actions";

export default function PackagingForm({ storeId, packaging }: { storeId: string; packaging: Packaging | null }) {
  const [result, action, pending] = useActionState(saveGhnPackaging, { ok: false, message: "" });
  return (
    <section className="shipping-card">
      <h2>Đóng gói đơn GHN</h2>
      <p>GrowDesk dùng bao bì này để tính phí GHN Staging khi cửa hàng đã kết nối GHN và bật giao tận nơi.</p>
      <form action={action}>
        <input type="hidden" name="__active_store_id" value={storeId} />
        <div className="shipping-fields">
          <label>Loại bao bì<select name="kind" defaultValue={packaging?.kind ?? "box"}><option value="box">Hộp</option><option value="bag">Túi</option></select></label>
          <label>Quy tắc đóng gói<select name="packing_rule" defaultValue={packaging?.packing_rule ?? "stack"}><option value="stack">Xếp chồng theo chiều cao</option><option value="single">Một sản phẩm mỗi kiện</option></select></label>
          {dimensionFields.map(([key, label, max]) => (
            <label key={key}>{key === "weight_g" ? "Khối lượng vỏ (g)" : label}
              <input name={key} type="number" min={key === "weight_g" ? 0 : 1} max={key === "weight_g" ? max - 1 : max} step={1} required defaultValue={packaging?.[key]} />
            </label>
          ))}
        </div>
        <p>Nhập kích thước bao bì sau khi đóng. Giỏ hàng phải vừa một kiện.</p>
        <button className="shipping-primary" disabled={pending}>{pending ? "Đang lưu…" : "Lưu cấu hình đóng gói"}</button>
        {result.message && <p role={result.ok ? "status" : "alert"} className={result.ok ? "shipping-success" : "shipping-error"}>{result.message}</p>}
      </form>
    </section>
  );
}
