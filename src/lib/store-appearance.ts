export const storeThemes = [
  { id: "green", label: "Xanh lá", color: "#3d874a", description: "Tươi mát, gần gũi" },
  { id: "orange", label: "Cam ấm", color: "#d96b2b", description: "Nổi bật, năng động" },
  { id: "blue", label: "Xanh dương", color: "#367fb5", description: "Sạch sẽ, hiện đại" },
  { id: "rose", label: "Đỏ hồng", color: "#c45170", description: "Ấm áp, trẻ trung" },
] as const;

export type StoreThemePreset = (typeof storeThemes)[number]["id"];

export const storefrontSectionIds = ["hero", "menu", "reviews", "story"] as const;
export type StorefrontSection = (typeof storefrontSectionIds)[number];

export const storefrontSections: { id: StorefrontSection; label: string; description: string; required?: boolean }[] = [
  { id: "hero", label: "Ảnh bìa và giới thiệu", description: "Ảnh chính, lời chào và thông tin quán." },
  { id: "menu", label: "Thực đơn", description: "Danh sách món khách có thể chọn và đặt.", required: true },
  { id: "reviews", label: "Đánh giá", description: "Nhận xét đã được cửa hàng duyệt." },
  { id: "story", label: "Giới thiệu cửa hàng", description: "Lời nhắn và thông tin về quán." },
];

export const layoutPresets = [
  {
    id: "classic",
    label: "Cân bằng",
    description: "Giới thiệu trước, tiếp đến là thực đơn.",
    sectionOrder: ["hero", "menu", "reviews", "story"],
  },
  {
    id: "menu-first",
    label: "Thực đơn trước",
    description: "Đưa món ăn lên đầu để khách chọn nhanh.",
    sectionOrder: ["menu", "hero", "reviews", "story"],
  },
  {
    id: "story-first",
    label: "Giới thiệu trước",
    description: "Kể về cửa hàng trước khi khách xem món.",
    sectionOrder: ["hero", "story", "menu", "reviews"],
  },
] as const;

export type StorefrontLayoutPreset = (typeof layoutPresets)[number]["id"];

export const defaultSectionOrder: StorefrontSection[] = ["hero", "menu", "reviews", "story"];

export function isStoreThemePreset(value: string): value is StoreThemePreset {
  return storeThemes.some((theme) => theme.id === value);
}

export function isStorefrontLayoutPreset(value: string): value is StorefrontLayoutPreset {
  return layoutPresets.some((layout) => layout.id === value);
}

export function isStorefrontSection(value: unknown): value is StorefrontSection {
  return typeof value === "string" && storefrontSectionIds.includes(value as StorefrontSection);
}

export function normalizeSectionOrder(value: unknown): StorefrontSection[] {
  if (!Array.isArray(value)) return [...defaultSectionOrder];
  const requested = value.filter(isStorefrontSection);
  const unique = [...new Set(requested)];
  return [...unique, ...defaultSectionOrder.filter((section) => !unique.includes(section))];
}

export function normalizeHiddenSections(value: unknown): StorefrontSection[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isStorefrontSection).filter((section) => section !== "menu"))];
}
