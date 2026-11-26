export const themeCreationMethods = { blank: "Tạo từ đầu", starter: "Tạo từ bản phát hành", clone: "Nhân bản giao diện" } as const;
export type ThemeCreationMethod = keyof typeof themeCreationMethods;
export const initialThemeVersion = "1.0.0";

export type ThemeCreationSource = {
  id: string; name: string; theme_slug: string; category: string; description: string; lifecycle: string;
  image: string | null; version: string | null; draft_revision: number; families: string[];
};
export type ThemeCreationCategory = { id: string; name: string; theme_family: string };

export function proposeThemeSlug(name: string) {
  return name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/đ/g,"d")
    .replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,80).replace(/-+$/g,"");
}

export function validCreationSlug(slug: string) {
  return slug.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}
