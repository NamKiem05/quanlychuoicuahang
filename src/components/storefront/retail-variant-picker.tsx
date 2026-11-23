"use client";

import { useMemo, useState } from "react";

export type RetailVariant = {
  id: string;
  attributes: Record<string, string>;
  price: number;
  stock: number;
};

/** Selection only: checkout must independently validate price and stock on the server. */
export default function RetailVariantPicker({ variants, onSelect }: {
  variants: RetailVariant[];
  onSelect: (variant: RetailVariant | null) => void;
}) {
  const [selected, setSelected] = useState<Record<string, string>>({});
  const groups = useMemo(() => {
    const attributes = new Map<string, Set<string>>();
    for (const variant of variants) {
      for (const [name, value] of Object.entries(variant.attributes)) {
        if (!attributes.has(name)) attributes.set(name, new Set());
        attributes.get(name)!.add(value);
      }
    }
    return [...attributes].map(([name, values]) => ({ name, values: [...values] }));
  }, [variants]);

  const matching = (choices: Record<string, string>) => variants.find((variant) =>
    groups.every(({ name }) => choices[name] && variant.attributes[name] === choices[name]) &&
    Object.keys(variant.attributes).length === groups.length,
  );
  const match = matching(selected);

  function choose(name: string, value: string) {
    const next = { ...selected, [name]: value };
    setSelected(next);
    onSelect(matching(next) ?? null);
  }

  return <div className="retail-variant-picker">
    {groups.map(({ name, values }) => <fieldset className="retail-detail-options" key={name}>
      <legend>{name}</legend>
      <div>{values.map((value) => <button type="button" key={value}
        className={selected[name] === value ? "selected" : ""}
        aria-pressed={selected[name] === value}
        onClick={() => choose(name, value)}>{value}</button>)}</div>
    </fieldset>)}
    <p className="retail-detail-hint" aria-live="polite">{match
      ? match.stock > 0 ? `${match.price.toLocaleString("vi-VN")}₫ · Còn ${match.stock}` : "Biến thể này đã hết hàng."
      : groups.every(({ name }) => selected[name]) ? "Không có tổ hợp này." : "Chọn đầy đủ các thuộc tính."}</p>
  </div>;
}
