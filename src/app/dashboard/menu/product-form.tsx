"use client";

import { useState } from "react";
import { createProduct, deleteProduct, setProductVisibility, updateProduct } from "../actions";
import ProductImageField from "./product-image-field";
import { dimensionFields, type Dimensions } from "@/lib/shipping/packaging";
import VariantBuilder from "./variant-builder";
import type { MerchandiseMode } from "@/lib/merchandise-mode";

type CategoryOption = { id: string; name: string };
type Product = {
  id: string;
  name: string;
  price_vnd: number;
  category_id: string | null;
  status: string;
  image_url: string | null;
  description: string;
  hasVariants?: boolean;
  shipping_dimensions?: Dimensions | null;
  stock_quantity: number | null;
  low_stock_threshold: number;
};

export default function ProductForm({
  storeId,
  categories,
  product,
  showLowStockThreshold,
  brands = [],
  mode = "general",
}: {
  storeId: string;
  categories: CategoryOption[];
  product?: Product;
  showLowStockThreshold: boolean;
  brands?: { id: string; name: string }[];
  mode?: MerchandiseMode;
}) {
  const [isUploading, setIsUploading] = useState(false);
  const [buildingVariants, setHasVariants] = useState(false);
  const hasVariants = buildingVariants || Boolean(product?.hasVariants);

  return (
    <>
      <form className={"dashboard-form compact-form" + (product ? " product-editor-form" : "")} action={product ? updateProduct : createProduct}>
        {product && <input type="hidden" name="product_id" value={product.id} />}
        {product ? (
          <>
            <div className="form-row">
              <label>{mode === "food" ? "Tên món" : "Tên sản phẩm"}<input name="name" defaultValue={product.name} required maxLength={160} /></label>
              <label>Giá bán (đồng)<input name="price_vnd" type="number" min="0" step="1000" defaultValue={product.price_vnd} required /></label>
            </div>
            <div className="form-row">
              <label>Danh mục<select name="category_id" defaultValue={product.category_id ?? ""}><option value="">Chưa phân loại</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
              <label>Trạng thái<select name="status" defaultValue={product.status}><option value="active">Đang bán công khai</option><option value="draft">Bản nháp</option><option value="archived">Đã ẩn</option></select></label>
            </div>
          </>
        ) : (
          <>
            <label>Tên sản phẩm<input name="name" required maxLength={160} placeholder={mode === "food" ? "Tên món ăn hoặc đồ uống" : "Tên sản phẩm"} /></label>
            <label>Giá bán (đồng)<input name="price_vnd" type="number" min="0" step="1000" required placeholder="59000" /></label>
            <label>Danh mục<select name="category_id" defaultValue=""><option value="">Chưa phân loại</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            {brands.length > 0 && <label>Thương hiệu<select name="brand_id" defaultValue=""><option value="">Chưa chọn thương hiệu</option>{brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label>}
          </>
        )}
        <div className="form-row">
          {!buildingVariants && <label>Số lượng tồn kho <span className="field-hint">Để trống nếu không giới hạn số lượng</span><input name="stock_quantity" type="number" min="0" max="2147483647" step="1" defaultValue={product?.stock_quantity ?? ""} placeholder="Không giới hạn" /></label>}
          {showLowStockThreshold && <label>Ngưỡng cảnh báo tồn kho <span className="field-hint">Cảnh báo khi tồn kho bằng hoặc thấp hơn ngưỡng</span><input name="low_stock_threshold" type="number" min="0" max="2147483647" step="1" defaultValue={product?.low_stock_threshold ?? 5} required /></label>}
        </div>
        {hasVariants ? (product && <p className="dashboard-help">Nhập cân nặng và kích thước của từng biến thể trong mục Quản lý biến thể sản phẩm.</p>) : <fieldset>
          <legend>Thông tin vận chuyển cho một sản phẩm</legend>
          <p className="dashboard-help">Nhập đủ bốn thông số để tính phí GHN.</p>
          <div className="form-row">
            {dimensionFields.map(([key, label, max]) => (
              <label key={key}>{label}<input name={key} type="number" min={1} max={max} step={1} defaultValue={product?.shipping_dimensions?.[key]} /></label>
            ))}
          </div>
        </fieldset>}
        <div className="product-image-form-field"><span>{mode === "food" ? "Ảnh món" : "Ảnh sản phẩm"} <span className="field-hint">JPG, PNG hoặc WebP · tối đa 5 MB</span></span><ProductImageField storeId={storeId} initialUrl={product?.image_url ?? ""} onUploadingChange={setIsUploading} /></div>
        <label>Mô tả<textarea name="description" rows={2} maxLength={2000} defaultValue={product?.description ?? ""} placeholder={mode === "food" ? "Mô tả ngắn về món" : "Mô tả ngắn về sản phẩm"} /></label>
        {!product && mode !== "food" && <VariantBuilder onEnabledChange={setHasVariants} />}
        {!product && mode === "food" && <p className="dashboard-help">Sau khi tạo món, mở quản lý món để thêm size, topping và các lựa chọn khác.</p>}
        {product ? (
          <button className="secondary-submit" type="submit" disabled={isUploading}>{isUploading ? "Đang tải ảnh..." : "Lưu thay đổi"}</button>
        ) : (
          <button className="primary-button dashboard-submit" type="submit" disabled={isUploading}>{isUploading ? "Đang tải ảnh..." : (mode === "food" ? "Thêm món" : "Thêm sản phẩm")}<span>→</span></button>
        )}
      </form>
      {product && (
        <div className="product-editor-actions">
          <form action={setProductVisibility}>
            <input type="hidden" name="product_id" value={product.id} />
            <input type="hidden" name="status" value={product.status === "active" ? "archived" : "active"} />
            <button className="secondary-submit" type="submit">{product.status === "active" ? "Ẩn sản phẩm khỏi cửa hàng" : "Hiện sản phẩm trên cửa hàng"}</button>
          </form>
          <form action={deleteProduct} onSubmit={(event) => {
            if (!window.confirm(`Bạn có chắc muốn xóa sản phẩm “${product.name}” không? Thao tác này không thể hoàn tác.`)) event.preventDefault();
          }}>
            <input type="hidden" name="product_id" value={product.id} />
            <button className="danger-submit" type="submit">Xóa sản phẩm</button>
          </form>
        </div>
      )}
    </>
  );
}
