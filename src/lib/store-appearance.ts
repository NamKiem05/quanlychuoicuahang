export const storeThemes = [
  { id: "green", label: "Xanh lá", color: "#3d874a", description: "Tươi mát, gần gũi" },
  { id: "orange", label: "Cam ấm", color: "#d96b2b", description: "Nổi bật, năng động" },
  { id: "blue", label: "Xanh dương", color: "#367fb5", description: "Sạch sẽ, hiện đại" },
  { id: "rose", label: "Đỏ hồng", color: "#c45170", description: "Ấm áp, trẻ trung" },
] as const;

export type StoreThemePreset = (typeof storeThemes)[number]["id"];

export function getStoreBannerUrls(value: unknown, legacyUrl: string | null) {
  const urls = Array.isArray(value) ? value.filter((url): url is string => typeof url === "string" && url.length > 0) : [];
  return [...new Set(urls.length ? urls : legacyUrl ? [legacyUrl] : [])].slice(0, 3);
}

export const storefrontStyles = [
  { id: "original", label: "Giao diện hiện tại", description: "Banner ngang và thẻ món bo góc." },
  { id: "modern", label: "Hiện đại", description: "Ảnh bìa bo góc, tiêu đề đậm và thẻ món nổi bật." },
  { id: "cozy", label: "Ấm cúng", description: "Kiểu chữ có chân, nền ấm và thẻ bo mềm." },
  { id: "minimal", label: "Tối giản", description: "Đường nét gọn, nền trắng và viền mảnh." },
] as const;

export type StorefrontStyle = (typeof storefrontStyles)[number]["id"];

export function isStorefrontStyle(value: unknown): value is StorefrontStyle {
  return storefrontStyles.some((style) => style.id === value);
}

export const storefrontSectionIds = ["hero", "menu", "reviews", "story"] as const;
export type StorefrontSection = (typeof storefrontSectionIds)[number];

export const storefrontSections: { id: StorefrontSection; label: string; description: string; required?: boolean }[] = [
  { id: "hero", label: "Banner cửa hàng", description: "Hiển thị trọn ảnh bìa ở phần banner." },
  { id: "menu", label: "Thực đơn", description: "Danh sách món khách có thể chọn và đặt.", required: true },
  { id: "reviews", label: "Đánh giá", description: "Nhận xét đã được cửa hàng duyệt." },
  { id: "story", label: "Giới thiệu cửa hàng", description: "Lời nhắn và thông tin về quán." },
];

export const layoutPresets = [
  {
    id: "classic",
    label: "Cân bằng",
    description: "Banner trước, tiếp đến là thực đơn.",
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
