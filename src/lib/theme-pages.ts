import type { themeFamilies } from "./theme-studio";

export const themePageKinds = {
  home: "Trang chủ", products: "Danh sách sản phẩm", product: "Chi tiết sản phẩm",
  category: "Danh mục", search: "Tìm kiếm", cart: "Giỏ hàng",
  contact: "Liên hệ", about: "Giới thiệu", custom: "Trang tùy chỉnh",
} as const;
export type PageKind = keyof typeof themePageKinds;
type Family = keyof typeof themeFamilies;
export type ThemeBlock = { id: string; kind: BlockKind; title: string; copy: string; limit: number; hidden: boolean; image?: string };
export const contentPageTemplates = {
  content: "Nội dung", contact: "Liên hệ", faq: "Câu hỏi thường gặp", policy: "Chính sách",
} as const;
export type ContentPageTemplate = keyof typeof contentPageTemplates;
export type ThemePageMeta = {
  template?: ContentPageTemplate; homepage?: boolean; navigation?: boolean; createdAt?: string; updatedAt?: string;
  seoTitle?: string; seoDescription?: string; ogTitle?: string; ogDescription?: string; ogImage?: string; noindex?: boolean;
};
export type ThemePage = { id: string; kind: PageKind; slug: string; title: string; description: string; visible: boolean; blocks: ThemeBlock[]; meta?: ThemePageMeta };

export function canBeThemeHome(kind: PageKind) {
  return kind === "home" || kind === "custom" || kind === "about" || kind === "contact";
}

export function findThemeHome(pages: ThemePage[]) {
  return pages.find(page => page.visible && page.meta?.homepage)
    ?? pages.find(page => page.kind === "home" && page.visible && page.meta?.homepage !== false);
}

export function resolveThemePage(pages: ThemePage[], slug?: string) {
  return slug === undefined ? findThemeHome(pages) : pages.find(page => page.slug === slug && page.visible);
}

export function themePageInNavigation(page: Pick<ThemePage, "visible" | "meta" | "kind">) {
  return page.visible && (page.meta?.navigation ?? ["contact", "about", "custom", "products", "search", "cart"].includes(page.kind));
}

export function themePageTemplate(page: ThemePage) {
  return page.kind === "custom" ? page.meta?.template ?? "content" : page.kind;
}

export function validPageOgImage(value: string) {
  if (value.length > 2048 || !value.startsWith("https://")
    || !/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?(?:[/?#]|$)/i.test(value) || /[\s\\]/.test(value)) return false;
  try {
    return Boolean(new URL(value).hostname);
  } catch {
    return false;
  }
}

export const componentGroups = { banner: "Banner và thông báo", catalog: "Sản phẩm và bộ sưu tập", content: "Nội dung và thông tin" } as const;
type CatalogGroup = keyof typeof componentGroups;
type Source = "catalog" | "categories" | "store" | "reviews" | "text";
const entry = (label: string, description: string, group: CatalogGroup, source: Source, families?: readonly Family[]) =>
  ({ label, description, group, source, families, responsive: true, schema: 2, renderer: "ThemeBlockContent" });
export const themeBlocks = {
  announcement: entry("Thông báo", "Hiển thị nội dung thông báo và ảnh tùy chọn.", "banner", "text"),
  story: entry("Giới thiệu thương hiệu", "Kết hợp lời giới thiệu của theme với mô tả cửa hàng.", "content", "store"),
  contact: entry("Liên hệ cửa hàng", "Hiển thị địa chỉ và số điện thoại của cửa hàng.", "content", "store"),
  testimonials: entry("Đánh giá", "Hiển thị đánh giá hiện có của cửa hàng.", "content", "reviews"),
  categories: entry("Danh mục sản phẩm", "Tạo lưới liên kết đến danh mục của cửa hàng.", "catalog", "categories"),
  new_arrivals: entry("Sản phẩm mới", "Hiển thị lưới sản phẩm từ catalog của cửa hàng.", "catalog", "catalog"),
  food_menu: entry("Thực đơn", "Hiển thị món ăn cho cửa hàng ngành thực phẩm.", "catalog", "catalog", ["food"]),
  fashion_collection: entry("Bộ sưu tập thời trang", "Hiển thị lưới sản phẩm cho ngành thời trang.", "catalog", "catalog", ["fashion"]),
  beauty_collection: entry("Sản phẩm chăm sóc cá nhân", "Hiển thị lưới sản phẩm cho ngành chăm sóc cá nhân.", "catalog", "catalog", ["beauty"]),
  electronics_collection: entry("Sản phẩm điện tử", "Hiển thị lưới sản phẩm cho ngành điện tử.", "catalog", "catalog", ["electronics"]),
  home_collection: entry("Bộ sưu tập gia dụng", "Hiển thị lưới sản phẩm cho ngành gia dụng.", "catalog", "catalog", ["home"]),
} as const;
export type BlockKind = keyof typeof themeBlocks;
export type ComponentStatus = "active" | "disabled" | "deprecated";
export const componentStatuses = { active: "Đang hoạt động", disabled: "Đã vô hiệu hóa", deprecated: "Ngừng khuyến nghị" } as const;
export function componentStatus(kind: BlockKind, disabled: readonly string[], deprecated: readonly string[]): ComponentStatus {
  return disabled.includes(kind) ? "disabled" : deprecated.includes(kind) ? "deprecated" : "active";
}
export const componentFields = {
  title: { label: "Tiêu đề", type: "string", required: true, default: "", min: 0, max: 100 },
  copy: { label: "Nội dung", type: "text", required: true, default: "", min: 0, max: 500 },
  limit: { label: "Số mục hiển thị", type: "number", required: true, default: 6, min: 1, max: 12 },
  hidden: { label: "Ẩn", type: "boolean", required: true, default: false },
  image: { label: "Ảnh nội dung", type: "image", required: false, default: null },
} as const;
export function fieldsForComponent(kind: BlockKind) {
  const keys: (keyof typeof componentFields)[] = ["title", "copy"];
  if (["catalog", "categories", "reviews"].includes(themeBlocks[kind].source)) keys.push("limit");
  if (kind === "announcement") keys.push("image");
  keys.push("hidden");
  return keys;
}
export function createThemeBlock(kind: BlockKind, id: string): ThemeBlock {
  return { id, kind, title: componentFields.title.default, copy: componentFields.copy.default,
    limit: componentFields.limit.default, hidden: componentFields.hidden.default };
}
export function componentReleases(kind: BlockKind) {
  const base = { version: "1.0.0", note: "Renderer và các trường cấu hình chuẩn của manifest v2." };
  return kind === "announcement" ? [{ version: "1.1.0", note: "Thêm khóa ảnh tùy chọn. Instance cũ dùng chung renderer." }, base] : [base];
}
export const componentSources = { catalog: "Sản phẩm", categories: "Danh mục", store: "Thông tin cửa hàng", reviews: "Đánh giá", text: "Nội dung tĩnh" } as const;

export function filterThemeComponents<T extends { kind: BlockKind; status: ComponentStatus; themes: number; updatedAt?: string }>(
  entries: T[],
  filters: { term?: string; group?: string; source?: string; status?: string; family?: string; compatibility?: string; version?: string; responsive?: string; order?: string },
) {
  const term = filters.term?.trim().toLocaleLowerCase("vi");
  const nameOrder = new Intl.Collator("vi");
  return entries.filter(({ kind, status }) => {
    const entry = themeBlocks[kind];
    const compatible = blockCompatible(kind, filters.family);
    return (!term || `${entry.label} ${kind} ${entry.description}`.toLocaleLowerCase("vi").includes(term)) &&
      (!filters.group || entry.group === filters.group) && (!filters.source || entry.source === filters.source) &&
      (!filters.status || status === filters.status) && (!filters.version || componentReleases(kind)[0].version === filters.version) &&
      (!filters.responsive || entry.responsive === (filters.responsive === "yes")) &&
      (!filters.family || filters.compatibility === "all" || compatible === (filters.compatibility !== "incompatible"));
  }).sort((a, b) => {
    const name = nameOrder.compare(themeBlocks[a.kind].label, themeBlocks[b.kind].label);
    if (filters.order === "name_desc") return -name;
    if (filters.order === "usage") return b.themes - a.themes || name;
    if (filters.order === "updated") return (Date.parse(b.updatedAt ?? "") || 0) - (Date.parse(a.updatedAt ?? "") || 0) || name;
    return name;
  });
}
export function blockCompatible(kind: BlockKind, family?: string) {
  if (!Object.hasOwn(themeBlocks, kind)) return false;
  const allowed = themeBlocks[kind].families;
  return !allowed || !family || allowed.some(value => value === family);
}
export const themePageSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const nodeId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export const themeStudioImageKey = /^theme-studio\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(png|jpg|webp)$/;

export function themeImagePublicUrl(key: string | undefined) {
  const origin = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return origin && key && themeStudioImageKey.test(key)
    ? `${origin.replace(/\/$/, "")}/storage/v1/object/public/platform-assets/${key}` : null;
}

function plain(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validPageMeta(value: unknown, kind: PageKind, visible: boolean): value is ThemePageMeta {
  if (!plain(value)) return false;
  return Object.entries(value).every(([key, entry]) => {
    switch (key) {
      case "template": return kind === "custom" && typeof entry === "string" && Object.hasOwn(contentPageTemplates, entry);
      case "homepage": return typeof entry === "boolean" && (!entry || visible && canBeThemeHome(kind));
      case "navigation": case "noindex": return typeof entry === "boolean";
      case "createdAt": case "updatedAt": return typeof entry === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(entry);
      case "seoTitle": case "ogTitle": return typeof entry === "string" && Array.from(entry).length <= 100;
      case "seoDescription": case "ogDescription": return typeof entry === "string" && Array.from(entry).length <= 240;
      case "ogImage": return typeof entry === "string" && validPageOgImage(entry);
      default: return false;
    }
  });
}

export function readThemePages(input: unknown): ThemePage[] | null {
  if (!Array.isArray(input) || input.length > 16) return null;
  const ids = new Set<string>();
  const slugs = new Set<string>();
  const kinds = new Set<string>();
  let homepage = false;
  for (const page of input) {
    if (!plain(page) || Object.keys(page).length !== (Object.hasOwn(page, "meta") ? 8 : 7) || typeof page.id !== "string" || !nodeId.test(page.id)
      || typeof page.kind !== "string" || !Object.hasOwn(themePageKinds, page.kind)
      || typeof page.slug !== "string" || page.slug.length > 64 || !themePageSlug.test(page.slug)
      || (page.kind === "custom" ? Object.hasOwn(themePageKinds, page.slug) : page.slug !== page.kind)
      || typeof page.title !== "string" || Array.from(page.title).length > 100
      || typeof page.description !== "string" || Array.from(page.description).length > 240
      || typeof page.visible !== "boolean" || (page.kind !== "custom" && !page.visible)
      || !Array.isArray(page.blocks) || page.blocks.length > 16
      || ids.has(page.id.toLowerCase()) || slugs.has(page.slug) || (page.kind !== "custom" && kinds.has(page.kind))) return null;
    if (Object.hasOwn(page, "meta")) {
      if (!validPageMeta(page.meta, page.kind as PageKind, page.visible) || (homepage && page.meta.homepage)) return null;
      if (page.meta.homepage) homepage = true;
    }
    ids.add(page.id.toLowerCase()); slugs.add(page.slug); kinds.add(page.kind);
    for (const block of page.blocks) {
      if (!plain(block) || Object.keys(block).length !== (Object.hasOwn(block, "image") ? 7 : 6) || typeof block.id !== "string" || !nodeId.test(block.id)
        || ids.has(block.id.toLowerCase()) || typeof block.kind !== "string" || !Object.hasOwn(themeBlocks, block.kind)
        || typeof block.title !== "string" || Array.from(block.title).length > componentFields.title.max
        || typeof block.copy !== "string" || Array.from(block.copy).length > componentFields.copy.max
        || typeof block.limit !== "number" || !Number.isInteger(block.limit) || block.limit < componentFields.limit.min || block.limit > componentFields.limit.max
        || typeof block.hidden !== "boolean"
        || (Object.hasOwn(block, "image") && (block.kind !== "announcement" || typeof block.image !== "string" || !themeStudioImageKey.test(block.image)))) return null;
      ids.add(block.id.toLowerCase());
    }
  }
  return input as ThemePage[];
}

// Public rendering recovers valid pages and blocks from malformed legacy data.
// Editors still require the entire document to pass readThemePages.
export function readablePublicThemePages(input: unknown): ThemePage[] {
  const valid = readThemePages(input);
  if (valid) return valid;
  if (!Array.isArray(input)) return [];
  const pages: ThemePage[] = [];
  for (const page of input.slice(0, 16)) {
    if (!plain(page)) continue;
    const empty = { ...page, blocks: [] };
    if (!readThemePages([...pages, empty])) continue;
    const blocks: ThemeBlock[] = [];
    for (const block of (Array.isArray(page.blocks) ? page.blocks.slice(0, 16) : [])) {
      if (readThemePages([...pages, { ...page, blocks: [...blocks, block] }])) blocks.push(block);
    }
    pages.push({ ...empty, blocks } as ThemePage);
  }
  return pages;
}
