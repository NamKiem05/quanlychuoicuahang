export const librarySorts = {
  newest: "Mới tạo", oldest: "Cũ nhất", updated: "Cập nhật gần đây", name_asc: "Tên A–Z", name_desc: "Tên Z–A",
  installations: "Nhiều lượt cài nhất", stores: "Nhiều cửa hàng sử dụng nhất",
} as const;

export const libraryLifecycle = { draft: "Bản nháp", published: "Đã phát hành", archived: "Đã lưu trữ" } as const;
export const libraryDistribution = { listed: "Đang phân phối", hidden: "Đã ẩn", unlisted: "Chưa niêm yết", paused: "Marketplace đang đóng" } as const;

function value(input: unknown, max: number) {
  return typeof input === "string" ? Array.from(input.trim()).slice(0, max).join("") : "";
}

function choice<T extends Record<string, string>>(options: T, input: unknown) {
  return typeof input === "string" && Object.hasOwn(options, input) ? input as Extract<keyof T, string> : undefined;
}

function date(input: unknown) {
  if (typeof input !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input) || input < "1900-01-01") return "";
  const time = Date.parse(input + "T00:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === input ? input : "";
}

export function themeLibraryFilters(query: Record<string, unknown>, families: Record<string, string>, idPattern: RegExp) {
  const from = date(query.from);
  const to = date(query.to);
  return {
    q: value(query.q, 100), status: choice(libraryLifecycle, query.status) ?? "",
    distribution: choice(libraryDistribution, query.distribution) ?? "",
    family: choice(families, query.family) ?? "", category: value(query.category, 80),
    creator: typeof query.creator === "string" && idPattern.test(query.creator) ? query.creator : "",
    dateField: query.dateField === "updated" ? "updated" : "created", from, to,
    order: choice(librarySorts, query.order) ?? "newest",
    page: typeof query.page === "string" && /^[1-9]\d{0,4}$/.test(query.page) && Number(query.page) <= 50001 ? Number(query.page) : 1,
    valid: (!query.from || !!from) && (!query.to || !!to) && (!from || !to || from <= to),
  };
}

export function themeImageUrl(value: string) {
  if (!value) return true;
  if (value.length > 2048 || !/^https:\/\//.test(value) || /[\s\\]/u.test(value)) return false;
  try {
    const url = new URL(value);
    return Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}
