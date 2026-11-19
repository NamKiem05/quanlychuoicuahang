"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { GhnCheckoutSnapshot } from "@/lib/shipping/packaging";
import { createShipment, loadGhnWards, previewShipment } from "./actions";

type Saved = Partial<{ to_province_name: string; to_ward_name: string; weight: number; length: number; width: number; height: number }>;
type Result = Awaited<ReturnType<typeof previewShipment>>;
type Location = { id: number; name: string };

const packageFields = [
  { key: "weight", label: "Khối lượng (gram)", max: 19999 },
  { key: "length", label: "Dài (cm)", max: 200 },
  { key: "width", label: "Rộng (cm)", max: 200 },
  { key: "height", label: "Cao (cm)", max: 200 },
] as const;

const money = (amount: number) => amount.toLocaleString("vi-VN") + "₫";
const eta = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });

export default function ShipmentForm({ storeId, orderId, provinces, locationsError, quote, customerFee, previous, pending }: {
  storeId: string;
  orderId: string;
  provinces: Location[];
  locationsError: boolean;
  quote: GhnCheckoutSnapshot | null;
  customerFee: number;
  previous: Saved | null;
  pending: boolean;
}) {
  const router = useRouter();
  const submitting = useRef(false);
  const [result, setResult] = useState<Result | null>(null);
  const [preview, setPreview] = useState(false);
  const [parcelConfirmed, setParcelConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [province, setProvince] = useState(previous?.to_province_name ?? "");
  const [ward, setWard] = useState(previous?.to_ward_name ?? "");
  const [wards, setWards] = useState<Location[]>([]);
  const [loadingWards, setLoadingWards] = useState(false);
  const [wardError, setWardError] = useState(false);
  const provinceId = provinces.find((item) => item.name === province)?.id;

  useEffect(() => {
    if (!provinceId || quote || pending) return;
    let active = true;
    const values = new FormData();
    values.set("__active_store_id", storeId);
    values.set("order_id", orderId);
    values.set("province_id", String(provinceId));
    void loadGhnWards(values).then((response) => {
      if (!active) return;
      setWards(response.items);
      setWardError(!response.ok);
      setLoadingWards(false);
    }).catch(() => {
      if (!active) return;
      setWardError(true);
      setLoadingWards(false);
    });
    return () => { active = false; };
  }, [orderId, pending, provinceId, quote, storeId]);

  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const create = submitter?.value === "create";
    if (create && !pending && (!preview || (result?.requiresParcelConfirmation && !parcelConfirmed))) return;
    const values = new FormData(event.currentTarget);
    submitting.current = true;
    setBusy(true);
    setResult(null);
    try {
      const response = await (create ? createShipment(values) : previewShipment(values));
      setResult(response);
      setPreview(response.ok && !create);
      if (create) router.refresh();
    } catch {
      setPreview(false);
      setResult({ ok: false, message: "Chưa xử lý được yêu cầu. Hãy thử lại." });
      if (create) router.refresh();
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <form className="ghn-shipment-form" onSubmit={run}>
      <input type="hidden" name="__active_store_id" value={storeId} />
      <input type="hidden" name="order_id" value={orderId} />
      {pending && <p className="ghn-shipment-warning">Lần gửi trước chưa được xác nhận. Dùng lại kiện đã lưu để tránh tạo trùng vận đơn.</p>}
      {quote && (
        <>
          <h2>Kiện dự kiến tại checkout</h2>
          <p>{quote.packaging_name && quote.packaging_name + " · "}{quote.weight} g · {quote.length} × {quote.width} × {quote.height} cm · {quote.ward}, {quote.province}.</p>
        </>
      )}
      <h2>Kiện đóng gói thực tế</h2>
      <p>1 kiện · Cân và đo kiện sau khi đóng gói, rồi kiểm tra phí trước khi tạo vận đơn.</p>
      <fieldset className="ghn-actual-package" disabled={busy} onChange={() => {
        setPreview(false);
        setResult(null);
        setParcelConfirmed(false);
      }}>
        <div className="ghn-shipment-fields">
          {!quote && (
            <>
              <label>Tỉnh / thành phố
                {provinces.length && !pending ? (
                  <select name="province" required value={province} onChange={(event) => {
                    setProvince(event.target.value);
                    setWard("");
                    setWards([]);
                    setWardError(false);
                    setLoadingWards(Boolean(event.target.value));
                  }}>
                    <option value="">Chọn tỉnh / thành phố</option>
                    {provinces.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
                  </select>
                ) : <input name="province" maxLength={120} required value={province} onChange={(event) => setProvince(event.target.value)} readOnly={pending} />}
              </label>
              <label>Phường / xã
                {provinces.length && !wardError && !pending ? (
                  <select name="ward" required disabled={!provinceId || loadingWards} value={ward} onChange={(event) => setWard(event.target.value)}>
                    <option value="">{loadingWards ? "Đang tải phường / xã…" : "Chọn phường / xã"}</option>
                    {wards.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
                  </select>
                ) : <input name="ward" maxLength={120} required value={ward} onChange={(event) => setWard(event.target.value)} readOnly={pending} />}
              </label>
            </>
          )}
          {packageFields.map(({ key, label, max }) => (
            <label key={key}>{label}
              <input name={key} type="number" min={1} max={max} required readOnly={pending} defaultValue={previous?.[key] ?? quote?.[key] ?? ""} />
            </label>
          ))}
        </div>
      </fieldset>
      {(locationsError || wardError) && !pending && <p className="ghn-shipment-warning" role="status">Chưa tải được danh mục địa chỉ GHN. Hãy nhập đúng tên địa phương theo danh mục GHN.</p>}
      <p>Phí giao hàng đã chốt với khách: <strong>{money(customerFee)}</strong>.</p>
      {result && (
        <div role={result.ok ? "status" : "alert"} className={result.ok ? "ghn-shipment-success" : "ghn-shipment-error"}>
          {result.message}
          {result.fee !== undefined && (
            <p>Phí GHN cho kiện đã cân đo: <b>{money(result.fee)}</b>{result.expected && <> · Giao dự kiến {eta.format(new Date(result.expected))}</>}</p>
          )}
        </div>
      )}
      {result?.requiresParcelConfirmation && !pending && (
        <div className="ghn-shipment-warning">
          <p>Số đo thực tế chênh đáng kể so với kiện dự kiến tại checkout. Hãy kiểm tra lại số đo.</p>
          <label>
            <input type="checkbox" name="confirm_parcel_change" value="yes" checked={parcelConfirmed} disabled={busy}
              onChange={(event) => setParcelConfirmed(event.target.checked)} /> Tôi đã cân đo lại và xác nhận số đo này.
          </label>
        </div>
      )}
      <div className="ghn-shipment-actions">
        <button type="submit" name="action" value="preview" disabled={busy || loadingWards}>Xem phí kiện thực tế</button>
        <button type="submit" name="action" value="create" disabled={busy || loadingWards || (!pending && (!preview || (result?.requiresParcelConfirmation && !parcelConfirmed)))}>
          {busy ? "Đang xử lý…" : pending ? "Kiểm tra / gửi lại" : "Tạo vận đơn thử nghiệm"}
        </button>
      </div>
    </form>
  );
}
