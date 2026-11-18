import { redirect } from "next/navigation";
import { getBankByCode } from "@viet-qr/core";
import { createClient } from "@/lib/supabase/server";

type BillingClient = Awaited<ReturnType<typeof createClient>>;

export function getPlatformBankAccount() {
  const bankCode = process.env.MERCHANT_PLAN_BANK_CODE?.trim().toUpperCase();
  const accountNumber = process.env.MERCHANT_PLAN_ACCOUNT_NUMBER?.trim();
  const accountName = process.env.MERCHANT_PLAN_ACCOUNT_NAME?.trim();
  if (!bankCode || !accountNumber || !/^\d{6,30}$/.test(accountNumber) || !accountName) return null;
  const bank = getBankByCode(bankCode);
  if (!bank) return null;
  return { bank_code: bank.code, bank_name: bank.fullName, account_number: accountNumber, account_name: accountName };
}

export function getMerchantPlanWebhookSecret() {
  const secret = process.env.MERCHANT_PLAN_SEPAY_API_KEY?.trim();
  return secret && secret.length >= 32 && /^\S+$/.test(secret) && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ? secret : null;
}

export async function getMerchantPlanPaymentAvailability(client: BillingClient) {
  const { data, error } = await client.from("platform_payment_settings").select("sepay_enabled").eq("id", true).maybeSingle();
  if (error) {
    // Keep existing installations working until the optional switch is installed.
    if (["42P01", "PGRST205"].includes(error.code)) return { enabled: true, migrationMissing: true, error: false };
    return { enabled: false, migrationMissing: false, error: true };
  }
  return { enabled: data?.sepay_enabled === true, migrationMissing: false, error: !data };
}

export async function getCurrentMerchantPlan(client: BillingClient, userId: string) {
  return client.from("merchant_plan_payments")
    .select("plan, valid_until")
    .eq("user_id", userId).eq("status", "approved").gt("valid_until", new Date().toISOString())
    .order("valid_until", { ascending: false }).order("plan", { ascending: false }).limit(1).maybeSingle();
}

export async function hasMerchantPremium(client: BillingClient, storeId: string) {
  const { data, error } = await client.rpc("has_merchant_premium", { target_store: storeId });
  // Older deployments have only legacy stores until the billing migration is installed.
  return data === true || error?.code === "PGRST202";
}

export async function requireMerchantPremium(client: BillingClient, storeId: string) {
  if (!(await hasMerchantPremium(client, storeId))) redirect("/merchant-plan?message=premium-required");
}
