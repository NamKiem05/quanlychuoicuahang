import type { ThemeManifest } from "./theme-studio";
import type { ThemePage } from "./theme-pages";

export const semanticThemeVersion = /^(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})$/;

type Snapshot = { manifest: ThemeManifest; metadata: Record<string, unknown> };
export type VersionDifference = { area: string; label: string; state: "added" | "modified" | "removed" | "unchanged";
  warning?: string; before?: unknown; after?: unknown };

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  return value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, field]) => [key, canonical(field)])) : value;
}
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

export function compareThemeSnapshots(before: Snapshot, after: Snapshot) {
  const differences: VersionDifference[] = [];
  const add = (area: string, label: string, a: unknown, b: unknown, warning?: string) => {
    differences.push({ area, label, state: same(a, b) ? "unchanged" : a === undefined ? "added" : b === undefined ? "removed" : "modified",
      before: a, after: b, ...(warning && !same(a,b) ? { warning } : {}) });
  };
  for (const key of new Set([...Object.keys(before.metadata), ...Object.keys(after.metadata)])) {
    const a = before.metadata[key];
    const b = after.metadata[key];
    add("Metadata", key, a, b, key === "families" && Array.isArray(a) && Array.isArray(b) && a.some(item => !b.includes(item))
      ? "Có ngành hàng bị loại khỏi danh sách tương thích." : undefined);
  }
  const { pages: oldPages = [], schemaVersion: oldSchema = 1, ...oldDesign } = before.manifest;
  const { pages: newPages = [], schemaVersion: newSchema = 1, ...newDesign } = after.manifest;
  add("Schema", "Phiên bản schema", oldSchema, newSchema, "Kiểm tra tương thích cấu hình cửa hàng khi đổi schema.");
  for (const key of Object.keys(oldDesign) as (keyof typeof oldDesign)[]) add("Thiết kế", key, oldDesign[key], newDesign[key]);
  add("Trang", "Thứ tự trang", oldPages.map(page => page.title || page.slug), newPages.map(page => page.title || page.slug));
  const oldById = new Map(oldPages.map(page => [page.id, page]));
  const newById = new Map(newPages.map(page => [page.id, page]));
  const metadata = (page: ThemePage) => {
    const { id, kind, slug, title, description, visible } = page;
    const meta = Object.fromEntries(Object.entries(page.meta ?? {}).filter(([key]) => key !== "createdAt" && key !== "updatedAt"));
    return { id, kind, slug, title, description, visible, meta };
  };
  for (const key of new Set([...oldById.keys(), ...newById.keys()])) {
    const a = oldById.get(key);
    const b = newById.get(key);
    const label = b?.title || a?.title || b?.slug || a?.slug || key;
    add("Trang", label, a && metadata(a), b && metadata(b), a?.visible && (!b || !b.visible || a.slug !== b.slug)
      ? "URL cũ có thể ngừng hoạt động." : undefined);
    const oldBlocks = new Map(a?.blocks.map(block => [block.id, block]));
    const newBlocks = new Map(b?.blocks.map(block => [block.id, block]));
    if (a && b) add("Component", `Thứ tự · ${label}`,
      a.blocks.map(block => ({ id: block.id, kind: block.kind })), b.blocks.map(block => ({ id: block.id, kind: block.kind })));
    for (const id of new Set([...oldBlocks.keys(), ...newBlocks.keys()])) {
      const previous = oldBlocks.get(id);
      const current = newBlocks.get(id);
      add("Component", `${label} · ${current?.title || previous?.title || current?.kind || previous?.kind || id}`, previous, current,
        previous && (!current || previous.kind !== current.kind) ? "Có thể xung đột nếu cửa hàng đã tùy chỉnh component này." : undefined);
    }
  }
  return differences;
}

export function themeManifestAssetKeys(manifest: ThemeManifest) {
  return [...new Set(manifest.pages?.flatMap(page => page.blocks.flatMap(block => block.image ? [block.image] : [])))];
}
