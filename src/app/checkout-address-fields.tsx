"use client";

import { useState } from "react";
import provinces from "@/lib/vietnam-checkout-addresses.json";

export type CheckoutAddress = { province: number; ward: number; detail: string };

export default function CheckoutAddressFields({ onChange }: { onChange: (address: CheckoutAddress | null) => void }) {
  const [provinceCode, setProvinceCode] = useState("");
  const [wardCode, setWardCode] = useState("");
  const [street, setStreet] = useState("");
  const province = provinces.find((item) => String(item.code) === provinceCode);
  const ward = province?.wards.find((item) => String(item.code) === wardCode);
  const address = province && ward ? [street.trim(), ward.name, province.name].join(", ") : "";

  return (
    <div className="checkout-address-fields wide">
      <label>
        <span>Tỉnh / Thành phố</span>
        <select autoComplete="address-level1" required value={provinceCode} onChange={(event) => {
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
          setStreet(event.target.value);
          onChange(province && ward && event.target.value.trim()
            ? { province: province.code, ward: ward.code, detail: event.target.value.trim() }
            : null);
        }} />
      </label>
      <input type="hidden" name="deliveryAddress" value={address} />
    </div>
  );
}
