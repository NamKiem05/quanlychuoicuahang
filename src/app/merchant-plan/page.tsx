import type { Metadata } from "next";
import Link from "next/link";
import BankTransferQr from "@/app/bank-transfer-qr";
import SidebarIcon from "@/app/sidebar-icon";
import { signOut } from "@/app/dashboard/actions";
import { getMerchantContext } from "@/app/dashboard/data";
import { getCurrentMerchantPlan, getMerchantPlanPaymentAvailability, getMerchantPlanWebhookSecret, getPlatformBankAccount } from "@/lib/merchant-billing";
import { findMerchantPlan, formatPlanAmount, merchantPlans } from "@/lib/merchant-plans";
import { requestMerchantPlan } from "./actions";
import PaymentRefresh from "./payment-refresh";
import CancelPayment from "./cancel-payment";
import "./merchant-plan.css";

export const metadata: Metadata = { title: "Gói dịch vụ | Gần Đây" };
export const instant = false;

const messages: Record<string, string> = {
  "premium-required": "Tính năng này cần gói Nâng cao còn hiệu lực.",
  "invalid-plan": "Hãy chọn một gói dịch vụ hợp lệ.",
  "request-failed": "Chưa tạo được yêu cầu thanh toán. Vui lòng tải lại trang và thử lại.",
  unavailable: "Thanh toán gói dịch vụ hiện chưa sẵn sàng.",
  "payment-cancelled": "Đã hủy yêu cầu thanh toán. Bạn có thể chọn lại gói.",
  "payment-changed": "Trạng thái thanh toán đã thay đổi. Hãy kiểm tra thông tin bên dưới.",
  "cancel-failed": "Chưa hủy được yêu cầu. Vui lòng thử lại sau.",
};

const dateFormatter = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Ho_Chi_Minh",
});

export default async function MerchantPlanPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const [{ supabase, userId, store, requestedPlan }, query] = await Promise.all([getMerchantContext(), searchParams]);
  const pendingFields = "plan, amount_vnd, transfer_code";
  const [upgradePending, active, owner, cancellationSchema, paymentAvailability] = await Promise.all([
    supabase.from("merchant_plan_payments").select(`${pendingFields}, upgrade_amount_vnd, upgrade_expires_at`).eq("user_id", userId).eq("status", "pending").maybeSingle(),
    getCurrentMerchantPlan(supabase, userId),
    store ? supabase.rpc("get_store_billing_owner", { requested_store: store.id }).maybeSingle<{ billing_owner_id: string | null }>() : { data: null },
    supabase.from("merchant_plan_payments").select("cancelled_at").eq("user_id", userId).limit(0),
    getMerchantPlanPaymentAvailability(supabase),
  ]);
  const upgradeAvailable = !upgradePending.error;
  const pending = upgradePending.error?.code === "42703"
    ? await supabase.from("merchant_plan_payments").select(pendingFields).eq("user_id", userId).eq("status", "pending").maybeSingle()
    : upgradePending;
  const upgrade = upgradePending.data?.upgrade_expires_at ? upgradePending.data : null;
  const expiredQuote = Boolean(upgrade && !active.data && !active.error);
  const plan = findMerchantPlan(active.data?.plan);
  const pendingPlan = findMerchantPlan(pending.data?.plan);
  const preferredPlan = findMerchantPlan(requestedPlan);
  const bank = getPlatformBankAccount();
  const existingPaymentReady = Boolean(bank && getMerchantPlanWebhookSecret());
  const paymentReady = existingPaymentReady && paymentAvailability.enabled;
  const billingErrors = [pending.error, active.error, "error" in owner ? owner.error : null];
  const billingAvailable = !billingErrors.some(Boolean);
  const migrationMissing = billingErrors.some((error) =>
    error && ["PGRST205", "PGRST204", "42P01", "42703"].includes(error.code)
  );
  const linkedToDifferentAccount = Boolean(store && owner.data?.billing_owner_id !== userId);
  const message = query.message ? messages[query.message] : undefined;

  return (
    <main className="merchant-plan-page">
      <header className="merchant-plan-header">
        <Link className="merchant-plan-back" href={store ? "/dashboard" : "/"}><span aria-hidden="true">←</span> {store ? "Về quản lý cửa hàng" : "Về trang chủ"}</Link>
        <Link className="merchant-plan-back" href="/staff-invitations">Lời mời cửa hàng</Link>
        <form action={signOut}><button className="merchant-plan-signout">Đăng xuất</button></form>
      </header>
      <div className="merchant-plan-heading">
        <span className="merchant-plan-symbol"><SidebarIcon name="payment" /></span>
        <h1>Gói dịch vụ của cửa hàng</h1>
      </div>
      {message && <p className="merchant-plan-notice" role="status">{message}</p>}

      {!billingAvailable ? (
        <>
          <p className="merchant-plan-notice" role="alert">{migrationMissing
            ? "Thanh toán chưa mở vì hệ thống đang chờ cập nhật cơ sở dữ liệu."
            : "Chưa tải được trạng thái thanh toán. Vui lòng tải lại trang."}</p>
          {!store && <PlanOptions preferredId={preferredPlan?.id} />}
        </>
      ) : linkedToDifferentAccount ? (
        <p className="merchant-plan-notice">{owner.data?.billing_owner_id ? "Chủ tài khoản đã đăng ký gói sẽ quản lý thanh toán cho cửa hàng." : "Cửa hàng của bạn đang sử dụng quyền truy cập hiện có."}</p>
      ) : (
        <>
          {plan && active.data && (
            <section className="merchant-plan-active" aria-label="Gói đang hoạt động">
              <span className="merchant-plan-active-icon" aria-hidden="true">✓</span>
              <div>
                <h2>{plan.name} đang hoạt động</h2>
                <p>Có hiệu lực đến <strong>{dateFormatter.format(new Date(active.data.valid_until))}</strong></p>
              </div>
              <Link className="merchant-plan-button" href="/dashboard">{store ? "Mở quản lý cửa hàng" : "Tạo gian hàng"} <span aria-hidden="true">→</span></Link>
            </section>
          )}
          {expiredQuote && <p className="merchant-plan-notice" role="status">Mã nâng cấp đã hết hạn. Nếu đã chuyển khoản, hãy liên hệ hỗ trợ để đối soát.</p>}
          {pending.data && pendingPlan && !expiredQuote ? (
            <section className="merchant-plan-payment">
              <header className="merchant-plan-payment-header">
                <h2>{upgrade ? "Nâng cấp lên gói Nâng cao" : `Thanh toán ${pendingPlan.name.toLocaleLowerCase("vi-VN")}`}</h2>
                <span className="merchant-plan-pending">Chờ thanh toán</span>
              </header>
              {upgrade && <p>Chuyển khoản trước {dateFormatter.format(new Date(upgrade.upgrade_expires_at))}. Sau khi nâng cấp, ngày hết hạn vẫn giữ nguyên.</p>}
              {bank && existingPaymentReady ? (
                <BankTransferQr details={{ ...bank, amount: upgrade?.upgrade_amount_vnd ?? pending.data.amount_vnd, reference: pending.data.transfer_code }} />
              ) : (
                <p>Thông tin chuyển khoản hiện chưa sẵn sàng. Nếu đã chuyển, hãy kiểm tra trạng thái bên dưới.</p>
              )}
              <div className="merchant-plan-payment-actions">
                <p role="status">Gói tự kích hoạt khi hệ thống xác nhận đúng số tiền và nội dung chuyển khoản.</p>
                <div>
                  <PaymentRefresh />
                  {!cancellationSchema.error && <CancelPayment paymentCode={pending.data.transfer_code} />}
                </div>
              </div>
            </section>
          ) : paymentReady ? (
            <section aria-label={plan ? "Gia hạn gói" : "Chọn gói dịch vụ"}>
              <p className="merchant-plan-intro">{plan ? "Gia hạn thêm một tháng từ ngày hết hạn hiện tại." : store ? "Chọn gói dịch vụ để gia hạn cửa hàng." : "Chọn gói và thanh toán tháng đầu tiên để mở quyền tạo gian hàng."}</p>
              <div className="merchant-plan-grid">
                {(plan ? [plan] : merchantPlans).map((option) => (
                  <PlanCard key={option.id} option={option} preferred={!plan && option.id === preferredPlan?.id}>
                    <form action={requestMerchantPlan}>
                      <input type="hidden" name="plan" value={option.id} />
                      <button className="merchant-plan-button" type="submit">{plan ? "Tạo mã QR gia hạn" : `Chọn ${option.name.toLocaleLowerCase("vi-VN")}`} <span aria-hidden="true">→</span></button>
                    </form>
                  </PlanCard>
                ))}
                {plan?.id === "basic" && upgradeAvailable && (
                  <article className="merchant-plan-card" data-plan="plus">
                    <span className="merchant-plan-card-icon"><SidebarIcon name="promotions" /></span>
                    <h2>Nâng cấp lên gói Nâng cao</h2>
                    <p>Trả phần chênh lệch theo thời gian còn lại và giữ nguyên ngày hết hạn.</p>
                    <ul><li>Tạo mã khuyến mãi</li><li>Kết nối tên miền riêng</li><li>Chỉnh sửa giao diện</li></ul>
                    <form action={requestMerchantPlan}>
                      <input type="hidden" name="plan" value="plus" />
                      <button className="merchant-plan-button" type="submit">Nâng cấp ngay <span aria-hidden="true">→</span></button>
                    </form>
                  </article>
                )}
              </div>
            </section>
          ) : (
            <>
              <p className="merchant-plan-notice" role="status">{paymentAvailability.error ? "Chưa kiểm tra được trạng thái thanh toán. Vui lòng thử lại sau." : !paymentAvailability.enabled ? "Thanh toán mới hiện đang tạm dừng." : "Thanh toán đang chờ cấu hình tài khoản ngân hàng và SePay."}</p>
              {!plan && <PlanOptions preferredId={preferredPlan?.id} />}
            </>
          )}
        </>
      )}
    </main>
  );
}

function PlanOptions({ preferredId }: { preferredId?: string }) {
  return (
    <div className="merchant-plan-grid">
      {merchantPlans.map((option) => (
        <PlanCard option={option} preferred={option.id === preferredId} key={option.id} />
      ))}
    </div>
  );
}

function PlanCard({ option, preferred, children }: {
  option: (typeof merchantPlans)[number];
  preferred: boolean;
  children?: React.ReactNode;
}) {
  return (
    <article className="merchant-plan-card" data-plan={option.id} data-preferred={preferred}>
      <div className="merchant-plan-card-top">
        <span className="merchant-plan-card-icon"><SidebarIcon name={option.id === "basic" ? "store" : "promotions"} /></span>
        {preferred && <span className="merchant-plan-preferred">Đã chọn khi đăng ký</span>}
      </div>
      <h2>{option.name}</h2>
      <p className="merchant-plan-price"><strong>{formatPlanAmount(option.amount)}</strong><span>/ tháng</span></p>
      <ul>{option.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
      {children}
    </article>
  );
}
