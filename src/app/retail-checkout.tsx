"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import CheckoutAddressFields, { type CheckoutAddress } from "@/app/checkout-address-fields";
import SidebarIcon from "@/app/sidebar-icon";
import type { RetailCartLine } from "@/app/retail-cart";
import "./retail-checkout.css";

type Props = {
  lines: RetailCartLine[]; cartCount: number; subtotal: number; discount: number; total: number;
  storeName: string; deliveryEnabled: boolean; deliveryFee: number; deliveryRadius: number; bankTransfer: boolean;
  fulfillment: "pickup" | "delivery"; payment: "cash_on_pickup" | "bank_transfer";
  ghnEnabled: boolean; quoteReady: boolean; quoteStatus: ReactNode;
  deliveryLocation: { latitude: number; longitude: number } | null; deliveryLocationMessage: string; locating: boolean;
  promoInput: string; promoCode: string | null; promoFeedback: { message: string; isError: boolean } | null; promoStale: boolean;
  acceptsOrders: boolean; submitting: boolean; applying: boolean; error: string;
  onBack: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onFulfillment: (method: "pickup" | "delivery") => void; onPayment: (method: "cash_on_pickup" | "bank_transfer") => void;
  onAddressChange: (address: CheckoutAddress | null) => void; onLocate: () => void; onPromoInput: (value: string) => void; onPromoApply: () => void; onPromoClear: () => void;
};
const money = (value: number) => `${Number(value).toLocaleString("vi-VN")}₫`;

type SavedAddress = { id: string; recipient_name: string; phone: string; address: string };
export default function RetailCheckout(p: Props) {
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [addressError, setAddressError] = useState(false);
  const [name, setName] = useState(""); const [phone, setPhone] = useState(""); const [email, setEmail] = useState(""); const [address, setAddress] = useState("");
  const [selected, setSelected] = useState("");
  const touched = useRef({ name: false, phone: false, email: false, address: false });
  const ghnEnabled = p.ghnEnabled;
  const awaitingQuote = ghnEnabled && p.fulfillment === "delivery" && !p.quoteReady;
  const [clearLocation] = useState(() => p.onAddressChange);
  useEffect(() => {
    let active = true;
    const supabase = createClient();
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !active) return;
      const [profile, saved] = await Promise.all([
        supabase.from("profiles").select("display_name,phone").eq("id", user.id).maybeSingle(),
        supabase.from("customer_addresses").select("id,recipient_name,phone,address").eq("user_id", user.id).order("created_at", { ascending: false }),
      ]);
      if (!active) return;
      const latest = !saved.error ? saved.data?.[0] : null;
      if (!touched.current.name) setName(latest?.recipient_name || profile.data?.display_name || "");
      if (!touched.current.phone) setPhone(latest?.phone || profile.data?.phone || "");
      if (!touched.current.email) setEmail(user.email || "");
      if (saved.error) setAddressError(true);
      else {
        setAddresses(saved.data || []);
        if (!ghnEnabled && latest && !touched.current.address) { setSelected(latest.id); setAddress(latest.address); clearLocation(null); }
      }
    })();
    return () => { active = false; };
  }, [clearLocation, ghnEnabled]);
  function chooseAddress(id: string) { touched.current.address = true; touched.current.name = true; touched.current.phone = true; setSelected(id); const saved = addresses.find(item => item.id === id); if (saved) { setName(saved.recipient_name); setPhone(saved.phone); setAddress(saved.address); p.onAddressChange(null); } else { setAddress(""); p.onAddressChange(null); } }
  return <section className="retail-checkout-page">
    <nav className="retail-detail-breadcrumb" aria-label="Đường dẫn"><button type="button" onClick={p.onBack}>Giỏ hàng</button><span>›</span><b>Thanh toán</b></nav>
    <header className="retail-checkout-heading"><h1><SidebarIcon name="payment" /> Thanh toán</h1><ol aria-label="Các bước đặt hàng"><li className="done"><span>✓</span>Giỏ hàng</li><li className="active" aria-current="step"><span>2</span>Thanh toán</li><li><span>3</span>Hoàn tất</li></ol></header>
    <form className="retail-checkout-grid" onSubmit={p.onSubmit}>
      <div className="retail-checkout-main">
        <section className="retail-checkout-card"><h2><SidebarIcon name="accounts" /> Thông tin nhận hàng</h2><div className="retail-checkout-fields">{p.fulfillment === "pickup" && <p className="retail-address-hint" role="status">{p.deliveryEnabled ? "Đang chọn nhận tại cửa hàng. Chọn Giao hàng tận nơi bên dưới để xem địa chỉ nhận hàng." : "Cửa hàng hiện chỉ hỗ trợ nhận tại cửa hàng, chưa bật giao hàng tận nơi."}</p>}{p.fulfillment === "delivery" && !ghnEnabled && addresses.length > 0 && <label className="wide"><span>Địa chỉ đã lưu</span><select value={selected} onChange={event => chooseAddress(event.target.value)}><option value="">Nhập địa chỉ khác</option>{addresses.map(item => <option key={item.id} value={item.id}>{item.recipient_name} · {item.address}</option>)}</select></label>}{p.fulfillment === "delivery" && addressError && <p className="retail-saved-address-error" role="status">Chưa tải được địa chỉ đã lưu. Bạn vẫn có thể nhập địa chỉ bên dưới.</p>}<label><span>Họ và tên <em>*</em></span><input name="customerName" value={name} onChange={event => { touched.current.name = true; setName(event.target.value); }} autoComplete="name" maxLength={120} placeholder="Tên người nhận" required /></label><label><span>Số điện thoại <em>*</em></span><input name="customerPhone" value={phone} onChange={event => { touched.current.phone = true; setPhone(event.target.value); }} type="tel" autoComplete="tel" inputMode="tel" pattern="[0-9+() .-]{9,16}" placeholder="Số điện thoại liên hệ" required /></label><label className="wide"><span>Email nhận mã đơn <em>*</em></span><input name="customerEmail" value={email} onChange={event => { touched.current.email = true; setEmail(event.target.value); }} type="email" autoComplete="email" maxLength={254} placeholder="ban@example.com" required /></label>{p.fulfillment === "delivery" && (selected
          ? <label className="wide"><span>Địa chỉ giao hàng</span><textarea name="deliveryAddress" value={address} rows={2} readOnly /></label>
          : <CheckoutAddressFields onChange={(next) => { touched.current.address = true; p.onAddressChange(next); }} />)}<label className="wide"><span>Ghi chú <small>Không bắt buộc</small></span><textarea name="customerNote" rows={2} maxLength={500} placeholder="Ghi chú cho cửa hàng" /></label></div>{p.quoteStatus}{p.fulfillment === "delivery" && !ghnEnabled && <div className="retail-checkout-location"><button type="button" onClick={() => { touched.current.address = true; p.onLocate(); }} disabled={p.locating}>{p.locating ? "Đang xác định vị trí…" : p.deliveryLocation ? "Cập nhật vị trí nhận hàng" : "Dùng vị trí hiện tại"}</button>{p.deliveryLocation && <span>Đã ghi nhận tọa độ giao hàng.</span>}{p.deliveryLocationMessage && <p role="status">{p.deliveryLocationMessage}</p>}<input type="hidden" name="deliveryLatitude" value={p.deliveryLocation?.latitude ?? ""} /><input type="hidden" name="deliveryLongitude" value={p.deliveryLocation?.longitude ?? ""} /><small>Cho phép truy cập vị trí tại điểm nhận hàng để kiểm tra bán kính giao hàng.</small></div>}</section>
        <fieldset className="retail-checkout-card retail-checkout-options"><legend><SidebarIcon name="delivery" /> Phương thức nhận hàng</legend><label className={p.fulfillment === "pickup" ? "selected" : ""}><input type="radio" name="fulfillmentMethod" value="pickup" checked={p.fulfillment === "pickup"} onChange={() => p.onFulfillment("pickup")} /><span><b>Nhận tại cửa hàng</b><small>{p.storeName} sẽ xác nhận thời gian nhận hàng.</small></span><strong>Miễn phí</strong></label>{p.deliveryEnabled ? <label className={p.fulfillment === "delivery" ? "selected" : ""}><input type="radio" name="fulfillmentMethod" value="delivery" checked={p.fulfillment === "delivery"} onChange={() => p.onFulfillment("delivery")} /><span><b>Giao hàng tận nơi</b><small>{ghnEnabled ? "GHN Staging · Tính phí theo địa chỉ nhận hàng." : `Bán kính tối đa ${(p.deliveryRadius / 1000).toLocaleString("vi-VN")} km theo đường chim bay.`}</small></span><strong>{ghnEnabled && !p.quoteReady ? "Tính theo địa chỉ" : money(p.deliveryFee)}</strong></label> : <label className="unavailable"><input type="radio" name="fulfillmentMethod" value="delivery" disabled /><span><b>Giao hàng tận nơi</b><small>Cửa hàng chưa bật phương thức này.</small></span></label>}</fieldset>
        <fieldset className="retail-checkout-card retail-checkout-options"><legend><SidebarIcon name="payment" /> Phương thức thanh toán</legend><label className={p.payment === "cash_on_pickup" ? "selected" : ""}><input type="radio" name="paymentMethod" value="cash_on_pickup" checked={p.payment === "cash_on_pickup"} onChange={() => p.onPayment("cash_on_pickup")} /><span><b>{p.total <= 0 ? "Không cần thanh toán" : p.fulfillment === "delivery" ? "Thanh toán khi nhận hàng" : "Thanh toán tại cửa hàng"}</b><small>{p.fulfillment === "delivery" ? "Thanh toán trực tiếp với người giao hàng." : "Thanh toán trực tiếp tại cửa hàng."}</small></span></label>{p.bankTransfer && <label className={p.payment === "bank_transfer" ? "selected" : ""}><input type="radio" name="paymentMethod" value="bank_transfer" checked={p.payment === "bank_transfer"} disabled={p.total <= 0} onChange={() => p.onPayment("bank_transfer")} /><span><b>Chuyển khoản QR</b><small>Quét mã QR sau khi đặt hàng.</small></span></label>}</fieldset>
      </div>
      <aside className="retail-checkout-card retail-checkout-summary"><h2><SidebarIcon name="cart" /> Đơn hàng của bạn <small>({p.cartCount} sản phẩm)</small></h2><div className="retail-checkout-items">{p.lines.map(line => <article key={line.id}><div className="retail-checkout-image">{line.product.image ? <Image src={line.product.image} alt="" fill sizes="72px" unoptimized /> : <span aria-hidden="true">◇</span>}</div><div><b>{line.product.name}</b>{line.optionLabels.length > 0 && <small>{line.optionLabels.join(" · ")}</small>}<small>Số lượng: {line.quantity}</small></div><strong>{money(line.unitPrice * line.quantity)}</strong></article>)}</div><div className="retail-checkout-promo"><b>Mã giảm giá</b><div><input aria-label="Mã giảm giá" value={p.promoInput} maxLength={24} placeholder="Nhập mã giảm giá" onChange={event => p.onPromoInput(event.target.value.toUpperCase())} />{p.promoCode ? <button type="button" onClick={p.onPromoClear}>Bỏ mã</button> : <button type="button" onClick={p.onPromoApply} disabled={p.applying || !p.acceptsOrders}>{p.applying ? "Đang kiểm tra…" : "Áp dụng"}</button>}</div>{p.promoStale && <p role="status">Giỏ hàng đã thay đổi. Hãy áp dụng lại mã.</p>}{p.promoFeedback && !p.promoStale && <p role={p.promoFeedback.isError ? "alert" : "status"}>{p.promoFeedback.message}</p>}</div><dl><div><dt>Tạm tính</dt><dd>{money(p.subtotal)}</dd></div><div><dt>Phí giao hàng</dt><dd>{awaitingQuote ? "Chưa có báo giá" : money(p.fulfillment === "delivery" ? p.deliveryFee : 0)}</dd></div>{p.promoCode && <div><dt>Giảm giá · {p.promoCode}</dt><dd className="discount">−{money(p.discount)}</dd></div>}<div className="total"><dt>Tổng thanh toán</dt><dd>{awaitingQuote ? "Chưa có báo giá" : money(p.total)}</dd></div></dl>{p.error && <p className="retail-checkout-error" role="alert">{p.error}</p>}<button className="retail-checkout-submit" type="submit" disabled={!p.acceptsOrders || p.submitting || p.applying || p.lines.length === 0 || awaitingQuote}>{p.submitting ? "Đang gửi đơn…" : p.applying ? "Đang kiểm tra mã…" : "Đặt hàng"} →</button><button className="retail-checkout-back" type="button" onClick={p.onBack}>← Về giỏ hàng</button></aside>
    </form>
  </section>;
}
