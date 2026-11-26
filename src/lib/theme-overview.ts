const vietnamDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit",
});
const dayMs = 86_400_000;

export const overviewPeriods = {
  today: "Hôm nay", "7d": "7 ngày gần nhất", "30d": "30 ngày gần nhất",
  month: "Tháng này", previous: "Tháng trước", year: "Năm nay", custom: "Tùy chỉnh",
} as const;

function dateValue(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const time = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(time) && iso(time) === value ? time : NaN;
}

function iso(time: number) {
  return new Date(time).toISOString().slice(0, 10);
}

export function themeOverviewFilters(query: Record<string, unknown>, now = new Date()) {
  const parts = vietnamDate.formatToParts(now);
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  const today = dateValue(`${part("year")}-${part("month")}-${part("day")}`);
  const date = new Date(today);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const period = typeof query.period === "string" && Object.hasOwn(overviewPeriods, query.period)
    ? query.period as keyof typeof overviewPeriods : "30d";
  const grain = query.grain === "week" || query.grain === "month" ? query.grain : "day";
  const sort = query.sort === "purchases" || query.sort === "revenue" ? query.sort : "installations";
  const page = typeof query.page === "string" && /^[1-9]\d{0,4}$/.test(query.page) ? Number(query.page) : 1;
  let end = today;
  let start = today - 29 * dayMs;
  switch (period) {
    case "today": start = today; break;
    case "7d": start = today - 6 * dayMs; break;
    case "month": start = Date.UTC(year, month, 1); break;
    case "previous":
      start = Date.UTC(year, month - 1, 1);
      end = Date.UTC(year, month, 1) - dayMs;
      break;
    case "year": start = Date.UTC(year, 0, 1); break;
    case "custom": start = dateValue(query.from); end = dateValue(query.to); break;
  }
  const valid = Number.isFinite(start) && Number.isFinite(end) && start >= Date.UTC(1900, 0, 1)
    && end <= today && end >= start && end - start < 366 * dayMs;
  return { period, grain, sort, page, valid, from: Number.isFinite(start) ? iso(start) : "",
    to: Number.isFinite(end) ? iso(end) : "", today: iso(today), exclusiveEnd: valid ? iso(end + dayMs) : "" };
}
