"use client";

import { useState } from "react";
import { createProduct, deleteProduct, setProductVisibility, updateProduct } from "../actions";
import ProductImageField from "./product-image-field";

type CategoryOption = { id: string; name: string };
type Product = {
  id: string;
  name: string;
  price_vnd: number;
  category_id: string | null;
  status: string;
  image_url: string | null;
  description: string;
  stock_quantity: number | null;
};

export default function ProductForm({
  storeId,
  categories,
  product,
}: {
  storeId: string;
  categories: CategoryOption[];
  product?: Product;
}) {
  const [isUploading, setIsUploading] = useState(false);

  return (
    <>
      <form className={"dashboard-form compact-form" + (product ? " product-editor-form" : "")} action={product ? updateProduct : createProduct}>
        {product && <input type="hidden" name="product_id" value={product.id} />}
        {product ? (
          <>
            <div className="form-row">
              <label>Tên món<input name="name" defaultValue={product.name} required maxLength={160} /></label>
              <label>Giá bán (đồng)<input name="price_vnd" type="number" min="0" step="1000" defaultValue={product.price_vnd} required /></label>
            </div>
            <div className="form-row">
              <label>Danh mục<select name="category_id" defaultValue={product.category_id ?? ""}><option value="">Chưa phân loại</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
              <label>Trạng thái<select name="status" defaultValue={product.status}><option value="active">Đang bán công khai</option><option value="draft">Bản nháp</option><option value="archived">Đã ẩn</option></select></label>
            </div>
          </>
        ) : (
          <>
            <label>Tên món<input name="name" required maxLength={160} placeholder="Tên sản phẩm" /></label>
            <label>Giá bán (đồng)<input name="price_vnd" type="number" min="0" step="1000" required placeholder="59000" /></label>
            <label>Danh mục<select name="category_id" defaultValue=""><option value="">Chưa phân loại</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          </>
        )}
        <label>Số lượng tồn kho <span className="field-hint">Để trống nếu không giới hạn số lượng</span><input name="stock_quantity" type="number" min="0" max="2147483647" step="1" defaultValue={product?.stock_quantity ?? ""} placeholder="Không giới hạn" /></label>
        <div className="product-image-form-field"><span>Ảnh món ăn <span className="field-hint">JPG, PNG hoặc WebP · tối đa 5 MB</span></span><ProductImageField storeId={storeId} initialUrl={product?.image_url ?? ""} onUploadingChange={setIsUploading} /></div>
        <label>Mô tả<textarea name="description" rows={2} maxLength={2000} defaultValue={product?.description ?? ""} placeholder="Mô tả ngắn về món ăn" /></label>
        {product ? (
          <button className="secondary-submit" type="submit" disabled={isUploading}>{isUploading ? "Đang tải ảnh..." : "Lưu thay đổi"}</button>
        ) : (
          <button className="primary-button dashboard-submit" type="submit" disabled={isUploading}>{isUploading ? "Đang tải ảnh..." : "Thêm vào thực đơn"}<span>→</span></button>
        )}
      </form>
      {product && (
        <div className="product-editor-actions">
          <form action={setProductVisibility}>
            <input type="hidden" name="product_id" value={product.id} />
            <input type="hidden" name="status" value={product.status === "active" ? "archived" : "active"} />
            <button className="secondary-submit" type="submit">{product.status === "active" ? "Ẩn món khỏi cửa hàng" : "Hiện món trên cửa hàng"}</button>
          </form>
          <form action={deleteProduct} onSubmit={(event) => {
            if (!window.confirm(`Bạn có chắc muốn xóa món “${product.name}” không? Thao tác này không thể hoàn tác.`)) event.preventDefault();
          }}>
            <input type="hidden" name="product_id" value={product.id} />
            <button className="danger-submit" type="submit">Xóa món</button>
          </form>
        </div>
      )}
    </>
  );
}
