"use client";

import { useEffect, useRef, useState } from "react";
import StoreLocationPicker from "@/app/(merchant)/dashboard/store/location-picker";
import { lookupCheckoutLocation, type Position } from "@/lib/checkout-location";
import provinces from "@/lib/vietnam-checkout-addresses.json";

export type CheckoutAddress = { province: number; ward: number; detail: string };

export default function CheckoutAddressFields({ onChange }: { onChange: (address: CheckoutAddress | null) => void }) {
  const [provinceCode, setProvinceCode] = useState("");
  const [wardCode, setWardCode] = useState("");
  const [street, setStreet] = useState("");
  const [locationMessage, setLocationMessage] = useState("");
  const lookup = useRef<AbortController | null>(null);
  const streetValue = useRef("");
  const province = provinces.find((item) => String(item.code) === provinceCode);
  const ward = province?.wards.find((item) => String(item.code) === wardCode);
  const address = province && ward ? [street.trim(), ward.name, province.name].join(", ") : "";

  useEffect(() => () => lookup.current?.abort(), []);

  function cancelLookup() {
    lookup.current?.abort();
    setLocationMessage("");
  }

  async function selectPin(position: Position) {
    lookup.current?.abort();
    const request = new AbortController();
    lookup.current = request;
    setLocationMessage("Đang tìm tỉnh/thành và phường/xã…");

    const location = await lookupCheckoutLocation(position, request.signal).catch(() => null);
    if (request.signal.aborted) return;
    if (!location) {
      setLocationMessage("Chưa xác định được phường/xã từ ghim. Bạn có thể chọn địa chỉ bên dưới.");
      return;
    }

    setProvinceCode(String(location.province));
    setWardCode(String(location.ward));
    const detail = streetValue.current.trim();
    onChange(detail ? { ...location, detail } : null);
    setLocationMessage("Đã điền tỉnh/thành và phường/xã từ bản đồ. Bạn có thể chỉnh lại nếu cần.");
  }

  return (
    <>
      <StoreLocationPicker initialLatitude={null} initialLongitude={null} embedded delivery onPin={selectPin} />
      {locationMessage && <p className="store-location-message" role="status">{locationMessage}</p>}
      <div className="checkout-address-fields wide">
      <label>
        <span>Tỉnh / Thành phố</span>
        <select autoComplete="address-level1" required value={provinceCode} onChange={(event) => {
          cancelLookup();
          setProvinceCode(event.target.value);
          setWardCode("");
          onChange(null);
        }}>
          <option value="">Chọn tỉnh / thành phố</option>
          {provinces.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
        </select>
      </label>
      <label>
        <span>Phường / Xã</span>
        <select autoComplete="address-level2" required disabled={!province} value={wardCode} onChange={(event) => {
          cancelLookup();
          setWardCode(event.target.value);
          onChange(event.target.value && street.trim()
            ? { province: Number(provinceCode), ward: Number(event.target.value), detail: street.trim() }
            : null);
        }}>
          <option value="">Chọn phường / xã</option>
          {province?.wards.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
        </select>
      </label>
      <label className="wide">
        <span>Địa chỉ chi tiết</span>
        <input autoComplete="street-address" maxLength={400} required pattern={".*\\S.*"} placeholder="Số nhà, tên đường, thôn hoặc tòa nhà" value={street} onChange={(event) => {
          streetValue.current = event.target.value;
          setStreet(event.target.value);
          onChange(province && ward && event.target.value.trim()
            ? { province: province.code, ward: ward.code, detail: event.target.value.trim() }
            : null);
        }} />
      </label>
      <input type="hidden" name="deliveryAddress" value={address} />
      </div>
    </>
  );
}
