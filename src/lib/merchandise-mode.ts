export type MerchandiseMode = "general" | "retail" | "food";
export const merchandiseModeLabels: Record<MerchandiseMode,string> = { general: "Dùng chung", retail: "Bán lẻ", food: "Đồ ăn và thức uống" };
export function isMerchandiseMode(value: unknown): value is MerchandiseMode { return typeof value === "string" && ["general", "retail", "food"].includes(value); }
