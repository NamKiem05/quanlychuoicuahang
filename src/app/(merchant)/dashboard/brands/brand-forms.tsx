"use client";

import { useActionState, useState } from "react";
import ProductImageField from "../menu/product-image-field";
import { assignBrand, deleteBrand, saveBrand } from "./actions";

export type Brand = { id: string; name: string; description: string; logo_url: string | null };

export function BrandForm({ storeId, brand }: { storeId: string; brand?: Brand }) {
  const [error, action, pending] = useActionState(saveBrand.bind(null, brand?.id ?? null), null);
  const [uploading, setUploading] = useState(false);
  return <form className="brand-form" action={action}><label>Tên thương hiệu<input name="name" required maxLength={100} defaultValue={brand?.name} placeholder="Ví dụ: Thương hiệu của bạn" /></label><label>Mô tả<textarea name="description" maxLength={2000} defaultValue={brand?.description} rows={3} placeholder="Giới thiệu ngắn về thương hiệu" /></label><fieldset disabled={pending}><legend>Logo thương hiệu <small>Không bắt buộc · JPG, PNG, WebP · tối đa 5 MB</small></legend><ProductImageField storeId={storeId} initialUrl={brand?.logo_url ?? ""} kind="brand" onUploadingChange={setUploading} /></fieldset>{error && <p className="brand-error" role="alert">{error}</p>}<button className="brand-primary" type="submit" disabled={pending || uploading}>{pending ? "Đang lưu…" : brand ? "Lưu thay đổi" : "Thêm thương hiệu"}</button></form>;
}

export function DeleteBrand({ brand }: { brand: Brand }) {
  const [error, action, pending] = useActionState(deleteBrand.bind(null, brand.id), null);
  return <form action={action} onSubmit={(event) => { if (!window.confirm(`Xóa thương hiệu “${brand.name}”?`)) event.preventDefault(); }}>{error && <p className="brand-error" role="alert">{error}</p>}<button className="brand-delete" type="submit" disabled={pending}>{pending ? "Đang xóa…" : "Xóa thương hiệu"}</button></form>;
}

export function AssignBrand({ productId, brandId, brands }: { productId: string; brandId: string | null; brands: Brand[] }) {
  const [error, action, pending] = useActionState(assignBrand, null);
  return <form className="brand-assign" action={action}><input type="hidden" name="product_id" value={productId} /><label><span className="sr-only">Thương hiệu của sản phẩm</span><select name="brand_id" defaultValue={brandId ?? ""}><option value="">Chưa có thương hiệu</option>{brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label><button type="submit" disabled={pending}>{pending ? "Đang lưu…" : "Lưu"}</button>{error && <p className="brand-error" role="alert">{error}</p>}</form>;
}
