import { isStoreThemePreset, isStorefrontStyle, isStorefrontSection, storefrontSectionIds, type StorefrontSection, type StorefrontStyle, type StoreThemePreset } from "@/lib/store-appearance";
import { readablePublicThemePages, readThemePages, type ThemePage } from "./theme-pages";

export const themeFamilies = {
  food: "Đồ ăn và đồ uống", fashion: "Thời trang", beauty: "Mỹ phẩm",
  electronics: "Điện tử", home: "Nội thất và gia dụng", general: "Cửa hàng tổng hợp",
} as const;
export const themeIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ThemeManifest = {
  schemaVersion?: 2;
  pages?: ThemePage[];
  preset: StoreThemePreset;
  style: StorefrontStyle;
  order: StorefrontSection[];
  hidden: StorefrontSection[];
  headline: string;
  density: "compact" | "comfortable";
  settings: {
    font: "system" | "serif";
    radius: "soft" | "square";
    width: "standard" | "wide";
    columns: [number, number, number];
  };
};

export const defaultThemeManifest: ThemeManifest = {
  preset: "green", style: "original", order: [...storefrontSectionIds], hidden: [],
  headline: "", density: "comfortable",
  settings: { font: "system", radius: "soft", width: "standard", columns: [4, 3, 2] },
};

export function readThemeManifest(raw: unknown): ThemeManifest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const settings = value.settings as Record<string, unknown> | null | undefined;
  const pages = value.schemaVersion === 2 ? readThemePages(value.pages) : null;
  if ((value.schemaVersion === 2 ? !pages || Object.keys(value).length !== 9 : Object.keys(value).length !== 7)
    || typeof value.preset !== "string" || !isStoreThemePreset(value.preset) || !isStorefrontStyle(value.style)
    || !Array.isArray(value.order) || value.order.length !== storefrontSectionIds.length
    || !value.order.every(isStorefrontSection) || new Set(value.order).size !== storefrontSectionIds.length
    || !Array.isArray(value.hidden) || !value.hidden.every(isStorefrontSection)
    || value.hidden.includes("menu") || new Set(value.hidden).size !== value.hidden.length
    || typeof value.headline !== "string" || Array.from(value.headline).length > 100
    || (value.density !== "compact" && value.density !== "comfortable")
    || !settings || typeof settings !== "object" || Array.isArray(settings) || Object.keys(settings).length !== 4
    || (settings.font !== "system" && settings.font !== "serif")
    || (settings.radius !== "soft" && settings.radius !== "square")
    || (settings.width !== "standard" && settings.width !== "wide")
    || !Array.isArray(settings.columns) || settings.columns.length !== 3
    || !settings.columns.every((column, index) => Number.isInteger(column) && column >= 1 && column <= [6, 4, 2][index])) return null;
  return {
    ...(pages ? { schemaVersion: 2 as const, pages } : {}),
    preset: value.preset, style: value.style, order: value.order, hidden: value.hidden,
    headline: value.headline, density: value.density,
    settings: { font: settings.font, radius: settings.radius, width: settings.width, columns: settings.columns as [number, number, number] },
  };
}

export function readPublicThemeManifest(raw: unknown) {
  if (raw && typeof raw === "object" && "schemaVersion" in raw && raw.schemaVersion === 2 && "pages" in raw) {
    return readThemeManifest({ ...raw, pages: readablePublicThemePages(raw.pages) });
  }
  return readThemeManifest(raw);
}

export type ThemeProduct = {
  id: string; name: string; description: string; primary_family: keyof typeof themeFamilies;
  compatible_families: string[]; preview_url: string | null; price_vnd: number; release_id: string;
  version: string; manifest: ThemeManifest; licensed: boolean; owned_version: string | null;
  purchase_id: string | null; transfer_code: string | null; purchase_amount: number | null;
  purchases: number;
};
