import {
  blockCompatible, canBeThemeHome, contentPageTemplates, createThemeBlock, findThemeHome, readThemePages, themePageKinds,
  themePageSlug, validPageOgImage, type BlockKind, type ContentPageTemplate, type PageKind, type ThemePage, type ThemePageMeta,
} from "./theme-pages";

const templateBlocks: Record<ContentPageTemplate, BlockKind[]> = {
  content: ["announcement"], faq: ["announcement"], policy: ["announcement"], contact: ["contact"],
};
const systemBlocks: Partial<Record<PageKind, BlockKind[]>> = {
  home: ["announcement", "new_arrivals"], products: ["new_arrivals"], category: ["categories"],
  contact: ["contact"], about: ["story"],
};
const reserved = new Set(["checkout", "admin", "api", "login", "logout", "dashboard", "customer", "pages"]);
const slugBlocked = (slug: string) => Object.hasOwn(themePageKinds, slug) || reserved.has(slug);
export const pageTemplates = Object.entries(contentPageTemplates).map(([key, label]) => ({
  key: key as ContentPageTemplate,
  label,
  blocks: templateBlocks[key as ContentPageTemplate],
}));

type PageFields = { kind: PageKind; title: string; slug: string; description: string; visible: boolean; meta: ThemePageMeta };
export type PageCommand = { type: "create" | "edit"; id: string; fields: PageFields } |
  { type: "copy" | "delete" | "home" | "toggle" | "up" | "down"; id: string };

export function changeThemePages(pages: ThemePage[], command: PageCommand, options: {
  now: string; id: () => string; family: string; disabled: string[]; maxCustomPages: number;
}): { pages: ThemePage[]; selected: string } | { error: string } {
  const index = pages.findIndex(page => page.id.toLowerCase() === command.id.toLowerCase());
  const old = pages[index];
  const home = findThemeHome(pages);
  const error = (message: string) => ({ error: message });
  if (command.type !== "create" && !old) return error("Trang không thuộc giao diện đang mở.");
  const canAddCustom = pages.filter(page => page.kind === "custom").length < options.maxCustomPages;
  const stamp = (page: ThemePage): ThemePage => ({ ...page, meta: { ...page.meta, updatedAt: options.now } });
  let next = [...pages];
  let selected = old?.id ?? "";
  if (command.type === "create" || command.type === "edit") {
    const { kind, title, slug, description, visible, meta } = command.fields;
    const creating = command.type === "create";
    if (creating && (pages.length >= 16 || (kind === "custom" && !canAddCustom))) return error("Đã đạt giới hạn số trang của giao diện.");
    if (!Object.hasOwn(themePageKinds, kind) || (!creating && kind !== old.kind)) return error("Loại trang không hợp lệ.");
    if (!title.trim() || Array.from(title).length > 100 || Array.from(description).length > 240
      || !themePageSlug.test(slug) || slug.length > 64) return error("Kiểm tra tên, mô tả và slug của trang.");
    if (kind !== "custom" ? slug !== kind : slugBlocked(slug) && (creating || slug !== old.slug)) return error("Slug này dành cho trang hệ thống.");
    if (pages.some(page => (creating || page.id !== old.id) && page.slug === slug)) return error("Slug đã được sử dụng trong giao diện này.");
    if (!visible && (kind !== "custom" || (old && home?.id === old.id))) return error("Hãy chọn một trang chủ thay thế trước khi ẩn. Trang hệ thống luôn hiển thị.");
    if (meta.ogImage && !validPageOgImage(meta.ogImage)) return error("Ảnh Open Graph cần dùng URL HTTPS hợp lệ.");
    if (creating) {
      selected = options.id();
      const blocks = (kind === "custom" ? templateBlocks[meta.template ?? "content"] : systemBlocks[kind] ?? [])
        .filter(block => !options.disabled.includes(block) && blockCompatible(block, options.family))
        .map(block => createThemeBlock(block, options.id()));
      next.push({ id: selected, kind, slug, title, description, visible, blocks,
        meta: { ...meta, ...(kind === "home" ? { homepage: false } : {}), createdAt: options.now, updatedAt: options.now } });
    } else {
      next[index] = stamp({ ...old, title, slug, description, visible, meta: {
        ...meta, ...(old.meta?.homepage === undefined ? {} : { homepage: old.meta.homepage }),
        ...(old.meta?.createdAt ? { createdAt: old.meta.createdAt } : {}),
      } });
    }
  } else if (command.type === "copy") {
    if (pages.length >= 16 || !canAddCustom) return error("Đã đạt giới hạn số trang tùy chỉnh.");
    let suffix = 1;
    let slug = `${old.slug.slice(0, 53).replace(/-+$/, "")}-ban-sao`;
    while (pages.some(page => page.slug === slug)) {
      suffix += 1;
      slug = `${old.slug.slice(0, 50).replace(/-+$/, "")}-ban-sao-${suffix}`;
    }
    selected = options.id();
    next.splice(index + 1, 0, { ...old, id: selected, kind: "custom", slug,
      title: `${Array.from(old.title || themePageKinds[old.kind]).slice(0, 89).join("")} – bản sao`,
      visible: false, meta: { ...old.meta, template: old.meta?.template ?? (old.kind === "contact" ? "contact" : "content"),
        homepage: false, createdAt: options.now, updatedAt: options.now },
      blocks: old.blocks.map(block => ({ ...block, id: options.id() })),
    });
  } else if (command.type === "delete") {
    if (old.kind !== "custom") return error("Trang hệ thống không thể xóa.");
    if (home?.id === old.id) return error("Hãy chọn một trang chủ thay thế trước khi xóa.");
    next.splice(index, 1);
    selected = "";
  } else if (command.type === "home") {
    if (!old.visible || !canBeThemeHome(old.kind)) return error("Chỉ có thể chọn trang chủ hoặc trang nội dung đang hiển thị.");
    next = pages.map(page => page.id === old.id ? stamp({ ...page, meta: { ...page.meta, homepage: true } }) :
      page.meta?.homepage ? stamp({ ...page, meta: { ...page.meta, homepage: false } }) : page);
  } else if (command.type === "toggle") {
    if (old.kind !== "custom") return error("Trang hệ thống luôn hiển thị.");
    if (old.visible && home?.id === old.id) return error("Hãy chọn một trang chủ thay thế trước khi ẩn.");
    next[index] = stamp({ ...old, visible: !old.visible });
  } else {
    const target = index + (command.type === "up" ? -1 : 1);
    if (!pages[target]) return error("Trang đã ở đầu hoặc cuối danh sách.");
    next.splice(target, 0, ...next.splice(index, 1));
    next[target] = stamp(next[target]);
  }
  return readThemePages(next) ? { pages: next, selected } : error("Cấu hình trang không hợp lệ. Kiểm tra loại trang, SEO và danh sách component.");
}
