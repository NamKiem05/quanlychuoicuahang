"use client";

import { deleteProductOptionGroup, saveProductOptionGroup } from "../actions";

export type ProductOption = {
  id: string;
  name: string;
  price_adjustment_vnd: number;
};

export type ProductOptionGroup = {
  id: string;
  name: string;
  selection_mode: "single" | "multiple";
  min_selections: number;
  max_selections: number;
  options: ProductOption[];
};

function optionLines(group: ProductOptionGroup) {
  return group.options
    .map((option) => `${option.name}|${option.price_adjustment_vnd}`)
    .join("\n");
}

function OptionGroupForm({
  productId,
  group,
}: {
  productId: string;
  group?: ProductOptionGroup;
}) {
  return (
    <form className="dashboard-form compact-form product-option-form" action={saveProductOptionGroup}>
      <input type="hidden" name="product_id" value={productId} />
      {group && <input type="hidden" name="group_id" value={group.id} />}
      <label>Tên nhóm<input name="group_name" required maxLength={80} defaultValue={group?.name ?? ""} placeholder="Ví dụ: Chọn kích cỡ" /></label>
      <div className="form-row">
        <label>Cách chọn<select name="selection_mode" defaultValue={group?.selection_mode ?? "single"}><option value="single">Chọn một</option><option value="multiple">Chọn nhiều</option></select></label>
        <label className="product-option-required"><input type="checkbox" name="required" value="true" defaultChecked={(group?.min_selections ?? 0) > 0} /><span>Bắt buộc chọn</span></label>
      </div>
      <label>Các lựa chọn <span className="field-hint">Mỗi dòng: tên lựa chọn | số tiền cộng thêm</span><textarea name="options" rows={4} required maxLength={3000} defaultValue={group ? optionLines(group) : ""} placeholder={"Nhỏ|0\nVừa|5000\nLớn|10000"} /></label>
      <button className="secondary-submit" type="submit">{group ? "Lưu nhóm tùy chọn" : "+ Thêm nhóm tùy chọn"}</button>
    </form>
  );
}

export default function ProductOptionsManager({
  productId,
  groups,
}: {
  productId: string;
  groups: ProductOptionGroup[];
}) {
  return (
    <section className="product-options-manager" aria-label="Tùy chọn món">
      <div className="product-options-heading">
        <div><b>Tùy chọn món</b><small>Size, topping hoặc cách chế biến</small></div>
        <span>{groups.length} nhóm</span>
      </div>
      {groups.map((group) => (
        <details className="product-option-group-editor" key={group.id}>
          <summary>
            <span><b>{group.name}</b><small>{group.selection_mode === "single" ? "Chọn một" : "Chọn nhiều"} · {group.min_selections > 0 ? "Bắt buộc" : "Không bắt buộc"} · {group.options.length} lựa chọn</small></span>
            <span aria-hidden="true">⌄</span>
          </summary>
          <div className="product-option-group-body">
            <OptionGroupForm productId={productId} group={group} />
            <form action={deleteProductOptionGroup} onSubmit={(event) => {
              if (!window.confirm(`Xóa nhóm “${group.name}” và các lựa chọn của nhóm?`)) event.preventDefault();
            }}>
              <input type="hidden" name="group_id" value={group.id} />
              <button className="danger-submit" type="submit">Xóa nhóm</button>
            </form>
          </div>
        </details>
      ))}
      {groups.length < 40 ? (
        <div className="product-option-create">
          <OptionGroupForm productId={productId} />
        </div>
      ) : (
        <p className="dashboard-help">Mỗi món có thể có tối đa 40 nhóm tùy chọn.</p>
      )}
    </section>
  );
}
