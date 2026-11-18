import type { createClient } from "@/lib/supabase/server";

type PlanRevenueDay = {
  revenue_day: string;
  revenue_vnd: number;
  paid_payments: number;
  upgrade_revenue_vnd: number;
};

type Payment = {
  id: string;
  paid_at: string;
  amount_vnd: number;
  upgrade_amount_vnd?: number | null;
  upgrade_expires_at?: string | null;
};

const vietnamDate = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });
const dayMs = 86_400_000;
const paymentFields = "id, paid_at, amount_vnd";
const pageSize = 250;

export async function getPlatformPlanRevenue(
  supabase: Awaited<ReturnType<typeof createClient>>,
  from: string,
  until: string,
) {
  const days = new Map<string, PlanRevenueDay>();
  for (let day = Date.parse(from); day < Date.parse(until); day += dayMs) {
    const date = new Date(day).toISOString().slice(0, 10);
    days.set(date, { revenue_day: date, revenue_vnd: 0, paid_payments: 0, upgrade_revenue_vnd: 0 });
  }

  const requestedAt = new Date().toISOString();
  let cursor: Payment | undefined;
  let fields = `${paymentFields}, upgrade_amount_vnd, upgrade_expires_at`;

  function fetchBatch(columns: string) {
    const query = supabase.from("merchant_plan_payments").select(columns)
      .eq("status", "approved")
      .gte("paid_at", `${from}T00:00:00+07:00`)
      .lt("paid_at", `${until}T00:00:00+07:00`)
      .lte("paid_at", requestedAt)
      .order("paid_at").order("id").limit(pageSize);
    if (cursor) {
      query.or(`paid_at.gt.${cursor.paid_at},and(paid_at.eq.${cursor.paid_at},id.gt.${cursor.id})`);
    }
    return query;
  }

  for (;;) {
    let result = await fetchBatch(fields);
    if (!cursor && result.error?.code === "42703" && fields !== paymentFields) {
      fields = paymentFields;
      result = await fetchBatch(fields);
    }
    if (result.error) return { days: [], error: result.error };
    const batch = (result.data ?? []) as unknown as Payment[];
    for (const payment of batch) {
      const paidAt = new Date(payment.paid_at);
      if (payment.upgrade_expires_at && paidAt.getTime() >= Date.parse(payment.upgrade_expires_at)) continue;
      const day = days.get(vietnamDate.format(paidAt));
      if (!day) continue;
      day.revenue_vnd += payment.upgrade_amount_vnd ?? payment.amount_vnd;
      day.paid_payments += 1;
      day.upgrade_revenue_vnd += payment.upgrade_amount_vnd ?? 0;
    }
    if (!batch.length) return { days: [...days.values()], error: null };
    cursor = batch.at(-1);
  }
}
