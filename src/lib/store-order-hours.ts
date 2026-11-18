export type OrderHours = ([number, number] | null)[];

const weekdays = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];
const minuteMs = 60_000;

export function formatOrderHour(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function getOrderHoursStatus(hours: OrderHours | null, timestamp: number) {
  if (!hours) return { open: true, nextOpening: null };

  // Vietnam uses UTC+07:00. Reading UTC fields avoids the browser's local zone.
  const vietnamTime = new Date(timestamp + 420 * minuteMs);
  const day = vietnamTime.getUTCDay();
  const minute = vietnamTime.getUTCHours() * 60 + vietnamTime.getUTCMinutes();
  const current = hours[day];
  const previous = hours[(day + 6) % 7];
  const openToday = current && minute >= current[0] && (current[0] > current[1] || minute < current[1]);
  const openFromYesterday = previous && previous[0] > previous[1] && minute < previous[1];
  if (openToday || openFromYesterday) return { open: true, nextOpening: null };

  for (let offset = 0; offset <= 7; offset++) {
    const nextDay = (day + offset) % 7;
    const window = hours[nextDay];
    if (!window || (offset === 0 && window[0] <= minute)) continue;
    const label = offset === 0 ? "hôm nay" : offset === 1 ? "ngày mai" : weekdays[nextDay];
    return { open: false, nextOpening: `${formatOrderHour(window[0])} ${label}` };
  }
  return { open: false, nextOpening: null };
}
