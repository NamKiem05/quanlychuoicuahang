"use client";

import { useState, type FormEvent } from "react";

const shopId = "100001";
const sampleToken = "GHN-DEMO";
const product = { name: "Hộp bánh mẫu", price: 85000 };
const locations = [
  { province: "Hà Nội", district: "Nam Từ Liêm", wards: ["Tây Mỗ", "Đại Mỗ"], fee: 22000 },
  { province: "TP. Hồ Chí Minh", district: "Quận 1", wards: ["Bến Thành", "Bến Nghé"], fee: 28000 },
];
const currency = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" });

type Order = {
  name: string;
  phone: string;
  address: string;
  quantity: number;
  fee: number;
};

export default function Simulation() {
  const [enteredShop, setEnteredShop] = useState("");
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState(false);
  const [province, setProvince] = useState("");
  const [district, setDistrict] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [quote, setQuote] = useState<Order | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [shipmentCreated, setShipmentCreated] = useState(false);
  const location = locations.find((item) => item.province === province);

  function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const valid = enteredShop.trim() === shopId && token.trim() === sampleToken;
    setConnectionError(!valid);
    setConnected(valid);
  }

  function calculateFee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!location || district !== location.district) return;

    const data = new FormData(event.currentTarget);
    const ward = String(data.get("ward") ?? "");
    const street = String(data.get("street") ?? "").trim();
    const name = String(data.get("name") ?? "").trim();
    if (!location.wards.includes(ward) || !street || !name) return;

    setQuote({
      name,
      phone: String(data.get("phone") ?? ""),
      address: [street, ward, district, province].join(", "),
      quantity,
      fee: location.fee + (quantity - 1) * 2000,
    });
  }

  return (
    <>
      <section className="shipping-card">
        <h2>Kết nối tài khoản GHN</h2>
        {connected ? (
          <p className="shipping-success" role="status">Đã kích hoạt GHN cho cửa hàng mô phỏng · Shop ID {shopId}.</p>
        ) : (
          <form onSubmit={connect}>
            <p>Thông tin mẫu để kết nối: Shop ID <strong>{shopId}</strong> và token <strong>{sampleToken}</strong>.</p>
            <div className="shipping-fields">
              <label>Shop ID<input value={enteredShop} onChange={(event) => setEnteredShop(event.target.value)} inputMode="numeric" required /></label>
              <label>Token GHN mẫu<input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" required /></label>
            </div>
            <div className="shipping-notice">
              <button className="shipping-primary" type="submit">Kiểm tra và kết nối</button>
              {connectionError && <p className="shipping-error" role="alert">Shop ID hoặc token mẫu chưa đúng.</p>}
            </div>
          </form>
        )}
      </section>

      {connected && (
        <section className="shipping-card">
          <h2>Khách hàng đặt hàng</h2>
          {order ? (
            <p className="shipping-success" role="status">Đã đặt đơn mẫu DEMO-001.</p>
          ) : (
            <>
              <p>{product.name} · {currency.format(product.price)} mỗi sản phẩm</p>
              <form onSubmit={calculateFee} onChange={() => setQuote(null)}>
                <div className="shipping-fields">
                  <label>Số lượng trong giỏ<input type="number" min={1} max={10} required value={quantity} onChange={(event) => setQuantity(event.target.valueAsNumber || 0)} /></label>
                  <label>Họ tên người nhận<input name="name" defaultValue="Khách hàng mẫu" required /></label>
                  <label>Số điện thoại<input name="phone" type="tel" pattern="[0-9]{10}" defaultValue="0900000000" required /></label>
                  <label>Tỉnh/thành phố
                    <select value={province} required onChange={(event) => { setProvince(event.target.value); setDistrict(""); }}>
                      <option value="">Chọn tỉnh/thành phố</option>
                      {locations.map((item) => <option key={item.province}>{item.province}</option>)}
                    </select>
                  </label>
                  <label>Quận/huyện
                    <select value={district} required disabled={!location} onChange={(event) => setDistrict(event.target.value)}>
                      <option value="">Chọn quận/huyện</option>
                      {location && <option>{location.district}</option>}
                    </select>
                  </label>
                  <label>Phường/xã
                    <select key={province + district} name="ward" required disabled={!district}>
                      <option value="">Chọn phường/xã</option>
                      {district && location?.wards.map((ward) => <option key={ward}>{ward}</option>)}
                    </select>
                  </label>
                  <label>Địa chỉ chi tiết<input name="street" defaultValue="12 Đường Mẫu" required /></label>
                </div>
                <div className="shipping-notice">
                  <button className="shipping-primary" type="submit">Tính phí giao hàng</button>
                </div>
              </form>
              {quote && (
                <form onSubmit={(event) => { event.preventDefault(); setOrder(quote); }}>
                  <label><input type="radio" name="delivery" value="ghn" required /> Giao hàng GHN mô phỏng · {currency.format(quote.fee)}</label>
                  <p>Tổng thanh toán: <strong>{currency.format(product.price * quote.quantity + quote.fee)}</strong></p>
                  <button className="shipping-primary" type="submit">Xác nhận đặt hàng</button>
                </form>
              )}
            </>
          )}
        </section>
      )}

      {order && (
        <section className="shipping-card">
          <h2>Cửa hàng tiếp nhận đơn</h2>
          <p><strong>DEMO-001</strong> · {confirmed ? "Đã xác nhận" : "Chờ xác nhận"}</p>
          <p>{product.name} × {order.quantity} · Phí giao hàng {currency.format(order.fee)}</p>
          <p>{order.name} · {order.phone} · {order.address}</p>
          {!confirmed && <button className="shipping-primary" type="button" onClick={() => setConfirmed(true)}>Xác nhận đơn hàng</button>}
          {confirmed && !shipmentCreated && (
            <button className="shipping-primary" type="button" onClick={() => setShipmentCreated(true)}>Tạo vận đơn GHN mô phỏng</button>
          )}
          {shipmentCreated && <p className="shipping-success" role="status">Vận đơn mẫu GHN-DEMO-001 · Chờ lấy hàng.</p>}
        </section>
      )}
      {shipmentCreated && (
        <button className="shipping-primary" type="button" onClick={() => {
          setQuote(null);
          setOrder(null);
          setConfirmed(false);
          setShipmentCreated(false);
          setProvince("");
          setDistrict("");
          setQuantity(1);
        }}>Thử đơn hàng khác</button>
      )}
    </>
  );
}
