"use client";

import { useState } from "react";

function makeSlug(value: string) {
  return value.toLocaleLowerCase("vi-VN").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80).replace(/-$/, "");
}

export default function StoreNameFields() {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [manual, setManual] = useState(false);
  return <>
    <label>Tên cửa hàng <b>*</b><input name="name" required maxLength={120} placeholder="Ví dụ: Cửa hàng của bạn" value={name} onChange={(event) => { const value = event.target.value; setName(value); if (!manual) setSlug(makeSlug(value)); }} /></label>
    <label className="store-setup-wide">Đường dẫn cửa hàng <small>Có thể chỉnh sửa</small><input name="slug" maxLength={80} placeholder="cua-hang-cua-ban" value={slug} onChange={(event) => { const value = event.target.value; setSlug(value); setManual(value !== ""); }} /><span>Đường dẫn được tạo từ tên cửa hàng. Bạn có thể thay đổi nếu muốn.</span></label>
  </>;
}
