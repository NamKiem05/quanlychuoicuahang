"use client";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

type Address = { id: string; recipient_name: string; phone: string; address: string };
export default function AddressManager({ initialAddresses, initialError }: { initialAddresses: Address[]; initialError: boolean }) {
  const [addresses, setAddresses] = useState(initialAddresses);
  const [editing, setEditing] = useState<Address | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(initialError ? "Chưa tải được địa chỉ. Vui lòng thử lại sau." : "");
  const [isError, setIsError] = useState(initialError);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const values = { recipient_name: String(data.get("name") || "").trim(), phone: String(data.get("phone") || "").trim(), address: String(data.get("address") || "").trim() };
    if (!values.recipient_name || values.recipient_name.length > 120 || !/^[0-9+() .-]{9,16}$/.test(values.phone) || values.address.length < 5 || values.address.length > 500) { setIsError(true); setMessage("Vui lòng kiểm tra thông tin người nhận và địa chỉ."); return; }
    setBusy(true); setMessage(""); const supabase = createClient();
    const query = editing ? supabase.from("customer_addresses").update(values).eq("id", editing.id) : supabase.from("customer_addresses").insert(values);
    const { data: result, error } = await query.select("id,recipient_name,phone,address").maybeSingle(); setBusy(false);
    if (error || !result) { setIsError(true); setMessage("Chưa lưu được địa chỉ. Vui lòng thử lại."); return; }
    setAddresses(current => editing ? current.map(item => item.id === editing.id ? result : item) : [result, ...current]); setOpen(false); setEditing(null); setIsError(false); setMessage("Đã lưu địa chỉ nhận hàng.");
  }
  async function remove(item: Address) {
    if (!window.confirm("Bạn muốn xóa địa chỉ nhận hàng này?")) return;
    setBusy(true); setMessage(""); const { data, error } = await createClient().from("customer_addresses").delete().eq("id", item.id).select("id").maybeSingle(); setBusy(false);
    if (error || !data) { setIsError(true); setMessage("Chưa xóa được địa chỉ. Vui lòng thử lại."); return; }
    setAddresses(current => current.filter(address => address.id !== item.id)); setIsError(false); setMessage("Đã xóa địa chỉ nhận hàng.");
  }
  return <section className="customer-addresses"><div className="customer-addresses-heading"><div><span>TÀI KHOẢN MUA HÀNG</span><h1>Địa chỉ nhận hàng</h1><p>Lưu địa chỉ để chọn nhanh khi thanh toán.</p></div><button type="button" onClick={() => { setEditing(null); setOpen(true); setMessage(""); }}>＋ Thêm địa chỉ</button></div>{message && <p className={isError ? "customer-address-message error" : "customer-address-message"} role={isError ? "alert" : "status"}>{message}</p>}{open && <form className="customer-address-form" onSubmit={save} key={editing?.id || "new"}><h2>{editing ? "Chỉnh sửa địa chỉ" : "Thêm địa chỉ nhận hàng"}</h2><div><label>Họ tên người nhận <span>*</span><input name="name" defaultValue={editing?.recipient_name} maxLength={120} required autoComplete="name" /></label><label>Số điện thoại <span>*</span><input name="phone" defaultValue={editing?.phone} type="tel" pattern="[0-9+() .-]{9,16}" maxLength={16} required autoComplete="tel" /></label><label className="wide">Địa chỉ đầy đủ <span>*</span><textarea name="address" defaultValue={editing?.address} minLength={5} maxLength={500} rows={3} required autoComplete="street-address" placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành phố" /></label></div><footer><button type="button" onClick={() => { setOpen(false); setEditing(null); }}>Hủy</button><button type="submit" disabled={busy}>{busy ? "Đang lưu…" : "Lưu địa chỉ"}</button></footer></form>}{!initialError && addresses.length === 0 && !open ? <div className="customer-address-empty"><b>Bạn chưa có địa chỉ nhận hàng</b><p>Thêm địa chỉ để sử dụng khi đặt hàng.</p></div> : <div className="customer-address-list">{addresses.map(item => <article key={item.id}><div><h2>{item.recipient_name}</h2><p>{item.phone}</p><p>{item.address}</p></div><div className="customer-address-actions"><button type="button" disabled={busy} onClick={() => { setEditing(item); setOpen(true); setMessage(""); }}>Chỉnh sửa</button><button type="button" disabled={busy} onClick={() => void remove(item)}>Xóa</button></div></article>)}</div>}</section>;
}
