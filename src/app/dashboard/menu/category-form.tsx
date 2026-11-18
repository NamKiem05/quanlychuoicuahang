"use client";

import { useActionState, useState } from "react";
import { deleteCategory, saveCategory } from "../actions";
import ProductImageField from "./product-image-field";

type Category = { id: string; name: string; image: string | null };

export default function CategoryForm({ storeId, imagesAvailable, category }: { storeId: string; imagesAvailable: boolean; category?: Category }) {
  const [error, action, pending] = useActionState(saveCategory.bind(null, category?.id ?? null, category?.image ?? null), null);
  const [name, setName] = useState(category?.name ?? "");
  const [uploading, setUploading] = useState(false);

  return (
    <>
      <form className="dashboard-form compact-form" action={action}>
        <label>
          Tên danh mục
          <input name="name" required maxLength={100} placeholder="Ví dụ: Áo, đồ uống, phụ kiện" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        {imagesAvailable ? (
          <fieldset className="product-image-form-field" disabled={pending}>
            <legend>Ảnh danh mục <span className="field-hint">Không bắt buộc · JPG, PNG hoặc WebP · tối đa 5 MB</span></legend>
            <ProductImageField storeId={storeId} initialUrl={category?.image ?? ""} kind="category" onUploadingChange={setUploading} />
          </fieldset>
        ) : (
          <p className="dashboard-help">Cần cập nhật cơ sở dữ liệu để thêm ảnh danh mục.</p>
        )}
        {error && <p className="admin-error" role="alert">{error}</p>}
        <button className="secondary-submit" type="submit" disabled={uploading || pending}>
          {pending ? "Đang lưu…" : category ? "Lưu danh mục" : "+ Thêm danh mục"}
        </button>
      </form>
      {category && <CategoryDeleteForm category={category} disabled={pending || uploading} />}
    </>
  );
}

function CategoryDeleteForm({ category, disabled }: { category: Category; disabled: boolean }) {
  const [error, action, pending] = useActionState(deleteCategory.bind(null, category.id), null);

  return (
    <form className="category-delete-form" action={action} onSubmit={(event) => {
      if (!window.confirm(`Xóa danh mục “${category.name}”?`)) event.preventDefault();
    }}>
      {error && <p className="admin-error" role="alert">{error}</p>}
      <button className="product-visibility-button" type="submit" disabled={pending || disabled}>{pending ? "Đang xóa…" : "Xóa danh mục"}</button>
    </form>
  );
}
