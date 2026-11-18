"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getMerchantPlanPaymentAvailability, getMerchantPlanWebhookSecret, getPlatformBankAccount } from "@/lib/merchant-billing";
import { findMerchantPlan } from "@/lib/merchant-plans";
import { getMerchantContext } from "@/app/dashboard/data";

export async function requestMerchantPlan(formData: FormData) {
  const { supabase } = await getMerchantContext();
  const plan = findMerchantPlan(formData.get("plan"));
  if (!plan) redirect("/merchant-plan?message=invalid-plan");
  const availability = await getMerchantPlanPaymentAvailability(supabase);
  if (!availability.enabled || !getPlatformBankAccount() || !getMerchantPlanWebhookSecret()) redirect("/merchant-plan?message=unavailable");

  const { error } = await supabase.rpc("request_merchant_plan", { requested_plan: plan.id });
  if (error) redirect("/merchant-plan?message=request-failed");
  revalidatePath("/merchant-plan");
  redirect("/merchant-plan");
}

export async function cancelMerchantPlanPayment(paymentCode: string) {
  const { supabase } = await getMerchantContext();
  const { data, error } = await supabase.rpc("cancel_merchant_plan_payment", { payment_code: paymentCode });
  if (error) redirect("/merchant-plan?message=cancel-failed");
  revalidatePath("/merchant-plan");
  redirect(data ? "/merchant-plan?message=payment-cancelled" : "/merchant-plan?message=payment-changed");
}
