import type { themeFamilies } from "./theme-studio";

export const themePageKinds = {
  home: "Trang chủ", products: "Danh sách sản phẩm", product: "Chi tiết sản phẩm",
  category: "Danh mục", search: "Tìm kiếm", cart: "Giỏ hàng",
  contact: "Liên hệ", about: "Giới thiệu", custom: "Trang tùy chỉnh",
} as const;
export type PageKind = keyof typeof themePageKinds;
type Family = keyof typeof themeFamilies;
export type ThemeBlock = { id: string; kind: BlockKind; title: string; copy: string; limit: number; hidden: boolean };
export type ThemePage = { id: string; kind: PageKind; slug: string; title: string; description: string; visible: boolean; blocks: ThemeBlock[] };

const entry = (label: string, source: "catalog" | "categories" | "store" | "reviews" | "text", families?: readonly Family[]) => ({ label, source, families });
export const themeBlocks = {
  announcement: entry("Thông báo", "text"), story: entry("Giới thiệu thương hiệu", "store"),
  contact: entry("Liên hệ cửa hàng", "store"), testimonials: entry("Đánh giá", "reviews"),
  categories: entry("Danh mục sản phẩm", "categories"), new_arrivals: entry("Sản phẩm mới", "catalog"),
  food_menu: entry("Thực đơn", "catalog", ["food"]), fashion_collection: entry("Bộ sưu tập thời trang", "catalog", ["fashion"]),
  beauty_collection: entry("Sản phẩm chăm sóc cá nhân", "catalog", ["beauty"]),
  electronics_collection: entry("Sản phẩm điện tử", "catalog", ["electronics"]),
  home_collection: entry("Bộ sưu tập gia dụng", "catalog", ["home"]),
} as const;
export type BlockKind = keyof typeof themeBlocks;
export function blockCompatible(kind: BlockKind, family?: string) {
  const allowed = themeBlocks[kind].families;
  return !allowed || !family || allowed.some(value => value === family);
}
export const themePageSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const nodeId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function plain(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function readThemePages(input: unknown): ThemePage[] | null {
  if (!Array.isArray(input) || input.length > 16) return null;
  const ids = new Set<string>();
  const slugs = new Set<string>();
  const kinds = new Set<string>();
  for (const page of input) {
    if (!plain(page) || Object.keys(page).length !== 7 || typeof page.id !== "string" || !nodeId.test(page.id)
      || typeof page.kind !== "string" || !Object.hasOwn(themePageKinds, page.kind)
      || typeof page.slug !== "string" || page.slug.length > 64 || !themePageSlug.test(page.slug)
      || (page.kind === "custom" ? Object.hasOwn(themePageKinds, page.slug) : page.slug !== page.kind)
      || typeof page.title !== "string" || Array.from(page.title).length > 100
      || typeof page.description !== "string" || Array.from(page.description).length > 240
      || typeof page.visible !== "boolean" || (page.kind !== "custom" && !page.visible)
      || !Array.isArray(page.blocks) || page.blocks.length > 16
      || ids.has(page.id.toLowerCase()) || slugs.has(page.slug) || (page.kind !== "custom" && kinds.has(page.kind))) return null;
    ids.add(page.id.toLowerCase()); slugs.add(page.slug); kinds.add(page.kind);
    for (const block of page.blocks) {
      if (!plain(block) || Object.keys(block).length !== 6 || typeof block.id !== "string" || !nodeId.test(block.id)
        || ids.has(block.id.toLowerCase()) || typeof block.kind !== "string" || !Object.hasOwn(themeBlocks, block.kind)
        || typeof block.title !== "string" || Array.from(block.title).length > 100
        || typeof block.copy !== "string" || Array.from(block.copy).length > 500
        || typeof block.limit !== "number" || !Number.isInteger(block.limit) || block.limit < 1 || block.limit > 12
        || typeof block.hidden !== "boolean") return null;
      ids.add(block.id.toLowerCase());
    }
  }
  return input as ThemePage[];
}
